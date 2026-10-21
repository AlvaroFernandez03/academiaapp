// tests/billing.test.js
//
// Pruebas de la lógica de cuotas con un Stripe SIMULADO: no se conecta a
// Stripe ni cobra nada. Sirve para comprobar nuestra lógica (estados,
// cerrojos, webhooks, límites de reserva). Lo que hace de verdad Stripe se
// comprueba aparte, a mano, siguiendo PRUEBAS_STRIPE.md.
//
// Ejecutar:  npm test
// Usa una base de datos temporal: NUNCA toca la base de datos real.

const os = require("os");
const path = require("path");
const fs = require("fs");
const assert = require("assert");

const tmpDb = path.join(os.tmpdir(), `academia-test-${process.pid}.db`);
process.env.ACADEMIA_DB_PATH = tmpDb;
delete process.env.STRIPE_SECRET_KEY;
// Emails en modo local: se guardan en la tabla email_log y no salen a Internet.
process.env.EMAIL_PROVIDER = "";

const db = require("../db/database");
const { _setStripeForTests } = require("../services/stripeClient");
const billing = require("../services/billing");
const { handleStripeEvent } = require("../services/stripeEvents");
const { bookClass } = require("../services/bookingService");
const { setSetting } = require("../services/settings");
const { todayStr, addDays } = require("../utils/dates");
const { esperarEnvios } = require("../services/email");
const emailsA = (email, kind) =>
  db.prepare("SELECT * FROM email_log WHERE to_email = ? AND kind = ? ORDER BY id DESC").all(email, kind);

// ---------------------------------------------------------------------------
// Stripe falso: guarda estado en memoria y apunta cada llamada.
// ---------------------------------------------------------------------------
function crearStripeFalso() {
  let n = 0;
  const id = (p) => `${p}_${++n}`;
  const esperar = () => new Promise((r) => setTimeout(r, 5)); // abre ventana a carreras
  const unMes = () => Math.floor(Date.now() / 1000) + 30 * 86400;
  const f = { calls: [], subs: {}, sessions: {}, idem: {}, nextStatus: "active" };
  const log = (name, args) => f.calls.push({ name, args });

  f.customers = {
    create: async (p, o) => { log("customers.create", [p, o]); await esperar(); return { id: id("cus") }; },
    update: async (i, p) => { log("customers.update", [i, p]); return { id: i }; },
  };
  f.products = { create: async (p, o) => { log("products.create", [p, o]); return { id: id("prod") }; } };
  f.subscriptions = {
    create: async (p, o) => {
      log("subscriptions.create", [p, o]);
      await esperar();
      if (o && o.idempotencyKey && f.idem[o.idempotencyKey]) return f.idem[o.idempotencyKey];
      const incompleta = f.nextStatus === "incomplete";
      const sub = {
        id: id("sub"),
        status: incompleta ? "incomplete" : "active",
        current_period_end: unMes(),
        cancel_at_period_end: false,
        pause_collection: null,
        items: { data: p.items.map((it) => ({ id: id("si"), metadata: it.metadata })) },
        latest_invoice: incompleta ? { hosted_invoice_url: "https://invoice.stripe.com/i/prueba" } : null,
      };
      f.subs[sub.id] = sub;
      if (o && o.idempotencyKey) f.idem[o.idempotencyKey] = sub;
      return sub;
    },
    retrieve: async (i) => { log("subscriptions.retrieve", [i]); if (!f.subs[i]) throw new Error("No such subscription"); return f.subs[i]; },
    update: async (i, p) => {
      log("subscriptions.update", [i, p]);
      const s = f.subs[i];
      if (p.pause_collection === "") s.pause_collection = null; else if (p.pause_collection) s.pause_collection = p.pause_collection;
      if (p.cancel_at_period_end !== undefined) s.cancel_at_period_end = p.cancel_at_period_end;
      return s;
    },
    cancel: async (i) => { log("subscriptions.cancel", [i]); f.subs[i].status = "canceled"; return f.subs[i]; },
  };
  f.subscriptionItems = {
    create: async (p, o) => { log("subscriptionItems.create", [p, o]); const it = { id: id("si"), metadata: p.metadata }; f.subs[p.subscription].items.data.push(it); return it; },
    del: async (i, p) => {
      log("subscriptionItems.del", [i, p]);
      Object.values(f.subs).forEach((s) => { s.items.data = s.items.data.filter((x) => x.id !== i); });
      return { id: i, deleted: true };
    },
  };
  f.checkout = {
    sessions: {
      create: async (p) => {
        log("checkout.sessions.create", [p]);
        const s = { id: id("cs"), url: "https://checkout.stripe.com/prueba", customer: p.customer, metadata: p.metadata, mode: p.mode, status: "complete", setup_intent: { payment_method: id("pm") } };
        f.sessions[s.id] = s;
        return s;
      },
      retrieve: async (i) => { log("checkout.sessions.retrieve", [i]); await esperar(); return f.sessions[i]; },
    },
  };
  f.portalConfigs = {};
  f.billingPortal = {
    sessions: { create: async (p) => { log("billingPortal.sessions.create", [p]); return { url: "https://billing.stripe.com/prueba" }; } },
    configurations: {
      create: async (p) => { log("billingPortal.configurations.create", [p]); const c = { id: id("bpc"), active: true, features: p.features }; f.portalConfigs[c.id] = c; return c; },
      retrieve: async (i) => {
        log("billingPortal.configurations.retrieve", [i]);
        if (f.portalRetrieveFalla) throw Object.assign(new Error("Connection error"), { type: "StripeConnectionError" });
        if (!f.portalConfigs[i]) {
          // Así responde Stripe cuando algo no existe en la cuenta.
          throw Object.assign(new Error(`No such billing portal configuration: '${i}'`), { type: "StripeInvalidRequestError", code: "resource_missing", statusCode: 404 });
        }
        return f.portalConfigs[i];
      },
    },
  };
  f.count = (name) => f.calls.filter((c) => c.name === name).length;
  return f;
}

