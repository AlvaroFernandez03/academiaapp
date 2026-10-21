// tests/admin.test.js
//
// Pruebas de la lógica del panel de administración (services/admin.js):
// horario, sesiones canceladas, disciplinas, grupos, equipo y alumnos.
// Usa una base de datos temporal: NUNCA toca la base de datos real.
//
// Ejecutar:  npm test   (o solo esta: node --experimental-sqlite tests/admin.test.js)

const os = require("os");
const path = require("path");
const fs = require("fs");
const assert = require("assert");
const { spawnSync } = require("child_process");

const tmpDb = path.join(os.tmpdir(), `academia-admin-test-${process.pid}.db`);
process.env.ACADEMIA_DB_PATH = tmpDb;
process.env.JWT_SECRET = "secreto-solo-para-pruebas";
delete process.env.ADMIN_EMAIL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.SEED_DEMO_DATA;

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db/database");
const admin = require("../services/admin");
const { bookClass, cancelBooking, setAttendance, plazasOcupadas } = require("../services/bookingService");
const { setSetting } = require("../services/settings");
const { requireAuth } = require("../middleware/auth");
const { todayStr, addDays } = require("../utils/dates");

// ---------------------------------------------------------------------------
const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });
const rechaza = (fn, patron, status) =>
  assert.throws(fn, (e) => {
    assert.ok(e instanceof admin.AdminError, `se esperaba AdminError y llegó: ${e && e.message}`);
    if (patron) assert.match(e.message, patron);
    if (status) assert.strictEqual(e.status, status);
    return true;
  });

const cuenta = (email) => db.prepare("SELECT * FROM accounts WHERE email = ?").get(email);
const disciplina = (slug) => db.prepare("SELECT * FROM disciplines WHERE slug = ?").get(slug);
const grupo = (nombre) => db.prepare("SELECT * FROM groups WHERE name = ?").get(nombre);
const reserva = (id) => db.prepare("SELECT * FROM bookings WHERE id = ?").get(id);
function proxima(dia, desde = addDays(todayStr(), 1)) {
  let f = desde;
  while (new Date(f + "T12:00:00").getDay() !== dia) f = addDays(f, 1);
  return f;
}
// Familia con N alumnos sin cuota (para las pruebas se desactiva "exigir cuota").
let nFam = 0;
function familia(n) {
  const acc = db.prepare("INSERT INTO accounts (name, email, password_hash, role) VALUES (?, ?, 'x', 'member')").run(`Fam ${++nFam}`, `fam${nFam}@test.com`).lastInsertRowid;
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(db.prepare("INSERT INTO members (account_id, first_name, last_name, is_dependent) VALUES (?, ?, 'Test', 1)").run(acc, `A${nFam}-${i}`).lastInsertRowid);
  return { accountId: acc, memberIds: ids };
}

const ADMIN = () => cuenta("admin@academia.com").id;
const JAVIER = () => cuenta("javier.instructor@academia.com").id;
const MARTA = () => cuenta("marta.instructor@academia.com").id;

// ===========================================================================
// DISCIPLINAS Y GRUPOS
// ===========================================================================
prueba("Crear disciplina: el slug se genera sin acentos; un nombre repetido (aunque cambien mayúsculas) -> 409", () => {
  const d = admin.createDiscipline({ name: "Defensa Personal Femenina" });
  assert.strictEqual(d.slug, "defensa-personal-femenina");
  const t = admin.createDiscipline({ name: "Taekwondo Olímpico" });
  assert.strictEqual(t.slug, "taekwondo-olimpico");
  rechaza(() => admin.createDiscipline({ name: "judo" }), /Ya existe/, 409);
  rechaza(() => admin.createDiscipline({ name: "   " }), /vacío/);
});

