// js/admin-horario.js — panel de administración: Horario y Disciplinas/grupos.
// Usa las utilidades de admin.js (abrirModal, alPulsar, ejecutar, aviso...).

const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0]; // de lunes a domingo
let clasesAdmin = [];
let disciplinasAdmin = [];
let equipoAdmin = [];
let canceladasAdmin = [];
let verFueraDeHorario = false;
let verArchivadas = false;

function fechaISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// Próximas N fechas (desde hoy incluido) que caen en ese día de la semana.
function proximasSesiones(dia, cantidad) {
  const fechas = [];
  const d = new Date();
  while (fechas.length < cantidad) {
    if (d.getDay() === dia) fechas.push(fechaISO(d));
    d.setDate(d.getDate() + 1);
  }
  return fechas;
}
// textoEdades(min, max) está en common.js (también lo usan la portada y las
// páginas de disciplina).
const nombreClase = (c) => c.name || c.group_name;
const textoCanceladas = (n) => (!n ? "" : n === 1 ? " Se ha cancelado 1 reserva." : ` Se han cancelado ${n} reservas.`);

// ===========================================================================
// HORARIO
// ===========================================================================
async function cargarHorario() {
  contenido(`
    <div class="toolbar">
      <button class="btn btn-primary btn-sm" id="hz-nueva">Nueva clase</button>
      <label class="check-inline"><input type="checkbox" id="hz-fuera" ${verFueraDeHorario ? "checked" : ""}> Ver también las clases quitadas del horario</label>
    </div>
    <div id="hz-lista">${CARGANDO}</div>`);
  document.getElementById("hz-nueva").addEventListener("click", () => abrirFormClase(null));
  document.getElementById("hz-fuera").addEventListener("change", (e) => { verFueraDeHorario = e.target.checked; pintarHorario(); });
  await recargarHorario();
}

async function recargarHorario() {
  try {
    [clasesAdmin, disciplinasAdmin, equipoAdmin, canceladasAdmin] = await Promise.all([
      api("/admin/classes"),
      api("/admin/disciplines"),
      api("/admin/team"),
      api("/schedule/cancellations"),
    ]);
    pintarHorario();
  } catch (err) {
    const cont = document.getElementById("hz-lista");
    if (cont) cont.innerHTML = errorHtml(err);
  }
}

function hayGruposActivos() {
  return disciplinasAdmin.some((d) => d.active && d.groups.some((g) => g.active));
}

function pintarHorario() {
  const cont = document.getElementById("hz-lista");
  if (!cont) return;
  const visibles = clasesAdmin.filter((c) => verFueraDeHorario || c.active);

  if (clasesAdmin.length === 0) {
    cont.innerHTML = `<div class="empty-state"><p>Todavía no hay clases en el horario.</p>${
      hayGruposActivos()
        ? `<p>Pulsa «Nueva clase» para crear la primera.</p>`
        : `<p>Primero crea una disciplina y un grupo (por ejemplo, «BJJ» → «Adultos»).</p><button class="btn btn-primary" data-ir="disciplinas">Ir a Disciplinas y grupos</button>`
    }</div>`;
    cont.querySelectorAll("[data-ir]").forEach((b) => b.addEventListener("click", () => abrirPestana(b.dataset.ir)));
    return;
  }

  const bloques = ORDEN_SEMANA.map((dia) => {
    const delDia = visibles.filter((c) => c.day_of_week === dia);
    if (!delDia.length) return "";
    return `<div class="day-block"><h3 class="day-title">${DIAS_SEMANA[dia]}</h3>${delDia.map(filaClaseAdmin).join("")}</div>`;
  }).join("");

  cont.innerHTML = `
    ${bloques || `<p class="muted">No hay clases activas en el horario.</p>`}
    <h2 style="margin:26px 0 10px;">Sesiones canceladas</h2>
    ${
      canceladasAdmin.length
        ? canceladasAdmin
            .map(
              (c) => `<div class="admin-row">
                <span class="time">${formatFecha(c.date)}</span>
                <span class="info"><strong>${esc(c.class_name)}</strong> · ${c.start_time}<div class="sub">${c.reason ? esc(c.reason) : "Sin motivo indicado"}</div></span>
                <button class="btn btn-outline btn-sm" data-restaurar="${c.id}">Deshacer</button>
              </div>`
            )
            .join("")
        : `<p class="muted" style="font-size:0.88rem;">No hay ninguna sesión cancelada próximamente. Para cancelar un día concreto (festivo, instructor enfermo…), usa «Cancelar un día» en la clase.</p>`
    }`;

  cont.querySelectorAll("[data-hz]").forEach((b) => b.addEventListener("click", () => accionClase(b.dataset.hz, Number(b.dataset.id))));
  cont.querySelectorAll("[data-restaurar]").forEach((b) => b.addEventListener("click", () => deshacerCancelacion(Number(b.dataset.restaurar))));
}

