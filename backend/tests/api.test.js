// tests/api.test.js
//
// Prueba la API DE VERDAD: arranca el servidor en un puerto libre, con una
// base de datos y una carpeta de fotos temporales, y le hace peticiones HTTP
// como lo haría el navegador. Comprueba sobre todo los PERMISOS (que una
// familia o un instructor no puedan usar el panel de administración), las
// cuentas desactivadas, las sesiones canceladas, la subida de fotos y la
// seguridad (límites de intentos, cabeceras, recuperar contraseña, aviso de
// privacidad, emails en modo local y copias de seguridad).
//
// No lee tu .env para nada importante: todas las variables que afectan a la
// prueba se fijan aquí, así nunca toca tu base de datos ni tu Stripe.
//
// Ejecutar:  npm test   (o solo esta: node tests/api.test.js)

const os = require("os");
const path = require("path");
const fs = require("fs");
const net = require("net");
const assert = require("assert");
const { spawn } = require("child_process");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "academia-api-"));
const UPLOADS = path.join(TMP, "uploads");
let servidor, BASE;

function puertoLibre() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function arrancar() {
  const port = await puertoLibre();
  BASE = `http://127.0.0.1:${port}`;
  servidor = spawn(process.execPath, ["--experimental-sqlite", "--no-warnings", "server.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      ACADEMIA_DB_PATH: path.join(TMP, "academia.db"),
      UPLOADS_DIR: UPLOADS,
      BACKUP_DIR: path.join(TMP, "copias"),
      EMAIL_PROVIDER: "",
      TRUST_PROXY: "",
      CORS_ORIGIN: "",
      JWT_SECRET: "secreto-solo-para-pruebas",
      ADMIN_EMAIL: "admin@academia.com",
      FRONTEND_URL: BASE,
      SEED_DEMO_DATA: "1",
      STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
      STRIPE_DEMO: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  servidor.stdout.on("data", (d) => (log += d));
  servidor.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("El servidor no ha arrancado:\n" + log);
}

// Petición JSON. Devuelve { status, body }.
async function pedir(metodo, ruta, { token, body } = {}) {
  const res = await fetch(`${BASE}/api${ruta}`, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body && metodo !== "GET" ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const entrar = async (email, password = "academia123") => (await pedir("POST", "/auth/login", { body: { email, password } })).body;

function proxima(dia) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() !== dia) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });
const T = {}; // tokens y datos compartidos entre pruebas

// ===========================================================================
prueba("Sin sesión, una familia o un instructor NO pueden usar el panel (401/403); la administración sí", async () => {
  T.admin = (await entrar("admin@academia.com")).token;
  T.carlos = (await entrar("carlos@ejemplo.com")).token;
  T.beatriz = (await entrar("beatriz@ejemplo.com")).token;
  T.javier = (await entrar("javier.instructor@academia.com")).token;
  const rutas = [
    ["GET", "/admin/summary"], ["GET", "/admin/families"], ["GET", "/admin/team"], ["GET", "/admin/members/1"],
    ["POST", "/admin/classes"], ["POST", "/admin/team"], ["PUT", "/admin/accounts/1/role"], ["POST", "/admin/accounts/1/reset-password"],
    ["DELETE", "/admin/disciplines/1"], ["GET", "/admin/billing/settings"],
  ];
  for (const [m, r] of rutas) {
    assert.strictEqual((await pedir(m, r)).status, 401, `${m} ${r} sin sesión`);
    assert.strictEqual((await pedir(m, r, { token: T.carlos, body: {} })).status, 403, `${m} ${r} como familia`);
    assert.strictEqual((await pedir(m, r, { token: T.javier, body: {} })).status, 403, `${m} ${r} como instructor`);
  }
  assert.strictEqual((await pedir("GET", "/admin/summary", { token: T.admin })).status, 200);
  // Las rutas de cuotas de administración siguen funcionando junto al panel nuevo.
  assert.strictEqual((await pedir("GET", "/admin/billing/settings", { token: T.admin })).status, 200);
});

prueba("Los errores de validación llegan como JSON con su mensaje (nunca un 500)", async () => {
  const r = await pedir("POST", "/admin/classes", { token: T.admin, body: { group_id: 1, instructor_account_id: 2, day_of_week: 1, start_time: "20:00", end_time: "19:00", capacity: 10 } });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /posterior/);
  assert.strictEqual((await pedir("GET", "/admin/members/999999", { token: T.admin })).status, 404);
  assert.strictEqual((await pedir("PUT", "/admin/classes/abc", { token: T.admin, body: {} })).status, 404);
});