prueba("Archivar una disciplina con grupos activos o con planes a la venta -> 409", () => {
  rechaza(() => admin.setDisciplineActive(disciplina("judo").id, false), /grupos activos/, 409);
  const d = admin.createDiscipline({ name: "Capoeira" });
  db.prepare("INSERT INTO plans (name, price_cents, scope, discipline_id) VALUES ('Capoeira mensual', 3000, 'discipline', ?)").run(d.id);
  rechaza(() => admin.setDisciplineActive(d.id, false), /planes de cuota|plan de cuota/, 409);
  db.prepare("UPDATE plans SET active = 0 WHERE discipline_id = ?").run(d.id);
  assert.strictEqual(admin.setDisciplineActive(d.id, false).active, 0);
});

prueba("Una disciplina archivada desaparece del horario público y no admite grupos nuevos", () => {
  const capoeira = db.prepare("SELECT * FROM disciplines WHERE name = 'Capoeira'").get();
  const publicas = db.prepare("SELECT id FROM disciplines WHERE active = 1").all().map((r) => r.id);
  assert.ok(!publicas.includes(capoeira.id));
  rechaza(() => admin.createGroup({ discipline_id: capoeira.id, name: "Adultos" }), /archivada/);
});

prueba("Borrar: solo lo que nunca se ha usado; lo usado se archiva", () => {
  rechaza(() => admin.deleteDiscipline(disciplina("judo").id), /archívala/, 409);
  const d = admin.createDiscipline({ name: "Borrar Me" });
  admin.deleteDiscipline(d.id);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM disciplines WHERE id = ?").get(d.id).n, 0);
});

prueba("Grupos: validación de edades, nombre repetido, mover de disciplina solo sin clases", () => {
  const tkd = disciplina("taekwondo-olimpico");
  rechaza(() => admin.createGroup({ discipline_id: tkd.id, name: "Mal", min_age: 12, max_age: 8 }), /mínima no puede ser mayor/);
  const g = admin.createGroup({ discipline_id: tkd.id, name: "TKD Infantil", min_age: 6, max_age: 12, description: "Iniciación" });
  assert.strictEqual(g.min_age, 6);
  rechaza(() => admin.createGroup({ discipline_id: tkd.id, name: "tkd infantil" }), /ya tiene un grupo/, 409);
  // Sin clases se puede mover de disciplina...
  const movido = admin.updateGroup(g.id, { discipline_id: disciplina("defensa-personal-femenina").id });
  assert.strictEqual(movido.discipline_id, disciplina("defensa-personal-femenina").id);
  admin.updateGroup(g.id, { discipline_id: tkd.id });
  // ...con clases, no (cambiaría qué cuotas dan acceso a ellas).
  rechaza(() => admin.updateGroup(grupo("BJJ Adultos").id, { discipline_id: disciplina("judo").id }), /ya tiene clases/, 409);
});

prueba("Archivar un grupo con clases en el horario -> 409", () => {
  rechaza(() => admin.setGroupActive(grupo("BJJ Adultos").id, false), /clases en el horario/, 409);
});

// ===========================================================================
// HORARIO
// ===========================================================================
prueba("Crear clase: rechaza instructor que no lo es, horas al revés y aforo 0", () => {
  const g = grupo("TKD Infantil").id;
  const base = { group_id: g, instructor_account_id: MARTA(), day_of_week: 5, start_time: "17:00", end_time: "18:00", capacity: 10 };
  rechaza(() => admin.createClass({ ...base, instructor_account_id: cuenta("carlos@ejemplo.com").id }), /quién imparte/);
  rechaza(() => admin.createClass({ ...base, start_time: "18:00", end_time: "17:00" }), /posterior/);
  rechaza(() => admin.createClass({ ...base, start_time: "5pm" }), /HH:MM/);
  rechaza(() => admin.createClass({ ...base, capacity: 0 }), /aforo/i);
  const c = admin.createClass(base);
  assert.strictEqual(c.group_name, "TKD Infantil");
  assert.strictEqual(c.instructor_name, "Marta Cifuentes");
});

