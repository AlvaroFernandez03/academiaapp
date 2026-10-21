// routes/admin-billing.js — gestión de cuotas para la administración
const express = require("express");
const db = require("../db/database");
const { requireAuth, requireRole } = require("../middleware/auth");
const billing = require("../services/billing");
const { getAllSettings, setSetting } = require("../services/settings");
const { getStripe, isCardDemo } = require("../services/stripeClient");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (err) {
    if (err instanceof billing.BillingError) return res.status(err.status).json({ error: err.message });
    console.error("Error en administración de cuotas:", err);
    res.status(500).json({ error: "Ha ocurrido un error inesperado." });
  }
};

// --- Cuotas ---
const ESTADOS = ["pendiente_pago", "procesando", "activa", "pausada", "impagada", "cancelada"];

router.get("/memberships", handle((req) => {
  const { status } = req.query;
  if (status && !ESTADOS.includes(status)) throw new billing.BillingError("Estado no válido.");
  return db
    .prepare(
      `SELECT ms.id, ms.status, ms.payment_method, ms.price_cents, ms.current_period_end, ms.cancel_at_period_end,
              ms.paused_until, ms.created_at, m.first_name, m.last_name,
              a.name AS account_name, a.email AS account_email, a.phone AS account_phone, p.name AS plan_name
       FROM memberships ms
       JOIN members m ON m.id = ms.member_id JOIN accounts a ON a.id = ms.account_id JOIN plans p ON p.id = ms.plan_id
       ${status ? "WHERE ms.status = ?" : ""}
       ORDER BY CASE ms.status WHEN 'impagada' THEN 0 WHEN 'pendiente_pago' THEN 1 WHEN 'procesando' THEN 2
                WHEN 'activa' THEN 3 WHEN 'pausada' THEN 4 ELSE 5 END, m.first_name`
    )
    .all(...(status ? [status] : []));
}));

router.post("/memberships/:id/manual-payment", handle((req) =>
  billing.recordManualPayment({
    membershipId: Number(req.params.id),
    method: req.body.method,
    months: req.body.months,
    notes: req.body.notes,
    adminAccountId: req.accountId,
  })
));

router.post("/memberships/:id/cancel", handle((req) =>
  billing.cancelMembership({ accountId: req.accountId, membershipId: Number(req.params.id), isAdmin: true })
));

// --- Pagos recibidos ---
router.get("/payments", handle(() =>
  db
    .prepare(
      `SELECT pa.*, a.name AS account_name, pl.name AS plan_name, m.first_name AS member_first_name
       FROM payments pa JOIN accounts a ON a.id = pa.account_id
       LEFT JOIN memberships ms ON ms.id = pa.membership_id LEFT JOIN plans pl ON pl.id = ms.plan_id
       LEFT JOIN members m ON m.id = ms.member_id
       ORDER BY pa.created_at DESC, pa.id DESC LIMIT 200`
    )
    .all()
));

// --- Planes ---
router.get("/plans", handle(() =>
  db
    .prepare(
      `SELECT p.*, d.name AS discipline_name,
              (SELECT COUNT(*) FROM memberships ms WHERE ms.plan_id = p.id AND ms.status IN ('activa', 'pausada', 'impagada')) AS live_count
       FROM plans p LEFT JOIN disciplines d ON d.id = p.discipline_id ORDER BY p.active DESC, p.name`
    )
    .all()
));

function validarPlan(b) {
  const nombre = (b.name || "").trim();
  if (!nombre) throw new billing.BillingError("El plan necesita un nombre.");
  const precio = Number(b.price_cents);
  if (!Number.isInteger(precio) || precio < 1) throw new billing.BillingError("El precio no es válido.");
  let limite = b.max_classes_per_week === "" || b.max_classes_per_week == null ? null : Number(b.max_classes_per_week);
  if (limite !== null && (!Number.isInteger(limite) || limite < 1 || limite > 14)) {
    throw new billing.BillingError("El límite semanal debe estar entre 1 y 14 clases (o vacío para ilimitado).");
  }
  return { nombre, precio, limite, descripcion: (b.description || "").trim() || null };
}

