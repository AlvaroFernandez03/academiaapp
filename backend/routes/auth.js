// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db/database");
const { getSetting } = require("../services/settings");
const { emailRestablecer } = require("../services/email");
const { limites } = require("../middleware/rateLimit");
const { errorContrasenaNueva, makeToken, tokenAleatorio, huella } = require("../utils/security");

const router = express.Router();

function isAdminEmail(email) {
  const adminEmail = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  return adminEmail && email.toLowerCase() === adminEmail;
}
const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 120;
const versionPrivacidad = () => Number(getSetting("privacy_version", "1")) || 1;

// Lo que el navegador guarda de la cuenta tras entrar.
function datosCuenta(a) {
  return {
    id: a.id, name: a.name, email: a.email, role: a.role,
    must_change_password: !!a.must_change_password,
    privacy_pending: (a.privacy_version_accepted || 0) < versionPrivacidad(),
  };
}

// Hash de una contraseña que no existe: se compara contra él cuando el email
// no tiene cuenta, para que la respuesta tarde lo mismo y no delate qué
// emails están registrados.
const HASH_FICTICIO = bcrypt.hashSync("contraseña-que-no-existe", 10);

// ---------------------------------------------------------------------------
// POST /api/auth/register — crear una cuenta familiar
// ---------------------------------------------------------------------------
// El registro público siempre crea una cuenta de tipo "member" (una familia).
// Las cuentas de instructor o administración las da de alta la propia
// academia desde su panel — no tiene sentido que cualquiera pueda
// registrarse como instructor desde fuera.
//
// Si la persona que se registra también entrena (practices_self = true), se
// le crea de una vez su propio perfil de miembro. Los hijos se añaden
// después, desde "Mi familia" en la app, no en este mismo formulario — así
// el registro inicial es rápido y no obliga a rellenar los datos de todos
// los niños antes de poder ni siquiera entrar.
router.post("/register", limites.registro, (req, res) => {
  const { name, password, phone, practices_self, birth_date, accept_privacy } = req.body;
  const email = String(req.body.email || "").trim().toLowerCase();
  const nombre = String(name || "").trim();

  if (!nombre || !email || !password) {
    return res.status(400).json({ error: "Nombre, email y contraseña son obligatorios." });
  }
  if (nombre.length > 80) return res.status(400).json({ error: "El nombre es demasiado largo." });
  if (!emailValido(email)) return res.status(400).json({ error: "El email no es válido." });
  const errorClave = errorContrasenaNueva(password);
  if (errorClave) return res.status(400).json({ error: errorClave });
  // Los datos (también los de menores) solo se guardan si antes se ha
  // aceptado el aviso de privacidad de la academia.
  if (accept_privacy !== true) {
    return res.status(400).json({ error: "Para crear la cuenta tienes que leer y aceptar el aviso de privacidad." });
  }

  const existing = db.prepare("SELECT id FROM accounts WHERE email = ?").get(email);
  if (existing) return res.status(409).json({ error: "Ya hay una cuenta con ese email. Si no recuerdas la contraseña, usa «¿Has olvidado tu contraseña?»." });

  const passwordHash = bcrypt.hashSync(password, 10);
  const role = isAdminEmail(email) ? "admin" : "member";

  let accountId;
  try {
    db.exec("BEGIN");
    accountId = db
      .prepare(
        `INSERT INTO accounts (name, email, password_hash, role, phone, privacy_version_accepted, privacy_accepted_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .run(nombre, email, passwordHash, role, phone || null, versionPrivacidad()).lastInsertRowid;

    if (practices_self) {
      const [primero, ...resto] = nombre.split(" ");
      db.prepare(
        `INSERT INTO members (account_id, first_name, last_name, birth_date, is_dependent)
         VALUES (?, ?, ?, ?, 0)`
      ).run(accountId, primero, resto.join(" ") || "-", birth_date || null);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return res.status(400).json({ error: "No se ha podido completar el registro." });
  }

  const cuenta = db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId);
  res.status(201).json({ token: makeToken(cuenta), account: datosCuenta(cuenta) });
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
router.post("/login", limites.login, (req, res) => {
  const { password } = req.body;
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!email || !password) return res.status(400).json({ error: "Email y contraseña son obligatorios." });

  const account = db.prepare("SELECT * FROM accounts WHERE email = ?").get(email);
  const correcta = bcrypt.compareSync(String(password), account ? account.password_hash : HASH_FICTICIO);
  if (!account || !correcta) {
    req.anotarFallo();
    return res.status(401).json({ error: "Email o contraseña incorrectos." });
  }
  req.limpiarFallos();
  // Solo se dice que está desactivada a quien ya ha demostrado conocer la
  // contraseña: así no se revela a cualquiera qué emails tienen cuenta.
  if (!account.active) {
    return res.status(403).json({ error: "Esta cuenta está desactivada. Habla con la academia." });
  }

  if (isAdminEmail(account.email) && account.role !== "admin") {
    db.prepare("UPDATE accounts SET role = 'admin' WHERE id = ?").run(account.id);
    account.role = "admin";
  }

  res.json({ token: makeToken(account), account: datosCuenta(account) });
});

// ---------------------------------------------------------------------------
// POST /api/auth/forgot — "¿Has olvidado tu contraseña?"
// ---------------------------------------------------------------------------
// Responde SIEMPRE lo mismo, exista o no la cuenta: si no, cualquiera podría
// usar este formulario para averiguar qué emails están registrados.
router.post("/forgot", limites.olvido, (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const respuesta = { success: true, message: "Si ese email tiene una cuenta, te hemos enviado un enlace para elegir una contraseña nueva. Revisa también la carpeta de spam." };
  if (!emailValido(email)) return res.json(respuesta);

  const cuenta = db.prepare("SELECT id, name, email, active FROM accounts WHERE email = ?").get(email);
  if (cuenta && cuenta.active) {
    const token = tokenAleatorio();
    db.exec("BEGIN");
    try {
      // Pedir un enlace nuevo anula los anteriores que no se hayan usado.
      db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE account_id = ? AND used_at IS NULL").run(cuenta.id);
      db.prepare("INSERT INTO password_resets (account_id, token_hash, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))")
        .run(cuenta.id, huella(token));
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    emailRestablecer(cuenta, token);
  }
  res.json(respuesta);
});

// POST /api/auth/reset — elegir la contraseña nueva con el enlace del email.
router.post("/reset", limites.restablecer, (req, res) => {
  const { token, new_password } = req.body;
  const invalido = { error: "El enlace no es válido o ha caducado. Pide uno nuevo desde «¿Has olvidado tu contraseña?»." };
  if (!token || typeof token !== "string") return res.status(400).json(invalido);

  const peticion = db
    .prepare("SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')")
    .get(huella(token));
  if (!peticion) return res.status(400).json(invalido);
  const errorClave = errorContrasenaNueva(new_password);
  if (errorClave) return res.status(400).json({ error: errorClave });

  const cuenta = db.prepare("SELECT * FROM accounts WHERE id = ?").get(peticion.account_id);
  if (!cuenta || !cuenta.active) return res.status(400).json(invalido);

  db.exec("BEGIN");
  try {
    db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE id = ?").run(peticion.id);
    // Subir token_version cierra todas las sesiones abiertas con la contraseña antigua.
    db.prepare("UPDATE accounts SET password_hash = ?, must_change_password = 0, token_version = token_version + 1 WHERE id = ?")
      .run(bcrypt.hashSync(new_password, 10), cuenta.id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  const actualizada = db.prepare("SELECT * FROM accounts WHERE id = ?").get(cuenta.id);
  res.json({ token: makeToken(actualizada), account: datosCuenta(actualizada) });
});

module.exports = router;
module.exports.datosCuenta = datosCuenta;
