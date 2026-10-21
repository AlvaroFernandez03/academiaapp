// js/pasar-lista.js
let clasesCache = [];

document.addEventListener("DOMContentLoaded", async () => {
  await renderHeader();

  const account = getAccount();
  if (!getToken() || !account) { window.location.href = "acceso.html?next=pasar-lista.html"; return; }
  if (account.role !== "instructor" && account.role !== "admin") {
    document.querySelector("main").innerHTML = `
      <div class="empty-state">
        <h3>Sin acceso</h3>
        <p>Esta página es solo para instructores y administración.</p>
      </div>`;
    return;
  }

  // La fecha por defecto es hoy.
  document.getElementById("sel-fecha").value = fechaISO(new Date());

  try {
    clasesCache = await api("/schedule/classes");
    const sel = document.getElementById("sel-clase");
    // Primero las clases que da quien ha entrado; después, el resto (por si
    // cubre a un compañero).
    const opcion = (c) => `<option value="${c.id}">${DIAS_SEMANA[c.day_of_week]} ${c.start_time} · ${esc(c.name || c.group_name)}</option>`;
    const mias = clasesCache.filter((c) => c.instructor_account_id === account.id);
    const otras = clasesCache.filter((c) => c.instructor_account_id !== account.id);
    sel.innerHTML += mias.length
      ? `<optgroup label="Mis clases">${mias.map(opcion).join("")}</optgroup><optgroup label="Otras clases">${otras.map(opcion).join("")}</optgroup>`
      : otras.map(opcion).join("");
  } catch (err) {
    document.getElementById("lista-alumnos").innerHTML = `<p class="form-message error">${esc(err.message)}</p>`;
    return;
  }

  document.getElementById("sel-clase").addEventListener("change", ajustarFechaYCargar);
  document.getElementById("sel-fecha").addEventListener("change", cargarLista);

  // Desde el resumen de administración se llega con ?clase=ID&fecha=AAAA-MM-DD.
  const params = new URLSearchParams(location.search);
  const claseInicial = Number(params.get("clase"));
  if (claseInicial && clasesCache.some((c) => c.id === claseInicial)) {
    document.getElementById("sel-clase").value = String(claseInicial);
    if (/^\d{4}-\d{2}-\d{2}$/.test(params.get("fecha") || "")) document.getElementById("sel-fecha").value = params.get("fecha");
    cargarLista();
  }
});

function fechaISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Al elegir una clase, ajustamos la fecha a la próxima ocurrencia real de esa
// clase (si la que había puesta no coincide con su día de la semana), para
// no tener que explicarle a nadie por qué la lista sale vacía.
function ajustarFechaYCargar() {
  const classId = Number(document.getElementById("sel-clase").value);
  if (!classId) { document.getElementById("lista-alumnos").innerHTML = ""; return; }

  const clase = clasesCache.find((c) => c.id === classId);
  const fechaInput = document.getElementById("sel-fecha");
  const fechaActual = new Date(fechaInput.value + "T12:00:00");

  if (fechaActual.getDay() !== clase.day_of_week) {
    const hoy = new Date();
    const diasDesdeHoy = (clase.day_of_week - hoy.getDay() + 7) % 7;
    const resultado = new Date(hoy);
    resultado.setDate(hoy.getDate() + diasDesdeHoy);
    fechaInput.value = fechaISO(resultado);
  }

  cargarLista();
}