// ---------------------------------------------------------------------------
// Mini-ejecutor de pruebas
// ---------------------------------------------------------------------------
const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

// Utilidades de datos
const cuenta = (email) => db.prepare("SELECT * FROM accounts WHERE email = ?").get(email);
const miembro = (nombre) => db.prepare("SELECT * FROM members WHERE first_name = ?").get(nombre);
const plan = (nombre) => db.prepare("SELECT * FROM plans WHERE name = ?").get(nombre);
const cuota = (id) => db.prepare("SELECT * FROM memberships WHERE id = ?").get(id);
const clase = (nombre) => db.prepare("SELECT * FROM class_schedule WHERE name = ? ORDER BY day_of_week LIMIT 1").get(nombre);
const clasesDe = (nombre) => db.prepare("SELECT * FROM class_schedule WHERE name = ? ORDER BY day_of_week").all(nombre);

// Próxima fecha (a partir de mañana) que cae en ese día de la semana.
function proxima(diaSemana, desde = addDays(todayStr(), 1)) {
  let f = desde;
  while (new Date(f + "T12:00:00").getDay() !== diaSemana) f = addDays(f, 1);
  return f;
}
// Lunes de la semana que viene (para probar el límite semanal con una semana entera por delante).
const lunesQueViene = () => proxima(1, addDays(todayStr(), 7 - ((new Date().getDay() + 6) % 7)));

function nuevaFamilia(email, nombres) {
  const acc = db.prepare("INSERT INTO accounts (name, email, password_hash, role) VALUES (?, ?, 'x', 'member')").run(`Familia ${email}`, email).lastInsertRowid;
  const ids = nombres.map((n) => db.prepare("INSERT INTO members (account_id, first_name, last_name, is_dependent) VALUES (?, ?, 'Prueba', 1)").run(acc, n).lastInsertRowid);
  return { accountId: acc, memberIds: ids };
}

// ===========================================================================
// 1. DERECHO A RESERVAR (sin Stripe)
// ===========================================================================
prueba("Carlos (cuota BJJ en recepción) reserva BJJ sin gastar clase de prueba", () => {
  const c = clase("BJJ Adultos");
  const r = bookClass({ memberId: miembro("Carlos").id, classScheduleId: c.id, date: proxima(c.day_of_week) });
  assert.ok(!r.error, r.error);
  assert.strictEqual(r.is_trial, false);
});