prueba("Un instructor no puede dar dos clases a la vez; otro instructor a la misma hora sí", () => {
  // Javier da BJJ Adultos los lunes de 19:00 a 20:30.
  const g = grupo("TKD Infantil").id;
  rechaza(
    () => admin.createClass({ group_id: g, instructor_account_id: JAVIER(), day_of_week: 1, start_time: "20:00", end_time: "21:00", capacity: 10 }),
    /Javier Roldán ya da «BJJ Adultos» el lunes de 19:00 a 20:30/,
    409
  );
  // Justo al terminar sí se puede (20:30 -> 21:30).
  admin.createClass({ group_id: g, instructor_account_id: JAVIER(), day_of_week: 1, start_time: "20:30", end_time: "21:30", capacity: 10 });
  admin.createClass({ group_id: g, instructor_account_id: MARTA(), day_of_week: 1, start_time: "19:00", end_time: "20:00", capacity: 10 });
});

prueba("Subir el aforo da plaza a la lista de espera, por orden de llegada", () => {
  setSetting("require_membership_to_book", "0");
  const c = admin.createClass({ group_id: grupo("TKD Infantil").id, instructor_account_id: MARTA(), day_of_week: 3, start_time: "10:00", end_time: "11:00", capacity: 2 });
  const fecha = proxima(3);
  const { memberIds } = familia(4);
  const r = memberIds.map((m) => bookClass({ memberId: m, classScheduleId: c.id, date: fecha }));
  assert.deepStrictEqual(r.map((x) => x.status), ["reservada", "reservada", "en_espera", "en_espera"]);
  const res = admin.updateClass(c.id, { capacity: 3 });
  assert.strictEqual(res.promoted, 1);
  assert.strictEqual(reserva(r[2].id).status, "reservada", "sube el primero que esperaba");
  assert.strictEqual(reserva(r[3].id).status, "en_espera");
});

prueba("Con reservas futuras no se puede cambiar el día ni el grupo; la hora sí", () => {
  const c = db.prepare("SELECT * FROM class_schedule WHERE start_time = '10:00' AND day_of_week = 3").get();
  rechaza(() => admin.updateClass(c.id, { day_of_week: 4 }), /reservas próximas/, 409);
  rechaza(() => admin.updateClass(c.id, { group_id: grupo("BJJ Adultos").id }), /reservas próximas/, 409);
  const r = admin.updateClass(c.id, { start_time: "10:30", end_time: "11:30" });
  assert.strictEqual(r.class.start_time, "10:30");
  const vivas = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE class_schedule_id = ? AND status IN ('reservada','en_espera')").get(c.id).n;
  assert.strictEqual(vivas, 4, "las reservas siguen ahí, con la nueva hora");
});

prueba("Quitar una clase del horario cancela SOLO sus reservas futuras, con nota para la familia", () => {
  const c = db.prepare("SELECT * FROM class_schedule WHERE start_time = '10:30' AND day_of_week = 3").get();
  const { memberIds } = familia(1);
  // Una asistencia pasada, que debe quedarse tal cual.
  const pasada = db.prepare("INSERT INTO bookings (class_schedule_id, member_id, date, status) VALUES (?, ?, ?, 'asistio')").run(c.id, memberIds[0], addDays(todayStr(), -7)).lastInsertRowid;
  const r = admin.setClassActive(c.id, false);
  assert.strictEqual(r.cancelled_bookings, 4);
  const canceladas = db.prepare("SELECT * FROM bookings WHERE class_schedule_id = ? AND status = 'cancelada'").all(c.id);
  assert.ok(canceladas.every((b) => /quitado esta clase del horario/.test(b.cancel_note)));
  assert.strictEqual(reserva(pasada).status, "asistio");
  // Ya no se puede reservar, y no se puede borrar porque tiene historial.
  assert.ok(bookClass({ memberId: memberIds[0], classScheduleId: c.id, date: proxima(3) }).error);
  rechaza(() => admin.deleteClass(c.id), /quítala del horario en vez de borrarla/, 409);
  // Volver a ponerla funciona.
  assert.strictEqual(admin.setClassActive(c.id, true).class.active, 1);
});

