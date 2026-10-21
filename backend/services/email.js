// services/email.js
//
// Envío de emails. Dos modos:
//
//  - "local" (por defecto, sin configurar nada): NO se envía nada. Cada email
//    se guarda en la base de datos y se puede leer en Administración → Emails.
//    Sirve para probar y enseñar la app en local sin cuenta de email.
//  - "brevo" (EMAIL_PROVIDER=brevo + BREVO_API_KEY + EMAIL_FROM en el .env):
//    se envía de verdad por la API de Brevo. El contenido NO se guarda (puede
//    llevar enlaces de un solo uso), solo a quién, el asunto y si salió bien.
//
// Enviar un email nunca hace fallar la acción que lo provoca: si falla, se
// registra el error y la cancelación, el cambio de contraseña, etc. se hacen
// igualmente.
const db = require("../db/database");
const { getSetting } = require("./settings");

const enCurso = new Set();

function modoEmail() {
  return process.env.EMAIL_PROVIDER === "brevo" && process.env.BREVO_API_KEY && process.env.EMAIL_FROM ? "brevo" : "local";
}
function urlApp() {
  return (process.env.FRONTEND_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, "");
}
function nombreAcademia() {
  return getSetting("academy_name", "La academia") || "La academia";
}

const escHtml = (t) =>
  String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Plantilla sencilla, pensada para verse bien en cualquier cliente de correo
// (tablas y estilos en línea, sin imágenes externas).
function construir({ titulo, parrafos, boton }) {
  const academia = nombreAcademia();
  const texto = [titulo, "", ...parrafos, ...(boton ? ["", `${boton.texto}: ${boton.url}`] : []), "", `— ${academia}`].join("\n");
  const html = `<!DOCTYPE html><html lang="es"><body style="margin:0;background:#F6F5F3;font-family:Arial,Helvetica,sans-serif;color:#17181B;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F5F3;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid #E2E0DB;border-radius:10px;">
<tr><td style="padding:22px 26px 6px;font-size:13px;font-weight:bold;color:#A2201A;">${escHtml(academia)}</td></tr>
<tr><td style="padding:4px 26px 0;font-size:20px;font-weight:bold;">${escHtml(titulo)}</td></tr>
${parrafos.map((p) => `<tr><td style="padding:12px 26px 0;font-size:15px;line-height:1.5;">${escHtml(p)}</td></tr>`).join("")}
${
  boton
    ? `<tr><td style="padding:20px 26px 4px;"><a href="${escHtml(boton.url)}" style="display:inline-block;background:#A2201A;color:#FFFFFF;text-decoration:none;font-weight:bold;padding:11px 20px;border-radius:5px;">${escHtml(boton.texto)}</a></td></tr>
<tr><td style="padding:8px 26px 0;font-size:12px;color:#5A5D63;">Si el botón no funciona, copia esta dirección en el navegador:<br>${escHtml(boton.url)}</td></tr>`
    : ""
}
<tr><td style="padding:22px 26px 22px;font-size:12px;color:#94969C;">Este email lo envía ${escHtml(academia)} desde su aplicación de reservas.</td></tr>
</table></td></tr></table></body></html>`;
  return { texto, html };
}

async function enviarBrevo({ to, toName, subject, html, texto }) {
  const contacto = getSetting("academy_contact_email", "");
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      sender: { email: process.env.EMAIL_FROM, name: process.env.EMAIL_FROM_NAME || nombreAcademia() },
      to: [{ email: to, ...(toName ? { name: toName } : {}) }],
      ...(contacto ? { replyTo: { email: contacto } } : {}),
      subject,
      htmlContent: html,
      textContent: texto,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const detalle = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`Brevo respondió ${res.status}: ${detalle}`);
  }
}

function registrar({ to, subject, kind, status, error = null, texto = null }) {
  try {
    db.prepare("INSERT INTO email_log (to_email, subject, kind, status, error, body_text) VALUES (?, ?, ?, ?, ?, ?)")
      .run(to, subject, kind, status, error, texto);
  } catch (err) {
    console.error("No se ha podido registrar el email:", err.message);
  }
}

