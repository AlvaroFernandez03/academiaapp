// services/bookingService.js
//
// Reservar, anular y marcar asistencia. Tres reglas de fechas que se
// aplican aquí (y no solo en la pantalla, para que nadie se las salte
// forzando una petición):
//
//  - Solo se reserva o se anula una clase que TODAVÍA NO HA EMPEZADO.
//  - Una reserva que ya consta como "asistió" no se puede anular: es
//    historial (y, si no, una clase de prueba ya hecha se podría "devolver"
//    anulándola después, y repetir prueba gratis sin fin).
//  - La asistencia se marca el mismo día de la clase o después, nunca antes,
//    y se puede deshacer si el instructor se equivoca.
const db = require("../db/database");
const { checkBookingEntitlement } = require("./entitlements");
const { todayStr, addDays, yaHaEmpezado } = require("../utils/dates");

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
// Igual que en el horario (js/horario.js, SEMANAS_MAX): se puede reservar
// hasta 6 semanas vista.
const DIAS_ANTELACION_MAX = 6 * 7;

// Cuántas plazas ocupadas tiene ahora mismo una clase en una fecha concreta.
// Ocupan plaza las reservas confirmadas Y las que ya tienen la asistencia
// marcada (si no, al pasar lista antes de empezar, esas plazas parecerían
// libres y se podría pasar del aforo). La lista de espera no ocupa aforo.
function plazasOcupadas(classScheduleId, date) {
  return db
    .prepare("SELECT COUNT(*) AS c FROM bookings WHERE class_schedule_id = ? AND date = ? AND status IN ('reservada', 'asistio')")
    .get(classScheduleId, date).c;
}

// ---------------------------------------------------------------------------
// Reservar una plaza (o entrar en lista de espera si está completa)
// ---------------------------------------------------------------------------
function bookClass({ memberId, classScheduleId, date }) {
  const clase = db.prepare("SELECT * FROM class_schedule WHERE id = ? AND active = 1").get(classScheduleId);
  if (!clase) return { error: "Esa clase no existe o ya no está disponible." };

  if (typeof date !== "string" || !FECHA.test(date)) return { error: "La fecha no es válida." };
  if (date < todayStr()) return { error: "No se puede reservar una fecha que ya ha pasado." };
  if (yaHaEmpezado(date, clase.start_time)) return { error: "Esta clase ya ha empezado: elige otra sesión." };
  if (date > addDays(todayStr(), DIAS_ANTELACION_MAX)) {
    return { error: "Solo se puede reservar con un máximo de 6 semanas de antelación." };
  }

  // La fecha debe corresponder de verdad al día de la semana de esta clase
  // (si la clase es los lunes, no se puede "reservar" para un miércoles).
  const diaDeLaSemana = new Date(date + "T12:00:00").getDay();
  if (diaDeLaSemana !== clase.day_of_week) {
    return { error: "Esa fecha no corresponde al día de la semana de esta clase." };
  }

  // ¿La academia ha cancelado esa sesión concreta (festivo, instructor enfermo...)?
  const anulada = db
    .prepare("SELECT reason FROM class_cancellations WHERE class_schedule_id = ? AND date = ?")
    .get(classScheduleId, date);
  if (anulada) {
    return { error: `Esa clase está cancelada ese día${anulada.reason ? ` (${anulada.reason})` : ""}. Elige otra fecha.` };
  }

  // ¿Ya tenía una reserva viva (no cancelada) para esta clase y fecha?
  const existente = db
    .prepare(
      `SELECT * FROM bookings WHERE class_schedule_id = ? AND member_id = ? AND date = ? AND status != 'cancelada'`
    )
    .get(classScheduleId, memberId, date);
  if (existente) {
    if (existente.status === "asistio") return { error: "Ya consta que asistió a esta clase." };
    return { error: existente.status === "en_espera" ? "Ya estás en la lista de espera de esta clase." : "Ya tienes reserva para esta clase." };
  }

  // ¿Tiene una cuota que le permita reservar esta clase (o una clase de
  // prueba disponible)? Ver services/entitlements.js.
  const derecho = checkBookingEntitlement(memberId, classScheduleId, date);
  if (!derecho.ok) return { error: derecho.error };

  // La comprobación de aforo y el INSERT ocurren dentro de una transacción.
  // node:sqlite es síncrono, así que entre estas líneas ninguna otra
  // petición puede colarse, pero usamos BEGIN/COMMIT de todos modos por
  // claridad y por si el día de mañana se cambia a un driver asíncrono.
  let bookingId, status;
  try {
    db.exec("BEGIN");
    // VOLVER A RESERVAR TRAS ANULAR. La tabla no admite dos filas para el
    // mismo alumno, clase y fecha (UNIQUE), y la reserva anulada sigue ahí.
    // Antes, el INSERT fallaba y la familia veía «No se ha podido completar
    // la reserva». Ahora se borra la fila anulada y se crea una nueva: así la
    // reserva nueva tiene un id y una hora de alta nuevos, y si la clase está
    // llena entra AL FINAL de la lista de espera (no recupera el puesto que
    // tenía antes de anular). Lo que se pierde es solo la anulación, que ya no
    // tiene sentido guardar: el alumno vuelve a estar apuntado.
    db.prepare("DELETE FROM bookings WHERE class_schedule_id = ? AND member_id = ? AND date = ? AND status = 'cancelada'")
      .run(classScheduleId, memberId, date);

    const ocupadas = plazasOcupadas(classScheduleId, date);
    status = ocupadas < clase.capacity ? "reservada" : "en_espera";

    bookingId = db
      .prepare("INSERT INTO bookings (class_schedule_id, member_id, date, status, is_trial) VALUES (?, ?, ?, ?, ?)")
      .run(classScheduleId, memberId, date, status, derecho.isTrial ? 1 : 0).lastInsertRowid;
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    console.error("Error al reservar:", err);
    return { error: "No se ha podido completar la reserva." };
  }

  return { id: bookingId, status, is_trial: derecho.isTrial };
}