prueba("Borrar una clase recién creada (sin reservas) sí se puede", () => {
  const c = admin.createClass({ group_id: grupo("TKD Infantil").id, instructor_account_id: MARTA(), day_of_week: 0, start_time: "09:00", end_time: "10:00", capacity: 5 });
  admin.deleteClass(c.id);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM class_schedule WHERE id = ?").get(c.id).n, 0);
});

prueba("Reactivar una clase que ahora choca con otra del mismo instructor -> 409", () => {
  const g = grupo("TKD Infantil").id;
  const a = admin.createClass({ group_id: g, instructor_account_id: MARTA(), day_of_week: 6, start_time: "12:00", end_time: "13:00", capacity: 5 });
  admin.setClassActive(a.id, false);
  admin.createClass({ group_id: g, instructor_account_id: MARTA(), day_of_week: 6, start_time: "12:30", end_time: "13:30", capacity: 5 });
  rechaza(() => admin.setClassActive(a.id, true), /ya da/, 409);
});

prueba("Cancelar una sesión (festivo): cancela las reservas de ESE día con el motivo; las demás fechas siguen", () => {
  const c = db.prepare("SELECT * FROM class_schedule WHERE start_time = '10:30' AND day_of_week = 3").get();
  const f1 = proxima(3), f2 = addDays(f1, 7);
  const { memberIds } = familia(2);
  const b1 = bookClass({ memberId: memberIds[0], classScheduleId: c.id, date: f1 });
  const b2 = bookClass({ memberId: memberIds[1], classScheduleId: c.id, date: f2 });

  rechaza(() => admin.cancelSession(c.id, { date: addDays(f1, 1), reason: "x" }, ADMIN()), /no es miércoles/);
  rechaza(() => admin.cancelSession(c.id, { date: addDays(f1, -7 * 60), reason: "x" }, ADMIN()), /ya ha pasado/);

  const r = admin.cancelSession(c.id, { date: f1, reason: "Festivo local" }, ADMIN());
  assert.strictEqual(r.cancelled_bookings, 1);
  assert.strictEqual(reserva(b1.id).status, "cancelada");
  assert.match(reserva(b1.id).cancel_note, /cancelado la sesión del .*\(Festivo local\)/);
  assert.strictEqual(reserva(b2.id).status, "reservada", "la semana siguiente no se toca");

  const nueva = bookClass({ memberId: memberIds[1], classScheduleId: c.id, date: f1 });
  assert.match(nueva.error, /cancelada ese día \(Festivo local\)/);
  rechaza(() => admin.cancelSession(c.id, { date: f1 }, ADMIN()), /ya estaba cancelada/, 409);

  // Aparece en el listado público y, al deshacerla, se puede volver a reservar.
  const lista = admin.listCancellations();
  assert.ok(lista.some((x) => x.id === r.cancellation.id && x.reason === "Festivo local"));
  admin.restoreSession(r.cancellation.id);
  assert.ok(!bookClass({ memberId: memberIds[1], classScheduleId: c.id, date: f1 }).error);
  assert.strictEqual(reserva(b1.id).status, "cancelada", "deshacer no resucita reservas ya avisadas");
  setSetting("require_membership_to_book", "1");
});

// ===========================================================================
// RESERVAS: ANULAR, VOLVER A RESERVAR Y PASAR LISTA
// ===========================================================================
const filasDe = (classId, memberId, fecha) =>
  db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE class_schedule_id = ? AND member_id = ? AND date = ?").get(classId, memberId, fecha).n;

