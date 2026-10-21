// services/admin.js
//
// Lógica del panel de administración: horario, sesiones canceladas,
// disciplinas, grupos, equipo (instructores y administración) y alumnos.
//
// Tres principios que se repiten en todo el archivo:
//
// 1. NUNCA SE BORRA HISTORIAL. Una disciplina, grupo o clase con reservas
//    pasadas se ARCHIVA (active = 0) en vez de borrarse: las reservas,
//    asistencias y cuotas antiguas siguen apuntando a ellas. Solo se puede
//    borrar de verdad lo que se creó por error y nunca llegó a usarse.
//
// 2. QUIEN YA HA RESERVADO NO SE QUEDA COLGADO. Si la academia quita una
//    clase o cancela una sesión, sus reservas futuras se cancelan con una
//    nota que la familia ve en "Mis reservas". Y un cambio que dejaría una
//    reserva en un día u horario que ya no existe (mover la clase a otro día)
//    no se permite mientras haya reservas futuras.
//
// 3. LA ACADEMIA NO SE PUEDE QUEDAR SIN ADMINISTRACIÓN. Nadie puede quitarse
//    a sí mismo el rol ni desactivarse, y siempre tiene que quedar al menos
//    una cuenta de administración activa.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../db/database");
const { COLORES_CINTURON, colorDisciplina } = require("../utils/cinturones");
const { todayStr, addDays, fechaLegible } = require("../utils/dates");
const { emailReservasCanceladas, emailPrueba, modoEmail } = require("./email");
const { getSetting, setSetting } = require("./settings");

class AdminError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const ROLES = ["member", "instructor", "admin"];
const ROL_LEGIBLE = { member: "familia/alumno", instructor: "instructor", admin: "administración" };

// ---------------------------------------------------------------------------
// Validación de datos que llegan del formulario
// ---------------------------------------------------------------------------
function textoObligatorio(valor, campo, max = 80) {
  const t = String(valor ?? "").trim();
  if (!t) throw new AdminError(`${campo}: no puede estar vacío.`);
  if (t.length > max) throw new AdminError(`${campo}: máximo ${max} caracteres.`);
  return t;
}
function textoOpcional(valor, campo, max = 200) {
  const t = String(valor ?? "").trim();
  if (t.length > max) throw new AdminError(`${campo}: máximo ${max} caracteres.`);
  return t || null;
}
function enteroOpcional(valor, campo, min, max) {
  if (valor === "" || valor === null || valor === undefined) return null;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) throw new AdminError(`${campo}: debe ser un número entre ${min} y ${max}.`);
  return n;
}
function enteroObligatorio(valor, campo, min, max) {
  const n = enteroOpcional(valor, campo, min, max);
  if (n === null) throw new AdminError(`${campo}: es obligatorio.`);
  return n;
}
function emailValido(valor) {
  const e = String(valor ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 120) throw new AdminError("El email no es válido.");
  return e;
}
function esEmailAdminPrincipal(email) {
  const principal = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  return !!principal && String(email).toLowerCase() === principal;
}

