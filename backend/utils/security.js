// utils/security.js
// Piezas de seguridad compartidas: sesiones, política de contraseñas y
// enlaces de un solo uso.
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

// Las contraseñas NUEVAS (registro, cambio, restablecer) tienen que tener al
// menos 8 caracteres. Las cuentas antiguas con contraseñas más cortas siguen
// pudiendo entrar: se les pedirá una de 8 cuando la cambien.
const MIN_PASSWORD = 8;
function errorContrasenaNueva(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`;
  }
  if (password.length > 200) return "La contraseña es demasiado larga.";
  return null;
}

// La sesión lleva la "versión" de la cuenta (token_version). Al cambiar o
// restablecer la contraseña, esa versión sube y las sesiones anteriores dejan
// de valer: si alguien tenía la sesión abierta en un móvil perdido, se cierra.
function makeToken(account) {
  return jwt.sign({ accountId: account.id, tv: account.token_version || 0 }, process.env.JWT_SECRET, { expiresIn: "30d" });
}

// Enlaces de un solo uso: el enlace lleva un valor aleatorio largo, y en la
// base de datos solo se guarda su huella SHA-256.
function tokenAleatorio() {
  return crypto.randomBytes(32).toString("hex");
}
function huella(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

module.exports = { MIN_PASSWORD, errorContrasenaNueva, makeToken, tokenAleatorio, huella };
