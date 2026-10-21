// js/admin-academia.js — pestañas "Academia" (datos, aviso de privacidad y
// copias de seguridad) y "Emails" (registro y bandeja de pruebas) del panel.
// Usa las utilidades de admin.js (contenido, aviso, abrirModal, alPulsar...).

// Fechas que vienen del servidor: "2026-09-28 10:15:00" (SQLite, en UTC) o
// ISO completo. Se enseñan en la hora de quien mira.
function fechaHora(valor) {
  if (!valor) return "—";
  const s = String(valor);
  const d = new Date(/[TZ]/.test(s) ? s : s.replace(" ", "T") + "Z");
  if (isNaN(d)) return s;
  return d.toLocaleString("es-ES", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function tamano(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ===========================================================================
// ACADEMIA
// ===========================================================================
let academiaCache = null;

async function cargarAcademia() {
  contenido(CARGANDO);
  try {
    academiaCache = await api("/admin/academy");
  } catch (err) {
    contenido(errorHtml(err));
    return;
  }
  const a = academiaCache;
  contenido(`
    <div class="admin-bloque">
      <h2>Datos de la academia</h2>
      <p class="muted">Aparecen en la portada, en los emails y en el aviso de privacidad. Las respuestas a los emails de la app llegan al email de contacto. Lo que dejes vacío no se muestra.</p>
      <div class="form-grid">
        <div class="field"><label for="ac-nombre">Nombre</label><input id="ac-nombre" maxlength="80" value="${esc(a.academy_name)}"></div>
        <div class="field"><label for="ac-email">Email de contacto</label><input id="ac-email" type="email" value="${esc(a.academy_contact_email)}" placeholder="recepcion@…"></div>
        <div class="field"><label for="ac-tel">Teléfono</label><input id="ac-tel" maxlength="30" value="${esc(a.academy_phone || "")}" placeholder="600 000 000"></div>
        <div class="field"><label for="ac-dir">Dirección</label><input id="ac-dir" maxlength="160" value="${esc(a.academy_address || "")}" placeholder="Calle, número, ciudad"></div>
      </div>
      <h3 class="admin-subtitulo">Portada</h3>
      <div class="field"><label for="ac-lema">Lema (debajo del nombre)</label><input id="ac-lema" maxlength="120" value="${esc(a.academy_tagline || "")}" placeholder="Si lo dejas vacío, se escriben las disciplinas y desde qué edad"></div>
      <div class="field"><label for="ac-pres">Presentación</label><textarea id="ac-pres" rows="4" maxlength="1200" placeholder="Quiénes sois, cómo son las clases, a quién van dirigidas…">${esc(a.academy_about || "")}</textarea></div>
      <p class="muted" style="font-size:0.84rem; margin:-4px 0 14px;">Las disciplinas, el horario, el equipo y las cuotas de la portada salen solos de lo que hay en la app. La descripción de cada disciplina se escribe en «Disciplinas y grupos».</p>
      <div class="row-actions">
        <button class="btn btn-primary btn-sm" id="ac-guardar">Guardar datos</button>
        <a class="btn btn-outline btn-sm" href="index.html" target="_blank" rel="noopener">Ver la portada</a>
      </div>
      <p id="ac-msg" class="form-message"></p>
    </div>

    <div class="admin-bloque">
      <h2>Aviso de privacidad</h2>
      <p class="muted">
        Versión ${a.privacy_version}${a.privacy_updated_at ? ` · publicada el ${formatFecha(a.privacy_updated_at)}` : ""} ·
        ${a.privacy_pending_accounts
          ? `<strong>${a.privacy_pending_accounts} ${a.privacy_pending_accounts === 1 ? "cuenta no lo ha aceptado" : "cuentas no lo han aceptado"} todavía</strong> (se les pedirá al entrar)`
          : "todas las cuentas activas lo han aceptado"}
        · <a href="privacidad.html" target="_blank" rel="noopener">Ver la página pública</a>
      </p>
      ${/TEXTO PROVISIONAL|\[[^\]]+\]/.test(a.privacy_text)
        ? `<div class="notice warn">El texto actual es un <strong>borrador provisional</strong>: completa los datos entre [corchetes] y revísalo con vuestra gestoría o asesoría antes de usar la app con familias reales.</div>`
        : ""}
      <p class="muted" style="font-size:0.84rem;">Formato: una línea que empiece por <code># </code> es el título, <code>## </code> un apartado, <code>- </code> un punto de lista y <code>**texto**</code> va en negrita. Deja una línea en blanco entre párrafos.</p>
      <div class="field"><textarea id="pv-texto" class="editor-texto" rows="18" spellcheck="true">${esc(a.privacy_text)}</textarea></div>
      <div class="row-actions">
        <button class="btn btn-outline btn-sm" id="pv-vista">Vista previa</button>
        <button class="btn btn-outline btn-sm" id="pv-erratas" title="Guarda el texto sin pedir a las familias que lo vuelvan a aceptar">Guardar corrección de erratas</button>
        <button class="btn btn-primary btn-sm" id="pv-publicar">Publicar nueva versión…</button>
      </div>
      <p id="pv-msg" class="form-message"></p>
      <div id="pv-previa" class="texto-legal previa hidden"></div>
    </div>

    <div class="admin-bloque">
      <h2>Copias de seguridad</h2>
      <p class="muted">La app hace una copia de toda la base de datos cada día y guarda las más recientes. Esas copias están en el mismo ordenador que la app: <strong>descarga una de vez en cuando</strong> y guárdala en otro sitio (un disco externo, la nube de la academia). Las fotos de perfil se copian junto a ellas en el servidor.</p>
      <div class="toolbar"><button class="btn btn-primary btn-sm" id="bk-ahora">Hacer copia ahora</button></div>
      <div id="bk-lista">${CARGANDO}</div>
    </div>`);

  alPulsar("ac-guardar", "ac-msg", async (msg) => {
    academiaCache = await api("/admin/academy", {
      method: "PUT",
      body: JSON.stringify({
        academy_name: valor("ac-nombre"), academy_contact_email: valor("ac-email"),
        academy_phone: valor("ac-tel"), academy_address: valor("ac-dir"),
        academy_tagline: valor("ac-lema"), academy_about: valor("ac-pres"),
      }),
    });
    msg.textContent = "Datos guardados."; msg.classList.add("success");
  });

  document.getElementById("pv-vista").addEventListener("click", () => {
    const previa = document.getElementById("pv-previa");
    const abrir = previa.classList.contains("hidden");
    previa.innerHTML = abrir ? textoConFormato(valor("pv-texto")) : "";
    previa.classList.toggle("hidden", !abrir);
    document.getElementById("pv-vista").textContent = abrir ? "Ocultar vista previa" : "Vista previa";
  });
  alPulsar("pv-erratas", "pv-msg", async (msg) => {
    academiaCache = await api("/admin/privacy", { method: "PUT", body: JSON.stringify({ text: valor("pv-texto"), new_version: false }) });
    msg.textContent = "Texto guardado. Es la misma versión: no se pide a nadie que lo vuelva a aceptar."; msg.classList.add("success");
  });
  document.getElementById("pv-publicar").addEventListener("click", confirmarNuevaVersion);

  document.getElementById("bk-ahora").addEventListener("click", async (e) => {
    e.target.disabled = true;
    await ejecutar(() => api("/admin/backups", { method: "POST" }),
      (r) => `Copia hecha: ${r.name} (${tamano(r.size)}).`, pintarCopias);
    e.target.disabled = false;
  });
  await pintarCopias();
}

function confirmarNuevaVersion() {
  abrirModal(`
    <h3 style="margin-bottom:8px;">Publicar una nueva versión</h3>
    <p style="margin-bottom:10px;">Úsalo cuando cambie algo importante: qué datos se recogen, para qué, con quién se comparten o cuánto tiempo se guardan.</p>
    <p class="muted" style="margin-bottom:16px;">Todas las familias y el equipo tendrán que leerlo y aceptarlo la próxima vez que entren en la app. Para corregir una errata no hace falta: usa «Guardar corrección de erratas».</p>
    <button class="btn btn-primary" id="pv-confirmar">Publicar versión ${academiaCache.privacy_version + 1}</button>
    <button class="btn btn-outline" data-cerrar style="margin-left:8px;">Cancelar</button>
    <p id="pv-modal-msg" class="form-message"></p>`);
  alPulsar("pv-confirmar", "pv-modal-msg", async () => {
    const texto = document.getElementById("pv-texto").value;
    await api("/admin/privacy", { method: "PUT", body: JSON.stringify({ text: texto, new_version: true }) });
    cerrarModal();
    // Quien publica lo acepta a la vez (acaba de redactarlo).
    await api("/account/accept-privacy", { method: "POST" });
    await cargarAcademia();
    aviso(`Publicada la versión ${academiaCache.privacy_version}. Se pedirá aceptarla a cada cuenta al entrar.`);
  });
}

async function pintarCopias() {
  const cont = document.getElementById("bk-lista");
  if (!cont) return;
  try {
    const copias = await api("/admin/backups");
    if (!copias.length) {
      cont.innerHTML = `<p class="muted">Todavía no hay copias. La primera se hace sola al arrancar la app, o puedes hacerla ahora.</p>`;
      return;
    }
    cont.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Copia</th><th>Fecha</th><th class="num">Tamaño</th><th></th></tr></thead>
      <tbody>${copias
        .map((c) => `<tr><td><code>${esc(c.name)}</code></td><td>${fechaHora(c.created_at)}</td><td class="num">${tamano(c.size)}</td>
          <td><button class="btn btn-outline btn-sm" data-bajar="${esc(c.name)}">Descargar</button></td></tr>`)
        .join("")}</tbody></table></div>`;
    cont.querySelectorAll("[data-bajar]").forEach((b) => b.addEventListener("click", () => descargarCopia(b)));
  } catch (err) {
    cont.innerHTML = errorHtml(err);
  }
}

// La descarga necesita la sesión (lleva todos los datos de la academia), así
// que se pide con fetch + cabecera Authorization y se guarda como archivo.
async function descargarCopia(boton) {
  const nombre = boton.dataset.bajar;
  boton.disabled = true;
  try {
    const res = await fetch(`${API}/admin/backups/${encodeURIComponent(nombre)}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "No se ha podido descargar la copia.");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) {
    aviso(err.message, "warn");
  } finally {
    boton.disabled = false;
  }
}

// ===========================================================================
// EMAILS
// ===========================================================================
const TIPOS_EMAIL = { reset: "Recuperar contraseña", cancelacion: "Clase cancelada", cuota: "Cuotas", prueba: "Prueba" };
const ESTADOS_EMAIL = {
  local: `<span class="badge prueba">Bandeja de pruebas</span>`,
  enviado: `<span class="badge activa">Enviado</span>`,
  error: `<span class="badge impagada">Error</span>`,
};
let emailsCache = [];

async function cargarEmails() {
  contenido(CARGANDO);
  let datos;
  try {
    datos = await api("/admin/emails");
  } catch (err) {
    contenido(errorHtml(err));
    return;
  }
  emailsCache = datos.emails;
  const local = datos.mode === "local";
  contenido(`
    ${local
      ? `<div class="notice warn"><strong>Modo local: los emails no salen a Internet.</strong> Se guardan aquí para poder verlos (útil para probar y enseñar la app). Cuando la app esté publicada, se configura un proveedor de envío (Brevo) y llegarán de verdad a las familias.</div>`
      : `<div class="notice ok">Los emails se envían de verdad con Brevo. Aquí queda el registro (a quién y cuándo), sin el contenido.</div>`}
    <div class="toolbar">
      <p class="muted" style="font-size:0.88rem; max-width:620px;">La app avisa por email al recuperar una contraseña, cuando se cancela una clase con reservas y cuando hay un problema con una cuota.</p>
      <span class="spacer"></span>
      <button class="btn btn-outline btn-sm" id="em-prueba">Enviarme un email de prueba</button>
    </div>
    ${emailsCache.length
      ? `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Fecha</th><th>Para</th><th>Asunto</th><th>Tipo</th><th>Estado</th><th></th></tr></thead>
          <tbody>${emailsCache.map(filaEmail).join("")}</tbody></table></div>`
      : `<p class="muted">Todavía no se ha enviado ningún email.</p>`}`);

  document.getElementById("em-prueba").addEventListener("click", async (e) => {
    e.target.disabled = true;
    await ejecutar(() => api("/admin/emails/test", { method: "POST" }),
      (r) => (r.status === "local" ? `Email de prueba guardado en la bandeja (para ${r.to}).` : `Email de prueba enviado a ${r.to}.`),
      cargarEmails);
    const b = document.getElementById("em-prueba");
    if (b) b.disabled = false;
  });
  document.querySelectorAll("[data-email]").forEach((b) => b.addEventListener("click", () => verEmail(Number(b.dataset.email))));
}

function filaEmail(m) {
  return `<tr>
    <td style="white-space:nowrap;">${fechaHora(m.created_at)}</td>
    <td>${esc(m.to_email)}</td>
    <td>${esc(m.subject)}${m.error ? `<div class="form-message error" style="margin:4px 0 0;">${esc(m.error)}</div>` : ""}</td>
    <td>${esc(TIPOS_EMAIL[m.kind] || m.kind)}</td>
    <td>${ESTADOS_EMAIL[m.status] || esc(m.status)}</td>
    <td>${m.body_text ? `<button class="btn btn-outline btn-sm" data-email="${m.id}">Ver</button>` : ""}</td>
  </tr>`;
}

// El texto se escapa entero y después se convierten en enlace solo las
// direcciones http(s) (así se puede probar el enlace de "recuperar contraseña").
function textoEmailConEnlaces(texto) {
  return esc(texto).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}

function verEmail(id) {
  const m = emailsCache.find((x) => x.id === id);
  if (!m) return;
  abrirModal(`
    <h3 style="margin-bottom:4px;">${esc(m.subject)}</h3>
    <p class="muted" style="font-size:0.85rem; margin-bottom:12px;">Para ${esc(m.to_email)} · ${fechaHora(m.created_at)}</p>
    <div class="email-body">${textoEmailConEnlaces(m.body_text)}</div>
    ${m.kind === "reset" ? `<p class="muted" style="font-size:0.82rem; margin-top:10px;">Consejo para la demostración: abre el enlace en una ventana privada; si lo abres aquí, se cerrará tu sesión de administración.</p>` : ""}
    <button class="btn btn-outline" data-cerrar style="margin-top:14px;">Cerrar</button>`, { ancho: true });
}
