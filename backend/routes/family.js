// routes/family.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const db = require("../db/database");
const { requireAuth, memberBelongsToAccount } = require("../middleware/auth");
const { upload, uploadDir } = require("../middleware/upload");

const router = express.Router();
router.use(requireAuth);

// GET /api/family/members — todos los miembros de mi cuenta (yo + mis hijos)
router.get("/members", (req, res) => {
  const members = db
    .prepare("SELECT * FROM members WHERE account_id = ? AND active = 1 ORDER BY is_dependent, first_name")
    .all(req.accountId);
  res.json(members);
});

// ---------------------------------------------------------------------------
// Validación de los datos de un miembro
// ---------------------------------------------------------------------------
// La pantalla ya limita lo que se puede escribir, pero el servidor lo
// comprueba igualmente: si alguien envía la petición a mano con un número en
// vez de un nombre, o una fecha inventada, recibe un mensaje claro en lugar
// de un error 500 (o de un "NaN años" en el horario).
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
function texto(valor, max) {
  if (valor === undefined || valor === null) return "";
  if (typeof valor !== "string" && typeof valor !== "number") return null; // ni objetos ni listas
  const t = String(valor).trim();
  return t.length > max ? null : t;
}
function validarMiembro(body = {}) {
  const nombre = texto(body.first_name, 60);
  const apellidos = texto(body.last_name, 80);
  if (nombre === null || apellidos === null) return { error: "El nombre o los apellidos son demasiado largos." };
  if (!nombre || !apellidos) return { error: "El nombre y los apellidos son obligatorios." };

  let nacimiento = null;
  if (body.birth_date) {
    const f = String(body.birth_date);
    const d = new Date(f + "T12:00:00");
    const hoy = new Date();
    if (!FECHA.test(f) || isNaN(d) || d.toISOString().slice(0, 10) !== f || d > hoy || d.getFullYear() < 1900) {
      return { error: "La fecha de nacimiento no es válida." };
    }
    nacimiento = f;
  }

  const campos = {
    emergency_contact_name: texto(body.emergency_contact_name, 80),
    emergency_contact_phone: texto(body.emergency_contact_phone, 30),
    medical_notes: texto(body.medical_notes, 1000),
    bio: texto(body.bio, 500),
  };
  if (Object.values(campos).some((v) => v === null)) return { error: "Algún campo es demasiado largo." };

  return {
    datos: {
      first_name: nombre, last_name: apellidos, birth_date: nacimiento,
      emergency_contact_name: campos.emergency_contact_name || null,
      emergency_contact_phone: campos.emergency_contact_phone || null,
      medical_notes: campos.medical_notes || null,
      bio: campos.bio || null,
    },
  };
}

// POST /api/family/members — añadir un miembro (normalmente, un hijo/a)
router.post("/members", (req, res) => {
  const { error, datos: m } = validarMiembro(req.body);
  if (error) return res.status(400).json({ error });

  const result = db
    .prepare(
      `INSERT INTO members (account_id, first_name, last_name, birth_date, is_dependent, emergency_contact_name, emergency_contact_phone, medical_notes, bio)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`
    )
    .run(req.accountId, m.first_name, m.last_name, m.birth_date, m.emergency_contact_name, m.emergency_contact_phone, m.medical_notes, m.bio);

  res.status(201).json({ id: result.lastInsertRowid });
});

// PUT /api/family/members/:id — editar un miembro de mi propia familia
router.put("/members/:id", (req, res) => {
  if (!memberBelongsToAccount(req.params.id, req.accountId)) {
    return res.status(404).json({ error: "Ese perfil no pertenece a tu cuenta." });
  }

  const { error, datos: m } = validarMiembro(req.body);
  if (error) return res.status(400).json({ error });

  db.prepare(
    `UPDATE members SET first_name = ?, last_name = ?, birth_date = ?,
            emergency_contact_name = ?, emergency_contact_phone = ?, medical_notes = ?, bio = ?
     WHERE id = ?`
  ).run(m.first_name, m.last_name, m.birth_date, m.emergency_contact_name, m.emergency_contact_phone, m.medical_notes, m.bio, req.params.id);

  res.json({ success: true });
});

