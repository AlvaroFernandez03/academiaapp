// services/billing.js
//
// Toda la lógica de cuotas vive aquí, para que las rutas solo se ocupen de
// recibir peticiones y devolver respuestas.
//
// Principios de diseño:
//
// 1. NUNCA tocamos datos de tarjeta. La tarjeta se guarda en una página de
//    Stripe (Checkout en modo "setup"); nosotros solo guardamos la referencia
//    que Stripe nos devuelve. Así la academia no tiene que cumplir la normativa
//    PCI de manejo de tarjetas.
//
// 2. La tarjeta se guarda UNA vez. Después, contratar más cuotas (otro hijo,
//    otra disciplina) es un clic: creamos la suscripción directamente por API.
//
// 3. Cada cuota se identifica en Stripe por su "subscription item", con el id
//    de la cuota en sus metadatos. Así sabemos siempre qué línea de cobro es
//    de quién, incluso en el modo familiar donde todo va en un solo cargo.
//
// 4. Las operaciones de pausa y baja dependen de cuántas cuotas comparten la
//    misma suscripción de Stripe, no del modo configurado. Si comparte con
//    otras, se quita solo su línea; si es la única, se actúa sobre la
//    suscripción entera. Así todo sigue funcionando aunque el admin cambie de
//    modo con cuotas ya en marcha.
//
// 5. Las llamadas a Stripe son asíncronas, así que aquí SÍ puede haber dos
//    peticiones a la vez sobre la misma cuota (por ejemplo, el aviso de Stripe
//    y el navegador del padre llegando al mismo tiempo). Para evitar cobrar
//    dos veces usamos dos protecciones: un "cerrojo" en la base de datos
//    (solo una petición puede pasar la cuota de pendiente a procesando) y las
//    claves de idempotencia de Stripe (si una misma petición llega dos veces,
//    Stripe devuelve el mismo resultado en lugar de crear un segundo cobro).

const db = require("../db/database");
const { getStripe, isCardDemo } = require("./stripeClient");
const { getSetting, setSetting } = require("./settings");
const { emailCuotaVencida } = require("./email");
const { todayStr, addDays, addMonths, daysBetween, unixToDateStr, toUnix } = require("../utils/dates");

const CURRENCY = "eur";
const METODOS_MANUALES = ["efectivo", "transferencia", "bizum", "tpv"];

class BillingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function frontendUrl() {
  return (process.env.FRONTEND_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
}

function requireStripe() {
  const stripe = getStripe();
  if (!stripe) throw new BillingError("El pago con tarjeta no está configurado en la academia.", 503);
  return stripe;
}

function getMembership(id) {
  return db.prepare("SELECT * FROM memberships WHERE id = ?").get(id);
}

function getOwnedMembership(membershipId, accountId, isAdmin) {
  const m = getMembership(membershipId);
  if (!m) throw new BillingError("Cuota no encontrada.", 404);
  if (!isAdmin && m.account_id !== accountId) throw new BillingError("Esa cuota no es de tu familia.", 403);
  return m;
}

function stripeErrorMessage(err) {
  if (err instanceof BillingError) return err.message;
  if (err && err.type === "StripeCardError") return `El banco ha rechazado el pago: ${err.message}`;
  return "No se ha podido completar la operación con el sistema de pagos. Inténtalo de nuevo en unos minutos.";
}

// Stripe ha movido current_period_end de la suscripción a sus líneas en las
// versiones recientes de su API; leemos de los dos sitios para funcionar con
// cualquiera de ellas.
function periodEndFromSub(sub) {
  const ts = sub.current_period_end || (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].current_period_end);
  return ts ? unixToDateStr(ts) : null;
}

function isSubUsable(sub) {
  return sub && ["active", "trialing"].includes(sub.status) && !sub.pause_collection && !sub.cancel_at_period_end;
}