// "Estética y belleza" -> "estetica-y-belleza"
function slugify(texto) {
  return texto
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// Transacción con vuelta atrás automática si algo falla a medias.
function enTransaccion(fn) {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// Contraseña temporal fácil de dictar o copiar: sin letras ni números que se
// confundan (0/O, 1/l/I).
function contrasenaTemporal() {
  const alfabeto = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += alfabeto[crypto.randomInt(alfabeto.length)];
  return s;
}

// ===========================================================================
// DISCIPLINAS Y GRUPOS
// ===========================================================================
function listDisciplines() {
  const disciplinas = db
    .prepare(
      `SELECT d.*,
              (SELECT COUNT(*) FROM plans p WHERE p.discipline_id = d.id AND p.active = 1) AS active_plans,
              (SELECT COUNT(*) FROM plans p WHERE p.discipline_id = d.id) AS total_plans,
              (SELECT COUNT(*) FROM gradings gr WHERE gr.discipline_id = d.id) AS total_gradings
       FROM disciplines d ORDER BY d.active DESC, d.name`
    )
    .all();
  const grupos = db
    .prepare(
      `SELECT g.*,
              (SELECT COUNT(*) FROM class_schedule cs WHERE cs.group_id = g.id AND cs.active = 1) AS active_classes,
              (SELECT COUNT(*) FROM class_schedule cs WHERE cs.group_id = g.id) AS total_classes
       FROM groups g ORDER BY g.active DESC, g.name`
    )
    .all();
  return disciplinas.map((d) => ({ ...d, color: colorDisciplina(d), groups: grupos.filter((g) => g.discipline_id === d.id) }));
}

function getDiscipline(id) {
  const d = db.prepare("SELECT * FROM disciplines WHERE id = ?").get(id);
  if (!d) throw new AdminError("Disciplina no encontrada.", 404);
  return { ...d, color: colorDisciplina(d) };
}
function nombreDisciplinaLibre(nombre, exceptoId = 0) {
  const otra = db.prepare("SELECT id FROM disciplines WHERE lower(name) = lower(?) AND id != ?").get(nombre, exceptoId);
  if (otra) throw new AdminError(`Ya existe una disciplina llamada «${nombre}».`, 409);
}

// Color de cinturón (opcional) y descripción para su página pública.
function colorElegido(color) {
  if (color === undefined || color === null || color === "") return null;
  if (!COLORES_CINTURON.includes(color)) throw new AdminError("Ese color no es válido.");
  return color;
}
function descripcionDisciplina(texto) {
  const t = String(texto ?? "").trim();
  if (t.length > 2000) throw new AdminError("La descripción es demasiado larga (máximo 2.000 caracteres).");
  return t || null;
}

function createDiscipline({ name, color, description }) {
  const nombre = textoObligatorio(name, "El nombre", 60);
  nombreDisciplinaLibre(nombre);
  const base = slugify(nombre);
  if (!base) throw new AdminError("El nombre tiene que incluir alguna letra o número.");
  // El slug identifica la disciplina en las URLs y filtros: tiene que ser único.
  let slug = base;
  for (let n = 2; db.prepare("SELECT id FROM disciplines WHERE slug = ?").get(slug); n++) slug = `${base}-${n}`;
  const id = db
    .prepare("INSERT INTO disciplines (name, slug, color, description) VALUES (?, ?, ?, ?)")
    .run(nombre, slug, colorElegido(color), descripcionDisciplina(description)).lastInsertRowid;
  return getDiscipline(id);
}

// Renombrar no cambia el slug: así no se rompen enlaces ni filtros guardados.
// color y description son opcionales: si no se envían, se quedan como estaban.
function updateDiscipline(id, { name, color, description }) {
  const actual = getDiscipline(id);
  const nombre = textoObligatorio(name, "El nombre", 60);
  nombreDisciplinaLibre(nombre, id);
  db.prepare("UPDATE disciplines SET name = ?, color = ?, description = ? WHERE id = ?").run(
    nombre,
    color === undefined ? db.prepare("SELECT color FROM disciplines WHERE id = ?").get(id).color : colorElegido(color),
    description === undefined ? actual.description : descripcionDisciplina(description),
    id
  );
  return getDiscipline(id);
}

function setDisciplineActive(id, active) {
  const d = getDiscipline(id);
  if (!active) {
    const grupos = db.prepare("SELECT COUNT(*) AS n FROM groups WHERE discipline_id = ? AND active = 1").get(id).n;
    if (grupos > 0) throw new AdminError(`«${d.name}» tiene ${grupos} ${grupos === 1 ? "grupo activo" : "grupos activos"}: archívalos primero.`, 409);
    const planes = db.prepare("SELECT COUNT(*) AS n FROM plans WHERE discipline_id = ? AND active = 1").get(id).n;
    if (planes > 0) {
      throw new AdminError(`Hay ${planes} ${planes === 1 ? "plan de cuota" : "planes de cuota"} de «${d.name}» a la venta: retíralos primero en Cuotas y pagos → Planes.`, 409);
    }
  }
  db.prepare("UPDATE disciplines SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
  return getDiscipline(id);
}

// Borrar solo lo que no se ha usado nunca (creado por error).
function deleteDiscipline(id) {
  const d = getDiscipline(id);
  const usos = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM groups WHERE discipline_id = ?) AS grupos,
              (SELECT COUNT(*) FROM plans WHERE discipline_id = ?) AS planes,
              (SELECT COUNT(*) FROM gradings WHERE discipline_id = ?) AS graduaciones`
    )
    .get(id, id, id);
  if (usos.grupos || usos.planes || usos.graduaciones) {
    throw new AdminError(`«${d.name}» ya tiene grupos, planes o graduaciones asociados: archívala en vez de borrarla, así se conserva el historial.`, 409);
  }
  db.prepare("DELETE FROM disciplines WHERE id = ?").run(id);
  return { success: true };
}

function getGroup(id) {
  const g = db.prepare("SELECT * FROM groups WHERE id = ?").get(id);
  if (!g) throw new AdminError("Grupo no encontrado.", 404);
  return g;
}

function validarGrupo(datos) {
  const nombre = textoObligatorio(datos.name, "El nombre del grupo", 60);
  const min = enteroOpcional(datos.min_age, "La edad mínima", 0, 99);
  const max = enteroOpcional(datos.max_age, "La edad máxima", 0, 99);
  if (min !== null && max !== null && min > max) throw new AdminError("La edad mínima no puede ser mayor que la máxima.");
  return { nombre, min, max, descripcion: textoOpcional(datos.description, "La descripción", 200) };
}
function nombreGrupoLibre(disciplinaId, nombre, exceptoId = 0) {
  const otro = db
    .prepare("SELECT id FROM groups WHERE discipline_id = ? AND lower(name) = lower(?) AND id != ? AND active = 1")
    .get(disciplinaId, nombre, exceptoId);
  if (otro) throw new AdminError(`Esa disciplina ya tiene un grupo activo llamado «${nombre}».`, 409);
}

function createGroup(datos) {
  const d = getDiscipline(Number(datos.discipline_id));
  if (!d.active) throw new AdminError(`«${d.name}» está archivada: reactívala antes de añadirle grupos.`);
  const { nombre, min, max, descripcion } = validarGrupo(datos);
  nombreGrupoLibre(d.id, nombre);
  const id = db
    .prepare("INSERT INTO groups (discipline_id, name, min_age, max_age, description) VALUES (?, ?, ?, ?, ?)")
    .run(d.id, nombre, min, max, descripcion).lastInsertRowid;
  return getGroup(id);
}

function updateGroup(id, datos) {
  const g = getGroup(id);
  const { nombre, min, max, descripcion } = validarGrupo({ ...g, ...datos });
  let disciplinaId = g.discipline_id;
  if (datos.discipline_id !== undefined && Number(datos.discipline_id) !== g.discipline_id) {
    // Cambiar de disciplina cambiaría qué cuotas dan acceso a sus clases (y
    // falsearía el historial): solo se permite en un grupo sin clases.
    const clases = db.prepare("SELECT COUNT(*) AS n FROM class_schedule WHERE group_id = ?").get(id).n;
    if (clases > 0) throw new AdminError("Este grupo ya tiene clases: no se puede mover a otra disciplina. Crea un grupo nuevo en la otra disciplina.", 409);
    const nueva = getDiscipline(Number(datos.discipline_id));
    if (!nueva.active) throw new AdminError(`«${nueva.name}» está archivada.`);
    disciplinaId = nueva.id;
  }
  if (g.active) nombreGrupoLibre(disciplinaId, nombre, id);
  db.prepare("UPDATE groups SET discipline_id = ?, name = ?, min_age = ?, max_age = ?, description = ? WHERE id = ?")
    .run(disciplinaId, nombre, min, max, descripcion, id);
  return getGroup(id);
}

function setGroupActive(id, active) {
  const g = getGroup(id);
  if (!active) {
    const clases = db.prepare("SELECT COUNT(*) AS n FROM class_schedule WHERE group_id = ? AND active = 1").get(id).n;
    if (clases > 0) {
      throw new AdminError(`«${g.name}» tiene ${clases} ${clases === 1 ? "clase" : "clases"} en el horario: quítalas del horario primero.`, 409);
    }
  } else {
    const d = getDiscipline(g.discipline_id);
    if (!d.active) throw new AdminError(`La disciplina «${d.name}» está archivada: reactívala primero.`, 409);
    nombreGrupoLibre(g.discipline_id, g.name, id);
  }
  db.prepare("UPDATE groups SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
  return getGroup(id);
}

function deleteGroup(id) {
  const g = getGroup(id);
  const clases = db.prepare("SELECT COUNT(*) AS n FROM class_schedule WHERE group_id = ?").get(id).n;
  if (clases > 0) throw new AdminError(`«${g.name}» ya ha tenido clases: archívalo en vez de borrarlo, así se conserva el historial.`, 409);
  db.prepare("DELETE FROM groups WHERE id = ?").run(id);
  return { success: true };
}

// ===========================================================================
// HORARIO
// ===========================================================================
const COLUMNAS_CLASE = `cs.*, g.name AS group_name, g.active AS group_active, g.min_age, g.max_age,
  d.id AS discipline_id, d.name AS discipline_name, d.active AS discipline_active,
  a.name AS instructor_name, a.active AS instructor_active, a.role AS instructor_role`;
const TABLAS_CLASE = `FROM class_schedule cs
  JOIN groups g ON g.id = cs.group_id
  JOIN disciplines d ON d.id = g.discipline_id
  JOIN accounts a ON a.id = cs.instructor_account_id`;
const SQL_CLASE = `SELECT ${COLUMNAS_CLASE} ${TABLAS_CLASE}`;

function getClass(id) {
  const c = db.prepare(`${SQL_CLASE} WHERE cs.id = ?`).get(id);
  if (!c) throw new AdminError("Clase no encontrada.", 404);
  return c;
}

// Reservas "vivas" (con plaza o en lista de espera) de hoy en adelante.
function reservasFuturas(classId) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM bookings WHERE class_schedule_id = ? AND date >= ? AND status IN ('reservada', 'en_espera')")
    .get(classId, todayStr()).n;
}

function listClasses() {
  const hoy = todayStr();
  return db
    .prepare(
      `SELECT ${COLUMNAS_CLASE},
              (SELECT COUNT(*) FROM bookings b WHERE b.class_schedule_id = cs.id AND b.date >= ? AND b.status IN ('reservada', 'en_espera')) AS future_bookings,
              (SELECT COUNT(*) FROM bookings b WHERE b.class_schedule_id = cs.id) AS total_bookings
       ${TABLAS_CLASE}
       ORDER BY cs.active DESC, cs.day_of_week = 0, cs.day_of_week, cs.start_time`
    )
    .all(hoy);
}

// Comprueba todo lo que tiene que cumplir una clase para estar en el horario.
function validarClase(datos, exceptoId = 0, comprobarSolape = true) {
  const grupo = db
    .prepare("SELECT g.*, d.active AS discipline_active, d.name AS discipline_name FROM groups g JOIN disciplines d ON d.id = g.discipline_id WHERE g.id = ?")
    .get(Number(datos.group_id));
  if (!grupo) throw new AdminError("Elige el grupo de la clase.");
  if (!grupo.active || !grupo.discipline_active) throw new AdminError(`El grupo «${grupo.name}» está archivado.`);

  const instructor = db.prepare("SELECT id, name, role, active FROM accounts WHERE id = ?").get(Number(datos.instructor_account_id));
  if (!instructor || !["instructor", "admin"].includes(instructor.role)) throw new AdminError("Elige quién imparte la clase (un instructor o alguien de administración).");
  if (!instructor.active) throw new AdminError(`La cuenta de ${instructor.name} está desactivada.`);

  const dia = enteroObligatorio(datos.day_of_week, "El día de la semana", 0, 6);
  const inicio = String(datos.start_time || "");
  const fin = String(datos.end_time || "");
  if (!HHMM.test(inicio) || !HHMM.test(fin)) throw new AdminError("Las horas tienen que tener el formato HH:MM.");
  // "HH:MM" con ceros delante se puede comparar directamente como texto.
  if (inicio >= fin) throw new AdminError("La hora de fin tiene que ser posterior a la de inicio.");
  const aforo = enteroObligatorio(datos.capacity, "El aforo", 1, 200);
  const nombre = textoOpcional(datos.name, "El nombre de la clase", 60);

  // Una misma persona no puede dar dos clases a la vez.
  if (comprobarSolape) {
    const choque = db
      .prepare(
        `SELECT cs.start_time, cs.end_time, COALESCE(cs.name, g.name) AS nombre
         FROM class_schedule cs JOIN groups g ON g.id = cs.group_id
         WHERE cs.instructor_account_id = ? AND cs.day_of_week = ? AND cs.active = 1 AND cs.id != ?
           AND cs.start_time < ? AND cs.end_time > ?`
      )
      .get(instructor.id, dia, exceptoId, fin, inicio);
    if (choque) {
      throw new AdminError(`${instructor.name} ya da «${choque.nombre}» el ${DIAS[dia]} de ${choque.start_time} a ${choque.end_time}.`, 409);
    }
  }

  return { grupoId: grupo.id, instructorId: instructor.id, dia, inicio, fin, aforo, nombre };
}

function createClass(datos) {
  const v = validarClase(datos);
  const id = db
    .prepare(
      `INSERT INTO class_schedule (group_id, instructor_account_id, name, day_of_week, start_time, end_time, capacity)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(v.grupoId, v.instructorId, v.nombre, v.dia, v.inicio, v.fin, v.aforo).lastInsertRowid;
  return getClass(id);
}

// Si sube el aforo, las personas en lista de espera de las próximas sesiones
// pasan a tener plaza (por orden de llegada), igual que cuando alguien cancela.
function promoverListaDeEspera(classId, aforo) {
  let promovidas = 0;
  const fechas = db
    .prepare("SELECT DISTINCT date FROM bookings WHERE class_schedule_id = ? AND date >= ? AND status = 'en_espera'")
    .all(classId, todayStr());
  for (const { date } of fechas) {
    const ocupadas = db
      .prepare("SELECT COUNT(*) AS n FROM bookings WHERE class_schedule_id = ? AND date = ? AND status IN ('reservada', 'asistio')")
      .get(classId, date).n;
    const libres = aforo - ocupadas;
    if (libres <= 0) continue;
    const esperando = db
      .prepare("SELECT id FROM bookings WHERE class_schedule_id = ? AND date = ? AND status = 'en_espera' ORDER BY created_at ASC, id ASC LIMIT ?")
      .all(classId, date, libres);
    esperando.forEach((b) => db.prepare("UPDATE bookings SET status = 'reservada' WHERE id = ?").run(b.id));
    promovidas += esperando.length;
  }
  return promovidas;
}

function updateClass(id, datos) {
  const actual = getClass(id);
  const combinado = {
    group_id: actual.group_id,
    instructor_account_id: actual.instructor_account_id,
    day_of_week: actual.day_of_week,
    start_time: actual.start_time,
    end_time: actual.end_time,
    capacity: actual.capacity,
    name: actual.name,
    ...datos,
  };
  // Una clase fuera del horario puede editarse aunque choque con otra: se
  // comprobará al volver a ponerla en el horario.
  const v = validarClase(combinado, id, !!actual.active);

  const futuras = reservasFuturas(id);
  if (futuras > 0 && (v.dia !== actual.day_of_week || v.grupoId !== actual.group_id)) {
    throw new AdminError(
      `Hay ${futuras} ${futuras === 1 ? "reserva próxima" : "reservas próximas"} en esta clase: si cambias el día o el grupo, quedarían en una clase que ya no existe. ` +
        "Crea una clase nueva con el día o grupo que quieras y quita esta del horario (se avisará a quien había reservado).",
      409,
      { future_bookings: futuras }
    );
  }

  return enTransaccion(() => {
    db.prepare(
      `UPDATE class_schedule SET group_id = ?, instructor_account_id = ?, name = ?, day_of_week = ?, start_time = ?, end_time = ?, capacity = ?
       WHERE id = ?`
    ).run(v.grupoId, v.instructorId, v.nombre, v.dia, v.inicio, v.fin, v.aforo, id);
    const promovidas = v.aforo > actual.capacity && actual.active ? promoverListaDeEspera(id, v.aforo) : 0;
    return { class: getClass(id), promoted: promovidas };
  });
}

// Cancela las reservas vivas de una clase (todas las futuras, o las de una
// fecha concreta) dejando una nota que la familia verá en "Mis reservas".
// Devuelve las reservas afectadas, para poder avisar a cada familia.
function cancelarReservas(classId, nota, fecha = null) {
  const condicion = fecha ? "b.date = ?" : "b.date >= ?";
  const afectadas = db
    .prepare(
      `SELECT b.id, b.date, m.first_name, a.id AS account_id, a.name AS account_name, a.email, a.active
       FROM bookings b JOIN members m ON m.id = b.member_id JOIN accounts a ON a.id = m.account_id
       WHERE b.class_schedule_id = ? AND ${condicion} AND b.status IN ('reservada', 'en_espera')`
    )
    .all(classId, fecha || todayStr());
  const actualizar = db.prepare("UPDATE bookings SET status = 'cancelada', cancel_note = ? WHERE id = ?");
  afectadas.forEach((b) => actualizar.run(nota, b.id));
  return afectadas;
}

// Un email por familia (aunque la cancelación afecte a varios hermanos o a
// varias fechas). Se llama DESPUÉS de guardar los cambios: si el email falla,
// la cancelación ya está hecha y la familia la ve igualmente en la app.
function avisarFamilias(clase, afectadas, motivo) {
  const porCuenta = new Map();
  afectadas.forEach((b) => {
    if (!b.active) return;
    const f = porCuenta.get(b.account_id) || { cuenta: { email: b.email, name: b.account_name }, fechas: new Set(), miembros: new Set() };
    f.fechas.add(b.date);
    f.miembros.add(b.first_name);
    porCuenta.set(b.account_id, f);
  });
  for (const f of porCuenta.values()) {
    emailReservasCanceladas(f.cuenta, {
      clase: `${clase.name || clase.group_name} (${DIAS[clase.day_of_week]} a las ${clase.start_time})`,
      fechas: [...f.fechas].sort().map(fechaLegible),
      motivo,
      miembros: [...f.miembros],
    });
  }
}

function setClassActive(id, active) {
  const c = getClass(id);
  if (!active) {
    if (!c.active) return { class: c, cancelled_bookings: 0 };
    const afectadas = enTransaccion(() => {
      const r = cancelarReservas(id, "La academia ha quitado esta clase del horario.");
      db.prepare("UPDATE class_schedule SET active = 0 WHERE id = ?").run(id);
      return r;
    });
    avisarFamilias(c, afectadas, "se ha quitado del horario");
    return { class: getClass(id), cancelled_bookings: afectadas.length };
  }
  // Volver a ponerla: tiene que seguir cumpliendo todo (grupo e instructor
  // activos, sin solaparse con otra clase del mismo instructor).
  validarClase(c, id, true);
  db.prepare("UPDATE class_schedule SET active = 1 WHERE id = ?").run(id);
  return { class: getClass(id), cancelled_bookings: 0 };
}

function deleteClass(id) {
  getClass(id);
  const reservas = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE class_schedule_id = ?").get(id).n;
  if (reservas > 0) {
    throw new AdminError("Esta clase ya tiene reservas o asistencias registradas: quítala del horario en vez de borrarla, así se conserva el historial.", 409);
  }
  enTransaccion(() => {
    db.prepare("DELETE FROM class_cancellations WHERE class_schedule_id = ?").run(id);
    db.prepare("DELETE FROM class_schedule WHERE id = ?").run(id);
  });
  return { success: true };
}

// --- Sesiones canceladas (una fecha concreta) ---
function cancelSession(classId, { date, reason }, adminAccountId) {
  const c = getClass(classId);
  if (!c.active) throw new AdminError("Esta clase no está en el horario.");
  if (!FECHA.test(date || "")) throw new AdminError("Elige la fecha que quieres cancelar.");
  if (date < todayStr()) throw new AdminError("No se puede cancelar una sesión que ya ha pasado.");
  if (new Date(date + "T12:00:00").getDay() !== c.day_of_week) {
    throw new AdminError(`Esa fecha no es ${DIAS[c.day_of_week]}, que es el día de esta clase.`);
  }
  const motivo = textoOpcional(reason, "El motivo", 80);
  const ya = db.prepare("SELECT id FROM class_cancellations WHERE class_schedule_id = ? AND date = ?").get(classId, date);
  if (ya) throw new AdminError("Esa sesión ya estaba cancelada.", 409);

  const { id, afectadas } = enTransaccion(() => {
    const nuevaId = db
      .prepare("INSERT INTO class_cancellations (class_schedule_id, date, reason, created_by_account_id) VALUES (?, ?, ?, ?)")
      .run(classId, date, motivo, adminAccountId || null).lastInsertRowid;
    const nota = `La academia ha cancelado la sesión del ${fechaLegible(date)}${motivo ? ` (${motivo})` : ""}.`;
    return { id: nuevaId, afectadas: cancelarReservas(classId, nota, date) };
  });
  avisarFamilias(c, afectadas, motivo);
  return { cancellation: getCancellation(id), cancelled_bookings: afectadas.length };
}

function getCancellation(id) {
  const c = db
    .prepare(
      `SELECT cc.*, cs.day_of_week, cs.start_time, cs.end_time, COALESCE(cs.name, g.name) AS class_name
       FROM class_cancellations cc JOIN class_schedule cs ON cs.id = cc.class_schedule_id JOIN groups g ON g.id = cs.group_id
       WHERE cc.id = ?`
    )
    .get(id);
  if (!c) throw new AdminError("Cancelación no encontrada.", 404);
  return c;
}

// Deshacer una cancelación vuelve a abrir las reservas de esa fecha, pero NO
// restaura las que se cancelaron: esas familias ya fueron avisadas y tienen
// que volver a reservar si les sigue viniendo bien.
function restoreSession(cancellationId) {
  const c = getCancellation(cancellationId);
  if (c.date < todayStr()) throw new AdminError("Esa sesión ya ha pasado.");
  db.prepare("DELETE FROM class_cancellations WHERE id = ?").run(cancellationId);
  return { success: true };
}

// Público (lo usa el horario): sesiones canceladas en un rango de fechas.
function listCancellations(desde = todayStr(), hasta = addDays(todayStr(), 120)) {
  if (!FECHA.test(desde) || !FECHA.test(hasta)) throw new AdminError("Fechas no válidas.");
  return db
    .prepare(
      `SELECT cc.id, cc.class_schedule_id, cc.date, cc.reason, cs.day_of_week, cs.start_time, cs.end_time,
              COALESCE(cs.name, g.name) AS class_name
       FROM class_cancellations cc JOIN class_schedule cs ON cs.id = cc.class_schedule_id JOIN groups g ON g.id = cs.group_id
       WHERE cc.date BETWEEN ? AND ? ORDER BY cc.date, cs.start_time`
    )
    .all(desde, hasta);
}

// ===========================================================================
// EQUIPO Y CUENTAS
// ===========================================================================
function getAccount(id) {
  const a = db.prepare("SELECT id, name, email, phone, role, active, must_change_password, created_at FROM accounts WHERE id = ?").get(id);
  if (!a) throw new AdminError("Cuenta no encontrada.", 404);
  return a;
}
function clasesQueImparte(accountId) {
  return db.prepare("SELECT COUNT(*) AS n FROM class_schedule WHERE instructor_account_id = ? AND active = 1").get(accountId).n;
}
function adminsActivos() {
  return db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE role = 'admin' AND active = 1").get().n;
}

function listTeam() {
  return db
    .prepare(
      `SELECT a.id, a.name, a.email, a.phone, a.role, a.active, a.must_change_password, a.created_at,
              (SELECT COUNT(*) FROM class_schedule cs WHERE cs.instructor_account_id = a.id AND cs.active = 1) AS active_classes
       FROM accounts a WHERE a.role IN ('instructor', 'admin')
       ORDER BY a.active DESC, a.role = 'admin' DESC, a.name`
    )
    .all()
    .map((a) => ({ ...a, is_main_admin: esEmailAdminPrincipal(a.email) }));
}

// Alta de alguien del equipo. La contraseña temporal se devuelve UNA vez para
// que la administración se la dé en persona; al entrar se le pide cambiarla.
function createStaff({ name, email, phone, role }) {
  const nombre = textoObligatorio(name, "El nombre", 80);
  const correo = emailValido(email);
  const telefono = textoOpcional(phone, "El teléfono", 30);
  const rol = role === "admin" ? "admin" : "instructor";

  const existente = db.prepare("SELECT id, name, role FROM accounts WHERE email = ?").get(correo);
  if (existente) {
    throw new AdminError(
      `Ya existe una cuenta con ese email (${existente.name}, ${ROL_LEGIBLE[existente.role]}).` +
        (existente.role === "member" ? " Puedes darle permisos de instructor sin crear otra cuenta." : ""),
      409,
      { existing_account_id: existente.id, existing_role: existente.role, existing_name: existente.name }
    );
  }

  const temporal = contrasenaTemporal();
  const id = db
    .prepare("INSERT INTO accounts (name, email, password_hash, role, phone, must_change_password) VALUES (?, ?, ?, ?, ?, 1)")
    .run(nombre, correo, bcrypt.hashSync(temporal, 10), rol, telefono).lastInsertRowid;
  return { account: getAccount(id), temp_password: temporal };
}

// Corregir datos de contacto de cualquier cuenta (también el email, que es el
// usuario para entrar: por eso se comprueba que no esté ya en uso).
function updateAccount(id, { name, email, phone }) {
  const a = getAccount(id);
  const nombre = name === undefined ? a.name : textoObligatorio(name, "El nombre", 80);
  const correo = email === undefined ? a.email : emailValido(email);
  const telefono = phone === undefined ? a.phone : textoOpcional(phone, "El teléfono", 30);
  if (correo !== a.email) {
    if (esEmailAdminPrincipal(a.email)) throw new AdminError("El email de la administración principal se cambia en el archivo .env (ADMIN_EMAIL).");
    if (db.prepare("SELECT id FROM accounts WHERE email = ? AND id != ?").get(correo, id)) throw new AdminError("Ese email ya lo usa otra cuenta.", 409);
  }
  db.prepare("UPDATE accounts SET name = ?, email = ?, phone = ? WHERE id = ?").run(nombre, correo, telefono, id);
  return getAccount(id);
}

function setRole(id, role, adminAccountId) {
  if (!ROLES.includes(role)) throw new AdminError("Rol no válido.");
  if (Number(id) === Number(adminAccountId)) throw new AdminError("No puedes cambiar tu propio rol: pídeselo a otra persona de administración.");
  const a = getAccount(id);
  if (a.role === role) return a;

  if (esEmailAdminPrincipal(a.email)) {
    throw new AdminError("Esta es la cuenta de administración principal (ADMIN_EMAIL en el .env): no se le puede quitar el rol.");
  }
  if (a.role === "admin" && a.active && adminsActivos() <= 1) {
    throw new AdminError("Tiene que quedar al menos una cuenta de administración activa.");
  }
  if (role === "member") {
    const clases = clasesQueImparte(id);
    if (clases > 0) {
      throw new AdminError(`${a.name} da ${clases} ${clases === 1 ? "clase" : "clases"}: asígnalas a otra persona en el Horario antes de quitarle el rol.`, 409);
    }
  }
  db.prepare("UPDATE accounts SET role = ? WHERE id = ?").run(role, id);
  return getAccount(id);
}

function setAccountActive(id, active, adminAccountId) {
  if (Number(id) === Number(adminAccountId)) throw new AdminError("No puedes desactivar tu propia cuenta.");
  const a = getAccount(id);
  if (!active) {
    if (esEmailAdminPrincipal(a.email)) throw new AdminError("No se puede desactivar la cuenta de administración principal (ADMIN_EMAIL).");
    if (a.role === "admin" && a.active && adminsActivos() <= 1) throw new AdminError("Tiene que quedar al menos una cuenta de administración activa.");
    const clases = clasesQueImparte(id);
    if (clases > 0) {
      throw new AdminError(`${a.name} da ${clases} ${clases === 1 ? "clase" : "clases"}: asígnalas a otra persona en el Horario antes de desactivar la cuenta.`, 409);
    }
    // Una cuenta con cuotas vivas seguiría pagando (o debiendo) sin poder
    // entrar a la app: primero hay que darlas de baja.
    const cuotas = db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE account_id = ? AND status != 'cancelada'").get(id).n;
    if (cuotas > 0) {
      throw new AdminError(`Esta cuenta tiene ${cuotas} ${cuotas === 1 ? "cuota" : "cuotas"} sin dar de baja: dalas de baja en Cuotas y pagos antes de desactivarla.`, 409);
    }
  }
  db.prepare("UPDATE accounts SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
  return getAccount(id);
}

// Para quien ha olvidado su contraseña: la academia le da una temporal en
// persona. (La app todavía no envía emails, así que no hay "recuperar por
// correo".)
function resetPassword(id, adminAccountId) {
  if (Number(id) === Number(adminAccountId)) throw new AdminError("Para cambiar tu propia contraseña, usa «Mi cuenta».");
  getAccount(id);
  const temporal = contrasenaTemporal();
  // Subir token_version cierra las sesiones que tuviera abiertas (por si la
  // contraseña se ha filtrado o el móvil se ha perdido).
  db.prepare("UPDATE accounts SET password_hash = ?, must_change_password = 1, token_version = token_version + 1 WHERE id = ?")
    .run(bcrypt.hashSync(temporal, 10), id);
  return { temp_password: temporal };
}

// ===========================================================================
// ALUMNOS
// ===========================================================================
function listFamilies() {
  const cuentas = db
    .prepare(
      `SELECT a.id, a.name, a.email, a.phone, a.role, a.active, a.created_at
       FROM accounts a
       WHERE a.role = 'member' OR EXISTS (SELECT 1 FROM members m WHERE m.account_id = a.id)
       ORDER BY a.name COLLATE NOCASE`
    )
    .all();
  const miembros = db
    .prepare(
      `SELECT id, account_id, first_name, last_name, birth_date, is_dependent, avatar_file,
              (medical_notes IS NOT NULL AND medical_notes != '') AS has_medical_notes
       FROM members WHERE active = 1 ORDER BY is_dependent, first_name`
    )
    .all();
  const cuotas = db
    .prepare(
      `SELECT ms.member_id, ms.status, ms.cancel_at_period_end, p.name AS plan_name
       FROM memberships ms JOIN plans p ON p.id = ms.plan_id WHERE ms.status != 'cancelada'`
    )
    .all();
  const ultimaAsistencia = new Map(
    db.prepare("SELECT member_id, MAX(date) AS last FROM bookings WHERE status = 'asistio' GROUP BY member_id").all().map((r) => [r.member_id, r.last])
  );

  return cuentas.map((c) => ({
    ...c,
    members: miembros
      .filter((m) => m.account_id === c.id)
      .map((m) => ({
        ...m,
        has_medical_notes: !!m.has_medical_notes,
        memberships: cuotas.filter((q) => q.member_id === m.id),
        last_attendance: ultimaAsistencia.get(m.id) || null,
      })),
  }));
}

function getMemberDetail(memberId) {
  const m = db.prepare("SELECT * FROM members WHERE id = ?").get(memberId);
  if (!m) throw new AdminError("Alumno no encontrado.", 404);
  return {
    member: m,
    account: getAccount(m.account_id),
    memberships: db
      .prepare(
        `SELECT ms.id, ms.status, ms.payment_method, ms.price_cents, ms.current_period_end, ms.paused_until, ms.cancel_at_period_end,
                ms.created_at, p.name AS plan_name
         FROM memberships ms JOIN plans p ON p.id = ms.plan_id WHERE ms.member_id = ? ORDER BY ms.status = 'cancelada', ms.created_at DESC`
      )
      .all(memberId),
    recent_bookings: db
      .prepare(
        `SELECT b.date, b.status, b.is_trial, cs.start_time, COALESCE(cs.name, g.name) AS class_name
         FROM bookings b JOIN class_schedule cs ON cs.id = b.class_schedule_id JOIN groups g ON g.id = cs.group_id
         WHERE b.member_id = ? ORDER BY b.date DESC, cs.start_time DESC LIMIT 12`
      )
      .all(memberId),
    gradings: db
      .prepare(
        `SELECT gr.grade_name, gr.awarded_at, gr.notes, d.name AS discipline_name
         FROM gradings gr JOIN disciplines d ON d.id = gr.discipline_id WHERE gr.member_id = ? ORDER BY gr.awarded_at DESC`
      )
      .all(memberId),
  };
}

// ===========================================================================
// RESUMEN DEL DÍA
// ===========================================================================
function getSummary() {
  const hoy = todayStr();
  const dia = new Date(hoy + "T12:00:00").getDay();
  const contar = (sql, ...p) => db.prepare(sql).get(...p).n;

  const clasesHoy = db.prepare(`${SQL_CLASE} WHERE cs.active = 1 AND cs.day_of_week = ? ORDER BY cs.start_time`).all(dia).map((c) => {
    const estados = Object.fromEntries(
      db.prepare("SELECT status, COUNT(*) AS n FROM bookings WHERE class_schedule_id = ? AND date = ? GROUP BY status").all(c.id, hoy).map((r) => [r.status, r.n])
    );
    const cancelada = db.prepare("SELECT reason FROM class_cancellations WHERE class_schedule_id = ? AND date = ?").get(c.id, hoy);
    return {
      id: c.id, name: c.name || c.group_name, discipline_name: c.discipline_name, instructor_name: c.instructor_name,
      start_time: c.start_time, end_time: c.end_time, capacity: c.capacity,
      booked: (estados.reservada || 0) + (estados.asistio || 0), attended: estados.asistio || 0, waitlist: estados.en_espera || 0,
      cancelled: !!cancelada, cancel_reason: cancelada ? cancelada.reason : null,
    };
  });

  return {
    date: hoy,
    classes_today: clasesHoy,
    families: contar("SELECT COUNT(*) AS n FROM accounts WHERE role = 'member' AND active = 1"),
    new_families_30d: contar("SELECT COUNT(*) AS n FROM accounts WHERE role = 'member' AND created_at >= datetime('now', '-30 days')"),
    students_with_membership: contar("SELECT COUNT(DISTINCT member_id) AS n FROM memberships WHERE status = 'activa'"),
    memberships_unpaid: contar("SELECT COUNT(*) AS n FROM memberships WHERE status = 'impagada'"),
    memberships_pending: contar("SELECT COUNT(*) AS n FROM memberships WHERE status = 'pendiente_pago'"),
    team_active: contar("SELECT COUNT(*) AS n FROM accounts WHERE role IN ('instructor', 'admin') AND active = 1"),
    upcoming_cancellations: listCancellations(hoy, addDays(hoy, 14)),
  };
}

// ===========================================================================
// DATOS DE LA ACADEMIA, PRIVACIDAD Y EMAILS
// ===========================================================================
function getAcademy() {
  const version = Number(getSetting("privacy_version", "1")) || 1;
  return {
    academy_name: getSetting("academy_name", ""),
    academy_contact_email: getSetting("academy_contact_email", ""),
    // Lo que se ve en la portada (todo opcional).
    academy_tagline: getSetting("academy_tagline", ""),
    academy_about: getSetting("academy_about", ""),
    academy_address: getSetting("academy_address", ""),
    academy_phone: getSetting("academy_phone", ""),
    privacy_text: getSetting("privacy_text", ""),
    privacy_version: version,
    privacy_updated_at: getSetting("privacy_updated_at", "") || null,
    // Cuentas (activas) que todavía no han aceptado la versión vigente.
    privacy_pending_accounts: db
      .prepare("SELECT COUNT(*) AS n FROM accounts WHERE active = 1 AND privacy_version_accepted < ?")
      .get(version).n,
    email_mode: modoEmail(),
    email_from: modoEmail() === "brevo" ? process.env.EMAIL_FROM : null,
  };
}

// Los textos de la portada son opcionales: si no se envían, se quedan como
// estaban (así una versión antigua del panel no los borra al guardar).
const TEXTOS_PORTADA = [
  ["academy_tagline", "El lema", 120],
  ["academy_about", "La presentación", 1200],
  ["academy_address", "La dirección", 160],
  ["academy_phone", "El teléfono", 30],
];

function updateAcademy(datos) {
  const nombre = textoObligatorio(datos.academy_name, "El nombre de la academia", 80);
  const contacto = String(datos.academy_contact_email ?? "").trim();
  const email = contacto ? emailValido(contacto) : "";
  // Primero se valida todo y después se guarda: o se guarda todo, o nada.
  const portada = TEXTOS_PORTADA.filter(([clave]) => datos[clave] !== undefined).map(([clave, campo, max]) => [
    clave,
    textoOpcional(datos[clave], campo, max) || "",
  ]);
  setSetting("academy_name", nombre);
  setSetting("academy_contact_email", email);
  portada.forEach(([clave, valor]) => setSetting(clave, valor));
  return getAcademy();
}

// Guardar el aviso de privacidad. Con new_version = true se publica como
// versión NUEVA y todas las cuentas tendrán que volver a aceptarlo al entrar
// (para cambios de contenido). Sin ella, solo se corrige el texto (erratas).
function updatePrivacy({ text, new_version }) {
  const t = String(text ?? "").trim();
  if (t.length < 50) throw new AdminError("El aviso de privacidad es demasiado corto.");
  if (t.length > 30000) throw new AdminError("El aviso de privacidad es demasiado largo (máximo 30.000 caracteres).");
  setSetting("privacy_text", t);
  if (new_version) {
    setSetting("privacy_version", String((Number(getSetting("privacy_version", "1")) || 1) + 1));
    setSetting("privacy_updated_at", todayStr());
  }
  return getAcademy();
}

// Registro de emails. En modo local incluye el contenido (la bandeja de
// pruebas); con un proveedor real, el contenido no se guarda.
function listEmails() {
  return {
    mode: modoEmail(),
    emails: db
      .prepare("SELECT id, to_email, subject, kind, status, error, body_text, created_at FROM email_log ORDER BY id DESC LIMIT 100")
      .all(),
  };
}

async function sendTestEmail(adminAccountId) {
  const a = getAccount(adminAccountId);
  await emailPrueba(a.email);
  const ultimo = db.prepare("SELECT status, error FROM email_log WHERE to_email = ? AND kind = 'prueba' ORDER BY id DESC LIMIT 1").get(a.email);
  if (ultimo && ultimo.status === "error") throw new AdminError(`No se ha podido enviar: ${ultimo.error}`, 502);
  return { to: a.email, status: ultimo ? ultimo.status : "local" };
}

module.exports = {
  AdminError,
  // academia, privacidad y emails
  getAcademy, updateAcademy, updatePrivacy, listEmails, sendTestEmail,
  // disciplinas y grupos
  listDisciplines, createDiscipline, updateDiscipline, setDisciplineActive, deleteDiscipline,
  createGroup, updateGroup, setGroupActive, deleteGroup,
  // horario
  listClasses, getClass, createClass, updateClass, setClassActive, deleteClass,
  cancelSession, restoreSession, listCancellations,
  // equipo y cuentas
  listTeam, createStaff, updateAccount, setRole, setAccountActive, resetPassword,
  // alumnos y resumen
  listFamilies, getMemberDetail, getSummary,
};