// Primeros bytes ("firma") de cada formato de imagen admitido.
function esImagenDeVerdad(ruta) {
  let cabecera;
  try {
    const fd = fs.openSync(ruta, "r");
    cabecera = Buffer.alloc(12);
    fs.readSync(fd, cabecera, 0, 12, 0);
    fs.closeSync(fd);
  } catch (_) {
    return false;
  }
  const png = cabecera.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpg = cabecera[0] === 0xff && cabecera[1] === 0xd8 && cabecera[2] === 0xff;
  const webp = cabecera.toString("ascii", 0, 4) === "RIFF" && cabecera.toString("ascii", 8, 12) === "WEBP";
  return png || jpg || webp;
}

// ---------------------------------------------------------------------------
// FOTO DE PERFIL
// ---------------------------------------------------------------------------
// La comprobación de propiedad va ANTES de multer a propósito: así, si el
// perfil no es tuyo, rechazamos la petición sin llegar a procesar ni guardar
// el archivo que hayas mandado.
function comprobarPropiedad(req, res, next) {
  if (!memberBelongsToAccount(req.params.id, req.accountId)) {
    return res.status(403).json({ error: "Ese perfil no pertenece a tu cuenta." });
  }
  next();
}

// POST /api/family/members/:id/avatar — subir o cambiar la foto
router.post("/members/:id/avatar", comprobarPropiedad, (req, res, next) => {
  // Envolvemos multer a mano para poder devolver un error en JSON (por
  // ejemplo, si el archivo pesa demasiado o no es un formato admitido) en
  // lugar de la página de error HTML que da Express por defecto.
  upload.single("avatar")(req, res, (err) => {
    if (err) {
      // Los errores propios de multer vienen en inglés: traducimos los que
      // puede provocar una familia al subir una foto.
      const MENSAJES = {
        LIMIT_FILE_SIZE: "La imagen pesa más de 3 MB. Prueba con una foto más ligera.",
        LIMIT_UNEXPECTED_FILE: "Envía una sola imagen.",
        LIMIT_FILE_COUNT: "Envía una sola imagen.",
      };
      return res.status(400).json({ error: MENSAJES[err.code] || err.message || "No se ha podido subir la imagen." });
    }
    next();
  });
}, (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se ha recibido ninguna imagen." });

  // La extensión del nombre se puede falsear: se comprueba también que el
  // contenido empiece como una imagen JPG, PNG o WEBP de verdad.
  if (!esImagenDeVerdad(req.file.path)) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: "El archivo no es una imagen JPG, PNG o WEBP válida." });
  }

  // Si ya tenía una foto anterior, la borramos del disco: si no, con el
  // tiempo se acumulan archivos huérfanos que nadie referencia ya.
  const actual = db.prepare("SELECT avatar_file FROM members WHERE id = ?").get(req.params.id);
  if (actual.avatar_file) {
    fs.unlink(path.join(uploadDir, actual.avatar_file), () => {
      // Si el archivo ya no estuviera (por lo que sea), no pasa nada:
      // ignoramos el error, lo importante es que la referencia se actualice.
    });
  }

  db.prepare("UPDATE members SET avatar_file = ? WHERE id = ?").run(req.file.filename, req.params.id);
  res.json({ avatar_file: req.file.filename });
});

// DELETE /api/family/members/:id/avatar — quitar la foto (vuelve al icono por defecto)
router.delete("/members/:id/avatar", comprobarPropiedad, (req, res) => {
  const actual = db.prepare("SELECT avatar_file FROM members WHERE id = ?").get(req.params.id);
  if (actual.avatar_file) {
    fs.unlink(path.join(uploadDir, actual.avatar_file), () => {});
  }
  db.prepare("UPDATE members SET avatar_file = NULL WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