prueba("Anular y volver a reservar la misma clase funciona; si está llena, se vuelve al FINAL de la lista de espera", () => {
  setSetting("require_membership_to_book", "0");
  const c = admin.createClass({ group_id: grupo("TKD Infantil").id, instructor_account_id: MARTA(), day_of_week: 5, start_time: "16:00", end_time: "17:00", capacity: 1 });
  const fecha = proxima(5);
  const { memberIds: [a, b, d] } = familia(3);
  const ra = bookClass({ memberId: a, classScheduleId: c.id, date: fecha });
  const rb = bookClass({ memberId: b, classScheduleId: c.id, date: fecha });
  assert.deepStrictEqual([ra.status, rb.status], ["reservada", "en_espera"]);

  // B anula; mientras, D se apunta; B vuelve: entra, pero DETRÁS de D.
  assert.ok(cancelBooking(rb.id).success);
  const rd = bookClass({ memberId: d, classScheduleId: c.id, date: fecha });
  const rb2 = bookClass({ memberId: b, classScheduleId: c.id, date: fecha });
  assert.ok(!rb2.error, `volver a reservar no debería fallar: ${rb2.error}`);
  assert.strictEqual(rb2.status, "en_espera");
  assert.strictEqual(filasDe(c.id, b, fecha), 1, "una sola fila por alumno, clase y fecha");

  // A anula: la plaza es para D, que esperaba desde antes que la vuelta de B.
  assert.strictEqual(cancelBooking(ra.id).promoted_booking_id, rd.id);
  // Y A también puede volver (ahora a la lista de espera).
  assert.strictEqual(bookClass({ memberId: a, classScheduleId: c.id, date: fecha }).status, "en_espera");
  setSetting("require_membership_to_book", "1");
});

prueba("Tras deshacer la cancelación de una sesión, quien tenía reserva puede volver a reservar", () => {
  setSetting("require_membership_to_book", "0");
  const c = admin.createClass({ group_id: grupo("TKD Infantil").id, instructor_account_id: MARTA(), day_of_week: 4, start_time: "16:00", end_time: "17:00", capacity: 5 });
  const fecha = proxima(4);
  const { memberIds: [m] } = familia(1);
  const b = bookClass({ memberId: m, classScheduleId: c.id, date: fecha });
  const anulada = admin.cancelSession(c.id, { date: fecha, reason: "Festivo" }, ADMIN());
  assert.strictEqual(reserva(b.id).status, "cancelada");
  admin.restoreSession(anulada.cancellation.id);
  const otra = bookClass({ memberId: m, classScheduleId: c.id, date: fecha });
  assert.ok(!otra.error, `debería poder volver a reservar: ${otra.error}`);
  assert.strictEqual(otra.status, "reservada");
  setSetting("require_membership_to_book", "1");
});

prueba("Una familia no puede anular una clase ya asistida ni una que ya ha pasado (ni recuperar así la clase de prueba)", () => {
  const ayer = addDays(todayStr(), -1);
  const dow = new Date(ayer + "T12:00:00").getDay();
  const c = admin.createClass({ group_id: grupo("TKD Infantil").id, instructor_account_id: JAVIER(), day_of_week: dow, start_time: "07:00", end_time: "08:00", capacity: 5 });
  const { memberIds: [conPrueba, ausente] } = familia(2);
  const insertar = (m, status, prueba) =>
    db.prepare("INSERT INTO bookings (class_schedule_id, member_id, date, status, is_trial) VALUES (?, ?, ?, ?, ?)").run(c.id, m, ayer, status, prueba).lastInsertRowid;

  // Hizo su clase de prueba ayer: no puede "anularla" para tener otra gratis.
  const asistida = insertar(conPrueba, "asistio", 1);
  assert.match(cancelBooking(asistida).error, /asistida/);
  assert.strictEqual(reserva(asistida).status, "asistio");
  assert.match(bookClass({ memberId: conPrueba, classScheduleId: c.id, date: proxima(dow) }).error, /prueba gratuita ya está usada/);

  // Reservó y no vino: tampoco se anula después.
  const pasada = insertar(ausente, "reservada", 0);
  assert.match(cancelBooking(pasada).error, /ya ha empezado/);
});

