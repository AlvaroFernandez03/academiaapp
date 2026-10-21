// routes/schedule.js
const express = require("express");
const db = require("../db/database");
const { listCancellations, AdminError } = require("../services/admin");
const { colorDisciplina } = require("../utils/cinturones");
const { todayStr, addDays } = require("../utils/dates");

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const router = express.Router();

// GET /api/schedule/disciplines — solo las activas (las archivadas se ven en
// el panel de administración)
router.get("/disciplines", (req, res) => {
  const disciplinas = db.prepare("SELECT * FROM disciplines WHERE active = 1 ORDER BY name").all();
  res.json(disciplinas.map((d) => ({ ...d, color: colorDisciplina(d) })));
});

// GET /api/schedule/groups?discipline=slug
router.get("/groups", (req, res) => {
  const { discipline } = req.query;
  const condiciones = ["g.active = 1"];
  const params = [];
  if (discipline) {
    condiciones.push("d.slug = ?");
    params.push(discipline);
  }

  const groups = db
    .prepare(
      `SELECT g.*, d.name AS discipline_name, d.slug AS discipline_slug
       FROM groups g JOIN disciplines d ON d.id = g.discipline_id
       WHERE ${condiciones.join(" AND ")}
       ORDER BY d.name, g.name`
    )
    .all(...params);
  res.json(groups);
});

// GET /api/schedule/classes — el horario semanal completo, con filtros opcionales
// ?discipline=slug &group_id=
router.get("/classes", (req, res) => {
  const { discipline, group_id } = req.query;
  const condiciones = ["cs.active = 1"];
  const params = [];
  if (discipline) { condiciones.push("d.slug = ?"); params.push(discipline); }
  if (group_id) { condiciones.push("cs.group_id = ?"); params.push(group_id); }

  const clases = db
    .prepare(
      `SELECT cs.*, g.name AS group_name, g.min_age, g.max_age,
              d.name AS discipline_name, d.slug AS discipline_slug,
              d.id AS discipline_id, d.color AS discipline_color,
              acc.name AS instructor_name
       FROM class_schedule cs
       JOIN groups g ON g.id = cs.group_id
       JOIN disciplines d ON d.id = g.discipline_id
       JOIN accounts acc ON acc.id = cs.instructor_account_id
       WHERE ${condiciones.join(" AND ")}
       ORDER BY cs.day_of_week, cs.start_time`
    )
    .all(...params);
  res.json(clases.map((c) => ({ ...c, discipline_color: colorDisciplina({ id: c.discipline_id, color: c.discipline_color }) })));
});

// GET /api/schedule/occupancy?from=YYYY-MM-DD&to=YYYY-MM-DD — plazas ocupadas
// y lista de espera de todas las sesiones de esas fechas (para el calendario;
// solo cifras, ningún nombre). Máximo 62 días de una vez.
router.get("/occupancy", (req, res) => {
  const desde = FECHA.test(req.query.from || "") ? req.query.from : todayStr();
  const hasta = FECHA.test(req.query.to || "") ? req.query.to : addDays(desde, 6);
  if (hasta < desde) return res.status(400).json({ error: "El rango de fechas no es válido." });
  if (hasta > addDays(desde, 62)) return res.status(400).json({ error: "Como máximo, 62 días de una vez." });
  const filas = db
    .prepare(
      `SELECT class_schedule_id, date,
              SUM(status IN ('reservada', 'asistio')) AS taken, SUM(status = 'en_espera') AS waitlist
       FROM bookings WHERE date BETWEEN ? AND ? AND status IN ('reservada', 'asistio', 'en_espera')
       GROUP BY class_schedule_id, date`
    )
    .all(desde, hasta);
  res.json(filas);
});

// GET /api/schedule/cancellations?from=YYYY-MM-DD&to=YYYY-MM-DD — sesiones que
// la academia ha cancelado (festivos...), para marcarlas en el horario.
router.get("/cancellations", (req, res) => {
  try {
    res.json(listCancellations(req.query.from || undefined, req.query.to || undefined));
  } catch (err) {
    if (err instanceof AdminError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

module.exports = router;
