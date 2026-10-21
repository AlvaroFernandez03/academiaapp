// middleware/seguridad.js
//
// Cabeceras de seguridad (lo mismo que haría la librería "helmet", escrito a
// mano para no añadir dependencias) y respuestas de error uniformes.

// Política de contenido: el navegador solo ejecuta scripts de la propia app
// (ni scripts escritos dentro del HTML, ni de otras webs). Es una segunda
// barrera: aunque algún día se colara código en un nombre o una nota, el
// navegador se negaría a ejecutarlo.
//  - style-src 'unsafe-inline': la app usa atributos style="..." en el HTML
//    que genera; los estilos no pueden ejecutar código, así que el riesgo es
//    mínimo.
//  - img-src data: blob: para las iniciales y las vistas previas de fotos.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function cabecerasSeguridad(req, res, next) {
  res.set({
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff", // no "adivinar" tipos: un .png se trata siempre como imagen
    "X-Frame-Options": "DENY", // nadie puede meter la app dentro de otra web (clickjacking)
    "Referrer-Policy": "same-origin", // los enlaces de un solo uso no se filtran a otras webs
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  // HSTS: una vez servida por HTTPS, el navegador ya no aceptará la versión
  // sin cifrar. Solo se envía si la petición llega de verdad por HTTPS.
  if (req.secure) res.set("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  // Las respuestas de la API (datos personales) no se guardan en cachés.
  if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
  next();
}

// Rutas /api que no existen: JSON, no la página HTML por defecto de Express.
function apiNoEncontrada(req, res) {
  res.status(404).json({ error: "Esa ruta no existe." });
}

// Último recurso para errores no previstos: se registran en el servidor y al
// navegador solo le llega un mensaje genérico (sin detalles internos).
// eslint-disable-next-line no-unused-vars
function manejarErrores(err, req, res, next) {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Los datos enviados no son válidos." });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Los datos enviados son demasiado grandes." });
  console.error("Error no controlado en", req.method, req.path, err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Ha ocurrido un error inesperado." });
}

module.exports = { cabecerasSeguridad, apiNoEncontrada, manejarErrores, CSP };