prueba("Alta de instructor -> entra con la temporal -> se le pide cambiarla -> la cambia", async () => {
  const alta = await pedir("POST", "/admin/team", { token: T.admin, body: { name: "Nuevo Instructor", email: "nuevo@academia.com", role: "instructor" } });
  assert.strictEqual(alta.status, 200, JSON.stringify(alta.body));
  T.nuevoId = alta.body.account.id;
  const login = await entrar("nuevo@academia.com", alta.body.temp_password);
  assert.strictEqual(login.account.role, "instructor");
  assert.strictEqual(login.account.must_change_password, true);
  const cambio = await pedir("PUT", "/account/password", { token: login.token, body: { current_password: alta.body.temp_password, new_password: "miClaveNueva1" } });
  assert.strictEqual(cambio.status, 200);
  // Cambiar la contraseña cierra las demás sesiones; este navegador recibe una nueva.
  assert.strictEqual((await pedir("GET", "/account", { token: login.token })).status, 401, "la sesión antigua deja de valer");
  assert.strictEqual((await pedir("GET", "/account", { token: cambio.body.token })).body.must_change_password, false);
  T.nuevo = cambio.body.token;
  // Ya puede pasar lista (lista de una clase), pero no entrar al panel.
  assert.strictEqual((await pedir("GET", `/bookings/class?class_schedule_id=1&date=${proxima(1)}`, { token: T.nuevo })).status, 200);
  assert.strictEqual((await pedir("GET", "/admin/summary", { token: T.nuevo })).status, 403);
});

prueba("Alta con un email de una familia -> 409 con los datos para darle el rol sin duplicar la cuenta", async () => {
  const r = await pedir("POST", "/admin/team", { token: T.admin, body: { name: "Carlos", email: "carlos@ejemplo.com", role: "instructor" } });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.existing_role, "member");
  assert.ok(r.body.existing_account_id);
});

prueba("Desactivar una cuenta corta su sesión abierta y el login; reactivarla lo devuelve", async () => {
  assert.strictEqual((await pedir("PUT", `/admin/accounts/${T.nuevoId}/active`, { token: T.admin, body: { active: false } })).status, 200);
  const uso = await pedir("GET", "/family/members", { token: T.nuevo });
  assert.strictEqual(uso.status, 401);
  assert.match(uso.body.error, /desactivada/);
  const login = await pedir("POST", "/auth/login", { body: { email: "nuevo@academia.com", password: "miClaveNueva1" } });
  assert.strictEqual(login.status, 403);
  // Con contraseña incorrecta no se revela que la cuenta existe y está desactivada.
  const mala = await pedir("POST", "/auth/login", { body: { email: "nuevo@academia.com", password: "otra-cosa" } });
  assert.strictEqual(mala.status, 401);
  assert.doesNotMatch(mala.body.error, /desactivada/);
  await pedir("PUT", `/admin/accounts/${T.nuevoId}/active`, { token: T.admin, body: { active: true } });
  assert.strictEqual((await pedir("GET", "/family/members", { token: T.nuevo })).status, 200);
});

prueba("Nadie se quita a sí mismo la administración ni se desactiva", async () => {
  const yo = (await pedir("GET", "/account", { token: T.admin })).body.id;
  assert.strictEqual((await pedir("PUT", `/admin/accounts/${yo}/role`, { token: T.admin, body: { role: "member" } })).status, 400);
  assert.strictEqual((await pedir("PUT", `/admin/accounts/${yo}/active`, { token: T.admin, body: { active: false } })).status, 400);
});

prueba("Montar una disciplina, grupo y clase desde el panel -> aparece en el horario público", async () => {
  const d = await pedir("POST", "/admin/disciplines", { token: T.admin, body: { name: "Muay Thai" } });
  assert.strictEqual(d.status, 200, JSON.stringify(d.body));
  const g = await pedir("POST", "/admin/groups", { token: T.admin, body: { discipline_id: d.body.id, name: "Muay Thai Adultos", min_age: 16 } });
  const c = await pedir("POST", "/admin/classes", {
    token: T.admin,
    body: { group_id: g.body.id, instructor_account_id: T.nuevoId, day_of_week: 4, start_time: "21:00", end_time: "22:00", capacity: 12 },
  });
  assert.strictEqual(c.status, 200, JSON.stringify(c.body));
  T.claseMT = c.body.id;
  const horario = (await pedir("GET", "/schedule/classes?discipline=muay-thai")).body;
  assert.deepStrictEqual(horario.map((x) => x.instructor_name), ["Nuevo Instructor"]);
  assert.ok((await pedir("GET", "/schedule/disciplines")).body.some((x) => x.slug === "muay-thai"));
});

