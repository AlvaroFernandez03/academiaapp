// middleware/auth.js
const jwt = require("jsonwebtoken");
const db = require("../db/database");

function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Necesitas iniciar sesión." });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Tu sesión ha caducado. Vuelve a iniciar sesión." });
  }

  // Las sesiones duran 30 días: sin esta comprobación, una cuenta que la
  // academia desactiva hoy podría seguir usando la app hasta que caducara.
  const account = db.prepare("SELECT active, token_version FROM accounts WHERE id = ?").get(payload.accountId);
  if (!account) return res.status(401).json({ error: "Tu sesión ya no es válida. Vuelve a iniciar sesión." });
  if (!account.active) return res.status(401).json({ error: "Esta cuenta está desactivada. Habla con la academia." });
  // La contraseña ha cambiado desde que se abrió esta sesión: se cierra.
  if ((payload.tv || 0) !== account.token_version) {
    return res.status(401).json({ error: "La contraseña de la cuenta ha cambiado. Vuelve a iniciar sesión." });
  }

  req.accountId = payload.accountId;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    const account = db.prepare("SELECT role FROM accounts WHERE id = ?").get(req.accountId);
    if (!account || !roles.includes(account.role)) {
      return res.status(403).json({ error: "No tienes permiso para hacer esto." });
    }
    req.accountRole = account.role;
    next();
  };
}

// Comprueba que un miembro concreto pertenece a la cuenta indicada. Se usa
// en todas las rutas donde una familia actúa "en nombre de" uno de sus
// miembros (reservar una clase, ver su progreso...), para que nadie pueda
// tocar los datos de un miembro de otra familia aunque adivine su id.
function memberBelongsToAccount(memberId, accountId) {
  return !!db.prepare("SELECT id FROM members WHERE id = ? AND account_id = ?").get(memberId, accountId);
}

module.exports = { requireAuth, requireRole, memberBelongsToAccount };
