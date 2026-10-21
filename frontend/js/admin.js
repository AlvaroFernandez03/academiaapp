// js/admin.js — panel de administración: estructura, Resumen, Equipo y Alumnos.
// El Horario y las Disciplinas/grupos están en admin-horario.js; Academia y
// Emails, en admin-academia.js.

const PESTANAS = {
  resumen: () => cargarResumen(),
  horario: () => cargarHorario(),
  disciplinas: () => cargarDisciplinas(),
  equipo: () => cargarEquipo(),
  alumnos: () => cargarAlumnos(),
  academia: () => cargarAcademia(),
  emails: () => cargarEmails(),
};
let yo = null; // la cuenta que está usando el panel

document.addEventListener("DOMContentLoaded", async () => {
  await renderHeader();
  yo = getAccount();
  if (!getToken() || !yo) { window.location.href = "acceso.html?next=admin.html"; return; }
  if (yo.role !== "admin") {
    document.querySelector("main").innerHTML = `<div class="empty-state"><h3>Sin acceso</h3><p>Esta página es solo para la administración de la academia.</p></div>`;
    return;
  }

  document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => abrirPestana(b.dataset.tab)));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrarModal(); });
  // Si se cambia a mano la parte "#..." de la dirección, se abre esa pestaña.
  window.addEventListener("hashchange", () => abrirPestana(location.hash.slice(1)));
  // La pestaña va en la dirección (admin.html#horario): al recargar, sigue en la misma.
  abrirPestana(location.hash.slice(1) || "resumen");
});

function abrirPestana(tab) {
  if (!PESTANAS[tab]) tab = "resumen";
  history.replaceState(null, "", `#${tab}`);
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === tab));
  aviso("");
  PESTANAS[tab]();
}

// ---------------------------------------------------------------------------
// Utilidades compartidas por las pestañas (también las usa admin-horario.js)
// ---------------------------------------------------------------------------
function aviso(texto, tipo = "ok") {
  document.getElementById("aviso").innerHTML = texto ? `<div class="notice ${tipo}">${esc(texto)}</div>` : "";
}
function contenido(html) {
  document.getElementById("contenido").innerHTML = html;
}
const CARGANDO = `<p class="muted">Cargando…</p>`;
const errorHtml = (err) => `<p class="form-message error">${esc(err.message)}</p>`;

function abrirModal(html, { ancho = false } = {}) {
  const modal = document.getElementById("modal");
  modal.innerHTML = `<div class="form-card${ancho ? " wide" : ""}" role="dialog" aria-modal="true">${html}</div>`;
  modal.classList.remove("hidden");
  modal.onclick = (e) => { if (e.target === modal) cerrarModal(); };
  modal.querySelectorAll("[data-cerrar]").forEach((b) => b.addEventListener("click", cerrarModal));
  const primero = modal.querySelector("input:not([type=hidden]), select, textarea");
  if (primero) primero.focus();
}
function cerrarModal() {
  const modal = document.getElementById("modal");
  modal.classList.add("hidden");
  modal.innerHTML = "";
}

// Conecta el botón "Guardar" de un modal: evita el doble clic y enseña el
// error dentro del propio modal (sin cerrarlo, para no perder lo escrito).
function alPulsar(botonId, msgId, fn) {
  const btn = document.getElementById(botonId);
  btn.addEventListener("click", async () => {
    const msg = document.getElementById(msgId);
    msg.textContent = ""; msg.className = "form-message";
    btn.disabled = true;
    try {
      await fn(msg);
    } catch (err) {
      msg.textContent = err.message; msg.classList.add("error");
    } finally {
      if (document.body.contains(btn)) btn.disabled = false;
    }
  });
}

// Acción directa (sin formulario): muestra el resultado arriba de la página.
async function ejecutar(fn, textoOk, despues) {
  try {
    const r = await fn();
    const texto = typeof textoOk === "function" ? textoOk(r) : textoOk;
    if (texto) aviso(texto, "ok");
    if (despues) await despues();
    return r;
  } catch (err) {
    aviso(err.message, "warn");
    window.scrollTo({ top: 0, behavior: "smooth" });
    return null;
  }
}

const valor = (id) => document.getElementById(id).value;
const normalizar = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
function edad(fechaNacimiento) {
  if (!fechaNacimiento) return null;
  const hoy = new Date();
  const n = new Date(fechaNacimiento + "T12:00:00");
  let e = hoy.getFullYear() - n.getFullYear();
  const m = hoy.getMonth() - n.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < n.getDate())) e--;
  return e;
}