// Envía (o guarda en la bandeja local) un email. Nunca lanza errores.
function enviarEmail({ to, toName, subject, kind, titulo, parrafos, boton }) {
  const { texto, html } = construir({ titulo: titulo || subject, parrafos, boton });
  const tarea = (async () => {
    if (!to) return;
    if (modoEmail() === "local") {
      registrar({ to, subject, kind, status: "local", texto });
      return;
    }
    try {
      await enviarBrevo({ to, toName, subject, html, texto });
      registrar({ to, subject, kind, status: "enviado" });
    } catch (err) {
      console.error(`✉️  No se ha podido enviar «${subject}» a ${to}:`, err.message);
      registrar({ to, subject, kind, status: "error", error: err.message.slice(0, 400) });
    }
  })();
  enCurso.add(tarea);
  tarea.finally(() => enCurso.delete(tarea));
  return tarea;
}

// Para las pruebas: espera a que terminen los envíos pendientes.
function esperarEnvios() {
  return Promise.all([...enCurso]);
}

// ---------------------------------------------------------------------------
// Emails concretos
// ---------------------------------------------------------------------------
function emailRestablecer(cuenta, token) {
  return enviarEmail({
    to: cuenta.email, toName: cuenta.name, kind: "reset",
    subject: "Restablecer tu contraseña",
    parrafos: [
      `Hola, ${cuenta.name}. Hemos recibido una petición para restablecer la contraseña de tu cuenta.`,
      "El enlace sirve una sola vez y caduca en 1 hora. Si no lo has pedido tú, ignora este email: tu contraseña no cambia.",
    ],
    boton: { texto: "Elegir contraseña nueva", url: `${urlApp()}/restablecer.html?token=${token}` },
  });
}

// La academia ha cancelado reservas de esta familia (sesión cancelada o clase
// quitada del horario). Un email por familia, aunque afecte a varios hijos.
function emailReservasCanceladas(cuenta, { clase, fechas, motivo, miembros }) {
  const cuando = fechas.length === 1 ? `el ${fechas[0]}` : `los días ${fechas.join(", ")}`;
  return enviarEmail({
    to: cuenta.email, toName: cuenta.name, kind: "cancelacion",
    subject: `Clase cancelada: ${clase}`,
    parrafos: [
      `Hola, ${cuenta.name}. La academia ha cancelado «${clase}» ${cuando}${motivo ? ` (${motivo})` : ""}.`,
      `Se ha anulado la reserva de: ${miembros.join(", ")}.`,
      "Si quieres, puedes reservar otra clase desde el horario.",
    ],
    boton: { texto: "Ver el horario", url: `${urlApp()}/horario.html` },
  });
}

function emailCuotaVencida(cuenta, { plan, miembro }) {
  return enviarEmail({
    to: cuenta.email, toName: cuenta.name, kind: "cuota",
    subject: `Cuota pendiente de pago: ${plan}`,
    parrafos: [
      `Hola, ${cuenta.name}. La cuota «${plan}» de ${miembro} ha vencido y está pendiente de pago.`,
      "Mientras no se renueve no se podrán reservar clases con ella. Puedes pagarla en recepción.",
    ],
    boton: { texto: "Ver mis cuotas", url: `${urlApp()}/mis-cuotas.html` },
  });
}

function emailPagoFallido(cuenta, { urlPago }) {
  return enviarEmail({
    to: cuenta.email, toName: cuenta.name, kind: "cuota",
    subject: "No se ha podido cobrar tu cuota",
    parrafos: [
      `Hola, ${cuenta.name}. El banco no ha aceptado el último cobro de tu cuota.`,
      "Revisa la tarjeta o completa el pago para seguir reservando clases.",
    ],
    boton: urlPago ? { texto: "Completar el pago", url: urlPago } : { texto: "Ver mis cuotas", url: `${urlApp()}/mis-cuotas.html` },
  });
}

function emailPrueba(to) {
  return enviarEmail({
    to, kind: "prueba",
    subject: "Email de prueba",
    parrafos: ["Si lees esto, el envío de emails de la aplicación está bien configurado."],
    boton: { texto: "Abrir la aplicación", url: urlApp() },
  });
}

module.exports = {
  modoEmail, urlApp, enviarEmail, esperarEnvios,
  emailRestablecer, emailReservasCanceladas, emailCuotaVencida, emailPagoFallido, emailPrueba,
};