prueba("Carlos reserva Judo (no incluido en su cuota) -> usa su clase de prueba", () => {
  const c = clase("Judo Adultos");
  const r = bookClass({ memberId: miembro("Carlos").id, classScheduleId: c.id, date: proxima(c.day_of_week) });
  assert.ok(!r.error, r.error);
  assert.strictEqual(r.is_trial, true);
});

prueba("Carlos intenta otra clase de Judo -> rechazada (prueba ya gastada)", () => {
  const c = clase("Judo Adultos");
  const r = bookClass({ memberId: miembro("Carlos").id, classScheduleId: c.id, date: addDays(proxima(c.day_of_week), 7) });
  assert.ok(r.error, "debería rechazarse");
});

prueba("Sofía (sin cuota) puede hacer su clase de prueba", () => {
  const c = clase("Judo Infantil");
  const r = bookClass({ memberId: miembro("Sofía").id, classScheduleId: c.id, date: proxima(c.day_of_week) });
  assert.ok(!r.error, r.error);
  assert.strictEqual(r.is_trial, true);
});

prueba("Plan '2 días/semana': 2 clases BJJ en la semana sí, la 3ª no", () => {
  const { accountId, memberIds } = nuevaFamilia("limite@test.com", ["Lucía"]);
  const r = billing.createMembership({ accountId, memberId: memberIds[0], planId: plan("BJJ 2 días/semana").id, paymentMethod: "manual" });
  return r.then((res) => {
    billing.recordManualPayment({ membershipId: res.membership.id, method: "efectivo", months: 1, adminAccountId: 1 });
    const lunes = lunesQueViene();
    const bjj = clasesDe("BJJ Adultos"); // lunes, miércoles y viernes
    const fecha = (c) => proxima(c.day_of_week, lunes);
    const r1 = bookClass({ memberId: memberIds[0], classScheduleId: bjj[0].id, date: fecha(bjj[0]) });
    const r2 = bookClass({ memberId: memberIds[0], classScheduleId: bjj[1].id, date: fecha(bjj[1]) });
    const r3 = bookClass({ memberId: memberIds[0], classScheduleId: bjj[2].id, date: fecha(bjj[2]) });
    assert.ok(!r1.error && !r2.error, `${r1.error} ${r2.error}`);
    assert.ok(r3.error && /semanales/.test(r3.error), `3ª debería rechazarse, fue: ${JSON.stringify(r3)}`);
  });
});

prueba("Con 'exigir cuota' desactivado, cualquiera reserva sin gastar prueba", () => {
  setSetting("require_membership_to_book", "0");
  try {
    const c = clasesDe("Judo Infantil")[1];
    const r = bookClass({ memberId: miembro("Sofía").id, classScheduleId: c.id, date: proxima(c.day_of_week) });
    assert.ok(!r.error, r.error);
    assert.strictEqual(r.is_trial, false);
  } finally {
    setSetting("require_membership_to_book", "1");
  }
});

// ===========================================================================
// 2. PAGO EN RECEPCIÓN
// ===========================================================================
prueba("Cuota en recepción: pendiente -> pago registrado -> activa un mes", async () => {
  const { accountId, memberIds } = nuevaFamilia("manual@test.com", ["Pablo"]);
  const r = await billing.createMembership({ accountId, memberId: memberIds[0], planId: plan("MMA mensual").id, paymentMethod: "manual" });
  assert.strictEqual(r.next_step, "pay_at_desk");
  assert.strictEqual(r.membership.status, "pendiente_pago");
  billing.recordManualPayment({ membershipId: r.membership.id, method: "bizum", months: 1, adminAccountId: 1 });
  const m = cuota(r.membership.id);
  assert.strictEqual(m.status, "activa");
  assert.ok(m.current_period_end > todayStr());
});

prueba("Registrar pago en una cuota de tarjeta -> rechazado (evita cobrar dos veces)", async () => {
  const id = db.prepare("INSERT INTO memberships (member_id, plan_id, account_id, payment_method, price_cents, status) VALUES (?, ?, ?, 'stripe', 100, 'activa')")
    .run(miembro("Pablo").id, plan("Kickboxing mensual").id, cuenta("manual@test.com").id).lastInsertRowid;
  assert.throws(() => billing.recordManualPayment({ membershipId: id, method: "efectivo", months: 1, adminAccountId: 1 }), /dos veces/);
  db.prepare("DELETE FROM memberships WHERE id = ?").run(id);
});

