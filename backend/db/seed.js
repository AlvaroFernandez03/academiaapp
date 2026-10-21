// db/seed.js
const bcrypt = require("bcryptjs");

function seed(db, { demo = true } = {}) {
  // Con SEED_DEMO_DATA=0 la academia arranca vacía (instalación real): sin
  // disciplinas, clases ni cuentas de ejemplo. Ver database.js.
  if (!demo) return;
  const existing = db.prepare("SELECT COUNT(*) AS c FROM disciplines").get().c;
  if (existing > 0) return;

  const pass = bcrypt.hashSync("academia123", 10);

  const insertAccount = db.prepare(
    "INSERT INTO accounts (name, email, password_hash, role, phone) VALUES (?, ?, ?, ?, ?)"
  );
  const insertMember = db.prepare(`
    INSERT INTO members (account_id, first_name, last_name, birth_date, is_dependent, emergency_contact_name, emergency_contact_phone, medical_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertDiscipline = db.prepare("INSERT INTO disciplines (name, slug) VALUES (?, ?)");
  const insertGroup = db.prepare("INSERT INTO groups (discipline_id, name, min_age, max_age, description) VALUES (?, ?, ?, ?, ?)");
  const insertClass = db.prepare(`
    INSERT INTO class_schedule (group_id, instructor_account_id, name, day_of_week, start_time, end_time, capacity)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertGrading = db.prepare(`
    INSERT INTO gradings (member_id, discipline_id, grade_name, grade_order, awarded_by_account_id, awarded_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // --- Cuenta de administración ---
  insertAccount.run("Dirección Academia", "admin@academia.com", pass, "admin", null);

  // --- Instructores ---
  const instrJavier = insertAccount.run("Javier Roldán", "javier.instructor@academia.com", pass, "instructor", "600100200").lastInsertRowid;
  const instrMarta = insertAccount.run("Marta Cifuentes", "marta.instructor@academia.com", pass, "instructor", "600100201").lastInsertRowid;
  const instrDiego = insertAccount.run("Diego Salvador", "diego.instructor@academia.com", pass, "instructor", "600100202").lastInsertRowid;

  // --- Disciplinas ---
  const bjj = insertDiscipline.run("Brazilian Jiu-Jitsu", "bjj").lastInsertRowid;
  const mma = insertDiscipline.run("MMA", "mma").lastInsertRowid;
  const kick = insertDiscipline.run("Kickboxing", "kickboxing").lastInsertRowid;
  const judo = insertDiscipline.run("Judo", "judo").lastInsertRowid;

  // --- Grupos ---
  const bjjInfantil = insertGroup.run(bjj, "BJJ Infantil", 6, 12, "Iniciación al Jiu-Jitsu para niños y niñas.").lastInsertRowid;
  const bjjAdultos = insertGroup.run(bjj, "BJJ Adultos", 16, null, "Nivel general, todos los grados.").lastInsertRowid;
  const bjjCompeticion = insertGroup.run(bjj, "BJJ Competición", 16, null, "Entrenamiento de alta intensidad para competidores.").lastInsertRowid;
  const mmaAdultos = insertGroup.run(mma, "MMA Adultos", 16, null, "Striking y grappling combinados.").lastInsertRowid;
  const kickAdultos = insertGroup.run(kick, "Kickboxing Adultos", 14, null, "Técnica y sparring controlado.").lastInsertRowid;
  const kickInfantil = insertGroup.run(kick, "Kickboxing Infantil", 6, 13, "Iniciación con enfoque en disciplina y técnica.").lastInsertRowid;
  const judoInfantil = insertGroup.run(judo, "Judo Infantil", 5, 12, "Judo tradicional para los más pequeños.").lastInsertRowid;
  const judoAdultos = insertGroup.run(judo, "Judo Adultos", 14, null, "Nivel general.").lastInsertRowid;

  // --- Horario semanal ---
  // day_of_week: 0=domingo ... 6=sábado
  insertClass.run(bjjInfantil, instrMarta, "BJJ Infantil", 1, "17:30", "18:30", 16);
  insertClass.run(bjjInfantil, instrMarta, "BJJ Infantil", 3, "17:30", "18:30", 16);
  insertClass.run(bjjAdultos, instrJavier, "BJJ Adultos", 1, "19:00", "20:30", 24);
  insertClass.run(bjjAdultos, instrJavier, "BJJ Adultos", 3, "19:00", "20:30", 24);
  insertClass.run(bjjAdultos, instrJavier, "BJJ Adultos", 5, "18:00", "19:30", 24);
  insertClass.run(bjjCompeticion, instrJavier, "BJJ Competición", 2, "20:30", "22:00", 12);
  insertClass.run(bjjCompeticion, instrJavier, "BJJ Competición", 4, "20:30", "22:00", 12);
  insertClass.run(mmaAdultos, instrDiego, "MMA Adultos", 2, "19:00", "20:30", 18);
  insertClass.run(mmaAdultos, instrDiego, "MMA Adultos", 4, "19:00", "20:30", 18);
  insertClass.run(kickAdultos, instrDiego, "Kickboxing Adultos", 1, "20:30", "21:30", 20);
  insertClass.run(kickAdultos, instrDiego, "Kickboxing Adultos", 3, "20:30", "21:30", 20);
  insertClass.run(kickInfantil, instrDiego, "Kickboxing Infantil", 6, "11:00", "12:00", 14);
  insertClass.run(judoInfantil, instrMarta, "Judo Infantil", 2, "17:30", "18:30", 16);
  insertClass.run(judoInfantil, instrMarta, "Judo Infantil", 4, "17:30", "18:30", 16);
  insertClass.run(judoAdultos, instrMarta, "Judo Adultos", 2, "18:45", "20:00", 20);
  insertClass.run(judoAdultos, instrMarta, "Judo Adultos", 6, "10:00", "11:15", 20);

  // --- Cuentas de ejemplo: un adulto que entrena solo, y una familia con hijos ---
  const cuentaAdulto = insertAccount.run("Carlos Medina", "carlos@ejemplo.com", pass, "member", "611222333").lastInsertRowid;
  insertMember.run(cuentaAdulto, "Carlos", "Medina", "1990-04-12", 0, "Ana Medina", "622333444", null);

  const cuentaFamilia = insertAccount.run("Beatriz Núñez", "beatriz@ejemplo.com", pass, "member", "611333444").lastInsertRowid;
  // Beatriz también entrena ella misma...
  const memBeatriz = insertMember.run(cuentaFamilia, "Beatriz", "Núñez", "1985-09-03", 0, "Pedro Núñez", "622444555", null).lastInsertRowid;
  // ...y tiene dos hijos apuntados, sin login propio.
  const memHijo1 = insertMember.run(cuentaFamilia, "Mateo", "Núñez", "2016-02-20", 1, "Beatriz Núñez", "611333444", "Alergia leve a frutos secos.").lastInsertRowid;
  const memHijo2 = insertMember.run(cuentaFamilia, "Sofía", "Núñez", "2018-07-11", 1, "Beatriz Núñez", "611333444", null).lastInsertRowid;

  // --- Algunas graduaciones de ejemplo ---
  insertGrading.run(memBeatriz, judo, "Cinturón naranja", 3, instrMarta, "2025-11-15", null);
  insertGrading.run(memHijo1, kick, "Cinturón amarillo", 1, instrDiego, "2026-03-02", "Buena progresión en la técnica de guardia.");
  const memCarlos = db.prepare("SELECT id FROM members WHERE account_id=?").get(cuentaAdulto).id;
  insertGrading.run(memCarlos, bjj, "Cinturón azul", 2, instrJavier, "2025-06-20", null);

  // Las cuentas de ejemplo son ficticias: se dan por aceptado el aviso de
  // privacidad para que la demostración no lo pida en cada cuenta. Las
  // cuentas reales lo aceptan al registrarse (o al entrar, si ya existían).
  db.prepare("UPDATE accounts SET privacy_version_accepted = 1, privacy_accepted_at = datetime('now')").run();

  console.log("✅ Academia de ejemplo creada.");
  console.log("   Contraseña de TODAS las cuentas de ejemplo: academia123");
  console.log("   admin@academia.com (administración)");
  console.log("   javier.instructor@academia.com, marta.instructor@academia.com, diego.instructor@academia.com (instructores)");
  console.log("   carlos@ejemplo.com (adulto que entrena solo)");
  console.log("   beatriz@ejemplo.com (cuenta familiar: ella + 2 hijos apuntados)");
}

module.exports = { seed };