router.post("/plans", handle((req) => {
  const { nombre, precio, limite, descripcion } = validarPlan(req.body);
  const scope = req.body.scope === "all" ? "all" : "discipline";
  let disciplinaId = null;
  if (scope === "discipline") {
    disciplinaId = Number(req.body.discipline_id);
    if (!db.prepare("SELECT id FROM disciplines WHERE id = ?").get(disciplinaId)) {
      throw new billing.BillingError("Elige la disciplina que incluye el plan.");
    }
  }
  const r = db
    .prepare("INSERT INTO plans (name, description, price_cents, scope, discipline_id, max_classes_per_week) VALUES (?, ?, ?, ?, ?, ?)")
    .run(nombre, descripcion, precio, scope, disciplinaId, limite);
  return { id: r.lastInsertRowid };
}));

// Editar un plan. El precio nuevo solo afecta a las altas nuevas: las cuotas
// ya contratadas mantienen el precio con el que se contrataron.
router.put("/plans/:id", handle((req) => {
  const plan = db.prepare("SELECT * FROM plans WHERE id = ?").get(req.params.id);
  if (!plan) throw new billing.BillingError("Plan no encontrado.", 404);
  const datos = { ...plan, ...req.body };
  const { nombre, precio, limite, descripcion } = validarPlan(datos);
  const activo = datos.active === true || datos.active === 1 || datos.active === "1" ? 1 : 0;
  db.prepare("UPDATE plans SET name = ?, description = ?, price_cents = ?, max_classes_per_week = ?, active = ? WHERE id = ?")
    .run(nombre, descripcion, precio, limite, activo, plan.id);
  return { success: true };
}));

// --- Ajustes ---
router.get("/settings", handle(() => ({ ...getAllSettings(), stripe_enabled: !!getStripe(), card_demo: isCardDemo() })));

router.put("/settings", handle((req) => {
  const b = req.body;
  const cambios = {};
  const entero = (valor, min, max, nombre) => {
    const n = Number(valor);
    if (!Number.isInteger(n) || n < min || n > max) throw new billing.BillingError(`${nombre}: debe estar entre ${min} y ${max}.`);
    return String(n);
  };
  if (b.family_billing_mode !== undefined) {
    if (!["separate", "combined"].includes(b.family_billing_mode)) throw new billing.BillingError("Modo de cobro familiar no válido.");
    cambios.family_billing_mode = b.family_billing_mode;
  }
  ["require_membership_to_book", "allow_manual_payment"].forEach((k) => {
    if (b[k] !== undefined) cambios[k] = b[k] === true || b[k] === "1" || b[k] === 1 ? "1" : "0";
  });
  if (b.trial_classes !== undefined) cambios.trial_classes = entero(b.trial_classes, 0, 10, "Clases de prueba");
  if (b.grace_days !== undefined) cambios.grace_days = entero(b.grace_days, 0, 60, "Días de margen");
  if (b.max_pause_days !== undefined) cambios.max_pause_days = entero(b.max_pause_days, 7, 365, "Duración máxima de pausa");

  if (!getStripe() && cambios.allow_manual_payment === "0") {
    throw new billing.BillingError("Sin Stripe configurado, el pago en recepción es la única forma de cobrar: no se puede desactivar.");
  }
  Object.entries(cambios).forEach(([k, v]) => setSetting(k, v));
  return { ...getAllSettings(), stripe_enabled: !!getStripe(), card_demo: isCardDemo() };
}));

// Lanzar a mano la revisión que el servidor hace cada hora (útil para pruebas).
router.post("/maintenance/run", handle(() => billing.runMaintenance()));

module.exports = router;