prueba("Pasar lista: no se marca asistencia de un día futuro, y se puede deshacer", () => {
  setSetting("require_membership_to_book", "0");
  const c = db.prepare("SELECT * FROM class_schedule WHERE start_time = '07:00' AND instructor_account_id = ?").get(JAVIER());
  const { memberIds: [m, n] } = familia(2);
  const futura = bookClass({ memberId: m, classScheduleId: c.id, date: proxima(c.day_of_week) });
  assert.match(setAttendance(futura.id, true).error, /Todavía no ha llegado el día/);
  assert.strictEqual(reserva(futura.id).status, "reservada");

  const ayer = db.prepare("INSERT INTO bookings (class_schedule_id, member_id, date, status) VALUES (?, ?, ?, 'reservada')")
    .run(c.id, n, addDays(todayStr(), -1)).lastInsertRowid;
  assert.ok(setAttendance(ayer, true).success);
  assert.strictEqual(reserva(ayer).status, "asistio");
  assert.ok(setAttendance(ayer, false).success, "deshacer");
  assert.strictEqual(reserva(ayer).status, "reservada");
  assert.match(setAttendance(ayer, false).error, /no tiene la asistencia marcada/);
  setSetting("require_membership_to_book", "1");
});

prueba("Quien ya tiene la asistencia marcada sigue ocupando su plaza (no se puede pasar del aforo)", () => {
  setSetting("require_membership_to_book", "0");
  const c = admin.createClass({ group_id: grupo("TKD Infantil").id, instructor_account_id: MARTA(), day_of_week: 2, start_time: "16:00", end_time: "17:00", capacity: 1 });
  const fecha = proxima(2);
  const { memberIds: [a, b] } = familia(2);
  // (Se marca directamente en la base de datos: en la app solo se puede el mismo día.)
  db.prepare("INSERT INTO bookings (class_schedule_id, member_id, date, status) VALUES (?, ?, ?, 'asistio')").run(c.id, a, fecha);
  assert.strictEqual(plazasOcupadas(c.id, fecha), 1);
  assert.strictEqual(bookClass({ memberId: b, classScheduleId: c.id, date: fecha }).status, "en_espera");
  setSetting("require_membership_to_book", "1");
});

prueba("Reservar: fecha mal escrita, más de 6 semanas vista o una clase que ya ha empezado -> rechazado", () => {
  setSetting("require_membership_to_book", "0");
  const hoyDow = new Date(todayStr() + "T12:00:00").getDay();
  const c = admin.createClass({ group_id: grupo("TKD Infantil").id, instructor_account_id: JAVIER(), day_of_week: hoyDow, start_time: "00:00", end_time: "00:30", capacity: 5 });
  const { memberIds: [m] } = familia(1);
  assert.match(bookClass({ memberId: m, classScheduleId: c.id, date: "2026-1-5" }).error, /no es válida/);
  assert.match(bookClass({ memberId: m, classScheduleId: c.id, date: todayStr() }).error, /ya ha empezado/);
  assert.match(bookClass({ memberId: m, classScheduleId: c.id, date: addDays(todayStr(), 7 * 7) }).error, /6 semanas/);
  assert.ok(!bookClass({ memberId: m, classScheduleId: c.id, date: addDays(todayStr(), 7 * 6) }).error, "justo 6 semanas sí");
  setSetting("require_membership_to_book", "1");
});

// ===========================================================================
// EQUIPO Y CUENTAS
// ===========================================================================
let nuevoInstructor;
prueba("Alta de instructor: contraseña temporal de 10 caracteres que funciona y obliga a cambiarla", () => {
  const r = admin.createStaff({ name: "Lucía Ferrer", email: "  Lucia.Ferrer@Academia.com ", phone: "600", role: "instructor" });
  assert.match(r.temp_password, /^[a-zA-Z2-9]{10}$/);
  assert.strictEqual(r.account.email, "lucia.ferrer@academia.com");
  assert.strictEqual(r.account.role, "instructor");
  assert.strictEqual(r.account.must_change_password, 1);
  assert.ok(bcrypt.compareSync(r.temp_password, cuenta("lucia.ferrer@academia.com").password_hash));
  nuevoInstructor = r.account;
});

