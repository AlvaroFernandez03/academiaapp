// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const authRoutes = require("./routes/auth");
const familyRoutes = require("./routes/family");
const scheduleRoutes = require("./routes/schedule");
const bookingRoutes = require("./routes/bookings");
const accountRoutes = require("./routes/account");
const billingRoutes = require("./routes/billing");
const adminBillingRoutes = require("./routes/admin-billing");
const adminRoutes = require("./routes/admin");
const publicRoutes = require("./routes/public");
const stripeWebhook = require("./routes/stripe-webhook");
const { runMaintenance } = require("./services/billing");
const { getStripe, isCardDemo } = require("./services/stripeClient");
const { modoEmail } = require("./services/email");
const { copiaSiToca } = require("./services/backup");
const { cabecerasSeguridad, apiNoEncontrada, manejarErrores } = require("./middleware/seguridad");

// Sin JWT_SECRET no se puede iniciar sesión: mejor no arrancar que arrancar roto.
if (!process.env.JWT_SECRET) {
  console.error("❌ Falta JWT_SECRET en el archivo .env (copia .env.example como .env y rellénalo).");
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by"); // no anunciar qué tecnología usa el servidor
// Detrás de un proxy (Caddy, Nginx, el de la plataforma...): TRUST_PROXY=1,
// para conocer la IP real (límites de intentos) y si la conexión es HTTPS.
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.use(cabecerasSeguridad);

// La web y la API se sirven desde el mismo sitio, así que por defecto NO se
// permite que otras webs llamen a la API desde el navegador. Solo si el
// frontend se sirviera desde otra dirección, se indica en CORS_ORIGIN.
if (process.env.CORS_ORIGIN) app.use(cors({ origin: process.env.CORS_ORIGIN.split(",").map((o) => o.trim()) }));

// El aviso de Stripe necesita el cuerpo SIN procesar para verificar su firma:
// por eso va antes de express.json().
app.post("/api/billing/webhook", express.raw({ type: "application/json", limit: "1mb" }), stripeWebhook);
app.use(express.json({ limit: "100kb" })); // los formularios de la app son pequeños
// Solo en la demo pública del portfolio (DEMO=1): cinta con las cuentas de prueba. Ver demo.js.
require("./demo")(app, path.join(__dirname, "..", "frontend"));
app.use(express.static(path.join(__dirname, "..", "frontend")));
// Las fotos de perfil se sirven aparte de los archivos del frontend, desde
// la carpeta donde las guarda multer.
app.use("/uploads", express.static(require("./middleware/upload").uploadsRoot));

app.use("/api/public", publicRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/family", familyRoutes);
app.use("/api/schedule", scheduleRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/account", accountRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/admin/billing", adminBillingRoutes);
app.use("/api/admin", adminRoutes);

// Cualquier web puede preguntar si el servidor está en marcha (lo usa el
// portfolio para saber cuándo está despierta la demo). Solo esta ruta.
app.get("/api/health", (req, res) => res.set("Access-Control-Allow-Origin", "*").json({ status: "ok" }));
app.use("/api", apiNoEncontrada);
app.use(manejarErrores);

app.listen(PORT, () => {
  console.log(`✅ Academia corriendo en http://localhost:${PORT}`);
  avisosDeConfiguracion();
});

// Resume al arrancar cómo están configurados los pagos y avisa de las
// combinaciones que suelen dar problemas más adelante.
function avisosDeConfiguracion() {
  const env = process.env;
  const claveReal = /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY || "");

  if (getStripe()) {
    console.log(`💳 Pagos con tarjeta: Stripe activado (${claveReal ? "CLAVES REALES: se cobra de verdad" : "modo pruebas"})`);
    if (env.STRIPE_DEMO === "1") console.log("ℹ️  STRIPE_DEMO se ignora porque hay STRIPE_SECRET_KEY.");
    if (!env.STRIPE_WEBHOOK_SECRET) {
      console.warn("⚠️  Falta STRIPE_WEBHOOK_SECRET: los avisos de Stripe (pagos confirmados, fallidos...) se rechazarán. Ver PRUEBAS_STRIPE.md.");
    }
    if (claveReal && /localhost|127\.0\.0\.1/.test(env.FRONTEND_URL || "localhost")) {
      console.warn("⚠️  Claves REALES con FRONTEND_URL local: Stripe devolvería a las familias a una dirección que no existe fuera de este ordenador.");
    }
  } else if (env.STRIPE_SECRET_KEY) {
    console.warn("⚠️  Hay STRIPE_SECRET_KEY pero Stripe no se ha podido cargar (¿falta npm install?). Solo pago en recepción.");
  } else if (isCardDemo()) {
    console.log("🎭 Pagos con tarjeta en MODO DEMOSTRACIÓN: se ve la opción, pero no cobra nada.");
    console.warn("   Recuerda poner STRIPE_DEMO=0 antes de que la usen alumnos reales.");
  } else {
    console.log("💶 Pagos con tarjeta desactivados (sin STRIPE_SECRET_KEY): solo pago en recepción");
  }

  if (env.JWT_SECRET === "cambia_esto_por_una_frase_secreta_larga_y_unica") {
    console.warn("⚠️  JWT_SECRET sigue siendo el de ejemplo: cámbialo antes de usar la app con datos reales.");
  } else if (env.JWT_SECRET.length < 32) {
    console.warn("⚠️  JWT_SECRET es corto: usa al menos 32 caracteres aleatorios (ver .env.example).");
  }

  console.log(
    modoEmail() === "brevo"
      ? `✉️  Emails: se envían con Brevo desde ${env.EMAIL_FROM}`
      : "✉️  Emails en MODO LOCAL: no se envía nada; se ven en Administración → Emails."
  );

  // Publicada en internet (FRONTEND_URL no es local): avisos de lo que sería
  // un problema serio con alumnos reales.
  const publica = !!env.FRONTEND_URL && !/localhost|127\.0\.0\.1/.test(env.FRONTEND_URL);
  if (publica) {
    if (modoEmail() === "local") console.warn("⚠️  La app está publicada pero los emails están en modo local: nadie recibirá los enlaces para restablecer la contraseña.");
    if (env.TRUST_PROXY !== "1") console.warn("⚠️  Publicada sin TRUST_PROXY=1: si hay un proxy delante (Caddy, Nginx...), los límites de intentos verán a todos con la misma IP.");
    const db = require("./db/database");
    if (db.prepare("SELECT 1 FROM accounts WHERE email = 'admin@academia.com'").get()) {
      console.warn("🚨 La base de datos tiene las CUENTAS DE EJEMPLO (contraseña academia123). No la uses publicada: arranca con una nueva y SEED_DEMO_DATA=0.");
    }
  }
}

// Revisión periódica de cuotas: vencimientos en efectivo, bajas que llegan a
// su fecha y pausas que terminan. Se lanza al arrancar y luego cada hora.
async function mantenimiento() {
  try {
    const r = await runMaintenance();
    if (r.overdue || r.ended || r.resumed || r.errors.length) console.log("🔁 Revisión de cuotas:", r);
  } catch (err) {
    console.error("Error en la revisión de cuotas:", err);
  }
}
mantenimiento();
setInterval(mantenimiento, 60 * 60 * 1000);

// Copia de seguridad diaria (se comprueba cada hora; ver services/backup.js).
function copiaDiaria() {
  try {
    const r = copiaSiToca();
    if (r) console.log(`💾 Copia de seguridad hecha: ${r.name}`);
  } catch (err) {
    console.error("❌ No se ha podido hacer la copia de seguridad:", err.message);
  }
}
copiaDiaria();
setInterval(copiaDiaria, 60 * 60 * 1000);