// Enseña la contraseña temporal. Solo se ve esta vez: la base de datos
// guarda únicamente su versión cifrada.
function mostrarContrasenaTemporal(cuenta, temporal, esNueva) {
  abrirModal(`
    <h3 style="margin-bottom:6px;">${esNueva ? "Cuenta creada" : "Contraseña nueva"}: ${esc(cuenta.name)}</h3>
    <p style="font-size:0.9rem;">Dale estos datos en persona. Por seguridad, la contraseña no se envía por email (si la persona lo prefiere, puede usar «¿Has olvidado tu contraseña?» al entrar).</p>
    <dl class="kv"><dt>Email para entrar</dt><dd>${esc(cuenta.email)}</dd></dl>
    <div class="pw-box" id="pw-temporal">${esc(temporal)}</div>
    <p class="muted" style="font-size:0.84rem; margin-bottom:14px;">
      Solo se muestra ahora: si se pierde, genera otra con «Nueva contraseña». Al entrar con ella, se le pedirá que ponga una suya.
    </p>
    <button class="btn btn-primary" id="pw-copiar">Copiar contraseña</button>
    <button class="btn btn-outline" data-cerrar style="margin-left:8px;">Hecho</button>`);
  document.getElementById("pw-copiar").addEventListener("click", async (e) => {
    try {
      await navigator.clipboard.writeText(temporal);
      e.target.textContent = "¡Copiada!";
    } catch (_) {
      // Sin permiso para el portapapeles: seleccionamos el texto para copiarlo a mano.
      const rango = document.createRange();
      rango.selectNodeContents(document.getElementById("pw-temporal"));
      getSelection().removeAllRanges();
      getSelection().addRange(rango);
      e.target.textContent = "Pulsa Ctrl+C para copiar";
    }
  });
}

// Corregir nombre, email o teléfono de cualquier cuenta (familia o equipo).
function abrirEditarCuenta(cuenta, alGuardar) {
  abrirModal(`
    <h3 style="margin-bottom:12px;">Datos de contacto</h3>
    <div class="field"><label for="ec-nombre">Nombre</label><input id="ec-nombre" value="${esc(cuenta.name)}"></div>
    <div class="field"><label for="ec-email">Email (es con el que entra)</label><input id="ec-email" type="email" value="${esc(cuenta.email)}"></div>
    <div class="field"><label for="ec-tel">Teléfono</label><input id="ec-tel" value="${esc(cuenta.phone || "")}"></div>
    <button class="btn btn-primary" id="ec-guardar">Guardar</button>
    <button class="btn btn-outline" data-cerrar style="margin-left:8px;">Cancelar</button>
    <p id="ec-msg" class="form-message"></p>`);
  alPulsar("ec-guardar", "ec-msg", async () => {
    await api(`/admin/accounts/${cuenta.id}`, {
      method: "PUT",
      body: JSON.stringify({ name: valor("ec-nombre"), email: valor("ec-email"), phone: valor("ec-tel") }),
    });
    cerrarModal();
    aviso("Datos guardados.");
    await alGuardar();
  });
}

async function nuevaContrasena(cuenta) {
  if (!confirm(`¿Generar una contraseña temporal nueva para ${cuenta.name}? La que tenga ahora dejará de funcionar.`)) return;
  try {
    const r = await api(`/admin/accounts/${cuenta.id}/reset-password`, { method: "POST" });
    mostrarContrasenaTemporal(cuenta, r.temp_password, false);
  } catch (err) {
    aviso(err.message, "warn");
  }
}

async function activarCuenta(cuenta, activa, recargar) {
  const texto = activa
    ? `¿Reactivar la cuenta de ${cuenta.name}? Podrá volver a entrar con su contraseña.`
    : `¿Desactivar la cuenta de ${cuenta.name}? No podrá entrar a la app (ni seguir usando una sesión abierta). No se borra nada y puedes reactivarla cuando quieras.`;
  if (!confirm(texto)) return;
  await ejecutar(
    () => api(`/admin/accounts/${cuenta.id}/active`, { method: "PUT", body: JSON.stringify({ active: activa }) }),
    activa ? "Cuenta reactivada." : "Cuenta desactivada.",
    recargar
  );
}