prueba("Alta con un email que ya es de una familia -> 409 con los datos para darle permisos", () => {
  try {
    admin.createStaff({ name: "Carlos", email: "carlos@ejemplo.com", role: "instructor" });
    assert.fail("debería haber fallado");
  } catch (e) {
    assert.strictEqual(e.status, 409);
    assert.strictEqual(e.extra.existing_role, "member");
    assert.strictEqual(e.extra.existing_account_id, cuenta("carlos@ejemplo.com").id);
  }
  rechaza(() => admin.createStaff({ name: "X", email: "no-es-un-email" }), /email no es válido/);
});

prueba("Roles: no a uno mismo; no quitar el rol a quien da clases; siempre queda una administración", () => {
  rechaza(() => admin.setRole(ADMIN(), "member", ADMIN()), /tu propio rol/);
  rechaza(() => admin.setRole(JAVIER(), "member", ADMIN()), /da \d+ clases/, 409);
  // Una familia puede pasar a instructor sin crear otra cuenta.
  assert.strictEqual(admin.setRole(cuenta("carlos@ejemplo.com").id, "instructor", ADMIN()).role, "instructor");
  admin.setRole(cuenta("carlos@ejemplo.com").id, "member", ADMIN());
  // Con dos administraciones se puede quitar una; con una sola, no.
  const otra = admin.createStaff({ name: "Recepción", email: "recepcion@academia.com", role: "admin" }).account;
  admin.setRole(ADMIN(), "instructor", otra.id);
  rechaza(() => admin.setRole(otra.id, "member", 999), /al menos una cuenta de administración/);
  admin.setRole(ADMIN(), "admin", otra.id);
});

prueba("La administración principal (ADMIN_EMAIL) no pierde el rol ni se desactiva", () => {
  process.env.ADMIN_EMAIL = "admin@academia.com";
  try {
    const recepcion = cuenta("recepcion@academia.com").id;
    rechaza(() => admin.setRole(ADMIN(), "member", recepcion), /principal/);
    rechaza(() => admin.setAccountActive(ADMIN(), false, recepcion), /principal/);
    rechaza(() => admin.updateAccount(ADMIN(), { email: "otro@academia.com" }), /ADMIN_EMAIL/);
  } finally {
    delete process.env.ADMIN_EMAIL;
  }
});

prueba("Desactivar: no a uno mismo, ni a quien da clases, ni a una familia con cuotas sin dar de baja", () => {
  rechaza(() => admin.setAccountActive(ADMIN(), false, ADMIN()), /tu propia cuenta/);
  rechaza(() => admin.setAccountActive(JAVIER(), false, ADMIN()), /da \d+ clases/, 409);
  rechaza(() => admin.setAccountActive(cuenta("carlos@ejemplo.com").id, false, ADMIN()), /cuotas? sin dar de baja/, 409);
  assert.strictEqual(admin.setAccountActive(nuevoInstructor.id, false, ADMIN()).active, 0);
});

prueba("Una cuenta desactivada no puede seguir usando una sesión que ya tenía abierta", () => {
  const token = jwt.sign({ accountId: nuevoInstructor.id }, process.env.JWT_SECRET);
  const probar = () => {
    let estado = 200, siguio = false;
    const res = { status(s) { estado = s; return this; }, json() { return this; } };
    requireAuth({ headers: { authorization: `Bearer ${token}` } }, res, () => { siguio = true; });
    return { estado, siguio };
  };
  assert.deepStrictEqual(probar(), { estado: 401, siguio: false });
  admin.setAccountActive(nuevoInstructor.id, true, ADMIN());
  assert.deepStrictEqual(probar(), { estado: 200, siguio: true });
});

prueba("Restablecer contraseña: nueva temporal que funciona, la antigua deja de valer", () => {
  rechaza(() => admin.resetPassword(ADMIN(), ADMIN()), /Mi cuenta/);
  const beatriz = cuenta("beatriz@ejemplo.com");
  const { temp_password } = admin.resetPassword(beatriz.id, ADMIN());
  const tras = cuenta("beatriz@ejemplo.com");
  assert.ok(bcrypt.compareSync(temp_password, tras.password_hash));
  assert.ok(!bcrypt.compareSync("academia123", tras.password_hash));
  assert.strictEqual(tras.must_change_password, 1);
});