prueba("Sesión cancelada: la familia ve el motivo en «Mis reservas» y ya no puede reservar ese día", async () => {
  const fecha = proxima(4);
  const carlos = (await pedir("GET", "/family/members", { token: T.carlos })).body[0];
  const reserva = await pedir("POST", "/bookings", { token: T.carlos, body: { member_id: carlos.id, class_schedule_id: T.claseMT, date: fecha } });
  assert.strictEqual(reserva.status, 201, JSON.stringify(reserva.body));
  assert.strictEqual(reserva.body.is_trial, true, "Carlos no tiene cuota de Muay Thai: es su clase de prueba");

  const cancel = await pedir("POST", `/admin/classes/${T.claseMT}/cancel-session`, { token: T.admin, body: { date: fecha, reason: "Festivo" } });
  assert.strictEqual(cancel.status, 200, JSON.stringify(cancel.body));
  assert.strictEqual(cancel.body.cancelled_bookings, 1);

  const mias = (await pedir("GET", "/bookings/mine", { token: T.carlos })).body;
  const r = mias.find((b) => b.id === reserva.body.id);
  assert.strictEqual(r.status, "cancelada");
  assert.match(r.cancel_note, /Festivo/);

  const publicas = (await pedir("GET", `/schedule/cancellations?from=${fecha}&to=${fecha}`)).body;
  assert.ok(publicas.some((x) => x.class_schedule_id === T.claseMT && x.reason === "Festivo"));
  const otra = await pedir("POST", "/bookings", { token: T.carlos, body: { member_id: carlos.id, class_schedule_id: T.claseMT, date: fecha } });
  assert.strictEqual(otra.status, 409);
  assert.match(otra.body.error, /cancelada ese día/);
});

prueba("Alumnos: el listado no incluye notas médicas; la ficha (solo administración) sí", async () => {
  const familias = (await pedir("GET", "/admin/families", { token: T.admin })).body;
  const mateo = familias.find((f) => f.email === "beatriz@ejemplo.com").members.find((m) => m.first_name === "Mateo");
  assert.strictEqual(mateo.has_medical_notes, true);
  assert.ok(!("medical_notes" in mateo));
  const ficha = (await pedir("GET", `/admin/members/${mateo.id}`, { token: T.admin })).body;
  assert.match(ficha.member.medical_notes, /frutos secos/);
});

prueba("Restablecer contraseña de una familia: la nueva funciona, la antigua no", async () => {
  const beatriz = (await pedir("GET", "/account", { token: T.beatriz })).body;
  const r = await pedir("POST", `/admin/accounts/${beatriz.id}/reset-password`, { token: T.admin });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await pedir("POST", "/auth/login", { body: { email: "beatriz@ejemplo.com", password: "academia123" } })).status, 401);
  const nueva = await entrar("beatriz@ejemplo.com", r.body.temp_password);
  assert.strictEqual(nueva.account.must_change_password, true);
  T.beatriz = nueva.token;
});