prueba("Vencida hace más de los días de margen -> la revisión la marca impagada", async () => {
  const m = db.prepare("SELECT ms.* FROM memberships ms JOIN members mb ON mb.id = ms.member_id WHERE mb.first_name = 'Pablo' AND ms.status = 'activa'").get();
  db.prepare("UPDATE memberships SET current_period_end = ? WHERE id = ?").run(addDays(todayStr(), -10), m.id);
  const cuentaPablo = db.prepare("SELECT a.email FROM accounts a JOIN members mb ON mb.account_id = a.id WHERE mb.id = ?").get(m.member_id);
  const antes = emailsA(cuentaPablo.email, "cuota").length;
  await billing.runMaintenance();
  assert.strictEqual(cuota(m.id).status, "impagada");
  await esperarEnvios();
  const avisos = emailsA(cuentaPablo.email, "cuota");
  assert.strictEqual(avisos.length, antes + 1, "se avisa a la familia por email");
  assert.match(avisos[0].body_text, /Pablo/);
  // Una segunda revisión no repite el aviso (la cuota ya está impagada).
  await billing.runMaintenance();
  await esperarEnvios();
  assert.strictEqual(emailsA(cuentaPablo.email, "cuota").length, antes + 1);
});

prueba("Pausa en recepción: al reanudar suma los días pausados a la fecha pagada", async () => {
  const m = db.prepare("SELECT ms.* FROM memberships ms JOIN members mb ON mb.id = ms.member_id WHERE mb.first_name = 'Beatriz'").get();
  const finAntes = cuota(m.id).current_period_end;
  await billing.pauseMembership({ accountId: m.account_id, membershipId: m.id, until: addDays(todayStr(), 20) });
  assert.strictEqual(cuota(m.id).status, "pausada");
  db.prepare("UPDATE memberships SET paused_at = ? WHERE id = ?").run(addDays(todayStr(), -10), m.id); // simulamos 10 días de pausa
  await billing.resumeMembership({ accountId: m.account_id, membershipId: m.id });
  const d = cuota(m.id);
  assert.strictEqual(d.status, "activa");
  assert.strictEqual(d.current_period_end, addDays(finAntes, 10));
});

prueba("Contratar dos veces el mismo plan al mismo alumno -> 409", async () => {
  const carlos = miembro("Carlos");
  await assert.rejects(
    billing.createMembership({ accountId: carlos.account_id, memberId: carlos.id, planId: plan("BJJ mensual").id, paymentMethod: "manual" }),
    (e) => e.status === 409
  );
});

prueba("No se puede contratar para un miembro de otra familia -> 403", async () => {
  await assert.rejects(
    billing.createMembership({ accountId: cuenta("carlos@ejemplo.com").id, memberId: miembro("Sofía").id, planId: plan("Judo mensual").id, paymentMethod: "manual" }),
    (e) => e.status === 403
  );
});

// ===========================================================================
// 3. TARJETA (Stripe simulado), modo "un cargo por cuota"
// ===========================================================================
let fake;
prueba("[Stripe] sin tarjeta guardada -> la cuota espera a que se añada", async () => {
  fake = crearStripeFalso();
  _setStripeForTests(fake);
  const sofia = miembro("Sofía");
  const r = await billing.createMembership({ accountId: sofia.account_id, memberId: sofia.id, planId: plan("Judo mensual").id, paymentMethod: "stripe" });
  assert.strictEqual(r.next_step, "add_payment_method");
  assert.strictEqual(r.membership.status, "pendiente_pago");
  assert.strictEqual(fake.count("subscriptions.create"), 0);
  // Una segunda cuota pendiente en la misma familia: es el caso en el que el
  // cerrojo de la base de datos evita de verdad el doble cobro.
  const beatriz = miembro("Beatriz");
  const r2 = await billing.createMembership({ accountId: beatriz.account_id, memberId: beatriz.id, planId: plan("BJJ mensual").id, paymentMethod: "stripe" });
  assert.strictEqual(r2.membership.status, "pendiente_pago");
});

