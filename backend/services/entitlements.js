// services/entitlements.js
//
// ¿Puede este miembro reservar esta clase? Es la pieza que conecta las cuotas
// con las reservas. Reglas, en orden:
//
// 1. Si la academia ha desactivado "exigir cuota para reservar", sí.
// 2. Si tiene una cuota ACTIVA que cubre la disciplina (o el plan ilimitado),
//    sí, siempre que no haya agotado el límite semanal de su plan.
// 3. Si su cuota está pausada o impagada, no, con un mensaje que explica por qué.
// 4. Si no es alumno de esa disciplina y le quedan clases de prueba, sí, como
//    clase de prueba gratuita.
// 5. En cualquier otro caso, no.
const db = require("../db/database");
const { getSetting } = require("./settings");
const { weekRange, fechaLegible } = require("../utils/dates");

function checkBookingEntitlement(memberId, classScheduleId, date) {
  if (getSetting("require_membership_to_book", "1") !== "1") return { ok: true, isTrial: false };

  const clase = db
    .prepare(
      `SELECT cs.id, g.discipline_id, d.name AS discipline_name
       FROM class_schedule cs JOIN groups g ON g.id = cs.group_id JOIN disciplines d ON d.id = g.discipline_id
       WHERE cs.id = ?`
    )
    .get(classScheduleId);
  if (!clase) return { ok: false, error: "Esa clase no existe." };

  const cubren = db
    .prepare(
      `SELECT ms.*, p.name AS plan_name, p.scope, p.discipline_id AS plan_discipline_id, p.max_classes_per_week
       FROM memberships ms JOIN plans p ON p.id = ms.plan_id
       WHERE ms.member_id = ? AND ms.status != 'cancelada'
         AND (p.scope = 'all' OR p.discipline_id = ?)`
    )
    .all(memberId, clase.discipline_id);

  const activas = cubren.filter((c) => c.status === "activa");
  if (activas.length > 0) {
    const { start, end } = weekRange(date);
    for (const c of activas) {
      if (c.max_classes_per_week == null) return { ok: true, isTrial: false };
      // Cuenta las reservas de esa semana en las clases que cubre ESTE plan.
      const usadas = db
        .prepare(
          `SELECT COUNT(*) AS n FROM bookings b
           JOIN class_schedule cs ON cs.id = b.class_schedule_id JOIN groups g ON g.id = cs.group_id
           WHERE b.member_id = ? AND b.date BETWEEN ? AND ? AND b.status != 'cancelada' AND b.is_trial = 0
             AND (? = 'all' OR g.discipline_id = ?)`
        )
        .get(memberId, start, end, c.scope, c.plan_discipline_id).n;
      if (usadas < c.max_classes_per_week) return { ok: true, isTrial: false };
    }
    const limite = Math.max(...activas.map((c) => c.max_classes_per_week));
    return { ok: false, error: `Ya has reservado las ${limite} clases semanales que incluye tu cuota. Podrás reservar más a partir del lunes.` };
  }

  const pausada = cubren.find((c) => c.status === "pausada");
  if (pausada) {
    return { ok: false, error: `La cuota «${pausada.plan_name}» está pausada hasta el ${fechaLegible(pausada.paused_until)}. Reanúdala desde «Cuotas» para poder reservar.` };
  }
  const impagada = cubren.find((c) => c.status === "impagada");
  if (impagada) {
    return { ok: false, error: `La cuota «${impagada.plan_name}» tiene un pago pendiente. Regularízalo desde «Cuotas» o en recepción para poder reservar.` };
  }

  const permitidas = Number(getSetting("trial_classes", "1"));
  const usadasPrueba = db
    .prepare("SELECT COUNT(*) AS n FROM bookings WHERE member_id = ? AND is_trial = 1 AND status != 'cancelada'")
    .get(memberId).n;
  if (usadasPrueba < permitidas) return { ok: true, isTrial: true };

  const pendiente = cubren.find((c) => c.status === "pendiente_pago" || c.status === "procesando");
  if (pendiente) {
    return { ok: false, error: `La cuota «${pendiente.plan_name}» todavía no está pagada. En cuanto se confirme el pago podrás reservar.` };
  }

  return {
    ok: false,
    error: `Para reservar clases de ${clase.discipline_name} hace falta una cuota que las incluya. Puedes contratarla desde «Cuotas».` +
      (permitidas > 0 ? " La clase de prueba gratuita ya está usada." : ""),
  };
}

module.exports = { checkBookingEntitlement };