// ===========================================================================
// FOTOS DE PERFIL (multer real)
// ===========================================================================
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
async function subirFoto(token, memberId, buffer, nombre, tipo) {
  const fd = new FormData();
  fd.append("avatar", new Blob([buffer], { type: tipo }), nombre);
  const res = await fetch(`${BASE}/api/family/members/${memberId}/avatar`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const fotos = () => (fs.existsSync(path.join(UPLOADS, "avatars")) ? fs.readdirSync(path.join(UPLOADS, "avatars")) : []);

prueba("Fotos: subir, servir, cambiar (borra la anterior), rechazar >3 MB y PDF, otra familia no, quitar", async () => {
  const mateo = (await pedir("GET", "/family/members", { token: T.beatriz })).body.find((m) => m.first_name === "Mateo");
  const r1 = await subirFoto(T.beatriz, mateo.id, PNG, "foto.png", "image/png");
  assert.strictEqual(r1.status, 200, JSON.stringify(r1.body));
  assert.match(r1.body.avatar_file, /^member-\d+-[0-9a-f]{20}\.png$/, "nombre no adivinable");
  const img = await fetch(`${BASE}/uploads/avatars/${r1.body.avatar_file}`);
  assert.strictEqual(img.status, 200);
  assert.strictEqual(img.headers.get("content-type"), "image/png");

  const r2 = await subirFoto(T.beatriz, mateo.id, PNG, "otra.png", "image/png");
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!fotos().includes(r1.body.avatar_file) && fotos().includes(r2.body.avatar_file), "la anterior se borra del disco");

  const antes = fotos().length;
  const grande = await subirFoto(T.beatriz, mateo.id, Buffer.alloc(4 * 1024 * 1024, 1), "enorme.jpg", "image/jpeg");
  assert.strictEqual(grande.status, 400);
  assert.match(grande.body.error, /3 MB/);
  const pdf = await subirFoto(T.beatriz, mateo.id, Buffer.from("%PDF-1.4"), "doc.pdf", "application/pdf");
  assert.strictEqual(pdf.status, 400);
  assert.match(pdf.body.error, /JPG, PNG o WEBP/);
  const intruso = await subirFoto(T.carlos, mateo.id, PNG, "intruso.png", "image/png");
  assert.strictEqual(intruso.status, 403);
  assert.strictEqual(fotos().length, antes, "ningún intento fallido deja archivos en el disco");

  const quitar = await pedir("DELETE", `/family/members/${mateo.id}/avatar`, { token: T.beatriz });
  assert.strictEqual(quitar.status, 200);
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!fotos().includes(r2.body.avatar_file));
});

// ===========================================================================
// SEGURIDAD, PRIVACIDAD, EMAILS Y COPIAS
// ===========================================================================
const emails = async () => (await pedir("GET", "/admin/emails", { token: T.admin })).body.emails;
async function ultimoEmail(para, tipo) {
  for (let i = 0; i < 20; i++) {
    const m = (await emails()).find((e) => e.to_email === para && e.kind === tipo);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

prueba("Cabeceras de seguridad en páginas y API; rutas /api inexistentes -> 404 JSON", async () => {
  const pagina = await fetch(`${BASE}/acceso.html`);
  assert.strictEqual(pagina.status, 200);
  const csp = pagina.headers.get("content-security-policy") || "";
  assert.match(csp, /script-src 'self'(;|$)/, "solo scripts de la propia app");
  assert.match(csp, /frame-ancestors 'none'/);
  assert.strictEqual(pagina.headers.get("x-frame-options"), "DENY");
  assert.strictEqual(pagina.headers.get("x-content-type-options"), "nosniff");
  assert.strictEqual(pagina.headers.get("x-powered-by"), null, "no se anuncia Express");
  assert.strictEqual(pagina.headers.get("strict-transport-security"), null, "HSTS solo por HTTPS");

  const api = await fetch(`${BASE}/api/account`, { headers: { Authorization: `Bearer ${T.admin}` } });
  assert.strictEqual(api.headers.get("cache-control"), "no-store", "los datos personales no se guardan en cachés");
  assert.strictEqual(api.headers.get("access-control-allow-origin"), null, "sin CORS_ORIGIN no se abre a otras webs");

  const r = await pedir("GET", "/no-existe");
  assert.strictEqual(r.status, 404);
  assert.ok(r.body && r.body.error, "404 en JSON");
  const roto = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{roto" });
  assert.strictEqual(roto.status, 400, "JSON mal formado -> 400, no 500");
});

prueba("Ninguna página HTML lleva scripts escritos dentro (los bloquearía la política de seguridad)", async () => {
  const dir = path.join(__dirname, "..", "..", "frontend");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(dir, f), "utf8");
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/gi)];
    assert.strictEqual(inline.length, 0, `${f} tiene un <script> sin src`);
    assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(html), `${f} tiene un atributo onclick/onload...`);
  }
});