function filaClaseAdmin(c) {
  const acciones = [`<button class="btn btn-outline btn-sm" data-hz="editar" data-id="${c.id}">Editar</button>`];
  if (c.active) {
    acciones.push(`<button class="btn btn-outline btn-sm" data-hz="cancelar-dia" data-id="${c.id}">Cancelar un día</button>`);
    acciones.push(`<button class="btn btn-danger btn-sm" data-hz="quitar" data-id="${c.id}">Quitar del horario</button>`);
  } else {
    acciones.push(`<button class="btn btn-outline btn-sm" data-hz="poner" data-id="${c.id}">Volver a ponerla</button>`);
    if (c.total_bookings === 0) acciones.push(`<button class="btn btn-danger btn-sm" data-hz="borrar" data-id="${c.id}">Borrar</button>`);
  }
  return `<div class="admin-row${c.active ? "" : " off"}">
    <span class="time">${c.start_time}–${c.end_time}</span>
    <span class="info">
      <strong>${esc(nombreClase(c))}</strong> ${c.active ? "" : `<span class="badge off">Fuera del horario</span>`}
      <div class="sub">${esc(c.discipline_name)} · ${esc(c.group_name)} · ${esc(c.instructor_name)}${c.instructor_active ? "" : " (cuenta desactivada)"}</div>
      <div class="sub">Aforo ${c.capacity}${c.future_bookings ? ` · ${c.future_bookings} ${c.future_bookings === 1 ? "reserva próxima" : "reservas próximas"}` : ""}</div>
    </span>
    <span class="row-actions">${acciones.join("")}</span>
  </div>`;
}

function accionClase(accion, id) {
  const c = clasesAdmin.find((x) => x.id === id);
  if (accion === "editar") return abrirFormClase(c);
  if (accion === "cancelar-dia") return abrirCancelarSesion(c);
  if (accion === "quitar") return quitarClase(c);
  if (accion === "poner") {
    return ejecutar(() => api(`/admin/classes/${id}/active`, { method: "PUT", body: JSON.stringify({ active: true }) }), `«${nombreClase(c)}» vuelve a estar en el horario.`, recargarHorario);
  }
  if (accion === "borrar") {
    if (!confirm(`¿Borrar «${nombreClase(c)}» definitivamente? Nunca ha tenido reservas, así que no se pierde historial.`)) return;
    return ejecutar(() => api(`/admin/classes/${id}`, { method: "DELETE" }), "Clase borrada.", recargarHorario);
  }
}

function quitarClase(c) {
  const texto =
    `¿Quitar «${nombreClase(c)}» (${DIAS_SEMANA[c.day_of_week].toLowerCase()} ${c.start_time}) del horario?\n\n` +
    (c.future_bookings
      ? `${c.future_bookings === 1 ? "Se cancelará su reserva próxima" : `Se cancelarán sus ${c.future_bookings} reservas próximas`}; las familias verán el motivo en «Mis reservas» y recibirán un email. `
      : "") +
    "El historial se conserva y podrás volver a ponerla cuando quieras.";
  if (!confirm(texto)) return;
  ejecutar(
    () => api(`/admin/classes/${c.id}/active`, { method: "PUT", body: JSON.stringify({ active: false }) }),
    (r) => `«${nombreClase(c)}» quitada del horario.${textoCanceladas(r.cancelled_bookings)}`,
    recargarHorario
  );
}

