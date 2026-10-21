// services/stripeEvents.js
//
// Procesa los avisos (webhooks) que Stripe manda cuando pasa algo con un
// cobro: un pago realizado, un pago fallido, una suscripción cancelada...
// Stripe es la fuente de verdad del dinero; esto mantiene nuestra base de
// datos sincronizada con lo que de verdad ha ocurrido.
//
// Un mismo aviso puede llegar más de una vez (Stripe reintenta si no le
// contestamos a tiempo), así que cada evento se procesa una única vez.
const db = require("../db/database");
const { completeSetupSession } = require("./billing");
const { emailPagoFallido } = require("./email");
const { unixToDateStr, todayStr } = require("../utils/dates");

// El id de suscripción de una factura ha cambiado de sitio entre versiones de
// la API de Stripe; lo buscamos en los dos.
function invoiceSubscriptionId(inv) {
  const raw = inv.subscription || (inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.subscription);
  if (!raw) return null;
  return typeof raw === "string" ? raw : raw.id;
}

async function handleStripeEvent(event) {
  try {
    db.prepare("INSERT INTO stripe_events (id, type) VALUES (?, ?)").run(event.id, event.type);
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) return { duplicate: true };
    throw err;
  }

  try {
    await procesar(event);
  } catch (err) {
    // Si falla, quitamos la marca para que el reintento de Stripe lo vuelva a intentar.
    db.prepare("DELETE FROM stripe_events WHERE id = ?").run(event.id);
    throw err;
  }
  return { processed: true };
}

async function procesar(event) {
  const obj = event.data.object;

  switch (event.type) {
    case "checkout.session.completed": {
      if (obj.mode === "setup") await completeSetupSession(obj.id);
      break;
    }

    case "invoice.paid": {
      const subId = invoiceSubscriptionId(obj);
      if (!subId) break;
      const cuotas = db.prepare("SELECT id, account_id FROM memberships WHERE stripe_subscription_id = ?").all(subId);
      if (cuotas.length === 0) break;

      const lineas = (obj.lines && obj.lines.data) || [];
      const fin = lineas.reduce((mx, l) => Math.max(mx, (l.period && l.period.end) || 0), 0);
      const ini = lineas.reduce((mn, l) => Math.min(mn, (l.period && l.period.start) || Infinity), Infinity);
      const finStr = fin ? unixToDateStr(fin) : null;
      const iniStr = Number.isFinite(ini) ? unixToDateStr(ini) : null;

      // Solo las cuotas que siguen teniendo su línea de cobro viva. Las que
      // se dieron de baja (línea quitada) o están pausadas no se renuevan.
      db.prepare(
        `UPDATE memberships SET status = 'activa', action_url = NULL, current_period_end = COALESCE(?, current_period_end)
         WHERE stripe_subscription_id = ? AND stripe_subscription_item_id IS NOT NULL
           AND status IN ('activa', 'impagada', 'procesando')`
      ).run(finStr, subId);

      if (obj.amount_paid > 0) {
        db.prepare(
          `INSERT OR IGNORE INTO payments (account_id, membership_id, amount_cents, method, period_start, period_end, stripe_invoice_id)
           VALUES (?, ?, ?, 'stripe', ?, ?, ?)`
        ).run(cuotas[0].account_id, cuotas.length === 1 ? cuotas[0].id : null, obj.amount_paid, iniStr, finStr, obj.id);
      }
      break;
    }

    case "invoice.payment_failed": {
      const subId = invoiceSubscriptionId(obj);
      if (!subId) break;
      const r = db.prepare(
        `UPDATE memberships SET status = 'impagada', action_url = ?
         WHERE stripe_subscription_id = ? AND stripe_subscription_item_id IS NOT NULL AND status IN ('activa', 'procesando')`
      ).run(obj.hosted_invoice_url || null, subId);
      // Aviso a la familia. Cada evento de Stripe se procesa una sola vez
      // (ver handleStripeEvent), así que no se repite si Stripe reintenta.
      if (r.changes) {
        const cuenta = db
          .prepare("SELECT a.email, a.name, a.active FROM memberships ms JOIN accounts a ON a.id = ms.account_id WHERE ms.stripe_subscription_id = ? LIMIT 1")
          .get(subId);
        if (cuenta && cuenta.active) emailPagoFallido(cuenta, { urlPago: obj.hosted_invoice_url || null });
      }
      break;
    }

    case "customer.subscription.updated": {
      const sub = obj;
      if (sub.pause_collection) {
        const vuelta = sub.pause_collection.resumes_at ? unixToDateStr(sub.pause_collection.resumes_at) : null;
        db.prepare(
          `UPDATE memberships SET status = 'pausada', pause_method = 'collection',
                  paused_at = COALESCE(paused_at, ?), paused_until = COALESCE(paused_until, ?)
           WHERE stripe_subscription_id = ? AND stripe_subscription_item_id IS NOT NULL AND status = 'activa'`
        ).run(todayStr(), vuelta, sub.id);
      } else if (["active", "trialing"].includes(sub.status)) {
        db.prepare(
          `UPDATE memberships SET status = 'activa', paused_at = NULL, paused_until = NULL, pause_method = NULL
           WHERE stripe_subscription_id = ? AND status = 'pausada' AND pause_method = 'collection'`
        ).run(sub.id);
      }
      if (["past_due", "unpaid"].includes(sub.status)) {
        db.prepare(
          `UPDATE memberships SET status = 'impagada'
           WHERE stripe_subscription_id = ? AND stripe_subscription_item_id IS NOT NULL AND status = 'activa'`
        ).run(sub.id);
      }
      // Baja programada o deshecha desde el portal de Stripe.
      db.prepare(
        `UPDATE memberships SET cancel_at_period_end = ?
         WHERE stripe_subscription_id = ? AND stripe_subscription_item_id IS NOT NULL AND status != 'cancelada'`
      ).run(sub.cancel_at_period_end ? 1 : 0, sub.id);
      break;
    }

    case "customer.subscription.deleted": {
      // Las cuotas pausadas "quitando su línea" no dependen de esta
      // suscripción mientras están pausadas: al reanudarse, crearán una nueva.
      db.prepare(
        `UPDATE memberships SET status = 'cancelada', cancelled_at = datetime('now'), stripe_subscription_item_id = NULL
         WHERE stripe_subscription_id = ? AND status != 'cancelada'
           AND NOT (status = 'pausada' AND pause_method = 'item_removed')`
      ).run(obj.id);
      db.prepare("UPDATE accounts SET stripe_family_subscription_id = NULL WHERE stripe_family_subscription_id = ?").run(obj.id);
      break;
    }

    default:
      break; // Eventos que no nos interesan: se ignoran.
  }
}

module.exports = { handleStripeEvent, invoiceSubscriptionId };
