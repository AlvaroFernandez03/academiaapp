// routes/bookings.js
const express = require("express");
const db = require("../db/database");
const { requireAuth, requireRole, memberBelongsToAccount } = require("../middleware/auth");
const { bookClass, cancelBooking, setAttendance, plazasOcupadas } = require("../services/bookingService");
const { colorDisciplina } = require("../utils/cinturones");

const router = express.Router();
router.use(requireAuth);

// GET /api/bookings/occupancy?class_schedule_id=&date= — para pintar "12/24 plazas"
router.get("/occupancy", (req, res) => {
  const { class_schedule_id, date } = req.query;
  if (!class_schedule_id || !date) return res.status(400).json({ error: "Faltan datos." });

  const clase = db.prepare("SELECT capacity FROM class_schedule WHERE id = ?").get(class_schedule_id);
  if (!clase) return res.status(404).json({ error: "Clase no encontrada." });

  const ocupadas = plazasOcupadas(class_schedule_id, date);
  const enEspera = db
    .prepare("SELECT COUNT(*) AS c FROM bookings WHERE class_schedule_id = ? AND date = ? AND status = 'en_espera'")
    .get(class_schedule_id, date).c;

  res.json({ capacity: clase.capacity, taken: ocupadas, waitlist: enEspera, full: ocupadas >= clase.capacity });
});

// ---------------------------------------------------------------------------
// POST /api/bookings — reservar una clase para un miembro de mi familia
// ---------------------------------------------------------------------------
router.post("/", (req, res) => {
  const { member_id, class_schedule_id, date } = req.body;
  if (!member_id || !class_schedule_id || !date) {
    return res.status(400).json({ error: "Faltan datos para reservar." });
  }

  // Comprobación de propiedad: solo se puede reservar EN NOMBRE de un
  // miembro de la propia familia, nunca de otra.
  if (!memberBelongsToAccount(member_id, req.accountId)) {
    return res.status(403).json({ error: "Ese perfil no pertenece a tu familia." });
  }

  const resultado = bookClass({ memberId: member_id, classScheduleId: class_schedule_id, date });
  if (resultado.error) return res.status(409).json({ error: resultado.error });

  res.status(201).json(resultado);
});

// ---------------------------------------------------------------------------
// GET /api/bookings/mine — todas las reservas de mi familia (todos los miembros)
// ---------------------------------------------------------------------------
router.get("/mine", (req, res) => {
  const reservas = db
    .prepare(
      `SELECT b.*, m.first_name, m.last_name,
              cs.name AS class_name, cs.start_time, cs.end_time,
              g.name AS group_name, d.name AS discipline_name, d.id AS discipline_id, d.color AS discipline_color
       FROM bookings b
       JOIN members m ON m.id = b.member_id
       JOIN class_schedule cs ON cs.id = b.class_schedule_id
       JOIN groups g ON g.id = cs.group_id
       JOIN disciplines d ON d.id = g.discipline_id
       WHERE m.account_id = ?
       ORDER BY b.date DESC, cs.start_time DESC`
    )
    .all(req.accountId);
  res.json(reservas.map((r) => ({ ...r, discipline_color: colorDisciplina({ id: r.discipline_id, color: r.discipline_color }) })));
});

// ---------------------------------------------------------------------------
// PUT /api/bookings/:id/cancel
// ---------------------------------------------------------------------------
router.put("/:id/cancel", (req, res) => {
  const reserva = db
    .prepare(`SELECT b.*, m.account_id FROM bookings b JOIN members m ON m.id = b.member_id WHERE b.id = ?`)
    .get(req.params.id);
  if (!reserva) return res.status(404).json({ error: "Reserva no encontrada." });
  if (reserva.account_id !== req.accountId) return res.status(403).json({ error: "Esa reserva no es de tu familia." });

  const resultado = cancelBooking(req.params.id);
  if (resultado.error) return res.status(409).json({ error: resultado.error });

  res.json(resultado);
});

// ---------------------------------------------------------------------------
// GET /api/bookings/class — lista de asistentes de una clase en una fecha
// (para que el instructor pase lista). Solo instructores y admin.
// ---------------------------------------------------------------------------
router.get("/class", requireRole("instructor", "admin"), (req, res) => {
  const { class_schedule_id, date } = req.query;
  if (!class_schedule_id || !date) return res.status(400).json({ error: "Faltan datos." });

  const lista = db
    .prepare(
      `SELECT b.*, m.first_name, m.last_name, m.birth_date, m.medical_notes, m.avatar_file
       FROM bookings b JOIN members m ON m.id = b.member_id
       WHERE b.class_schedule_id = ? AND b.date = ? AND b.status != 'cancelada'
       ORDER BY b.status, m.first_name`
    )
    .all(class_schedule_id, date);
  res.json(lista);
});

// PUT /api/bookings/:id/attendance — marcar como "asistió" (instructor/admin).
// Con { attended: false } se DESHACE (por si se marcó a quien no era).
// Las reglas de fechas están en services/bookingService.js.
router.put("/:id/attendance", requireRole("instructor", "admin"), (req, res) => {
  const asistio = !(req.body && req.body.attended === false);
  const resultado = setAttendance(req.params.id, asistio);
  if (resultado.error) return res.status(resultado.status || 409).json({ error: resultado.error });
  res.json(resultado);
});

module.exports = router;