prueba("Registro: exige aceptar el aviso de privacidad y una contraseña de 8 caracteres", async () => {
  const base = { name: "Lucía Prueba", email: "Lucia@Ejemplo.com ", password: "clave-segura", practices_self: false };
  const sin = await pedir("POST", "/auth/register", { body: base });
  assert.strictEqual(sin.status, 400);
  assert.match(sin.body.error, /privacidad/);
  const corta = await pedir("POST", "/auth/register", { body: { ...base, password: "1234567", accept_privacy: true } });
  assert.strictEqual(corta.status, 400);
  assert.match(corta.body.error, /8/);
  const mal = await pedir("POST", "/auth/register", { body: { ...base, email: "no-es-un-email", accept_privacy: true } });
  assert.strictEqual(mal.status, 400);
  const ok = await pedir("POST", "/auth/register", { body: { ...base, accept_privacy: true } });
  assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
  assert.strictEqual(ok.body.account.email, "lucia@ejemplo.com", "el email se guarda limpio y en minúsculas");
  assert.strictEqual(ok.body.account.privacy_pending, false);
  T.lucia = ok.body.token;
  const repe = await pedir("POST", "/auth/register", { body: { ...base, email: "LUCIA@ejemplo.com", accept_privacy: true } });
  assert.strictEqual(repe.status, 409);
});

prueba("Aviso de privacidad: nueva versión -> se pide aceptarla; corregir erratas no", async () => {
  const pub = (await pedir("GET", "/public/privacy")).body;
  assert.ok(pub.text.length > 50 && pub.version >= 1);
  assert.strictEqual((await pedir("PUT", "/admin/privacy", { token: T.lucia, body: { text: "x".repeat(60) } })).status, 403);
  assert.strictEqual((await pedir("PUT", "/admin/privacy", { token: T.admin, body: { text: "corto" } })).status, 400);

  const texto = "# Aviso de privacidad\n\nTexto de prueba con la **información** que da la academia a las familias.";
  const erratas = await pedir("PUT", "/admin/privacy", { token: T.admin, body: { text: texto, new_version: false } });
  assert.strictEqual(erratas.status, 200);
  assert.strictEqual(erratas.body.privacy_version, pub.version, "corregir erratas no cambia la versión");
  assert.strictEqual((await pedir("GET", "/account", { token: T.lucia })).body.privacy_pending, false);

  const nueva = await pedir("PUT", "/admin/privacy", { token: T.admin, body: { text: texto + "\n\nNuevo apartado.", new_version: true } });
  assert.strictEqual(nueva.body.privacy_version, pub.version + 1);
  assert.ok(nueva.body.privacy_pending_accounts > 0);
  assert.strictEqual((await pedir("GET", "/public/privacy")).body.version, pub.version + 1);

  assert.strictEqual((await pedir("GET", "/account", { token: T.lucia })).body.privacy_pending, true);
  assert.strictEqual((await entrar("lucia@ejemplo.com", "clave-segura")).account.privacy_pending, true, "el login lo indica");
  assert.strictEqual((await pedir("POST", "/account/accept-privacy", { token: T.lucia })).status, 200);
  assert.strictEqual((await pedir("GET", "/account", { token: T.lucia })).body.privacy_pending, false);
});

prueba("¿Olvidaste la contraseña?: misma respuesta exista o no; el enlace funciona una sola vez y cierra las sesiones", async () => {
  const existe = await pedir("POST", "/auth/forgot", { body: { email: "lucia@ejemplo.com" } });
  const noExiste = await pedir("POST", "/auth/forgot", { body: { email: "nadie@ejemplo.com" } });
  assert.strictEqual(existe.status, 200);
  assert.deepStrictEqual(existe.body, noExiste.body, "no revela qué emails tienen cuenta");
  assert.ok(!(await emails()).some((e) => e.to_email === "nadie@ejemplo.com"));

  const email = await ultimoEmail("lucia@ejemplo.com", "reset");
  assert.ok(email, "el email queda en la bandeja de pruebas (modo local)");
  assert.strictEqual(email.status, "local");
  const token = (email.body_text.match(/restablecer\.html\?token=([0-9a-f]+)/) || [])[1];
  assert.ok(token && token.length === 64, "el email lleva el enlace con el token");

  assert.strictEqual((await pedir("POST", "/auth/reset", { body: { token: "0".repeat(64), new_password: "otra-clave-1" } })).status, 400);
  assert.strictEqual((await pedir("POST", "/auth/reset", { body: { token, new_password: "corta" } })).status, 400);
  const ok = await pedir("POST", "/auth/reset", { body: { token, new_password: "otra-clave-1" } });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(ok.body.token);

  assert.strictEqual((await pedir("GET", "/account", { token: T.lucia })).status, 401, "la sesión antigua queda cerrada");
  assert.strictEqual((await pedir("GET", "/account", { token: ok.body.token })).status, 200);
  assert.strictEqual((await pedir("POST", "/auth/login", { body: { email: "lucia@ejemplo.com", password: "clave-segura" } })).status, 401);
  T.lucia = (await entrar("lucia@ejemplo.com", "otra-clave-1")).token;
  assert.strictEqual((await pedir("POST", "/auth/reset", { body: { token, new_password: "tercera-clave" } })).status, 400, "el enlace es de un solo uso");
});

