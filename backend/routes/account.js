// routes/account.js
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");
const { limites } = require("../middleware/rateLimit");
const { getSetting } = require("../services/settings");
const { errorContrasenaNueva, makeToken } = require("../utils/security");

const router = express.Router();
router.use(requireAuth);

const versionPrivacidad = () => Number(getSetting("privacy_version", "1")) || 1;

// GET /api/account — mis datos (sin la contraseña)
router.get("/", (req, res) => {
  const a = db
    .prepare("SELECT id, name, email, role, phone, created_at, must_change_password, privacy_version_accepted FROM accounts WHERE id = ?")
    .get(req.accountId);
  const { privacy_version_accepted, ...datos } = a;
  res.json({
    ...datos,
    must_change_password: !!a.must_change_password,
    // Si la academia ha publicado un aviso de privacidad nuevo, se pide aceptarlo.
    privacy_pending: (privacy_version_accepted || 0) < versionPrivacidad(),
  });
});

// PUT /api/account — cambiar nombre y teléfono
router.put("/", (req, res) => {
  const { name, phone } = req.body;
  if (typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "El nombre no puede estar vacío." });
  if (phone != null && typeof phone !== "string" && typeof phone !== "number") return res.status(400).json({ error: "El teléfono no es válido." });
  if (name.trim().length > 80) return res.status(400).json({ error: "El nombre es demasiado largo." });
  if (phone && String(phone).length > 30) return res.status(400).json({ error: "El teléfono es demasiado largo." });

  db.prepare("UPDATE accounts SET name = ?, phone = ? WHERE id = ?").run(name.trim(), phone || null, req.accountId);
  res.json({ success: true, name: name.trim() });
});

// POST /api/account/accept-privacy — aceptar la versión vigente del aviso
router.post("/accept-privacy", (req, res) => {
  const version = versionPrivacidad();
  db.prepare("UPDATE accounts SET privacy_version_accepted = ?, privacy_accepted_at = datetime('now') WHERE id = ?").run(version, req.accountId);
  res.json({ success: true, version });
});

// ---------------------------------------------------------------------------
// PUT /api/account/password — cambiar la contraseña
// ---------------------------------------------------------------------------
router.put("/password", limites.cambioContrasena, (req, res) => {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ error: "Indica tu contraseña actual y la nueva." });
  }
  const errorClave = errorContrasenaNueva(new_password);
  if (errorClave) return res.status(400).json({ error: errorClave });

  const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(req.accountId);

  // Pedimos siempre la contraseña actual: si alguien deja la sesión abierta
  // en un ordenador compartido de recepción, que no baste con eso para
  // secuestrar la cuenta cambiándole la contraseña sin más.
  if (!bcrypt.compareSync(String(current_password), account.password_hash)) {
    req.anotarFallo();
    return res.status(401).json({ error: "La contraseña actual no es correcta." });
  }
  req.limpiarFallos();
  if (bcrypt.compareSync(new_password, account.password_hash)) {
    return res.status(400).json({ error: "La nueva contraseña debe ser distinta de la actual." });
  }

  // Subir token_version cierra las sesiones abiertas en otros dispositivos.
  // Este navegador recibe una sesión nueva para no tener que volver a entrar.
  db.prepare("UPDATE accounts SET password_hash = ?, must_change_password = 0, token_version = token_version + 1 WHERE id = ?")
    .run(bcrypt.hashSync(new_password, 10), req.accountId);
  const actualizada = db.prepare("SELECT id, token_version FROM accounts WHERE id = ?").get(req.accountId);

  res.json({ success: true, token: makeToken(actualizada) });
});

module.exports = router;