// ===========================================================================
// RESUMEN
// ===========================================================================
async function cargarResumen() {
  contenido(CARGANDO);
  try {
    const s = await api("/admin/summary");
    const stat = (v, etiqueta, sub = "", alerta = false) =>
      `<div class="stat-box${alerta ? " alert" : ""}"><div class="value">${v}</div><div class="label">${etiqueta}${sub ? `<br><span class="muted">${sub}</span>` : ""}</div></div>`;

    contenido(`
      <div class="stat-grid">
        ${stat(s.families, "Familias con cuenta", s.new_families_30d ? `+${s.new_families_30d} en los últimos 30 días` : "")}
        ${stat(s.students_with_membership, "Alumnos con cuota activa")}
        ${stat(s.memberships_unpaid, "Cuotas con pago pendiente", s.memberships_unpaid ? `<a href="admin-cuotas.html" class="btn-link">Revisar</a>` : "", s.memberships_unpaid > 0)}
        ${stat(s.memberships_pending, "Por cobrar en recepción")}
        ${stat(s.team_active, "Personas en el equipo")}
      </div>

      <h2 style="margin-bottom:10px;">Clases de hoy <span class="muted" style="font-size:0.95rem; font-weight:500;">· ${formatFecha(s.date)}</span></h2>
      ${s.classes_today.length ? tablaClasesHoy(s.classes_today, s.date) : `<p class="muted">Hoy no hay clases en el horario.</p>`}

      <h2 style="margin:28px 0 10px;">Sesiones canceladas en las próximas dos semanas</h2>
      ${
        s.upcoming_cancellations.length
          ? `<ul class="list-plain">${s.upcoming_cancellations
              .map((c) => `<li><strong>${formatFecha(c.date)}</strong> · ${c.start_time} ${esc(c.class_name)}${c.reason ? ` — ${esc(c.reason)}` : ""}</li>`)
              .join("")}</ul>`
          : `<p class="muted">Ninguna. Para cancelar una sesión (festivo, instructor enfermo…), ve a <button class="btn-link" data-ir="horario">Horario</button>.</p>`
      }`);
    document.querySelectorAll("[data-ir]").forEach((b) => b.addEventListener("click", () => abrirPestana(b.dataset.ir)));
  } catch (err) {
    contenido(errorHtml(err));
  }
}

function tablaClasesHoy(clases, fecha) {
  return `<div class="table-wrap"><table class="data-table">
    <thead><tr><th>Hora</th><th>Clase</th><th>Imparte</th><th class="num">Reservas</th><th class="num">En espera</th><th class="num">Asistencia</th><th></th></tr></thead>
    <tbody>${clases
      .map((c) =>
        c.cancelled
          ? `<tr style="opacity:.6;"><td>${c.start_time}</td><td>${esc(c.name)}</td><td>${esc(c.instructor_name)}</td>
               <td colspan="4"><span class="badge cancelada">Cancelada</span> ${esc(c.cancel_reason || "")}</td></tr>`
          : `<tr><td>${c.start_time}–${c.end_time}</td><td><strong>${esc(c.name)}</strong><div class="muted" style="font-size:0.8rem;">${esc(c.discipline_name)}</div></td>
               <td>${esc(c.instructor_name)}</td><td class="num">${c.booked}/${c.capacity}</td><td class="num">${c.waitlist || "—"}</td>
               <td class="num">${c.attended || "—"}</td>
               <td><a class="btn btn-outline btn-sm" href="pasar-lista.html?clase=${c.id}&fecha=${fecha}">Pasar lista</a></td></tr>`
      )
      .join("")}</tbody></table></div>`;
}

// ===========================================================================
// EQUIPO (instructores y administración)
// ===========================================================================
const ROLES = { admin: "Administración", instructor: "Instructor", member: "Familia (sin permisos)" };
let equipoCache = [];

async function cargarEquipo() {
  contenido(`
    <div class="toolbar">
      <p class="muted" style="font-size:0.88rem; max-width:620px;">Quién imparte clases y quién gestiona la academia. Los instructores pueden pasar lista; administración, además, entra en este panel y en Cuotas y pagos.</p>
      <span class="spacer"></span>
      <button class="btn btn-primary btn-sm" id="btn-nuevo-staff">Añadir al equipo</button>
    </div>
    <div id="tabla-equipo">${CARGANDO}</div>`);
  document.getElementById("btn-nuevo-staff").addEventListener("click", abrirAltaEquipo);
  await pintarEquipo();
}