prueba("[Stripe] navegador + webhook A LA VEZ con 2 cuotas pendientes -> cada una se cobra UNA vez", async () => {
  const acc = cuenta("beatriz@ejemplo.com");
  await billing.createSetupSession(acc.id);
  const sesion = Object.values(fake.sessions)[0];
  // El navegador y el webhook llegan casi a la vez:
  const [a, b] = await Promise.all([
    billing.completeSetupSession(sesion.id, acc.id),
    handleStripeEvent({ id: "evt_setup_1", type: "checkout.session.completed", data: { object: { id: sesion.id, mode: "setup" } } }),
  ]);
  // Cada cuota debe haberse enviado a Stripe exactamente UNA vez.
  const porCuota = {};
  fake.calls.filter((c) => c.name === "subscriptions.create").forEach((c) => {
    const id = c.args[0].items[0].metadata.membership_id;
    porCuota[id] = (porCuota[id] || 0) + 1;
  });
  assert.deepStrictEqual(Object.values(porCuota), [1, 1], `doble cobro: ${JSON.stringify(porCuota)}`);
  const pendientes = db.prepare("SELECT status FROM memberships WHERE account_id = ? AND payment_method = 'stripe'").all(acc.id);
  assert.ok(pendientes.every((x) => x.status === "activa"), JSON.stringify(pendientes));
  assert.ok(cuenta("beatriz@ejemplo.com").stripe_default_pm);
  // La clave de idempotencia protege también ante reintentos de red:
  assert.match(fake.calls.find((c) => c.name === "subscriptions.create").args[1].idempotencyKey, /^mship-\d+-a1$/);
  void a; void b;
});

prueba("[Stripe] con tarjeta ya guardada, contratar activa al momento", async () => {
  const mateo = miembro("Mateo");
  const r = await billing.createMembership({ accountId: mateo.account_id, memberId: mateo.id, planId: plan("BJJ mensual").id, paymentMethod: "stripe" });
  assert.strictEqual(r.next_step, "done");
  assert.strictEqual(r.membership.status, "activa");
});

prueba("[Portal] se abre siempre SIN poder cancelar ni cambiar el plan, y se reutiliza la configuración", async () => {
  const acc = cuenta("beatriz@ejemplo.com");
  await billing.createPortalSession(acc.id);
  await billing.createPortalSession(acc.id);
  assert.strictEqual(fake.count("billingPortal.configurations.create"), 1);
  const features = fake.calls.find((c) => c.name === "billingPortal.configurations.create").args[0].features;
  assert.strictEqual(features.subscription_cancel.enabled, false);
  assert.strictEqual(features.subscription_update.enabled, false);
  assert.strictEqual(features.payment_method_update.enabled, true);
  const sesiones = fake.calls.filter((c) => c.name === "billingPortal.sessions.create");
  assert.ok(sesiones.every((c) => c.args[0].configuration === Object.keys(fake.portalConfigs)[0]));

  // Si alguien activa la cancelación en esa configuración, la app crea otra segura.
  Object.values(fake.portalConfigs)[0].features.subscription_cancel = { enabled: true };
  await billing.createPortalSession(acc.id);
  assert.strictEqual(fake.count("billingPortal.configurations.create"), 2);
  const ultima = fake.calls.filter((c) => c.name === "billingPortal.sessions.create").pop().args[0].configuration;
  assert.strictEqual(fake.portalConfigs[ultima].features.subscription_cancel.enabled, false);
});

prueba("[Portal] al cambiar a claves reales (la configuración guardada no existe) crea otra; un fallo de red NO", async () => {
  const acc = cuenta("beatriz@ejemplo.com");
  // 1) Fallo de red: debe dar error y NO crear configuraciones nuevas.
  const antes = fake.count("billingPortal.configurations.create");
  fake.portalRetrieveFalla = true;
  await assert.rejects(billing.createPortalSession(acc.id), (e) => e.status === 502);
  fake.portalRetrieveFalla = false;
  assert.strictEqual(fake.count("billingPortal.configurations.create"), antes);

  // 2) Paso de claves de prueba a reales: la configuración guardada no existe
  //    en la otra cuenta -> se crea una nueva y segura, y se guarda.
  setSetting("stripe_portal_config_id", "bpc_de_la_cuenta_de_pruebas");
  await billing.createPortalSession(acc.id);
  assert.strictEqual(fake.count("billingPortal.configurations.create"), antes + 1);
  const guardada = db.prepare("SELECT value FROM settings WHERE key = 'stripe_portal_config_id'").get().value;
  assert.ok(fake.portalConfigs[guardada], "debe guardar la configuración nueva");
  assert.strictEqual(fake.portalConfigs[guardada].features.subscription_cancel.enabled, false);
});

