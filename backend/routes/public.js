// routes/public.js — información pública de la academia (sin iniciar sesión)
const express = require("express");
const db = require("../db/database");
const { getSetting } = require("../services/settings");
const { colorDisciplina } = require("../utils/cinturones");

const router = express.Router();

// Nombre y contacto de la academia, para mostrarlos en la app.
// demo_accounts: si la base de datos tiene las cuentas de ejemplo, la página
// de acceso enseña cuáles son (en la instalación real no aparecen).
router.get("/info", (req, res) => {
  res.json({
    academy_name: getSetting("academy_name", "La academia"),
    academy_contact_email: getSetting("academy_contact_email", "") || null,
    demo_accounts: !!db.prepare("SELECT 1 FROM accounts WHERE email = 'carlos@ejemplo.com'").get(),
  });
});

// El aviso de privacidad vigente (se lee antes de registrarse).
router.get("/privacy", (req, res) => {
  res.json({
    text: getSetting("privacy_text", ""),
    version: Number(getSetting("privacy_version", "1")) || 1,
    updated_at: getSetting("privacy_updated_at", "") || null,
    academy_name: getSetting("academy_name", "La academia"),
  });
});

// ---------------------------------------------------------------------------
// GET /api/public/home — todo lo que necesitan la portada y las páginas de
// cada disciplina, en una sola petición.
// ---------------------------------------------------------------------------
// Solo datos que ya son públicos en el horario (disciplinas, grupos, clases
// y quién las imparte) más los precios de los planes y los datos de contacto
// que la academia escribe en Administración → Academia. Nada de alumnos,
// emails ni teléfonos del equipo.
router.get("/home", (req, res) => {
  const disciplinas = db.prepare("SELECT id, name, slug, color, description FROM disciplines WHERE active = 1 ORDER BY name").all();
  const grupos = db
    .prepare(
      `SELECT g.id, g.discipline_id, g.name, g.min_age, g.max_age, g.description,
              (SELECT COUNT(*) FROM class_schedule cs WHERE cs.group_id = g.id AND cs.active = 1) AS classes_per_week
       FROM groups g WHERE g.active = 1 ORDER BY g.min_age IS NULL, g.min_age, g.name`
    )
    .all();
  const clases = db
    .prepare(
      `SELECT cs.day_of_week, cs.start_time, cs.end_time, g.discipline_id, a.id AS instructor_id, a.name AS instructor_name
       FROM class_schedule cs
       JOIN groups g ON g.id = cs.group_id AND g.active = 1
       JOIN disciplines d ON d.id = g.discipline_id AND d.active = 1
       JOIN accounts a ON a.id = cs.instructor_account_id
       WHERE cs.active = 1`
    )
    .all();
  const planes = db
    .prepare(
      `SELECT p.id, p.name, p.description, p.price_cents, p.scope, p.max_classes_per_week, p.discipline_id
       FROM plans p LEFT JOIN disciplines d ON d.id = p.discipline_id
       WHERE p.active = 1 AND (p.scope = 'all' OR d.active = 1)
       ORDER BY p.scope = 'discipline', p.price_cents DESC`
    )
    .all();

  const porId = new Map(disciplinas.map((d) => [d.id, { ...d, color: colorDisciplina(d) }]));
  const salidaDisciplinas = disciplinas.map((d) => {
    const suyas = clases.filter((c) => c.discipline_id === d.id);
    return {
      ...porId.get(d.id),
      groups: grupos.filter((g) => g.discipline_id === d.id).map(({ discipline_id, ...g }) => g),
      classes_per_week: suyas.length,
      instructors: [...new Set(suyas.map((c) => c.instructor_name))],
    };
  });

  // El equipo que aparece es el que da clases en el horario.
  const equipo = new Map();
  clases.forEach((c) => {
    if (!equipo.has(c.instructor_id)) equipo.set(c.instructor_id, { name: c.instructor_name, disciplines: new Set(), classes_per_week: 0 });
    const e = equipo.get(c.instructor_id);
    e.disciplines.add(c.discipline_id);
    e.classes_per_week++;
  });

  // Cuándo hay clases cada día (de la primera a la última), para "Horario".
  const dias = [1, 2, 3, 4, 5, 6, 0]
    .map((dow) => {
      const delDia = clases.filter((c) => c.day_of_week === dow);
      if (!delDia.length) return null;
      return {
        day_of_week: dow,
        from: delDia.map((c) => c.start_time).sort()[0],
        to: delDia.map((c) => c.end_time).sort().pop(),
        classes: delDia.length,
      };
    })
    .filter(Boolean);

  const edadesMin = grupos.filter((g) => g.classes_per_week > 0 && g.min_age != null).map((g) => g.min_age);
  const exigeCuota = getSetting("require_membership_to_book", "1") === "1";

  res.json({
    academy: {
      name: getSetting("academy_name", "La academia"),
      tagline: getSetting("academy_tagline", "") || null,
      about: getSetting("academy_about", "") || null,
      address: getSetting("academy_address", "") || null,
      phone: getSetting("academy_phone", "") || null,
      email: getSetting("academy_contact_email", "") || null,
    },
    // Clases de prueba gratuitas (solo tiene sentido anunciarlas si para
    // reservar hace falta cuota).
    trial_classes: exigeCuota ? Number(getSetting("trial_classes", "1")) || 0 : 0,
    disciplines: salidaDisciplinas,
    instructors: [...equipo.values()]
      .map((e) => ({
        name: e.name,
        classes_per_week: e.classes_per_week,
        disciplines: [...e.disciplines].map((id) => porId.get(id)).filter(Boolean).map(({ name, slug, color }) => ({ name, slug, color })),
      }))
      .sort((a, b) => b.classes_per_week - a.classes_per_week || a.name.localeCompare(b.name)),
    plans: planes.map((p) => {
      const d = p.discipline_id ? porId.get(p.discipline_id) : null;
      return {
        id: p.id, name: p.name, description: p.description, price_cents: p.price_cents, scope: p.scope,
        max_classes_per_week: p.max_classes_per_week,
        discipline_slug: d ? d.slug : null, discipline_name: d ? d.name : null, discipline_color: d ? d.color : null,
      };
    }),
    opening: dias,
    stats: {
      disciplines: disciplinas.length,
      classes_per_week: clases.length,
      instructors: equipo.size,
      min_age: edadesMin.length ? Math.min(...edadesMin) : null,
    },
  });
});

module.exports = router;