async function pintarEquipo() {
  const cont = document.getElementById("tabla-equipo");
  if (!cont) return;
  try {
    equipoCache = await api("/admin/team");
    cont.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Nombre</th><th>Contacto</th><th>Rol</th><th class="num">Clases</th><th></th></tr></thead>
      <tbody>${equipoCache.map(filaEquipo).join("")}</tbody></table></div>`;
    cont.querySelectorAll("[data-eq]").forEach((b) => b.addEventListener("click", () => accionEquipo(b.dataset.eq, Number(b.dataset.id))));
  } catch (err) {
    cont.innerHTML = errorHtml(err);
  }
}

function filaEquipo(a) {
  const soyYo = a.id === yo.id;
  const marcas = [
    soyYo ? `<span class="badge">Tú</span>` : "",
    a.is_main_admin ? `<span class="badge">Principal</span>` : "",
    !a.active ? `<span class="badge off">Desactivada</span>` : "",
    a.must_change_password ? `<span class="badge pendiente_pago" title="Todavía no ha cambiado la contraseña temporal">Contraseña temporal</span>` : "",
  ].join(" ");
  const acciones = [`<button class="btn btn-outline btn-sm" data-eq="editar" data-id="${a.id}">Editar</button>`];
  if (!soyYo) {
    if (!a.is_main_admin) acciones.push(`<button class="btn btn-outline btn-sm" data-eq="rol" data-id="${a.id}">Rol</button>`);
    acciones.push(`<button class="btn btn-outline btn-sm" data-eq="clave" data-id="${a.id}">Nueva contraseña</button>`);
    if (!a.is_main_admin) {
      acciones.push(
        a.active
          ? `<button class="btn btn-danger btn-sm" data-eq="desactivar" data-id="${a.id}">Desactivar</button>`
          : `<button class="btn btn-outline btn-sm" data-eq="activar" data-id="${a.id}">Reactivar</button>`
      );
    }
  }
  return `<tr style="${a.active ? "" : "opacity:.6;"}">
    <td><strong>${esc(a.name)}</strong> <span class="badges">${marcas}</span></td>
    <td>${esc(a.email)}${a.phone ? `<div class="muted" style="font-size:0.8rem;">${esc(a.phone)}</div>` : ""}</td>
    <td>${ROLES[a.role]}</td>
    <td class="num">${a.active_classes}</td>
    <td><div class="row-actions">${acciones.join("")}</div></td>
  </tr>`;
}

function accionEquipo(accion, id) {
  const a = equipoCache.find((x) => x.id === id);
  if (accion === "editar") return abrirEditarCuenta(a, pintarEquipo);
  if (accion === "clave") return nuevaContrasena(a);
  if (accion === "activar") return activarCuenta(a, true, pintarEquipo);
  if (accion === "desactivar") return activarCuenta(a, false, pintarEquipo);
  if (accion === "rol") return abrirCambioRol(a, pintarEquipo);
}

function abrirCambioRol(cuenta, recargar) {
  abrirModal(`
    <h3 style="margin-bottom:12px;">Rol de ${esc(cuenta.name)}</h3>
    ${["instructor", "admin", "member"]
      .map(
        (r) => `<label class="radio-row"><input type="radio" name="rol" value="${r}" ${cuenta.role === r ? "checked" : ""}>
          <span><strong>${ROLES[r]}</strong><small>${
            { instructor: "Pasa lista de las clases.", admin: "Todo lo anterior, más este panel y Cuotas y pagos.", member: "Solo su familia: reservas y cuotas." }[r]
          }</small></span></label>`
      )
      .join("")}
    <button class="btn btn-primary" id="rol-guardar">Guardar</button>
    <button class="btn btn-outline" data-cerrar style="margin-left:8px;">Cancelar</button>
    <p id="rol-msg" class="form-message"></p>`);
  alPulsar("rol-guardar", "rol-msg", async () => {
    const rol = document.querySelector('input[name="rol"]:checked').value;
    await api(`/admin/accounts/${cuenta.id}/role`, { method: "PUT", body: JSON.stringify({ role: rol }) });
    cerrarModal();
    aviso(`${cuenta.name} ahora tiene el rol «${ROLES[rol]}».`);
    await recargar();
  });
}

function abrirAltaEquipo() {
  abrirModal(`
    <h3 style="margin-bottom:4px;">Añadir al equipo</h3>
    <p class="muted" style="font-size:0.86rem; margin-bottom:14px;">Se crea la cuenta con una contraseña temporal que le darás en persona.</p>
    <div class="field"><label for="st-nombre">Nombre y apellidos</label><input id="st-nombre"></div>
    <div class="field"><label for="st-email">Email (con el que entrará)</label><input id="st-email" type="email"></div>
    <div class="field"><label for="st-tel">Teléfono (opcional)</label><input id="st-tel"></div>
    <div class="field"><label>Rol</label>
      <label class="radio-row"><input type="radio" name="st-rol" value="instructor" checked><span><strong>Instructor</strong><small>Da clases y pasa lista.</small></span></label>
      <label class="radio-row"><input type="radio" name="st-rol" value="admin"><span><strong>Administración</strong><small>Recepción o dirección: gestiona horario, alumnos y cuotas.</small></span></label>
    </div>
    <button class="btn btn-primary" id="st-crear">Crear cuenta</button>
    <button class="btn btn-outline" data-cerrar style="margin-left:8px;">Cancelar</button>
    <p id="st-msg" class="form-message"></p>
    <div id="st-existente"></div>`);

  alPulsar("st-crear", "st-msg", async () => {
    const rol = document.querySelector('input[name="st-rol"]:checked').value;
    document.getElementById("st-existente").innerHTML = "";
    try {
      const r = await api("/admin/team", {
        method: "POST",
        body: JSON.stringify({ name: valor("st-nombre"), email: valor("st-email"), phone: valor("st-tel"), role: rol }),
      });
      await pintarEquipo();
      mostrarContrasenaTemporal(r.account, r.temp_password, true);
    } catch (err) {
      // El email ya tiene cuenta (por ejemplo, un padre que también da
      // clases): se le pueden dar permisos sin crear una segunda cuenta.
      const d = err.data || {};
      if (err.status === 409 && d.existing_account_id && d.existing_role !== "admin" && d.existing_role !== rol) {
        document.getElementById("st-existente").innerHTML = `
          <button class="btn btn-outline btn-sm" id="st-dar-permisos" style="margin-top:8px;">Dar a ${esc(d.existing_name)} el rol «${ROLES[rol]}»</button>`;
        document.getElementById("st-dar-permisos").addEventListener("click", async () => {
          try {
            await api(`/admin/accounts/${d.existing_account_id}/role`, { method: "PUT", body: JSON.stringify({ role: rol }) });
            cerrarModal();
            aviso(`${d.existing_name} ahora tiene el rol «${ROLES[rol]}». Sigue entrando con su email y contraseña de siempre.`);
            await pintarEquipo();
          } catch (e2) {
            const msg = document.getElementById("st-msg");
            msg.textContent = e2.message; msg.className = "form-message error";
          }
        });
      }
      throw err;
    }
  });
}

// ===========================================================================
// ALUMNOS
// ===========================================================================
let familiasCache = [];

async function cargarAlumnos() {
  contenido(`
    <div class="toolbar">
      <input type="search" id="al-buscar" placeholder="Buscar por nombre, email o teléfono…" aria-label="Buscar alumnos">
      <select id="al-filtro" aria-label="Filtrar">
        <option value="">Todas las familias</option>
        <option value="activa">Con cuota activa</option>
        <option value="sin">Con algún alumno sin cuota</option>
        <option value="pendiente">Con pago pendiente</option>
        <option value="desactivadas">Cuentas desactivadas</option>
      </select>
      <span class="spacer"></span>
      <span class="muted" id="al-contador" style="font-size:0.85rem;"></span>
    </div>
    <div id="al-lista">${CARGANDO}</div>`);
  document.getElementById("al-buscar").addEventListener("input", pintarFamilias);
  document.getElementById("al-filtro").addEventListener("change", pintarFamilias);
  await recargarFamilias();
}

async function recargarFamilias() {
  try {
    familiasCache = await api("/admin/families");
    pintarFamilias();
  } catch (err) {
    const cont = document.getElementById("al-lista");
    if (cont) cont.innerHTML = errorHtml(err);
  }
}

function coincideFiltro(f, filtro) {
  const cuotas = f.members.flatMap((m) => m.memberships);
  if (filtro === "activa") return cuotas.some((q) => q.status === "activa");
  // Basta con que UN alumno de la familia no tenga cuota (aunque sus hermanos sí).
  if (filtro === "sin") return f.members.some((m) => m.memberships.length === 0);
  if (filtro === "pendiente") return cuotas.some((q) => q.status === "impagada" || q.status === "pendiente_pago");
  if (filtro === "desactivadas") return !f.active;
  return true;
}

function pintarFamilias() {
  const cont = document.getElementById("al-lista");
  if (!cont) return;
  const q = normalizar(valor("al-buscar").trim());
  const filtro = valor("al-filtro");
  const lista = familiasCache.filter((f) => {
    if (!coincideFiltro(f, filtro)) return false;
    if (!q) return true;
    const texto = [f.name, f.email, f.phone, ...f.members.map((m) => `${m.first_name} ${m.last_name}`)].join(" ");
    return normalizar(texto).includes(q);
  });
  const alumnos = lista.reduce((n, f) => n + f.members.length, 0);
  document.getElementById("al-contador").textContent = `${lista.length} ${lista.length === 1 ? "familia" : "familias"} · ${alumnos} ${alumnos === 1 ? "alumno" : "alumnos"}`;

  if (lista.length === 0) {
    cont.innerHTML = `<div class="empty-state"><p>${familiasCache.length ? "Nadie coincide con la búsqueda." : "Todavía no se ha registrado ninguna familia."}</p></div>`;
    return;
  }
  cont.innerHTML = lista.map(tarjetaFamilia).join("");
  cont.querySelectorAll("[data-ficha]").forEach((b) => b.addEventListener("click", () => abrirFicha(Number(b.dataset.ficha))));
  cont.querySelectorAll("[data-fam]").forEach((b) => b.addEventListener("click", () => accionFamilia(b.dataset.fam, Number(b.dataset.id))));
}

function tarjetaFamilia(f) {
  const acciones = [`<button class="btn btn-outline btn-sm" data-fam="editar" data-id="${f.id}">Editar contacto</button>`];
  if (f.id !== yo.id) {
    acciones.push(`<button class="btn btn-outline btn-sm" data-fam="clave" data-id="${f.id}">Nueva contraseña</button>`);
    acciones.push(
      f.active
        ? `<button class="btn btn-danger btn-sm" data-fam="desactivar" data-id="${f.id}">Desactivar</button>`
        : `<button class="btn btn-outline btn-sm" data-fam="activar" data-id="${f.id}">Reactivar</button>`
    );
  }
  return `<div class="family-card${f.active ? "" : " off"}">
    <div class="family-head">
      <div>
        <strong>${esc(f.name)}</strong>
        ${!f.active ? `<span class="badge off">Desactivada</span>` : ""}
        ${f.role !== "member" ? `<span class="badge">${ROLES[f.role]}</span>` : ""}
        <div class="muted" style="font-size:0.83rem;">${esc(f.email)}${f.phone ? ` · ${esc(f.phone)}` : ""} · desde ${formatFecha(f.created_at)}</div>
      </div>
      <div class="row-actions">${acciones.join("")}</div>
    </div>
    <div class="family-members">
      ${f.members.length ? f.members.map(lineaAlumno).join("") : `<p class="muted" style="font-size:0.85rem; padding:6px 8px;">Todavía no ha añadido a nadie en «Mi familia».</p>`}
    </div>
  </div>`;
}

function lineaAlumno(m) {
  const e = edad(m.birth_date);
  const cuotas = m.memberships.length
    ? m.memberships.map((q) => `<span class="badge ${q.status}" title="${ESTADOS_CUOTA[q.status] || q.status}">${esc(q.plan_name)}</span>`).join("")
    : `<span class="badge">Sin cuota</span>`;
  return `<button class="member-line" data-ficha="${m.id}" title="Ver ficha">
    ${avatarHtml(m)}
    <span class="name">${esc(m.first_name)} ${esc(m.last_name)}</span>
    <span class="muted" style="font-size:0.82rem;">${e !== null ? `${e} años · ` : ""}${m.is_dependent ? "Hijo/a" : "Titular"}</span>
    <span class="badges">${cuotas}${m.has_medical_notes ? `<span class="badge medica">Notas médicas</span>` : ""}</span>
    <span class="muted" style="font-size:0.8rem; margin-left:auto;">${m.last_attendance ? `Última clase: ${formatFecha(m.last_attendance)}` : "Sin asistencias"}</span>
  </button>`;
}

function accionFamilia(accion, id) {
  const f = familiasCache.find((x) => x.id === id);
  if (accion === "editar") return abrirEditarCuenta(f, recargarFamilias);
  if (accion === "clave") return nuevaContrasena(f);
  if (accion === "activar") return activarCuenta(f, true, recargarFamilias);
  if (accion === "desactivar") return activarCuenta(f, false, recargarFamilias);
}

async function abrirFicha(memberId) {
  abrirModal(CARGANDO, { ancho: true });
  try {
    const d = await api(`/admin/members/${memberId}`);
    const m = d.member;
    const e = edad(m.birth_date);
    const ESTADOS_RESERVA = { reservada: "Reservada", en_espera: "En espera", cancelada: "Cancelada", asistio: "Asistió" };
    abrirModal(
      `
      <div style="display:flex; gap:14px; align-items:center; margin-bottom:6px;">
        ${avatarHtml(m, true)}
        <div><h3>${esc(m.first_name)} ${esc(m.last_name)}</h3>
          <div class="muted" style="font-size:0.86rem;">${e !== null ? `${e} años (${formatFecha(m.birth_date)})` : "Sin fecha de nacimiento"} · ${m.is_dependent ? "Hijo/a" : "Titular"}</div></div>
      </div>
      ${m.medical_notes ? `<div class="medical"><strong>Notas médicas:</strong> ${esc(m.medical_notes)}</div>` : ""}
      <dl class="kv">
        <dt>Cuenta</dt><dd>${esc(d.account.name)}<br>${esc(d.account.email)}${d.account.phone ? ` · ${esc(d.account.phone)}` : ""}</dd>
        <dt>Emergencias</dt><dd>${m.emergency_contact_name || m.emergency_contact_phone ? `${esc(m.emergency_contact_name || "")} ${esc(m.emergency_contact_phone || "")}` : `<span class="muted">Mismo contacto que la cuenta</span>`}</dd>
        ${m.bio ? `<dt>Sobre mí</dt><dd>${esc(m.bio)}</dd>` : ""}
      </dl>
      <h4 style="margin:6px 0;">Cuotas</h4>
      ${
        d.memberships.length
          ? `<ul class="list-plain">${d.memberships
              .map((q) => `<li><strong>${esc(q.plan_name)}</strong> <span class="badge ${q.status}">${ESTADOS_CUOTA[q.status] || q.status}</span> · ${formatEuros(q.price_cents)}/mes · ${q.payment_method === "stripe" ? "Tarjeta" : "Recepción"}${q.current_period_end && q.status !== "cancelada" ? ` · hasta ${formatFecha(q.current_period_end)}` : ""}</li>`)
              .join("")}</ul>`
          : `<p class="muted" style="font-size:0.86rem;">Sin cuotas.</p>`
      }
      <h4 style="margin:14px 0 6px;">Graduaciones</h4>
      ${
        d.gradings.length
          ? `<ul class="list-plain">${d.gradings.map((g) => `<li><strong>${esc(g.grade_name)}</strong> · ${esc(g.discipline_name)} · ${formatFecha(g.awarded_at)}${g.notes ? ` — ${esc(g.notes)}` : ""}</li>`).join("")}</ul>`
          : `<p class="muted" style="font-size:0.86rem;">Sin graduaciones registradas.</p>`
      }
      <h4 style="margin:14px 0 6px;">Últimas reservas</h4>
      ${
        d.recent_bookings.length
          ? `<ul class="list-plain">${d.recent_bookings
              .map((b) => `<li>${formatFecha(b.date)} ${b.start_time} · ${esc(b.class_name)} <span class="badge ${b.status}">${ESTADOS_RESERVA[b.status] || b.status}</span>${b.is_trial ? ` <span class="badge prueba">Prueba</span>` : ""}</li>`)
              .join("")}</ul>`
          : `<p class="muted" style="font-size:0.86rem;">Todavía no ha reservado ninguna clase.</p>`
      }
      <div style="margin-top:16px;"><button class="btn btn-outline" data-cerrar>Cerrar</button></div>`,
      { ancho: true }
    );
  } catch (err) {
    abrirModal(`${errorHtml(err)}<button class="btn btn-outline" data-cerrar>Cerrar</button>`);
  }
}