prueba("[Stripe] el banco pide 3D Secure -> impagada con enlace para confirmar", async () => {
  fake.nextStatus = "incomplete";
  const mateo = miembro("Mateo");
  const r = await billing.createMembership({ accountId: mateo.account_id, memberId: mateo.id, planId: plan("MMA mensual").id, paymentMethod: "stripe" });
  fake.nextStatus = "active";
  assert.strictEqual(r.membership.status, "impagada");
  assert.match(r.membership.action_url, /^https:\/\/invoice\.stripe\.com/);
});

prueba("[Webhook] invoice.paid activa, guarda el pago, y un aviso repetido no duplica nada", async () => {
  const m = db.prepare("SELECT * FROM memberships WHERE action_url IS NOT NULL").get();
  const ev = {
    id: "evt_paid_1", type: "invoice.paid",
    data: { object: { id: "in_1", subscription: m.stripe_subscription_id, amount_paid: m.price_cents,
      lines: { data: [{ period: { start: Math.floor(Date.now() / 1000), end: Math.floor(Date.now() / 1000) + 30 * 86400 } }] } } },
  };
  await handleStripeEvent(ev);
  const r2 = await handleStripeEvent(ev); // Stripe reintenta el mismo aviso
  await handleStripeEvent({ ...ev, id: "evt_paid_1_bis" }); // otro evento con la MISMA factura
  assert.deepStrictEqual(r2, { duplicate: true });
  assert.strictEqual(cuota(m.id).status, "activa");
  assert.strictEqual(cuota(m.id).action_url, null);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM payments WHERE stripe_invoice_id = 'in_1'").get().n, 1);
});

prueba("[Webhook] invoice.payment_failed -> impagada con enlace de pago", async () => {
  const m = db.prepare("SELECT * FROM memberships WHERE payment_method = 'stripe' AND status = 'activa' AND member_id = ?").get(miembro("Mateo").id);
  await handleStripeEvent({ id: "evt_fail_1", type: "invoice.payment_failed",
    data: { object: { id: "in_2", subscription: m.stripe_subscription_id, hosted_invoice_url: "https://invoice.stripe.com/i/fallo" } } });
  assert.strictEqual(cuota(m.id).status, "impagada");
  assert.strictEqual(cuota(m.id).action_url, "https://invoice.stripe.com/i/fallo");
  await esperarEnvios();
  const email = db.prepare("SELECT a.email FROM accounts a WHERE a.id = ?").get(m.account_id).email;
  assert.ok(emailsA(email, "cuota").some((e) => /invoice\.stripe\.com\/i\/fallo/.test(e.body_text)), "email con el enlace para pagar");
});

prueba("[Webhook] customer.subscription.deleted -> cuota cancelada", async () => {
  const m = db.prepare("SELECT * FROM memberships WHERE payment_method = 'stripe' AND status = 'impagada' AND member_id = ? ORDER BY id LIMIT 1").get(miembro("Mateo").id);
  await handleStripeEvent({ id: "evt_del_1", type: "customer.subscription.deleted", data: { object: { id: m.stripe_subscription_id } } });
  assert.strictEqual(cuota(m.id).status, "cancelada");
});

prueba("[Stripe] baja de una cuota activa con su propio cargo -> baja a final de periodo", async () => {
  const m = db.prepare("SELECT * FROM memberships WHERE payment_method = 'stripe' AND status = 'activa' AND member_id = ?").get(miembro("Sofía").id);
  await billing.cancelMembership({ accountId: m.account_id, membershipId: m.id });
  assert.strictEqual(cuota(m.id).cancel_at_period_end, 1);
  assert.strictEqual(cuota(m.id).status, "activa", "sigue activa hasta el final de lo pagado");
  const u = fake.calls.filter((c) => c.name === "subscriptions.update").pop();
  assert.deepStrictEqual(u.args[1], { cancel_at_period_end: true });
});