prueba("Pedir un enlace nuevo anula el anterior", async () => {
  await pedir("POST", "/auth/forgot", { body: { email: "lucia@ejemplo.com" } });
  const primero = (await ultimoEmail("lucia@ejemplo.com", "reset")).body_text.match(/token=([0-9a-f]+)/)[1];
  await pedir("POST", "/auth/forgot", { body: { email: "lucia@ejemplo.com" } });
  await new Promise((r) => setTimeout(r, 100));
  const segundo = (await emails()).find((e) => e.to_email === "lucia@ejemplo.com" && e.kind === "reset").body_text.match(/token=([0-9a-f]+)/)[1];
  assert.notStrictEqual(primero, segundo);
  assert.strictEqual((await pedir("POST", "/auth/reset", { body: { token: primero, new_password: "clave-vieja-1" } })).status, 400);
  assert.strictEqual((await pedir("POST", "/auth/reset", { body: { token: segundo, new_password: "clave-nueva-2" } })).status, 200);
});

prueba("Cancelar una sesión con reservas avisa por email a la familia", async () => {
  const m = await ultimoEmail("carlos@ejemplo.com", "cancelacion");
  assert.ok(m, "email de la cancelación de la prueba anterior");
  assert.match(m.body_text, /Festivo/);
  // Solo administración ve la bandeja.
  assert.strictEqual((await pedir("GET", "/admin/emails", { token: T.carlos })).status, 403);
  const prueba = await pedir("POST", "/admin/emails/test", { token: T.admin });
  assert.strictEqual(prueba.status, 200);
  assert.strictEqual(prueba.body.status, "local");
});

prueba("Una «foto» que en realidad es otra cosa (HTML con extensión .png) se rechaza y no se guarda", async () => {
  const antes = fotos().length;
  const miembro = (await pedir("GET", "/family/members", { token: T.carlos })).body[0];
  const falsa = await subirFoto(T.carlos, miembro.id, Buffer.from("<html><script>alert(1)</script></html>"), "foto.png", "image/png");
  assert.strictEqual(falsa.status, 400);
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(fotos().length, antes);
});

