// routes/stripe-webhook.js
//
// Recibe los avisos de Stripe. Dos detalles importantes:
//
// 1. Comprobamos la FIRMA de cada aviso con STRIPE_WEBHOOK_SECRET. Sin esto,
//    cualquiera podría mandarnos un "pago realizado" falso y activarse cuotas
//    gratis.
// 2. La firma se calcula sobre el cuerpo EXACTO de la petición, así que esta
//    ruta necesita el cuerpo sin procesar (express.raw). Por eso se registra
//    en server.js ANTES de express.json(): si el JSON ya se hubiera
//    interpretado, la firma nunca coincidiría.
const { getStripe } = require("../services/stripeClient");
const { handleStripeEvent } = require("../services/stripeEvents");

module.exports = async function stripeWebhook(req, res) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return res.status(503).json({ error: "Stripe no está configurado." });

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], secret);
  } catch (err) {
    return res.status(400).send(`Firma no válida: ${err.message}`);
  }

  try {
    await handleStripeEvent(event);
    res.json({ received: true });
  } catch (err) {
    console.error("Error procesando el evento de Stripe", event.type, err);
    // Un 500 hace que Stripe reintente el aviso más tarde.
    res.status(500).json({ error: "processing_failed" });
  }
};