prueba("Corregir el email de una cuenta: no puede quedar repetido", () => {
  rechaza(() => admin.updateAccount(cuenta("carlos@ejemplo.com").id, { email: "beatriz@ejemplo.com" }), /ya lo usa otra cuenta/, 409);
  const r = admin.updateAccount(cuenta("carlos@ejemplo.com").id, { phone: "699 000 111" });
  assert.strictEqual(r.phone, "699 000 111");
});

// ===========================================================================
// ALUMNOS Y RESUMEN
// ===========================================================================
prueba("Listado de familias: miembros, cuotas vivas y aviso de notas médicas", () => {
  const f = admin.listFamilies().find((x) => x.email === "beatriz@ejemplo.com");
  assert.deepStrictEqual(f.members.map((m) => m.first_name).sort(), ["Beatriz", "Mateo", "Sofía"]);
  const mateo = f.members.find((m) => m.first_name === "Mateo");
  assert.strictEqual(mateo.has_medical_notes, true);
  assert.ok(!("medical_notes" in mateo), "el listado no envía las notas, solo la ficha");
  assert.deepStrictEqual(mateo.memberships.map((q) => q.plan_name), ["Kickboxing mensual"]);
  const ficha = admin.getMemberDetail(mateo.id);
  assert.match(ficha.member.medical_notes, /frutos secos/);
  assert.strictEqual(ficha.account.email, "beatriz@ejemplo.com");
  assert.ok(ficha.gradings.length >= 1);
});

prueba("Resumen del día: clases de hoy con ocupación y contadores", () => {
  const s = admin.getSummary();
  assert.strictEqual(s.date, todayStr());
  const hoy = new Date(todayStr() + "T12:00:00").getDay();
  const esperadas = db.prepare("SELECT COUNT(*) AS n FROM class_schedule WHERE active = 1 AND day_of_week = ?").get(hoy).n;
  assert.strictEqual(s.classes_today.length, esperadas);
  for (const k of ["families", "students_with_membership", "memberships_unpaid", "memberships_pending", "team_active"]) {
    assert.ok(Number.isInteger(s[k]), k);
  }
  assert.ok(Array.isArray(s.upcoming_cancellations));
});

prueba("Instalación real (SEED_DEMO_DATA=0): arranca vacía, solo con los ajustes por defecto", () => {
  const vacia = path.join(os.tmpdir(), `academia-vacia-${process.pid}.db`);
  const script = `
    const db = require(${JSON.stringify(path.join(__dirname, "..", "db", "database"))});
    const n = (t) => db.prepare("SELECT COUNT(*) AS n FROM " + t).get().n;
    console.log(JSON.stringify({ disciplinas: n("disciplines"), cuentas: n("accounts"), planes: n("plans"), clases: n("class_schedule"), ajustes: n("settings") }));`;
  const r = spawnSync(process.execPath, ["--experimental-sqlite", "--no-warnings", "-e", script], {
    env: { ...process.env, ACADEMIA_DB_PATH: vacia, SEED_DEMO_DATA: "0" },
    encoding: "utf8",
  });
  for (const suf of ["", "-wal", "-shm"]) fs.rmSync(vacia + suf, { force: true });
  assert.strictEqual(r.status, 0, r.stderr);
  const datos = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.deepStrictEqual({ ...datos, ajustes: datos.ajustes > 0 }, { disciplinas: 0, cuentas: 0, planes: 0, clases: 0, ajustes: true });
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
  console.log(`\n${ok}/${pruebas.length} pruebas del panel de administración correctas`);
  try { db.close(); } catch (_) {}
  for (const suf of ["", "-wal", "-shm"]) fs.rmSync(tmpDb + suf, { force: true });
  process.exit(fallos.length ? 1 : 0);
})();