// --- Crear / editar una clase ---
function abrirFormClase(c) {
  if (!c && !hayGruposActivos()) {
    abrirModal(`<h3>Primero hace falta un grupo</h3>
      <p style="margin:10px 0 14px;">Cada clase pertenece a un grupo de una disciplina (por ejemplo, «BJJ» → «Adultos»).</p>
      <button class="btn btn-primary" id="ir-disc">Crear disciplinas y grupos</button> <button class="btn btn-outline" data-cerrar>Cerrar</button>`);
    document.getElementById("ir-disc").addEventListener("click", () => { cerrarModal(); abrirPestana("disciplinas"); });
    return;
  }

  const bloqueado = !!(c && c.future_bookings > 0); // día y grupo no se pueden cambiar
  const gruposHtml = disciplinasAdmin
    .map((d) => {
      const grupos = d.groups.filter((g) => (g.active && d.active) || (c && g.id === c.group_id));
      if (!grupos.length) return "";
      return `<optgroup label="${esc(d.name)}">${grupos
        .map((g) => `<option value="${g.id}" ${c && c.group_id === g.id ? "selected" : ""}>${esc(g.name)}${g.active ? "" : " (archivado)"}</option>`)
        .join("")}</optgroup>`;
    })
    .join("");
  const equipo = equipoAdmin.filter((a) => a.active || (c && a.id === c.instructor_account_id));
  const personasHtml = equipo
    .map((a) => `<option value="${a.id}" ${c && c.instructor_account_id === a.id ? "selected" : ""}>${esc(a.name)}${a.active ? "" : " (desactivada)"}</option>`)
    .join("");
  const diasHtml = ORDEN_SEMANA.map((d) => `<option value="${d}" ${c && c.day_of_week === d ? "selected" : ""}>${DIAS_SEMANA[d]}</option>`).join("");

  abrirModal(
    `
    <h3 style="margin-bottom:12px;">${c ? `Editar «${esc(nombreClase(c))}»` : "Nueva clase"}</h3>
    ${
      bloqueado
        ? `<div class="notice warn" style="margin-top:0;">Tiene ${c.future_bookings} ${c.future_bookings === 1 ? "reserva próxima" : "reservas próximas"}: puedes cambiar la hora, el aforo o quién la imparte, pero no el día ni el grupo (esas reservas quedarían en una clase que ya no existe). Para eso, crea una clase nueva y quita esta del horario.</div>`
        : ""
    }
    <div class="field"><label for="cl-grupo">Grupo</label><select id="cl-grupo" ${bloqueado ? "disabled" : ""}>${gruposHtml}</select></div>
    <div class="field"><label for="cl-imparte">Imparte</label><select id="cl-imparte">${personasHtml}</select></div>
    <div class="form-grid">
      <div class="field"><label for="cl-dia">Día</label><select id="cl-dia" ${bloqueado ? "disabled" : ""}>${diasHtml}</select></div>
      <div class="field"><label for="cl-aforo">Aforo (plazas)</label><input id="cl-aforo" type="number" min="1" max="200" value="${c ? c.capacity : 20}"></div>
      <div class="field"><label for="cl-inicio">Empieza</label><input id="cl-inicio" type="time" value="${c ? c.start_time : "18:00"}"></div>
      <div class="field"><label for="cl-fin">Termina</label><input id="cl-fin" type="time" value="${c ? c.end_time : "19:00"}"></div>
    </div>
    <div class="field"><label for="cl-nombre">Nombre (opcional)</label>
      <input id="cl-nombre" value="${c && c.name ? esc(c.name) : ""}" placeholder="Si lo dejas vacío, se usa el nombre del grupo">
    </div>
    <button class="btn btn-primary" id="cl-guardar">${c ? "Guardar cambios" : "Añadir al horario"}</button>
    <button class="btn btn-outline" data-cerrar style="margin-left:8px;">Cancelar</button>
    <p id="cl-msg" class="form-message"></p>`,
    { ancho: true }
  );

  alPulsar("cl-guardar", "cl-msg", async () => {
    const datos = {
      group_id: Number(valor("cl-grupo")),
      instructor_account_id: Number(valor("cl-imparte")),
      day_of_week: Number(valor("cl-dia")),
      start_time: valor("cl-inicio"),
      end_time: valor("cl-fin"),
      capacity: Number(valor("cl-aforo")),
      name: valor("cl-nombre"),
    };
    if (c) {
      const r = await api(`/admin/classes/${c.id}`, { method: "PUT", body: JSON.stringify(datos) });
      cerrarModal();
      aviso(`Cambios guardados.${r.promoted ? ` Al ampliar el aforo, ${r.promoted} ${r.promoted === 1 ? "persona que estaba" : "personas que estaban"} en lista de espera ya ${r.promoted === 1 ? "tiene" : "tienen"} plaza.` : ""}`);
    } else {
      await api("/admin/classes", { method: "POST", body: JSON.stringify(datos) });
      cerrarModal();
      aviso("Clase añadida al horario. Ya se puede reservar.");
    }
    await recargarHorario();
  });
}