prueba("Copias de seguridad: hacer, listar, descargar (solo administración) y nombres maliciosos rechazados", async () => {
  assert.strictEqual((await pedir("POST", "/admin/backups", { token: T.carlos })).status, 403);
  const hecha = await pedir("POST", "/admin/backups", { token: T.admin });
  assert.strictEqual(hecha.status, 200, JSON.stringify(hecha.body));
  assert.match(hecha.body.name, /^academia-\d{4}-\d{2}-\d{2}-\d{6}\.db$/);
  const lista = (await pedir("GET", "/admin/backups", { token: T.admin })).body;
  assert.ok(lista.some((c) => c.name === hecha.body.name));

  const bajar = (nombre, token) => fetch(`${BASE}/api/admin/backups/${nombre}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const res = await bajar(hecha.body.name, T.admin);
  assert.strictEqual(res.status, 200);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.strictEqual(bytes.subarray(0, 15).toString(), "SQLite format 3", "es una base de datos válida");
  assert.strictEqual((await bajar(hecha.body.name, T.carlos)).status, 403);
  assert.strictEqual((await bajar(hecha.body.name)).status, 401);
  for (const malo of ["..%2F..%2F.env", "..%2Fserver.js", "academia.db", encodeURIComponent("../academia.db")]) {
    assert.strictEqual((await bajar(malo, T.admin)).status, 404, malo);
  }
});

prueba("Datos de la academia: se editan en el panel y salen en la información pública", async () => {
  assert.strictEqual((await pedir("PUT", "/admin/academy", { token: T.admin, body: { academy_name: "Club Prueba", academy_contact_email: "malo" } })).status, 400);
  const r = await pedir("PUT", "/admin/academy", { token: T.admin, body: { academy_name: "Club Prueba", academy_contact_email: "hola@club.es" } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.email_mode, "local");
  const info = (await pedir("GET", "/public/info")).body;
  assert.deepStrictEqual(info, { academy_name: "Club Prueba", academy_contact_email: "hola@club.es", demo_accounts: true });
});

prueba("Portada: datos públicos de la academia (disciplinas, equipo, cuotas, horario) sin datos personales", async () => {
  // Los textos de la portada se editan en el panel; un lema demasiado largo -> 400 y no se guarda nada.
  const malo = await pedir("PUT", "/admin/academy", { token: T.admin, body: { academy_name: "Club Prueba", academy_tagline: "x".repeat(121) } });
  assert.strictEqual(malo.status, 400);
  const r = await pedir("PUT", "/admin/academy", {
    token: T.admin,
    body: { academy_name: "Club Prueba", academy_contact_email: "hola@club.es", academy_tagline: "Artes marciales en familia", academy_address: "Calle Mayor 1", academy_phone: "600 111 222" },
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  // Guardar sin enviar los campos de la portada no los borra (paneles antiguos).
  await pedir("PUT", "/admin/academy", { token: T.admin, body: { academy_name: "Club Prueba", academy_contact_email: "hola@club.es" } });

  const home = await pedir("GET", "/public/home");
  assert.strictEqual(home.status, 200);
  const h = home.body;
  assert.strictEqual(h.academy.tagline, "Artes marciales en familia");
  assert.strictEqual(h.academy.address, "Calle Mayor 1");
  assert.ok(h.disciplines.length >= 4 && h.disciplines.every((d) => d.color && Array.isArray(d.groups)));
  assert.ok(h.disciplines.find((d) => d.slug === "bjj").instructors.includes("Javier Roldán"));
  assert.ok(h.plans.length > 0 && h.plans.every((p) => p.price_cents > 0));
  assert.ok(h.instructors.length >= 3 && h.opening.length >= 5);
  assert.strictEqual(h.stats.min_age, 5);
  // Nada de alumnos, emails ni teléfonos del equipo.
  const texto = JSON.stringify(h);
  for (const privado of ["beatriz@ejemplo.com", "Mateo", "javier.instructor@academia.com", "600100200", "frutos secos", "password"]) {
    assert.ok(!texto.includes(privado), `la portada no debe incluir «${privado}»`);
  }
  // En la academia de ejemplo, las disciplinas traen una descripción de muestra.
  assert.ok(h.disciplines.find((d) => d.slug === "judo").description);
});

prueba("Horario: color de cinturón por disciplina y ocupación de la semana (solo cifras, sin nombres)", async () => {
  const disciplinas = (await pedir("GET", "/schedule/disciplines")).body;
  const colores = ["blanco", "gris", "amarillo", "naranja", "verde", "azul", "morado", "marron", "negro"];
  assert.ok(disciplinas.every((d) => colores.includes(d.color)), "todas tienen un color válido aunque no se haya elegido");
  const clases = (await pedir("GET", "/schedule/classes")).body;
  assert.ok(clases.every((c) => colores.includes(c.discipline_color)));

  const judo = disciplinas.find((d) => d.slug === "judo");
  assert.strictEqual((await pedir("PUT", `/admin/disciplines/${judo.id}`, { token: T.admin, body: { name: judo.name, color: "rosa" } })).status, 400);
  const r = await pedir("PUT", `/admin/disciplines/${judo.id}`, { token: T.admin, body: { name: judo.name, color: "marron", description: "Judo tradicional." } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual((await pedir("GET", "/schedule/disciplines")).body.find((d) => d.slug === "judo").color, "marron");
  // Renombrar sin enviar color ni descripción no los borra.
  await pedir("PUT", `/admin/disciplines/${judo.id}`, { token: T.admin, body: { name: judo.name } });
  const tras = (await pedir("GET", "/schedule/disciplines")).body.find((d) => d.slug === "judo");
  assert.strictEqual(tras.color, "marron");
  assert.strictEqual(tras.description, "Judo tradicional.");

  const bjj = clases.find((c) => c.name === "BJJ Adultos" && c.day_of_week === 1);
  const carlos = (await pedir("GET", "/family/members", { token: T.carlos })).body[0];
  const reserva = await pedir("POST", "/bookings", { token: T.carlos, body: { member_id: carlos.id, class_schedule_id: bjj.id, date: proxima(1) } });
  assert.strictEqual(reserva.status, 201, JSON.stringify(reserva.body));

  const hoy = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const hasta = new Date(hoy); hasta.setDate(hasta.getDate() + 30);
  const occ = await pedir("GET", `/schedule/occupancy?from=${iso(hoy)}&to=${iso(hasta)}`);
  assert.strictEqual(occ.status, 200);
  const fila = occ.body.find((o) => o.class_schedule_id === bjj.id && o.date === proxima(1));
  assert.ok(fila && fila.taken >= 1, "cuenta la reserva recién hecha");
  assert.deepStrictEqual(Object.keys(occ.body[0]).sort(), ["class_schedule_id", "date", "taken", "waitlist"], "solo cifras");
  const lejos = new Date(hoy); lejos.setDate(lejos.getDate() + 90);
  assert.strictEqual((await pedir("GET", `/schedule/occupancy?from=${iso(hoy)}&to=${iso(lejos)}`)).status, 400, "rango máximo");
});

prueba("Reservas: anular y volver a reservar funciona; asistencia de un día futuro -> 409; datos mal formados -> 400 (nunca 500)", async () => {
  const clases = (await pedir("GET", "/schedule/classes")).body;
  const bjj = clases.find((c) => c.name === "BJJ Adultos" && c.day_of_week === 3);
  const carlos = (await pedir("GET", "/family/members", { token: T.carlos })).body[0];
  const datos = { member_id: carlos.id, class_schedule_id: bjj.id, date: proxima(3) };

  const r1 = await pedir("POST", "/bookings", { token: T.carlos, body: datos });
  assert.strictEqual(r1.status, 201, JSON.stringify(r1.body));
  assert.strictEqual((await pedir("PUT", `/bookings/${r1.body.id}/cancel`, { token: T.carlos })).status, 200);
  // Antes de arreglarlo: 409 «No se ha podido completar la reserva».
  const r2 = await pedir("POST", "/bookings", { token: T.carlos, body: datos });
  assert.strictEqual(r2.status, 201, JSON.stringify(r2.body));
  assert.strictEqual(r2.body.status, "reservada");

  const javier = (await entrar("javier.instructor@academia.com")).token;
  const asistencia = await pedir("PUT", `/bookings/${r2.body.id}/attendance`, { token: javier });
  assert.strictEqual(asistencia.status, 409);
  assert.match(asistencia.body.error, /Todavía no ha llegado el día/);

  const raros = [
    ["POST", "/family/members", { first_name: { a: 1 }, last_name: "X" }],
    ["POST", "/family/members", { first_name: "Test", last_name: "X", birth_date: "2020-02-30" }],
    ["POST", "/family/members", { first_name: "Test", last_name: "X", birth_date: "no-es-fecha" }],
    ["PUT", "/account", { name: 5 }],
    ["POST", "/bookings", { ...datos, date: "mañana" }],
  ];
  for (const [m, ruta, body] of raros) {
    const r = await pedir(m, ruta, { token: T.carlos, body });
    assert.ok(r.status === 400 || r.status === 409, `${m} ${ruta} ${JSON.stringify(body)} -> ${r.status}`);
  }
});

// Va la última: deja la IP de las pruebas con intentos fallidos acumulados.
prueba("Demasiados intentos fallidos de entrar -> bloqueo temporal (429), incluso con la contraseña buena", async () => {
  for (let i = 0; i < 8; i++) {
    assert.strictEqual((await pedir("POST", "/auth/login", { body: { email: "beatriz@ejemplo.com", password: `mala-${i}` } })).status, 401);
  }
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "beatriz@ejemplo.com", password: "mala-9" }),
  });
  assert.strictEqual(res.status, 429);
  assert.ok(Number(res.headers.get("retry-after")) > 0);
  assert.match((await res.json()).error, /minutos?/);
  // Otra cuenta desde la misma IP sigue pudiendo entrar.
  assert.ok((await entrar("javier.instructor@academia.com")).token);
});

// ---------------------------------------------------------------------------
(async () => {
  let ok = 0;
  const fallos = [];
  try {
    await arrancar();
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
  } catch (err) {
    console.log(`  ✘ ${err.message}`);
    fallos.push("arranque");
  } finally {
    if (servidor) servidor.kill();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  console.log(`\n${ok}/${pruebas.length} pruebas de la API real correctas`);
  process.exit(fallos.length ? 1 : 0);
})();
