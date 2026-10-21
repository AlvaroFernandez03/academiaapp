// db/seed-app.js
// Ajustes generales de la academia (nombre, contacto, aviso de privacidad).
// Como los de cuotas, solo se insertan si faltan: nunca pisan lo que la
// academia haya cambiado.

// Texto PROVISIONAL del aviso de privacidad. Describe, con hechos, qué datos
// guarda la app y para qué. NO es un texto legal revisado: la academia tiene
// que completarlo (entre corchetes) y revisarlo con alguien con competencia
// en protección de datos antes de usar la app con alumnos reales. Se edita
// desde Administración → Academia, sin tocar código.
const PRIVACIDAD_PROVISIONAL = `# Aviso de privacidad

**TEXTO PROVISIONAL.** La academia debe completar los datos entre corchetes y revisar este texto con asesoramiento en protección de datos antes de usar la app con alumnos reales.

## Quién trata tus datos
[NOMBRE DE LA ACADEMIA], con [NIF/CIF], domicilio en [DIRECCIÓN] y email de contacto [EMAIL]. Es la responsable de los datos que se recogen en esta aplicación.

## Qué datos guardamos
- De la persona titular de la cuenta: nombre, email, teléfono y contraseña (cifrada: nadie de la academia puede verla).
- De cada persona que entrena (también menores a cargo de la persona titular): nombre, apellidos, fecha de nacimiento, foto de perfil (opcional), una breve descripción (opcional), contacto de emergencia y, si se indican, alergias o notas médicas relevantes para la práctica deportiva.
- Actividad en la academia: reservas de clases, asistencia, graduaciones, cuotas contratadas y pagos.
- Si se paga con tarjeta, los datos de la tarjeta los gestiona directamente el proveedor de pagos; la academia no los ve ni los guarda.

## Para qué los usamos
- Gestionar las reservas, la asistencia y el aforo de las clases.
- Gestionar las cuotas y los pagos.
- Actuar con seguridad en clase: el contacto de emergencia y las notas médicas los ve el personal de la academia (instructores al pasar lista y administración).
- Enviarte avisos sobre tu cuenta y tus clases (por ejemplo, una clase cancelada o una cuota vencida).
[COMPLETAR: base legal de cada tratamiento.]

## Con quién se comparten
No se venden ni se ceden a terceros. Para prestar el servicio se usan estos proveedores, que solo tratan los datos por encargo de la academia: [COMPLETAR según lo que se active: alojamiento del servidor, envío de emails, pagos con tarjeta].

## Cuánto tiempo se guardan
[COMPLETAR: plazos de conservación, por ejemplo mientras la persona sea alumna y el tiempo que exijan las obligaciones legales y contables.]

## Tus derechos
Puedes pedir acceder a tus datos, corregirlos, eliminarlos, limitar su uso u oponerte, y la portabilidad, escribiendo a [EMAIL]. También puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es).

## Menores de edad
Las cuentas las crea y gestiona siempre una persona adulta responsable, que es quien añade a los menores a su cargo y acepta este aviso en su nombre.`;

const AJUSTES_GENERALES = {
  // ACADEMY_NAME (opcional) da el nombre la primera vez que se crea la base
  // de datos; después se cambia en Administración → Academia.
  academy_name: process.env.ACADEMY_NAME || "La academia",
  academy_contact_email: "",
  privacy_text: PRIVACIDAD_PROVISIONAL,
  privacy_version: "1",
  privacy_updated_at: "",
};

// Textos de ejemplo para la portada y las páginas de disciplina. Solo se
// usan con los datos de ejemplo (SEED_DEMO_DATA distinto de 0), para que la
// demostración no se vea vacía. En la instalación real los escribe la
// academia en Administración → Academia y → Disciplinas y grupos.
const PRESENTACION_EJEMPLO =
  "Entrenamos artes marciales para adultos y para niños desde los 5 años, cada uno en su grupo de edad y nivel. " +
  "Da igual si nunca has pisado un tatami o si compites: aquí se aprende con técnica, respeto y buen ambiente. " +
  "Ven a probar una clase y conoce al equipo.";

const DESCRIPCIONES_EJEMPLO = {
  bjj: "Arte marcial de suelo: controlar, barrer y terminar el combate con palancas y estrangulaciones, usando la técnica y no la fuerza. Se progresa por cinturones, del blanco al negro.",
  mma: "Artes marciales mixtas: golpeo de pie, derribos y lucha en el suelo en el mismo entrenamiento. Sparring siempre controlado y adaptado a cada nivel.",
  kickboxing: "Golpeo con puños y piernas, trabajo de manoplas y saco, y mucha preparación física. Para aprender a defenderse y ponerse en forma.",
  judo: "Proyecciones, caídas seguras e inmovilizaciones. Ideal para empezar desde pequeños: enseña equilibrio, respeto y a caer sin hacerse daño.",
};

function seedApp(db, { demo = true } = {}) {
  const insertar = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  Object.entries(AJUSTES_GENERALES).forEach(([k, v]) => insertar.run(k, v));

  // Solo en la academia de ejemplo, y UNA sola vez (si luego se borra un
  // texto a propósito, no vuelve a aparecer). Nunca pisa lo ya escrito.
  if (!demo || !db.prepare("SELECT 1 FROM accounts WHERE email = 'carlos@ejemplo.com'").get()) return;
  if (insertar.run("demo_portada_rellenada", "1").changes === 0) return;
  insertar.run("academy_about", PRESENTACION_EJEMPLO);
  const describir = db.prepare("UPDATE disciplines SET description = ? WHERE slug = ? AND (description IS NULL OR description = '')");
  Object.entries(DESCRIPCIONES_EJEMPLO).forEach(([slug, texto]) => describir.run(texto, slug));
}

module.exports = { seedApp, PRIVACIDAD_PROVISIONAL };
