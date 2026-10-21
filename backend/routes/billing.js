// routes/billing.js — cuotas desde el lado de la familia
const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");
const billing = require("../services/billing");

const router = express.Router();

// Envuelve cada ruta: convierte los BillingError en respuestas con su código
// y su mensaje, y cualquier otro error en un 500 genérico (sin filtrar
// detalles internos al navegador).
const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (err) {
    if (err instanceof billing.BillingError) return res.status(err.status).json({ error: err.message });
    console.error("Error en cuotas:", err);
    res.status(500).json({ error: "Ha ocurrido un error inesperado." });
  }
};

// Público: los planes activos (para mostrarlos antes incluso de registrarse).
router.get("/plans", (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT p.id, p.name, p.description, p.price_cents, p.scope, p.max_classes_per_week, d.name AS discipline_name
         FROM plans p LEFT JOIN disciplines d ON d.id = p.discipline_id WHERE p.active = 1 ORDER BY p.price_cents`
      )
      .all()
  );
});

router.use(requireAuth);

router.get("/overview", handle((req) => billing.getOverview(req.accountId)));

router.post(
  "/memberships",
  handle((req) =>
    billing.createMembership({
      accountId: req.accountId,
      memberId: Number(req.body.member_id),
      planId: Number(req.body.plan_id),
      paymentMethod: req.body.payment_method,
    })
  )
);

router.post("/memberships/:id/pause", handle((req) =>
  billing.pauseMembership({ accountId: req.accountId, membershipId: Number(req.params.id), until: req.body.until })
));
router.post("/memberships/:id/resume", handle((req) =>
  billing.resumeMembership({ accountId: req.accountId, membershipId: Number(req.params.id) })
));
router.post("/memberships/:id/cancel", handle((req) =>
  billing.cancelMembership({ accountId: req.accountId, membershipId: Number(req.params.id) })
));
router.post("/memberships/:id/retry", handle((req) =>
  billing.retryMembership({ accountId: req.accountId, membershipId: Number(req.params.id) })
));

router.post("/setup-session", handle(async (req) => ({ url: await billing.createSetupSession(req.accountId) })));
router.post("/confirm-setup", handle((req) => {
  if (!req.body.session_id) throw new billing.BillingError("Falta la sesión de pago.");
  return billing.completeSetupSession(req.body.session_id, req.accountId);
}));
router.post("/portal-session", handle(async (req) => ({ url: await billing.createPortalSession(req.accountId) })));

module.exports = router;
