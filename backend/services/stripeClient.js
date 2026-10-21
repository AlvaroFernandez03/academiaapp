// services/stripeClient.js
// Stripe es OPCIONAL: si no hay STRIPE_SECRET_KEY en el .env, la app funciona
// igual, solo que las cuotas se pagan en recepción. Así la academia puede
// empezar a usarla antes de tener su cuenta de Stripe lista.

let client = null;
let cargado = false;

function getStripe() {
  if (cargado) return client;
  cargado = true;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  try {
    client = require("stripe")(key);
  } catch (err) {
    console.error("⚠️  Hay STRIPE_SECRET_KEY en el .env pero el paquete 'stripe' no está instalado. Ejecuta npm install.");
    client = null;
  }
  return client;
}

// Modo demostración (STRIPE_DEMO=1 en el .env): sin clave de Stripe, la app
// ENSEÑA la opción de pagar con tarjeta, pero al usarla solo muestra un aviso.
// No crea cuotas ni pagos. Sirve para presentar la app antes de decidir si se
// contrata Stripe. Si hay STRIPE_SECRET_KEY, manda la clave y no hay demo.
function isCardDemo() {
  return !getStripe() && process.env.STRIPE_DEMO === "1";
}

// Solo para las pruebas automáticas: permite sustituir Stripe por un doble.
function _setStripeForTests(fake) {
  client = fake;
  cargado = true;
}

module.exports = { getStripe, isCardDemo, _setStripeForTests };