// --- Cancelar una sesión concreta ---
function abrirCancelarSesion(c) {
  const yaCanceladas = new Set(canceladasAdmin.filter((x) => x.class_schedule_id === c.id).map((x) => x.date));
  const fechas = proximasSesiones(c.day_of_week, 10).filter((f) => !yaCanceladas.has(f)).slice(0, 8);

  abrirModal(`
    <h3 style="margin-bottom:4px;">Cancelar un día de «${esc(nombreClase(c))}»</h3>
    <p class="muted" style="font-size:0.86rem; margin-bottom:14px;">Solo ese día: el resto de semanas la clase sigue igual.</p>
    <div class="field"><label for="cs-fecha">¿Qué día?</label>
      <select id="cs-fecha">${fechas.map((f) => `<option value="${f}">${DIAS_SEMANA[c.day_of_week]} ${formatFecha(f)}</option>`).join("")}</select></div>
    <div class="field"><label for="cs-motivo">Motivo (lo verán las familias)</label>
      <input id="cs-motivo" maxlength="80" placeholder="Festivo, instructor enfermo, competición…"></div>
    <p id="cs-info" class="muted" style="font-size:0.86rem; margin-bottom:12px;"></p>
    <button class="btn btn-danger" id="cs-confirmar">Cancelar esa sesión</button>
    <button class="btn btn-outline" data-cerrar style="margin-left:8px;">Volver</button>
    <p id="cs-msg" class="form-message"></p>`);

  const info = async () => {
    const el = document.getElementById("cs-info");
    try {
      const o = await api(`/bookings/occupancy?class_schedule_id=${c.id}&date=${valor("cs-fecha")}`);
      const total = o.taken + o.waitlist;
      el.textContent = total
        ? `Ese día hay ${o.taken} ${o.taken === 1 ? "reserva" : "reservas"}${o.waitlist ? ` y ${o.waitlist} en lista de espera` : ""}: ${total === 1 ? "se cancelará" : "se cancelarán"}, lo verán en «Mis reservas» y cada familia recibirá un email. Si es con poca antelación, avisad también por vuestro canal habitual (WhatsApp…).`
        : "Todavía nadie ha reservado ese día.";
    } catch (_) {
      el.textContent = "";
    }
  };
  document.getElementById("cs-fecha").addEventListener("change", info);
  info();

  alPulsar("cs-confirmar", "cs-msg", async () => {
    const fecha = valor("cs-fecha");
    const r = await api(`/admin/classes/${c.id}/cancel-session`, { method: "POST", body: JSON.stringify({ date: fecha, reason: valor("cs-motivo") }) });
    cerrarModal();
    aviso(`Sesión del ${formatFecha(fecha)} cancelada.${textoCanceladas(r.cancelled_bookings)}`);
    await recargarHorario();
  });
}

function deshacerCancelacion(id) {
  const c = canceladasAdmin.find((x) => x.id === id);
  if (!confirm(`¿Volver a abrir la sesión del ${formatFecha(c.date)} de «${c.class_name}»?\n\nSe podrá reservar otra vez. Las reservas que se cancelaron no vuelven solas: esas familias tendrán que reservar de nuevo.`)) return;
  ejecutar(() => api(`/admin/cancellations/${id}`, { method: "DELETE" }), "La sesión vuelve a estar abierta.", recargarHorario);
}