async function cargarLista() {
  const classId = document.getElementById("sel-clase").value;
  const fecha = document.getElementById("sel-fecha").value;
  const cont = document.getElementById("lista-alumnos");

  if (!classId || !fecha) { cont.innerHTML = ""; return; }

  cont.innerHTML = "<p class='muted'>Cargando…</p>";

  try {
    const [lista, anuladas] = await Promise.all([
      api(`/bookings/class?class_schedule_id=${classId}&date=${fecha}`),
      api(`/schedule/cancellations?from=${fecha}&to=${fecha}`),
    ]);
    const anulada = anuladas.find((c) => c.class_schedule_id === Number(classId));
    if (anulada) {
      cont.innerHTML = `<div class="notice warn">Esta sesión está <strong>cancelada</strong>${anulada.reason ? ` (${esc(anulada.reason)})` : ""}. Las reservas se cancelaron y las familias lo ven en «Mis reservas».</div>`;
      return;
    }

    if (lista.length === 0) {
      cont.innerHTML = `<div class="empty-state"><p>Nadie ha reservado esta clase todavía.</p></div>`;
      return;
    }

    const reservados = lista.filter((r) => r.status === "reservada" || r.status === "asistio");
    const enEspera = lista.filter((r) => r.status === "en_espera");
    const vinieron = reservados.filter((r) => r.status === "asistio").length;
    // La asistencia se marca el día de la clase o después (el servidor
    // aplica la misma regla): antes, solo se ve quién ha reservado.
    const futura = fecha > fechaISO(new Date());

    cont.innerHTML = `
      <div class="lista-resumen">
        <span><strong>${reservados.length}</strong> ${reservados.length === 1 ? "confirmado" : "confirmados"}</span>
        ${futura ? "" : `<span><strong>${vinieron}</strong> ${vinieron === 1 ? "ha venido" : "han venido"}</span>`}
        ${enEspera.length ? `<span><strong>${enEspera.length}</strong> en lista de espera</span>` : ""}
      </div>
      ${futura ? `<div class="notice">Esta clase todavía no ha llegado: podrás marcar la asistencia ese día.</div>` : ""}
      ${reservados.map((r) => filaAlumno(r, futura)).join("") || "<p class='muted'>Nadie confirmado todavía.</p>"}
      ${
        enEspera.length > 0
          ? `<h2 class="lista-sub">Lista de espera</h2>${enEspera.map((r) => filaAlumno(r, true)).join("")}`
          : ""
      }`;

    cont.querySelectorAll("[data-asistencia]").forEach((btn) => {
      btn.addEventListener("click", () => cambiarAsistencia(btn.dataset.asistencia, btn.dataset.vino === "1", btn));
    });
  } catch (err) {
    cont.innerHTML = `<p class="form-message error">${esc(err.message)}</p>`;
  }
}

function filaAlumno(r, sinBoton) {
  const edad = r.birth_date ? calcularEdad(r.birth_date) : null;
  const vino = r.status === "asistio";
  let accion = "";
  if (!sinBoton && r.status !== "en_espera") {
    accion = vino
      ? `<button class="btn btn-sm btn-vino" data-asistencia="${r.id}" data-vino="1" aria-pressed="true" title="Pulsa para deshacer">✓ Ha venido</button>`
      : `<button class="btn btn-outline btn-sm" data-asistencia="${r.id}" data-vino="0" aria-pressed="false">Marcar asistencia</button>`;
  }
  return `
    <div class="asistente${vino ? " vino" : ""}${r.status === "en_espera" ? " espera" : ""}">
      ${avatarHtml(r)}
      <div class="asistente-datos">
        <strong>${esc(r.first_name)} ${esc(r.last_name)}</strong>
        <span class="muted">${edad !== null && !isNaN(edad) ? `${edad} años` : ""}${r.is_trial ? ' <span class="badge prueba">Clase de prueba</span>' : ""}${r.status === "en_espera" ? ' <span class="badge en_espera">En espera</span>' : ""}</span>
        ${r.medical_notes ? `<span class="asistente-medica">${esc(r.medical_notes)}</span>` : ""}
      </div>
      ${accion}
    </div>`;
}

function calcularEdad(birthDate) {
  const hoy = new Date();
  const nacimiento = new Date(birthDate + "T12:00:00");
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const m = hoy.getMonth() - nacimiento.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nacimiento.getDate())) edad--;
  return edad;
}

// Marcar o deshacer (si se marcó a quien no era).
async function cambiarAsistencia(bookingId, yaVino, boton) {
  boton.disabled = true;
  try {
    await api(`/bookings/${bookingId}/attendance`, { method: "PUT", body: JSON.stringify({ attended: !yaVino }) });
    cargarLista();
  } catch (err) {
    boton.disabled = false;
    alert(err.message);
  }
}
