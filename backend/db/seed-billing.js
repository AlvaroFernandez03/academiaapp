// db/seed-billing.js
// Ajustes por defecto y planes de ejemplo. Se ejecuta aunque la base de datos
// ya exista: los ajustes solo se insertan si faltan, y los planes solo si no
// hay ninguno todavía. Así una academia que ya usaba la versión anterior
// recibe los planes al actualizar, sin tocar sus datos.
const { todayStr, addDays, addMonths } = require("../utils/dates");

const AJUSTES_POR_DEFECTO = {
  family_billing_mode: "separate",      // 'separate' | 'combined'
  require_membership_to_book: "1",      // exigir cuota para reservar
  trial_classes: "1",                   // clases de prueba gratuitas por persona
  grace_days: "5",                      // días de margen antes de marcar impagada una cuota en efectivo
  allow_manual_payment: "1",            // permitir pagar en recepción
  max_pause_days: "90",                 // duración máxima de una pausa
};

function seedBilling(db, { demo = true } = {}) {
  // Los ajustes por defecto hacen falta siempre, con o sin datos de ejemplo.
  const insertAjuste = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  Object.entries(AJUSTES_POR_DEFECTO).forEach(([k, v]) => insertAjuste.run(k, v));

  // Los planes de ejemplo, no: en la instalación real los crea la academia.
  if (!demo) return;
  if (db.prepare("SELECT COUNT(*) AS c FROM plans").get().c > 0) return;

  const disciplina = (slug) => {
    const r = db.prepare("SELECT id FROM disciplines WHERE slug = ?").get(slug);
    return r ? r.id : null;
  };
  const insertPlan = db.prepare(`
    INSERT INTO plans (name, description, price_cents, scope, discipline_id, max_classes_per_week)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const planIlimitado = insertPlan.run("Ilimitado", "Acceso a todas las disciplinas, sin límite de clases.", 6900, "all", null, null).lastInsertRowid;
  const planes = {};
  [
    ["bjj", "BJJ mensual", "Todas las clases de Brazilian Jiu-Jitsu.", 4500, null],
    ["bjj", "BJJ 2 días/semana", "Hasta 2 clases de BJJ por semana.", 3500, 2],
    ["mma", "MMA mensual", "Todas las clases de MMA.", 4500, null],
    ["kickboxing", "Kickboxing mensual", "Todas las clases de Kickboxing.", 3900, null],
    ["judo", "Judo mensual", "Todas las clases de Judo.", 3900, null],
  ].forEach(([slug, nombre, desc, precio, limite]) => {
    const id = disciplina(slug);
    if (id) planes[nombre] = insertPlan.run(nombre, desc, precio, "discipline", id, limite).lastInsertRowid;
  });

  // Cuotas de ejemplo para las cuentas de prueba (solo si existen). Sofía, la
  // hija pequeña de Beatriz, se queda a propósito SIN cuota: sirve para ver
  // en acción la clase de prueba gratuita.
  const hoy = todayStr();
  const inicio = addDays(hoy, -10);
  const fin = addMonths(inicio, 1);
  const insertCuota = db.prepare(`
    INSERT INTO memberships (member_id, plan_id, account_id, payment_method, status, price_cents, current_period_end)
    VALUES (?, ?, ?, 'manual', 'activa', ?, ?)
  `);
  const insertPago = db.prepare(`
    INSERT INTO payments (account_id, membership_id, amount_cents, method, period_start, period_end, notes)
    VALUES (?, ?, ?, 'efectivo', ?, ?, 'Pago de ejemplo')
  `);
  const darCuota = (nombre, apellido, planNombre) => {
    const m = db.prepare("SELECT id, account_id FROM members WHERE first_name = ? AND last_name = ?").get(nombre, apellido);
    const planId = planes[planNombre];
    if (!m || !planId) return;
    const precio = db.prepare("SELECT price_cents FROM plans WHERE id = ?").get(planId).price_cents;
    const id = insertCuota.run(m.id, planId, m.account_id, precio, fin).lastInsertRowid;
    insertPago.run(m.account_id, id, precio, inicio, fin);
  };
  darCuota("Carlos", "Medina", "BJJ mensual");
  darCuota("Beatriz", "Núñez", "Judo mensual");
  darCuota("Mateo", "Núñez", "Kickboxing mensual");

  void planIlimitado;
  console.log("✅ Planes de cuota de ejemplo creados.");
}

module.exports = { seedBilling };