// ---------------------------------------------------------------------------
// Anular una reserva (lo hace la familia) — si ocupaba plaza, promueve
// automáticamente al primero de la lista de espera de esa clase y fecha.
// (Cuando es la ACADEMIA quien cancela una clase o una sesión, se usa
// services/admin.js, que además deja una nota y avisa por email.)
// ---------------------------------------------------------------------------
function cancelBooking(bookingId) {
  const reserva = db
    .prepare("SELECT b.*, cs.start_time FROM bookings b JOIN class_schedule cs ON cs.id = b.class_schedule_id WHERE b.id = ?")
    .get(bookingId);
  if (!reserva) return { error: "Reserva no encontrada." };
  if (reserva.status === "cancelada") return { error: "Esa reserva ya estaba cancelada." };
  if (reserva.status === "asistio") {
    return { error: "Esta clase ya consta como asistida: forma parte del historial y no se puede anular." };
  }
  if (yaHaEmpezado(reserva.date, reserva.start_time)) {
    return { error: "Esta clase ya ha empezado (o ha terminado): ya no se puede anular." };
  }

  let promovido = null;
  try {
    db.exec("BEGIN");

    const teniaPlaza = reserva.status === "reservada";
    db.prepare("UPDATE bookings SET status = 'cancelada' WHERE id = ?").run(bookingId);

    if (teniaPlaza) {
      // Buscamos a quien lleva más tiempo esperando para esta misma clase y
      // fecha, y le damos la plaza que acaba de quedar libre.
      const siguiente = db
        .prepare(
          `SELECT * FROM bookings
           WHERE class_schedule_id = ? AND date = ? AND status = 'en_espera'
           ORDER BY created_at ASC, id ASC LIMIT 1`
        )
        .get(reserva.class_schedule_id, reserva.date);

      if (siguiente) {
        db.prepare("UPDATE bookings SET status = 'reservada' WHERE id = ?").run(siguiente.id);
        promovido = siguiente;
      }
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return { error: "No se ha podido cancelar la reserva." };
  }

  return { success: true, promoted_booking_id: promovido ? promovido.id : null };
}

// ---------------------------------------------------------------------------
// Pasar lista: marcar (asistio = true) o deshacer (asistio = false)
// ---------------------------------------------------------------------------
function setAttendance(bookingId, asistio) {
  const reserva = db.prepare("SELECT * FROM bookings WHERE id = ?").get(bookingId);
  if (!reserva) return { error: "Reserva no encontrada.", status: 404 };

  if (asistio) {
    if (reserva.status !== "reservada") {
      return { error: "Solo se puede marcar asistencia de una reserva confirmada.", status: 409 };
    }
    if (reserva.date > todayStr()) {
      return { error: "Todavía no ha llegado el día de esta clase: la asistencia se marca ese día o después.", status: 409 };
    }
    db.prepare("UPDATE bookings SET status = 'asistio' WHERE id = ?").run(bookingId);
  } else {
    if (reserva.status !== "asistio") return { error: "Esa reserva no tiene la asistencia marcada.", status: 409 };
    db.prepare("UPDATE bookings SET status = 'reservada' WHERE id = ?").run(bookingId);
  }
  return { success: true, status: asistio ? "asistio" : "reservada" };
}

module.exports = { bookClass, cancelBooking, setAttendance, plazasOcupadas, todayStr, DIAS_ANTELACION_MAX };
