// db/schema.js
//
// El modelo clave de todo el proyecto es la separación entre CUENTA y
// MIEMBRO:
//
//   accounts -> quien inicia sesión (un adulto, un instructor, o admin)
//   members  -> quien realmente entrena y se apunta a clases
//
// Una cuenta de tipo "member" (un adulto responsable) puede tener varios
// perfiles de miembro colgando de ella: él mismo (si también entrena) y sus
// hijos menores, que no tienen contraseña propia. Así una familia con tres
// hijos apuntados usa UNA sola cuenta para reservar, pagar y ver el
// progreso de todos, que es justo como funciona en la vida real.

function createTables(db) {
  // --- Cuentas (quien inicia sesión) ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('member', 'instructor', 'admin')) DEFAULT 'member',
      phone TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // --- Miembros (quien entrena de verdad) ---
  // is_dependent = 0 -> es la propia persona de la cuenta, que también entrena.
  // is_dependent = 1 -> es un hijo/a a su cargo, sin acceso propio a la app.
  //
  // emergency_contact y medical_notes son datos sensibles habituales en
  // cualquier academia (a quién avisar y qué alergias/lesiones hay que
  // conocer). Se guardan aquí porque son imprescindibles para dar el
  // servicio con seguridad, pero conviene recordar que es información
  // delicada: solo debe verla quien de verdad la necesita (el propio
  // titular de la cuenta y el equipo de la academia), nunca exponerse en
  // listados públicos ni en la app del alumno de otra familia.
  db.exec(`
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      birth_date TEXT,                    -- "YYYY-MM-DD"; determina si es menor
      is_dependent INTEGER NOT NULL DEFAULT 0,
      emergency_contact_name TEXT,
      emergency_contact_phone TEXT,
      medical_notes TEXT,                 -- alergias, lesiones a tener en cuenta, etc.
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts (id)
    );
  `);

  // --- Disciplinas ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS disciplines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE
    );
  `);

  // --- Grupos ---
  // Un mismo BJJ puede tener "Infantil 6-9 años", "Juvenil", "Adultos",
  // "Competición"... Cada grupo pertenece a una disciplina y puede acotar
  // una franja de edad orientativa (min_age/max_age, ambas opcionales).
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discipline_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      min_age INTEGER,
      max_age INTEGER,
      description TEXT,
      FOREIGN KEY (discipline_id) REFERENCES disciplines (id)
    );
  `);

  // --- Horario de clases (recurrente semanal) ---
  // Cada fila es UNA franja que se repite cada semana (ej: "Lunes 18:00-19:00,
  // BJJ Adultos, con Javier"). Las reservas concretas de cada día se guardan
  // aparte en `bookings`, referenciando esta plantilla + una fecha.
  db.exec(`
    CREATE TABLE IF NOT EXISTS class_schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      instructor_account_id INTEGER NOT NULL,
      name TEXT,                          -- opcional: "Clase de competición", etc.
      day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
      start_time TEXT NOT NULL,           -- "HH:MM"
      end_time TEXT NOT NULL,
      capacity INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (group_id) REFERENCES groups (id),
      FOREIGN KEY (instructor_account_id) REFERENCES accounts (id)
    );
  `);

  // --- Reservas ---
  // Ata un miembro concreto a UNA ocurrencia concreta de una clase (la
  // plantilla de class_schedule + una fecha real). "en_espera" es la lista
  // de espera cuando el aforo está completo.
  db.exec(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_schedule_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      date TEXT NOT NULL,                 -- "YYYY-MM-DD"
      status TEXT NOT NULL CHECK (status IN ('reservada', 'en_espera', 'cancelada', 'asistio')) DEFAULT 'reservada',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (class_schedule_id) REFERENCES class_schedule (id),
      FOREIGN KEY (member_id) REFERENCES members (id),
      -- Un mismo miembro no puede reservar dos veces la misma clase el mismo día.
      UNIQUE (class_schedule_id, member_id, date)
    );
  `);

  // --- Graduaciones ---
  // Cada disciplina tiene su propio sistema de grados; aquí solo guardamos
  // el nombre del grado como texto libre (p. ej. "Cinturón azul", "3er Kyu"),
  // porque cada arte marcial los nombra de forma distinta.
  db.exec(`
    CREATE TABLE IF NOT EXISTS gradings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      discipline_id INTEGER NOT NULL,
      grade_name TEXT NOT NULL,
      grade_order INTEGER NOT NULL DEFAULT 0, -- para poder ordenar de menor a mayor grado
      awarded_by_account_id INTEGER,
      awarded_at TEXT NOT NULL,               -- "YYYY-MM-DD"
      notes TEXT,
      FOREIGN KEY (member_id) REFERENCES members (id),
      FOREIGN KEY (discipline_id) REFERENCES disciplines (id),
      FOREIGN KEY (awarded_by_account_id) REFERENCES accounts (id)
    );
  `);

  // --- Migraciones ---
  // CREATE TABLE IF NOT EXISTS no modifica una tabla que ya existe, así que
  // las columnas añadidas después de la primera versión hay que
  // incorporarlas con ALTER TABLE. Si la columna ya está (base de datos
  // creada desde cero con el esquema actual), SQLite da error y lo ignoramos.
  const migraciones = [
    "ALTER TABLE members ADD COLUMN avatar_file TEXT",
    "ALTER TABLE members ADD COLUMN bio TEXT",
    // Panel de administración:
    // - una cuenta desactivada no puede iniciar sesión (ni usar una sesión abierta);
    "ALTER TABLE accounts ADD COLUMN active INTEGER NOT NULL DEFAULT 1",
    // - tras una contraseña temporal dada por la academia, se pide cambiarla;
    "ALTER TABLE accounts ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0",
    // - disciplinas y grupos se ARCHIVAN en vez de borrarse, para no perder
    //   el historial de clases y reservas que cuelga de ellos;
    "ALTER TABLE disciplines ADD COLUMN active INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE groups ADD COLUMN active INTEGER NOT NULL DEFAULT 1",
    // - cuando es la academia quien cancela una reserva (clase quitada del
    //   horario, sesión cancelada por festivo...), la familia ve el motivo.
    "ALTER TABLE bookings ADD COLUMN cancel_note TEXT",
    // Privacidad: qué versión del aviso aceptó cada cuenta, y cuándo. Si la
    // academia publica una versión nueva, se vuelve a pedir la aceptación.
    "ALTER TABLE accounts ADD COLUMN privacy_version_accepted INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE accounts ADD COLUMN privacy_accepted_at TEXT",
    // Seguridad: cada sesión lleva la "versión" de la cuenta. Al cambiar o
    // restablecer la contraseña se sube, y todas las sesiones anteriores
    // (por ejemplo, una que se quedó abierta en otro móvil) dejan de valer.
    "ALTER TABLE accounts ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0",
    // Aspecto: color de cinturón de cada disciplina (ver utils/cinturones.js)
    // y una descripción para su página pública.
    "ALTER TABLE disciplines ADD COLUMN color TEXT",
    "ALTER TABLE disciplines ADD COLUMN description TEXT",
  ];
  migraciones.forEach((sql) => {
    try {
      db.exec(sql);
    } catch (err) {
      if (!String(err.message).includes("duplicate column")) throw err;
    }
  });

  // --- Sesiones canceladas ---
  // Una clase del horario se repite cada semana; esta tabla anula UNA fecha
  // concreta (festivo, instructor enfermo...) sin tocar el resto de semanas.
  db.exec(`
    CREATE TABLE IF NOT EXISTS class_cancellations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_schedule_id INTEGER NOT NULL,
      date TEXT NOT NULL,                 -- "YYYY-MM-DD"
      reason TEXT,
      created_by_account_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (class_schedule_id) REFERENCES class_schedule (id),
      FOREIGN KEY (created_by_account_id) REFERENCES accounts (id),
      UNIQUE (class_schedule_id, date)
    );
  `);

  // --- Enlaces para restablecer la contraseña ---
  // Nunca se guarda el enlace en sí, solo su huella (SHA-256): aunque alguien
  // leyera la base de datos, no podría usar los enlaces pendientes.
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,          -- datetime('now') + 1 hora
      used_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts (id)
    );
  `);

  // --- Registro de emails ---
  // Qué se ha enviado, a quién y si ha llegado al proveedor. En modo local
  // (sin proveedor configurado) también se guarda el contenido, para verlo en
  // la bandeja de pruebas del panel; con un proveedor real, NO se guarda el
  // contenido (puede incluir enlaces de un solo uso).
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      kind TEXT NOT NULL,                -- 'reset', 'cancelacion', 'cuota', 'prueba'...
      status TEXT NOT NULL,              -- 'local' | 'enviado' | 'error'
      error TEXT,
      body_text TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

module.exports = { createTables };