// ===========================================================================
// 4. TARJETA, modo "un único cargo por familia"
// ===========================================================================
prueba("[Familiar] 2ª cuota se añade como línea al mismo cargo (no crea otra suscripción)", async () => {
  setSetting("family_billing_mode", "combined");
  const { accountId, memberIds } = nuevaFamilia("familiar@test.com", ["Hugo", "Irene", "Leo"]);
  db.prepare("UPDATE accounts SET stripe_default_pm = 'pm_familia' WHERE id = ?").run(accountId);
  const antes = fake.count("subscriptions.create");
  const a = await billing.createMembership({ accountId, memberId: memberIds[0], planId: plan("Judo mensual").id, paymentMethod: "stripe" });
  const b = await billing.createMembership({ accountId, memberId: memberIds[1], planId: plan("Judo mensual").id, paymentMethod: "stripe" });
  const c = await billing.createMembership({ accountId, memberId: memberIds[2], planId: plan("Kickboxing mensual").id, paymentMethod: "stripe" });
  assert.strictEqual(fake.count("subscriptions.create") - antes, 1);
  assert.strictEqual(fake.count("subscriptionItems.create"), 2);
  assert.strictEqual(a.membership.stripe_subscription_id, b.membership.stripe_subscription_id);
  assert.strictEqual(b.membership.stripe_subscription_id, c.membership.stripe_subscription_id);
  assert.ok([a, b, c].every((x) => x.membership.status === "activa"));
});

prueba("[Familiar] pausar una cuota quita solo su línea; reanudar la vuelve a añadir", async () => {
  const m = db.prepare("SELECT ms.* FROM memberships ms JOIN members mb ON mb.id = ms.member_id WHERE mb.first_name = 'Hugo'").get();
  const dels = fake.count("subscriptionItems.del");
  await billing.pauseMembership({ accountId: m.account_id, membershipId: m.id, until: addDays(todayStr(), 15) });
  assert.strictEqual(fake.count("subscriptionItems.del"), dels + 1);
  assert.strictEqual(cuota(m.id).pause_method, "item_removed");
  assert.ok(!fake.calls.some((c) => c.name === "subscriptions.update" && c.args[1].pause_collection), "no debe pausar el cargo de toda la familia");
  const items = fake.count("subscriptionItems.create");
  await billing.resumeMembership({ accountId: m.account_id, membershipId: m.id });
  assert.strictEqual(fake.count("subscriptionItems.create"), items + 1);
  assert.strictEqual(cuota(m.id).status, "activa");
});

prueba("[Familiar] baja de una cuota quita su línea; la del último hijo programa la baja del cargo", async () => {
  const cuotas = db.prepare("SELECT ms.* FROM memberships ms JOIN members mb ON mb.id = ms.member_id WHERE mb.first_name IN ('Hugo','Irene','Leo') ORDER BY ms.id").all();
  const accountId = cuotas[0].account_id;
  await billing.cancelMembership({ accountId, membershipId: cuotas[0].id });
  await billing.cancelMembership({ accountId, membershipId: cuotas[1].id });
  assert.strictEqual(cuota(cuotas[0].id).stripe_subscription_item_id, null);
  assert.strictEqual(cuota(cuotas[1].id).stripe_subscription_item_id, null);
  await billing.cancelMembership({ accountId, membershipId: cuotas[2].id });
  const u = fake.calls.filter((c) => c.name === "subscriptions.update").pop();
  assert.strictEqual(u.args[0], cuotas[2].stripe_subscription_id);
  assert.deepStrictEqual(u.args[1], { cancel_at_period_end: true });
  assert.ok([0, 1, 2].every((i) => cuota(cuotas[i].id).cancel_at_period_end === 1));
  setSetting("family_billing_mode", "separate");
});

// ---------------------------------------------------------------------------
(async () => {
  let ok = 0;
  const fallos = [];
  for (const p of pruebas) {
    try {
      await p.fn();
      ok++;
      console.log(`  ✔ ${p.nombre}`);
    } catch (err) {
      fallos.push(p.nombre);
      console.log(`  ✘ ${p.nombre}\n      ${err.message}`);
    }
  }
  console.log(`\n${ok}/${pruebas.length} pruebas correctas`);
  try { db.close(); } catch (_) {}
  for (const suf of ["", "-wal", "-shm"]) fs.rmSync(tmpDb + suf, { force: true });
  process.exit(fallos.length ? 1 : 0);
})();