// Cuántas cuotas tienen todavía una línea de cobro viva en esa suscripción.
function liveItemsCount(subscriptionId) {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM memberships
       WHERE stripe_subscription_id = ? AND stripe_subscription_item_id IS NOT NULL AND status != 'cancelada'`
    )
    .get(subscriptionId).n;
}

// ---------------------------------------------------------------------------
// Clientes y productos en Stripe (se crean la primera vez que hacen falta)
// ---------------------------------------------------------------------------
async function ensureStripeCustomer(accountId) {
  const stripe = requireStripe();
  const acc = db.prepare("SELECT id, name, email, stripe_customer_id FROM accounts WHERE id = ?").get(accountId);
  if (acc.stripe_customer_id) return acc.stripe_customer_id;

  const customer = await stripe.customers.create(
    { email: acc.email, name: acc.name, metadata: { account_id: String(acc.id) } },
    { idempotencyKey: `customer-account-${acc.id}` }
  );
  db.prepare("UPDATE accounts SET stripe_customer_id = ? WHERE id = ?").run(customer.id, acc.id);
  return customer.id;
}

async function ensureStripeProduct(plan) {
  if (plan.stripe_product_id) return plan.stripe_product_id;
  const stripe = requireStripe();
  const product = await stripe.products.create(
    { name: plan.name, metadata: { plan_id: String(plan.id) } },
    { idempotencyKey: `product-plan-${plan.id}` }
  );
  db.prepare("UPDATE plans SET stripe_product_id = ? WHERE id = ?").run(product.id, plan.id);
  return product.id;
}

// El precio se manda "en línea" con cada cuota, usando el importe congelado
// en la cuota. Así, cambiar el precio de un plan solo afecta a altas nuevas.
function priceData(productId, amountCents) {
  return { currency: CURRENCY, product: productId, unit_amount: amountCents, recurring: { interval: "month" } };
}

// ---------------------------------------------------------------------------
// CONTRATAR una cuota
// ---------------------------------------------------------------------------
async function createMembership({ accountId, memberId, planId, paymentMethod }) {
  const member = db.prepare("SELECT * FROM members WHERE id = ? AND account_id = ? AND active = 1").get(memberId, accountId);
  if (!member) throw new BillingError("Ese perfil no pertenece a tu familia.", 403);

  const plan = db.prepare("SELECT * FROM plans WHERE id = ? AND active = 1").get(planId);
  if (!plan) throw new BillingError("Ese plan no existe o ya no está disponible.", 404);

  const stripe = getStripe();
  const manualPermitido = getSetting("allow_manual_payment", "1") === "1";
  let method = paymentMethod;
  if (!["stripe", "manual"].includes(method)) method = stripe ? "stripe" : "manual";
  if (method === "stripe" && !stripe) throw new BillingError("El pago con tarjeta no está disponible. Elige pagar en recepción.");
  if (method === "manual" && !manualPermitido) throw new BillingError("La academia solo acepta el pago con tarjeta.");

  let id;
  try {
    id = db
      .prepare("INSERT INTO memberships (member_id, plan_id, account_id, payment_method, price_cents) VALUES (?, ?, ?, ?, ?)")
      .run(memberId, planId, accountId, method, plan.price_cents).lastInsertRowid;
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      throw new BillingError(`${member.first_name} ya tiene la cuota «${plan.name}».`, 409);
    }
    throw err;
  }

  if (method === "manual") return { membership: getMembership(id), next_step: "pay_at_desk" };

  const acc = db.prepare("SELECT stripe_default_pm FROM accounts WHERE id = ?").get(accountId);
  if (!acc.stripe_default_pm) return { membership: getMembership(id), next_step: "add_payment_method" };

  const m = await activateStripeMembership(id);
  return { membership: m, next_step: "done" };
}

// ---------------------------------------------------------------------------
// ACTIVAR en Stripe una cuota pendiente (crear su cobro recurrente)
// ---------------------------------------------------------------------------
async function activateStripeMembership(id) {
  // Cerrojo: solo UNA petición puede pasar la cuota de pendiente a procesando.
  // Si otra ya lo hizo, esta se retira sin tocar Stripe.
  const cerrojo = db
    .prepare(
      `UPDATE memberships SET status = 'procesando', activation_attempts = activation_attempts + 1
       WHERE id = ? AND status = 'pendiente_pago' AND payment_method = 'stripe'`
    )
    .run(id);
  if (cerrojo.changes === 0) return getMembership(id);

  const m = getMembership(id);
  try {
    const stripe = requireStripe();
    const plan = db.prepare("SELECT * FROM plans WHERE id = ?").get(m.plan_id);
    const customerId = await ensureStripeCustomer(m.account_id);
    const productId = await ensureStripeProduct(plan);
    const idempotencyKey = `mship-${m.id}-a${m.activation_attempts}`;
    const modo = getSetting("family_billing_mode", "separate");

    // Modo familiar: si la familia ya tiene una suscripción en marcha, se
    // añade esta cuota como una línea más de ese mismo cargo mensual.
    if (modo === "combined") {
      const acc = db.prepare("SELECT stripe_family_subscription_id FROM accounts WHERE id = ?").get(m.account_id);
      if (acc.stripe_family_subscription_id) {
        let familiar = null;
        try {
          familiar = await stripe.subscriptions.retrieve(acc.stripe_family_subscription_id);
        } catch (_) {
          familiar = null; // borrada en Stripe: crearemos una nueva más abajo
        }
        if (isSubUsable(familiar)) {
          const item = await stripe.subscriptionItems.create(
            {
              subscription: familiar.id,
              price_data: priceData(productId, m.price_cents),
              metadata: { membership_id: String(m.id) },
              // Se cobra ya la parte proporcional del mes en curso, en vez de
              // dejarla para el mes siguiente.
              proration_behavior: "always_invoice",
            },
            { idempotencyKey }
          );
          db.prepare(
            `UPDATE memberships SET status = 'activa', stripe_subscription_id = ?, stripe_subscription_item_id = ?,
                    current_period_end = ?, action_url = NULL WHERE id = ?`
          ).run(familiar.id, item.id, periodEndFromSub(familiar), m.id);
          return getMembership(id);
        }
      }
    }

    const sub = await stripe.subscriptions.create(
      {
        customer: customerId,
        items: [{ price_data: priceData(productId, m.price_cents), metadata: { membership_id: String(m.id) } }],
        metadata: { account_id: String(m.account_id) },
        // Intenta cobrar ya con la tarjeta guardada. Si el banco pide
        // confirmación adicional (3D Secure), la suscripción queda
        // "incompleta" y guardamos el enlace para que el padre la confirme.
        payment_behavior: "allow_incomplete",
        expand: ["latest_invoice"],
      },
      { idempotencyKey }
    );

    if (modo === "combined") {
      db.prepare("UPDATE accounts SET stripe_family_subscription_id = ? WHERE id = ?").run(sub.id, m.account_id);
    }
    const cobrada = ["active", "trialing"].includes(sub.status);
    const enlacePago = !cobrada && sub.latest_invoice && sub.latest_invoice.hosted_invoice_url ? sub.latest_invoice.hosted_invoice_url : null;
    db.prepare(
      `UPDATE memberships SET status = ?, stripe_subscription_id = ?, stripe_subscription_item_id = ?,
              current_period_end = ?, action_url = ? WHERE id = ?`
    ).run(cobrada ? "activa" : "impagada", sub.id, sub.items.data[0].id, periodEndFromSub(sub), enlacePago, m.id);
  } catch (err) {
    // Si algo falla, la cuota vuelve a "pendiente" para poder reintentarla.
    db.prepare("UPDATE memberships SET status = 'pendiente_pago' WHERE id = ? AND status = 'procesando'").run(id);
    throw new BillingError(stripeErrorMessage(err), 402);
  }
  return getMembership(id);
}

// Activa, una detrás de otra, todas las cuotas con tarjeta pendientes de una
// familia. En orden, porque en modo familiar la primera crea la suscripción y
// las siguientes se añaden a ella.
async function activatePendingForAccount(accountId) {
  const pendientes = db
    .prepare("SELECT id FROM memberships WHERE account_id = ? AND payment_method = 'stripe' AND status = 'pendiente_pago' ORDER BY id")
    .all(accountId);
  const resultado = { activated: 0, errors: [] };
  for (const p of pendientes) {
    try {
      const m = await activateStripeMembership(p.id);
      if (m.status === "activa") resultado.activated++;
      else if (m.status === "impagada") resultado.errors.push({ membership_id: p.id, error: "El banco pide una confirmación adicional del pago." });
    } catch (err) {
      resultado.errors.push({ membership_id: p.id, error: err.message });
    }
  }
  return resultado;
}

async function retryMembership({ accountId, membershipId }) {
  const m = getOwnedMembership(membershipId, accountId, false);
  if (m.payment_method !== "stripe" || m.status !== "pendiente_pago") {
    throw new BillingError("Esta cuota no está pendiente de activar con tarjeta.");
  }
  const acc = db.prepare("SELECT stripe_default_pm FROM accounts WHERE id = ?").get(accountId);
  if (!acc.stripe_default_pm) throw new BillingError("Primero tienes que añadir una tarjeta.");
  return activateStripeMembership(m.id);
}

// ---------------------------------------------------------------------------
// GUARDAR TARJETA (página segura de Stripe) y portal de facturación
// ---------------------------------------------------------------------------
async function createSetupSession(accountId) {
  const stripe = requireStripe();
  const customer = await ensureStripeCustomer(accountId);
  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    customer,
    currency: CURRENCY,
    payment_method_types: ["card"],
    success_url: `${frontendUrl()}/mis-cuotas.html?setup=ok&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${frontendUrl()}/mis-cuotas.html?setup=cancelado`,
    metadata: { account_id: String(accountId) },
  });
  return session.url;
}

// Se llama desde DOS sitios: desde el navegador al volver de Stripe, y desde
// el aviso (webhook) que manda Stripe. Lo que llegue primero hace el trabajo;
// el segundo no repite nada gracias al cerrojo de activateStripeMembership.
// Así funciona aunque los webhooks no estén configurados todavía.
async function completeSetupSession(sessionId, expectedAccountId = null) {
  const stripe = requireStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["setup_intent"] });

  const accountId = Number(session.metadata && session.metadata.account_id);
  if (!accountId) throw new BillingError("Sesión de pago no reconocida.");
  if (expectedAccountId && accountId !== expectedAccountId) throw new BillingError("Esa sesión de pago no es de tu cuenta.", 403);
  if (session.status !== "complete") throw new BillingError("La tarjeta todavía no se ha confirmado.", 409);

  const setupIntent = typeof session.setup_intent === "string"
    ? await stripe.setupIntents.retrieve(session.setup_intent)
    : session.setup_intent;
  const pm = setupIntent.payment_method;
  const pmId = typeof pm === "string" ? pm : pm.id;

  await stripe.customers.update(session.customer, { invoice_settings: { default_payment_method: pmId } });
  db.prepare("UPDATE accounts SET stripe_default_pm = ? WHERE id = ?").run(pmId, accountId);

  return activatePendingForAccount(accountId);
}

// El portal de Stripe permite al padre cambiar la tarjeta y descargar recibos
// sin que tengamos que programar esas pantallas.
//
// Las bajas y cambios de plan NO se pueden hacer desde el portal: se hacen
// desde la app, que sabe si una cuota comparte cargo con otras de la familia.
// Si se cancelara la suscripción desde el portal, se daría de baja a toda la
// familia a la vez. Por eso no usamos la configuración del dashboard (que
// alguien podría cambiar sin querer), sino una propia creada por API.
const PORTAL_CONFIG_SETTING = "stripe_portal_config_id";

function portalConfigIsSafe(config) {
  const f = config && config.features;
  return !!(f && config.active && !(f.subscription_cancel && f.subscription_cancel.enabled) &&
    !(f.subscription_update && f.subscription_update.enabled));
}

function esRecursoInexistente(err) {
  return !!err && (err.code === "resource_missing" || err.statusCode === 404);
}

async function ensurePortalConfiguration() {
  const stripe = requireStripe();
  const guardada = getSetting(PORTAL_CONFIG_SETTING);
  if (guardada) {
    let config = null;
    try {
      config = await stripe.billingPortal.configurations.retrieve(guardada);
    } catch (err) {
      // Solo si Stripe dice que NO EXISTE (típico al pasar de claves de prueba
      // a claves reales: son cuentas distintas) creamos otra. Cualquier otro
      // fallo (red, clave mal puesta...) se muestra como error: si creáramos
      // una configuración nueva en cada fallo, se irían acumulando en Stripe.
      if (!esRecursoInexistente(err)) throw new BillingError(stripeErrorMessage(err), 502);
    }
    if (config && portalConfigIsSafe(config)) return config.id;
  }
  const config = await stripe.billingPortal.configurations.create({
    features: {
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      subscription_cancel: { enabled: false },
      subscription_update: { enabled: false },
      customer_update: { enabled: false },
    },
    default_return_url: `${frontendUrl()}/mis-cuotas.html`,
    metadata: { creado_por: "academia-app" },
  });
  setSetting(PORTAL_CONFIG_SETTING, config.id);
  return config.id;
}

async function createPortalSession(accountId) {
  const stripe = requireStripe();
  const customer = await ensureStripeCustomer(accountId);
  const configuration = await ensurePortalConfiguration();
  const session = await stripe.billingPortal.sessions.create({ customer, configuration, return_url: `${frontendUrl()}/mis-cuotas.html` });
  return session.url;
}

// ---------------------------------------------------------------------------
// PAUSAR (lesión, vacaciones...)
// ---------------------------------------------------------------------------
async function pauseMembership({ accountId, membershipId, until, isAdmin = false }) {
  const m = getOwnedMembership(membershipId, accountId, isAdmin);
  if (m.status !== "activa" || m.cancel_at_period_end) throw new BillingError("Solo se puede pausar una cuota activa.");

  const hoy = todayStr();
  const maxDias = Number(getSetting("max_pause_days", "90"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until || "") || until <= hoy) throw new BillingError("La fecha de vuelta tiene que ser posterior a hoy.");
  if (daysBetween(hoy, until) > maxDias) throw new BillingError(`Una pausa no puede durar más de ${maxDias} días.`);

  if (m.payment_method === "manual") {
    db.prepare("UPDATE memberships SET status = 'pausada', paused_at = ?, paused_until = ?, pause_method = 'manual' WHERE id = ?")
      .run(hoy, until, m.id);
    return getMembership(m.id);
  }

  const stripe = requireStripe();
  if (!m.stripe_subscription_id || !m.stripe_subscription_item_id) throw new BillingError("Esta cuota no tiene un cobro activo en Stripe.");

  try {
    if (liveItemsCount(m.stripe_subscription_id) > 1) {
      // Comparte cargo con otras cuotas: quitamos solo su línea (sin cobrar
      // ni devolver nada) y la volveremos a añadir al reanudar.
      await stripe.subscriptionItems.del(m.stripe_subscription_item_id, { proration_behavior: "none" });
      db.prepare(
        `UPDATE memberships SET status = 'pausada', paused_at = ?, paused_until = ?, pause_method = 'item_removed',
                stripe_subscription_item_id = NULL WHERE id = ?`
      ).run(hoy, until, m.id);
    } else {
      // Es la única cuota de su suscripción: pausamos el cobro entero y Stripe
      // lo reanudará solo en la fecha indicada.
      await stripe.subscriptions.update(m.stripe_subscription_id, {
        pause_collection: { behavior: "void", resumes_at: toUnix(until) },
      });
      db.prepare("UPDATE memberships SET status = 'pausada', paused_at = ?, paused_until = ?, pause_method = 'collection' WHERE id = ?")
        .run(hoy, until, m.id);
    }
  } catch (err) {
    throw new BillingError(stripeErrorMessage(err), 502);
  }
  return getMembership(m.id);
}

// ---------------------------------------------------------------------------
// REANUDAR (a mano, o automáticamente al llegar la fecha de vuelta)
// ---------------------------------------------------------------------------
async function resumeMembership({ accountId, membershipId, isAdmin = false }) {
  const m = getOwnedMembership(membershipId, accountId, isAdmin);
  if (m.status !== "pausada") throw new BillingError("Esta cuota no está pausada.");
  const hoy = todayStr();

  if (m.pause_method === "manual" || m.payment_method === "manual") {
    // En efectivo, el mes ya estaba pagado: alargamos la fecha de vencimiento
    // tantos días como haya durado la pausa, para que no pierda lo pagado.
    const diasPausa = Math.max(0, daysBetween(m.paused_at || hoy, hoy));
    const nuevoFin = m.current_period_end ? addDays(m.current_period_end, diasPausa) : null;
    db.prepare(
      `UPDATE memberships SET status = 'activa', current_period_end = ?, paused_at = NULL, paused_until = NULL, pause_method = NULL
       WHERE id = ?`
    ).run(nuevoFin, m.id);
    return getMembership(m.id);
  }

  const stripe = requireStripe();
  try {
    if (m.pause_method === "collection") {
      await stripe.subscriptions.update(m.stripe_subscription_id, { pause_collection: "" });
      db.prepare("UPDATE memberships SET status = 'activa', paused_at = NULL, paused_until = NULL, pause_method = NULL WHERE id = ?").run(m.id);
      return getMembership(m.id);
    }

    // pause_method = 'item_removed': volvemos a añadir su línea al cargo
    // familiar, si ese cargo sigue en marcha.
    let sub = null;
    try {
      sub = await stripe.subscriptions.retrieve(m.stripe_subscription_id);
    } catch (_) {
      sub = null;
    }
    if (isSubUsable(sub)) {
      db.prepare("UPDATE memberships SET activation_attempts = activation_attempts + 1 WHERE id = ?").run(m.id);
      const intento = getMembership(m.id).activation_attempts;
      const plan = db.prepare("SELECT * FROM plans WHERE id = ?").get(m.plan_id);
      const productId = await ensureStripeProduct(plan);
      const item = await stripe.subscriptionItems.create(
        {
          subscription: sub.id,
          price_data: priceData(productId, m.price_cents),
          metadata: { membership_id: String(m.id) },
          proration_behavior: "always_invoice",
        },
        { idempotencyKey: `mship-${m.id}-a${intento}` }
      );
      db.prepare(
        `UPDATE memberships SET status = 'activa', stripe_subscription_item_id = ?, current_period_end = ?,
                paused_at = NULL, paused_until = NULL, pause_method = NULL WHERE id = ?`
      ).run(item.id, periodEndFromSub(sub), m.id);
      return getMembership(m.id);
    }
  } catch (err) {
    throw new BillingError(stripeErrorMessage(err), 502);
  }

  // Si el cargo familiar ya no existe (por ejemplo, se dieron de baja todos
  // los demás mientras estaba pausada), la tratamos como un alta nueva.
  db.prepare(
    `UPDATE memberships SET status = 'pendiente_pago', stripe_subscription_id = NULL, stripe_subscription_item_id = NULL,
            paused_at = NULL, paused_until = NULL, pause_method = NULL WHERE id = ?`
  ).run(m.id);
  return activateStripeMembership(m.id);
}

// ---------------------------------------------------------------------------
// DAR DE BAJA
// ---------------------------------------------------------------------------
// Una cuota activa se da de baja "a final de mes": no se vuelve a cobrar, pero
// sigue permitiendo reservar hasta la fecha que ya está pagada. Una cuota que
// no se está usando (pendiente, pausada, impagada) se cancela al momento.
async function cancelMembership({ accountId, membershipId, isAdmin = false }) {
  const m = getOwnedMembership(membershipId, accountId, isAdmin);
  if (m.status === "cancelada") throw new BillingError("Esta cuota ya está cancelada.");
  if (m.status === "procesando") throw new BillingError("Se está procesando un pago de esta cuota. Inténtalo en unos segundos.", 409);
  if (m.cancel_at_period_end) throw new BillingError("Esta cuota ya tiene la baja programada.");

  const cancelarYa = () =>
    db.prepare(
      `UPDATE memberships SET status = 'cancelada', cancelled_at = datetime('now'), stripe_subscription_item_id = NULL,
              paused_until = NULL WHERE id = ?`
    ).run(m.id);

  const hayCobroEnStripe = m.payment_method === "stripe" && m.stripe_subscription_id;
  const stripe = hayCobroEnStripe ? requireStripe() : null;

  try {
    if (m.status === "pendiente_pago") {
      cancelarYa();
    } else if (m.status === "pausada" || m.status === "impagada") {
      if (hayCobroEnStripe) {
        if (m.stripe_subscription_item_id && liveItemsCount(m.stripe_subscription_id) > 1) {
          await stripe.subscriptionItems.del(m.stripe_subscription_item_id, { proration_behavior: "none" });
        } else if (m.pause_method !== "item_removed") {
          // Es la única cuota de esa suscripción: se cancela entera.
          await stripe.subscriptions.cancel(m.stripe_subscription_id);
        }
      }
      cancelarYa();
    } else if (m.status === "activa") {
      if (!m.current_period_end) {
        if (hayCobroEnStripe) await stripe.subscriptions.cancel(m.stripe_subscription_id);
        cancelarYa();
      } else if (m.payment_method === "manual") {
        db.prepare("UPDATE memberships SET cancel_at_period_end = 1 WHERE id = ?").run(m.id);
      } else if (liveItemsCount(m.stripe_subscription_id) > 1) {
        // Comparte cargo: quitamos ya su línea (sin devolver lo pagado) y
        // mantenemos el acceso hasta la fecha pagada.
        await stripe.subscriptionItems.del(m.stripe_subscription_item_id, { proration_behavior: "none" });
        db.prepare("UPDATE memberships SET cancel_at_period_end = 1, stripe_subscription_item_id = NULL WHERE id = ?").run(m.id);
      } else {
        await stripe.subscriptions.update(m.stripe_subscription_id, { cancel_at_period_end: true });
        db.prepare("UPDATE memberships SET cancel_at_period_end = 1 WHERE id = ?").run(m.id);
      }
    }
  } catch (err) {
    throw new BillingError(stripeErrorMessage(err), 502);
  }
  return getMembership(m.id);
}

// ---------------------------------------------------------------------------
// PAGO EN RECEPCIÓN (lo registra la administración)
// ---------------------------------------------------------------------------
function recordManualPayment({ membershipId, method, months, notes, adminAccountId }) {
  const m = getMembership(membershipId);
  if (!m) throw new BillingError("Cuota no encontrada.", 404);
  if (m.payment_method !== "manual") {
    throw new BillingError("Esta cuota se cobra con tarjeta a través de Stripe; registrar aquí un pago supondría cobrarla dos veces.");
  }
  if (m.status === "cancelada") throw new BillingError("No se pueden registrar pagos de una cuota cancelada.");
  if (!METODOS_MANUALES.includes(method)) throw new BillingError("Forma de pago no válida.");
  const meses = Number(months);
  if (!Number.isInteger(meses) || meses < 1 || meses > 12) throw new BillingError("Indica entre 1 y 12 meses.");

  // Si aún le quedaban días pagados, el nuevo periodo empieza donde acababa
  // el anterior; si ya estaba vencida, empieza hoy (la academia decide si
  // reclama o no el tiempo sin pagar).
  const hoy = todayStr();
  const inicio = m.current_period_end && m.current_period_end > hoy ? m.current_period_end : hoy;
  const fin = addMonths(inicio, meses);
  const importe = m.price_cents * meses;

  try {
    db.exec("BEGIN");
    db.prepare(
      `INSERT INTO payments (account_id, membership_id, amount_cents, method, period_start, period_end, notes, recorded_by_account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(m.account_id, m.id, importe, method, inicio, fin, notes || null, adminAccountId);
    db.prepare(
      `UPDATE memberships SET current_period_end = ?,
              status = CASE WHEN status = 'pausada' THEN 'pausada' ELSE 'activa' END
       WHERE id = ?`
    ).run(fin, m.id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw new BillingError("No se ha podido registrar el pago.", 500);
  }
  return getMembership(m.id);
}

// ---------------------------------------------------------------------------
// MANTENIMIENTO periódico (lo lanza el servidor cada hora)
// ---------------------------------------------------------------------------
async function runMaintenance() {
  const hoy = todayStr();
  const gracia = Number(getSetting("grace_days", "5"));
  const resultado = { overdue: 0, ended: 0, resumed: 0, errors: [] };

  // 1. Cuotas en efectivo que han vencido hace más de los días de margen.
  //    Se avisa por email a la familia (una vez: la cuota deja de estar
  //    'activa', así que la revisión siguiente ya no la vuelve a coger).
  const vencidas = db
    .prepare(
      `SELECT ms.id, p.name AS plan_name, m.first_name, a.email, a.name AS account_name, a.active
       FROM memberships ms JOIN plans p ON p.id = ms.plan_id JOIN members m ON m.id = ms.member_id JOIN accounts a ON a.id = ms.account_id
       WHERE ms.payment_method = 'manual' AND ms.status = 'activa' AND ms.cancel_at_period_end = 0
         AND ms.current_period_end IS NOT NULL AND ms.current_period_end < ?`
    )
    .all(addDays(hoy, -gracia));
  for (const v of vencidas) {
    const r = db.prepare("UPDATE memberships SET status = 'impagada' WHERE id = ? AND status = 'activa'").run(v.id);
    if (r.changes && v.active) emailCuotaVencida({ email: v.email, name: v.account_name }, { plan: v.plan_name, miembro: v.first_name });
    resultado.overdue += Number(r.changes);
  }

  // 2. Bajas programadas que llegan al final del periodo pagado.
  resultado.ended = db
    .prepare(
      `UPDATE memberships SET status = 'cancelada', cancelled_at = datetime('now')
       WHERE cancel_at_period_end = 1 AND status IN ('activa', 'impagada')
         AND (current_period_end IS NULL OR current_period_end <= ?)`
    )
    .run(hoy).changes;

  // 3. Pausas que terminan hoy (o que debían haber terminado).
  const aReanudar = db
    .prepare("SELECT id FROM memberships WHERE status = 'pausada' AND paused_until IS NOT NULL AND paused_until <= ?")
    .all(hoy);
  for (const p of aReanudar) {
    try {
      await resumeMembership({ membershipId: p.id, isAdmin: true });
      resultado.resumed++;
    } catch (err) {
      resultado.errors.push({ membership_id: p.id, error: err.message });
    }
  }
  return resultado;
}

// ---------------------------------------------------------------------------
// RESUMEN para la pantalla "Cuotas" de una familia
// ---------------------------------------------------------------------------
function getOverview(accountId) {
  const acc = db.prepare("SELECT stripe_default_pm FROM accounts WHERE id = ?").get(accountId);
  const miembros = db
    .prepare(
      "SELECT id, first_name, last_name, avatar_file, is_dependent FROM members WHERE account_id = ? AND active = 1 ORDER BY is_dependent, first_name"
    )
    .all(accountId);

  // No mandamos al navegador los identificadores internos de Stripe: no los
  // necesita para nada.
  const cuotas = db
    .prepare(
      `SELECT ms.id, ms.member_id, ms.plan_id, ms.payment_method, ms.status, ms.price_cents, ms.current_period_end,
              ms.cancel_at_period_end, ms.paused_until, ms.action_url, ms.created_at, ms.cancelled_at,
              p.name AS plan_name, p.scope, p.max_classes_per_week, d.name AS discipline_name
       FROM memberships ms JOIN plans p ON p.id = ms.plan_id LEFT JOIN disciplines d ON d.id = p.discipline_id
       WHERE ms.account_id = ? AND (ms.status != 'cancelada' OR ms.cancelled_at >= datetime('now', '-60 days'))
       ORDER BY ms.status = 'cancelada', ms.created_at DESC`
    )
    .all(accountId);

  const planes = db
    .prepare(
      `SELECT p.id, p.name, p.description, p.price_cents, p.scope, p.max_classes_per_week, d.name AS discipline_name
       FROM plans p LEFT JOIN disciplines d ON d.id = p.discipline_id WHERE p.active = 1 ORDER BY p.price_cents`
    )
    .all();

  const pagos = db
    .prepare(
      `SELECT pa.id, pa.amount_cents, pa.method, pa.period_start, pa.period_end, pa.created_at, pl.name AS plan_name,
              m.first_name AS member_first_name
       FROM payments pa
       LEFT JOIN memberships ms ON ms.id = pa.membership_id
       LEFT JOIN plans pl ON pl.id = ms.plan_id
       LEFT JOIN members m ON m.id = ms.member_id
       WHERE pa.account_id = ? ORDER BY pa.created_at DESC, pa.id DESC LIMIT 24`
    )
    .all(accountId);

  return {
    stripe_enabled: !!getStripe(),
    card_demo: isCardDemo(),
    allow_manual_payment: getSetting("allow_manual_payment", "1") === "1",
    has_payment_method: !!acc.stripe_default_pm,
    max_pause_days: Number(getSetting("max_pause_days", "90")),
    members: miembros.map((mb) => ({ ...mb, memberships: cuotas.filter((c) => c.member_id === mb.id) })),
    plans: planes,
    payments: pagos,
  };
}

module.exports = {
  BillingError,
  METODOS_MANUALES,
  createMembership,
  activateStripeMembership,
  activatePendingForAccount,
  retryMembership,
  createSetupSession,
  completeSetupSession,
  createPortalSession,
  pauseMembership,
  resumeMembership,
  cancelMembership,
  recordManualPayment,
  runMaintenance,
  getOverview,
};