// ===========================================================================
// DISCIPLINAS Y GRUPOS
// ===========================================================================
async function cargarDisciplinas() {
  contenido(`
    <div class="toolbar">
      <button class="btn btn-primary btn-sm" id="dg-nueva">Nueva disciplina</button>
      <label class="check-inline"><input type="checkbox" id="dg-archivadas" ${verArchivadas ? "checked" : ""}> Ver también las archivadas</label>
    </div>
    <p class="muted" style="font-size:0.86rem; margin-bottom:14px;">
      Cada disciplina (BJJ, Judo…) tiene grupos por edad o nivel, y cada clase del horario pertenece a un grupo.
      Lo que ya se ha usado no se borra: se <strong>archiva</strong>, para conservar el historial de reservas y cuotas.
    </p>
    <div id="dg-lista">${CARGANDO}</div>`);
  document.getElementById("dg-nueva").addEventListener("click", () => abrirFormDisciplina(null));
  document.getElementById("dg-archivadas").addEventListener("change", (e) => { verArchivadas = e.target.checked; pintarDisciplinas(); });
  await recargarDisciplinas();
}

async function recargarDisciplinas() {
  try {
    disciplinasAdmin = await api("/admin/disciplines");
    pintarDisciplinas();
  } catch (err) {
    const cont = document.getElementById("dg-lista");
    if (cont) cont.innerHTML = errorHtml(err);
  }
}

function pintarDisciplinas() {
  const cont = document.getElementById("dg-lista");
  if (!cont) return;
  const lista = disciplinasAdmin.filter((d) => verArchivadas || d.active);
  if (!lista.length) {
    cont.innerHTML = `<div class="empty-state"><p>${disciplinasAdmin.length ? "Todas las disciplinas están archivadas." : "Todavía no hay disciplinas. Crea la primera con «Nueva disciplina»."}</p></div>`;
    return;
  }
  cont.innerHTML = lista.map(tarjetaDisciplina).join("");
  cont.querySelectorAll("[data-dg]").forEach((b) => b.addEventListener("click", () => accionDisciplina(b.dataset.dg, Number(b.dataset.id))));
}

function tarjetaDisciplina(d) {
  const grupos = d.groups.filter((g) => verArchivadas || g.active);
  const sinUso = d.groups.length === 0 && d.total_plans === 0 && d.total_gradings === 0;
  const acciones = [];
  if (d.active) acciones.push(`<button class="btn btn-primary btn-sm" data-dg="nuevo-grupo" data-id="${d.id}">Añadir grupo</button>`);
  acciones.push(`<button class="btn btn-outline btn-sm" data-dg="renombrar" data-id="${d.id}">Editar</button>`);
  acciones.push(
    d.active
      ? `<button class="btn btn-outline btn-sm" data-dg="archivar" data-id="${d.id}">Archivar</button>`
      : `<button class="btn btn-outline btn-sm" data-dg="reactivar" data-id="${d.id}">Reactivar</button>`
  );
  if (sinUso) acciones.push(`<button class="btn btn-danger btn-sm" data-dg="borrar" data-id="${d.id}">Borrar</button>`);

  return `<div class="disc-card cinta-${esc(d.color)}${d.active ? "" : " off"}">
    <div class="disc-head">
      <div><h3 class="disc-nombre">${cinta(d.color)}${esc(d.name)}</h3> ${d.active ? "" : `<span class="badge off">Archivada</span>`}
        <div class="muted" style="font-size:0.8rem;">${d.active_plans} ${d.active_plans === 1 ? "plan de cuota a la venta" : "planes de cuota a la venta"}${d.active ? ` · <a class="btn-link" href="disciplina.html?d=${encodeURIComponent(d.slug)}" target="_blank" rel="noopener">Ver su página</a>` : ""}</div>
        ${d.description ? `<p class="disc-desc">${esc(d.description)}</p>` : `<p class="disc-desc vacia">Sin descripción: escríbela en «Editar» para que salga en la portada y en su página.</p>`}</div>
      <div class="row-actions">${acciones.join("")}</div>
    </div>
    ${
      grupos.length
        ? grupos.map(lineaGrupo).join("")
        : `<p class="muted" style="font-size:0.86rem; padding-top:6px;">${d.groups.length ? "Todos sus grupos están archivados." : "Sin grupos todavía."}</p>`
    }
  </div>`;
}

function lineaGrupo(g) {
  const acciones = [`<button class="btn btn-outline btn-sm" data-dg="editar-grupo" data-id="${g.id}">Editar</button>`];
  acciones.push(
    g.active
      ? `<button class="btn btn-outline btn-sm" data-dg="archivar-grupo" data-id="${g.id}">Archivar</button>`
      : `<button class="btn btn-outline btn-sm" data-dg="reactivar-grupo" data-id="${g.id}">Reactivar</button>`
  );
  if (g.total_classes === 0) acciones.push(`<button class="btn btn-danger btn-sm" data-dg="borrar-grupo" data-id="${g.id}">Borrar</button>`);
  return `<div class="group-line${g.active ? "" : " off"}">
    <div class="info"><strong>${esc(g.name)}</strong> ${g.active ? "" : `<span class="badge off">Archivado</span>`}
      <div class="muted" style="font-size:0.82rem;">${textoEdades(g.min_age, g.max_age)} · ${g.active_classes} ${g.active_classes === 1 ? "clase" : "clases"} en el horario${g.description ? ` · ${esc(g.description)}` : ""}</div></div>
    <div class="row-actions">${acciones.join("")}</div>
  </div>`;
}

const buscarGrupo = (id) => disciplinasAdmin.flatMap((d) => d.groups).find((g) => g.id === id);

function accionDisciplina(accion, id) {
  const d = disciplinasAdmin.find((x) => x.id === id);
  const g = buscarGrupo(id);
  const activar = (url, activa, texto) =>
    ejecutar(() => api(url, { method: "PUT", body: JSON.stringify({ active: activa }) }), texto, recargarDisciplinas);

  switch (accion) {
    case "renombrar": return abrirFormDisciplina(d);
    case "nuevo-grupo": return abrirFormGrupo(null, d);
    case "archivar": return activar(`/admin/disciplines/${id}/active`, false, `«${d.name}» archivada: ya no aparece en el horario ni al crear planes.`);
    case "reactivar": return activar(`/admin/disciplines/${id}/active`, true, `«${d.name}» vuelve a estar activa.`);
    case "borrar":
      if (!confirm(`¿Borrar «${d.name}»? Nunca se ha usado, así que no se pierde nada.`)) return;
      return ejecutar(() => api(`/admin/disciplines/${id}`, { method: "DELETE" }), "Disciplina borrada.", recargarDisciplinas);
    case "editar-grupo": return abrirFormGrupo(g, disciplinasAdmin.find((x) => x.id === g.discipline_id));
    case "archivar-grupo": return activar(`/admin/groups/${id}/active`, false, `Grupo «${g.name}» archivado.`);
    case "reactivar-grupo": return activar(`/admin/groups/${id}/active`, true, `Grupo «${g.name}» reactivado.`);
    case "borrar-grupo":
      if (!confirm(`¿Borrar el grupo «${g.name}»? Nunca ha tenido clases, así que no se pierde nada.`)) return;
      return ejecutar(() => api(`/admin/groups/${id}`, { method: "DELETE" }), "Grupo borrado.", recargarDisciplinas);
  }
}

// Colores de cinturón que se pueden elegir (los mismos que utils/cinturones.js).
const CINTAS = [
  ["blanco", "Blanco"], ["gris", "Gris"], ["amarillo", "Amarillo"], ["naranja", "Naranja"], ["verde", "Verde"],
  ["azul", "Azul"], ["morado", "Morado"], ["marron", "Marrón"], ["negro", "Negro"],
];

function abrirFormDisciplina(d) {
  // Sin color elegido, se propone uno que no use ya otra disciplina.
  const usados = new Set(disciplinasAdmin.filter((x) => x.active && (!d || x.id !== d.id)).map((x) => x.color));
  const colorActual = d ? d.color : (CINTAS.find(([c]) => !usados.has(c) && c !== "blanco") || CINTAS[5])[0];
  abrirModal(`
    <h3 style="margin-bottom:12px;">${d ? "Editar disciplina" : "Nueva disciplina"}</h3>
    <div class="field"><label for="di-nombre">Nombre</label><input id="di-nombre" maxlength="60" value="${d ? esc(d.name) : ""}" placeholder="Brazilian Jiu-Jitsu, Judo, Muay Thai…"></div>
    <fieldset class="field">
      <legend class="leyenda-campo">Color de cinturón</legend>
      <p class="muted" style="font-size:0.8rem; margin:-2px 0 4px;">Identifica la disciplina en el horario, en la portada y en su página. Mejor que no se repita.</p>
      <div class="selector-cinta">
        ${CINTAS.map(([c, nombre]) => `
          <label class="cinta-${c}${usados.has(c) ? " usado" : ""}" title="${usados.has(c) ? "Ya lo usa otra disciplina" : nombre}">
            <input type="radio" name="di-color" value="${c}" ${c === colorActual ? "checked" : ""}>
            <span class="muestra-cinta"></span>${nombre}
          </label>`).join("")}
      </div>
    </fieldset>
    <div class="field">
      <label for="di-desc">Descripción (opcional)</label>
      <textarea id="di-desc" rows="4" maxlength="2000" placeholder="Qué se aprende, a quién va dirigida, cómo es una clase…">${d && d.description ? esc(d.description) : ""}</textarea>
      <small class="muted">Sale en la portada y en la página de la disciplina.</small>
    </div>
    <button class="btn btn-primary" id="di-guardar">Guardar</button>
    <button class="btn btn-outline" data-cerrar style="margin-left:8px;">Cancelar</button>
    <p id="di-msg" class="form-message"></p>`, { ancho: true });
  alPulsar("di-guardar", "di-msg", async () => {
    const elegido = document.querySelector('input[name="di-color"]:checked');
    const body = JSON.stringify({ name: valor("di-nombre"), color: elegido ? elegido.value : null, description: valor("di-desc") });
    if (d) await api(`/admin/disciplines/${d.id}`, { method: "PUT", body });
    else await api("/admin/disciplines", { method: "POST", body });
    cerrarModal();
    aviso(d ? "Disciplina guardada." : "Disciplina creada. Añádele al menos un grupo para poder crear clases.");
    await recargarDisciplinas();
  });
}

function abrirFormGrupo(g, disciplina) {
  // Un grupo que ya tiene clases no puede cambiar de disciplina (cambiaría
  // qué cuotas dan acceso a sus clases).
  const puedeMover = g && g.total_classes === 0;
  const disciplinasActivas = disciplinasAdmin.filter((d) => d.active);
  abrirModal(`
    <h3 style="margin-bottom:12px;">${g ? `Editar grupo «${esc(g.name)}»` : `Nuevo grupo de ${esc(disciplina.name)}`}</h3>
    ${
      puedeMover
        ? `<div class="field"><label for="gr-disc">Disciplina</label><select id="gr-disc">${disciplinasActivas
            .map((d) => `<option value="${d.id}" ${d.id === g.discipline_id ? "selected" : ""}>${esc(d.name)}</option>`)
            .join("")}</select></div>`
        : ""
    }
    <div class="field"><label for="gr-nombre">Nombre</label><input id="gr-nombre" maxlength="60" value="${g ? esc(g.name) : ""}" placeholder="Infantil, Adultos, Competición…"></div>
    <div class="form-grid">
      <div class="field"><label for="gr-min">Edad mínima (opcional)</label><input id="gr-min" type="number" min="0" max="99" value="${g && g.min_age != null ? g.min_age : ""}"></div>
      <div class="field"><label for="gr-max">Edad máxima (opcional)</label><input id="gr-max" type="number" min="0" max="99" value="${g && g.max_age != null ? g.max_age : ""}"></div>
    </div>
    <div class="field"><label for="gr-desc">Descripción (opcional)</label><input id="gr-desc" maxlength="200" value="${g && g.description ? esc(g.description) : ""}"></div>
    <button class="btn btn-primary" id="gr-guardar">Guardar</button>
    <button class="btn btn-outline" data-cerrar style="margin-left:8px;">Cancelar</button>
    <p id="gr-msg" class="form-message"></p>`);

  alPulsar("gr-guardar", "gr-msg", async () => {
    const datos = { name: valor("gr-nombre"), min_age: valor("gr-min"), max_age: valor("gr-max"), description: valor("gr-desc") };
    if (g) {
      if (puedeMover) datos.discipline_id = Number(valor("gr-disc"));
      await api(`/admin/groups/${g.id}`, { method: "PUT", body: JSON.stringify(datos) });
    } else {
      await api("/admin/groups", { method: "POST", body: JSON.stringify({ ...datos, discipline_id: disciplina.id }) });
    }
    cerrarModal();
    aviso(g ? "Grupo guardado." : "Grupo creado. Ya puedes añadir sus clases en «Horario».");
    await recargarDisciplinas();
  });
}
