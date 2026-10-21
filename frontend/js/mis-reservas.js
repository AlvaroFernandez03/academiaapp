// js/mis-reservas.js
//
// Las reservas de toda la familia en dos bloques:
//  - Próximas: las que todavía no han empezado (se pueden anular).
//  - Historial: las pasadas, las asistidas y las anuladas (solo se consultan).
// La regla de "hasta que empiece la clase" la aplica también el servidor.
const ESTADOS = { reservada: "Reservada", en_espera: "En lista de espera", cancelada: "Anulada", asistio: "Asististe" };
const HISTORIAL_VISIBLE = 15; // el resto, con "Ver más"

document.addEventListener("DOMContentLoaded", async () => {
  await renderHeader();
  if (!getToken()) { window.location.href = "acceso.html?next=mis-reservas.html"; return; }
  cargarReservas();
});

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function horaAhora() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
// ¿Todavía no ha empezado? (mismo criterio que el servidor)
const porLlegar = (r) => r.date > hoyISO() || (r.date === hoyISO() && r.start_time > horaAhora());

async function cargarReservas() {
  const cont = document.getElementById("bookings-list");
  cont.innerHTML = "<p class='muted'>Cargando…</p>";

  try {
    const reservas = await api("/bookings/mine");

    if (reservas.length === 0) {
      cont.innerHTML = `<div class="empty-state"><p>Todavía no tienes ninguna reserva.</p><a class="btn btn-primary" href="horario.html">Ver el horario</a></div>`;
      return;
    }

    const proximas = reservas
      .filter((r) => porLlegar(r) && (r.status === "reservada" || r.status === "en_espera"))
      .sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time)); // la más cercana primero
    const historial = reservas.filter((r) => !proximas.includes(r)); // ya vienen de la más reciente a la más antigua

    cont.innerHTML = `
      <section class="reservas-bloque">
        <h2>Próximas</h2>
        ${proximas.length
          ? proximas.map((r) => filaReserva(r, true)).join("")
          : `<div class="empty-state compacto"><p>No tienes ninguna clase reservada.</p><a class="btn btn-primary" href="horario.html">Reservar una clase</a></div>`}
      </section>
      ${historial.length ? `
      <section class="reservas-bloque">
        <h2>Historial</h2>
        ${historial.map((r, i) => filaReserva(r, false, i >= HISTORIAL_VISIBLE)).join("")}
        ${historial.length > HISTORIAL_VISIBLE ? `<button class="btn btn-outline btn-sm" id="ver-mas">Ver las ${historial.length - HISTORIAL_VISIBLE} anteriores</button>` : ""}
      </section>` : ""}`;

    cont.querySelectorAll("[data-cancelar]").forEach((btn) => {
      btn.addEventListener("click", () => cancelarReserva(btn.dataset.cancelar, btn));
    });
    const verMas = document.getElementById("ver-mas");
    if (verMas) verMas.addEventListener("click", () => {
      cont.querySelectorAll(".reserva.oculta").forEach((el) => el.classList.remove("oculta"));
      verMas.remove();
    });
  } catch (err) {
    cont.innerHTML = `<p class="form-message error">${esc(err.message)}</p>`;
  }
}

function filaReserva(r, proxima, oculta = false) {
  const d = new Date(r.date + "T12:00:00");
  const diaSemana = d.toLocaleDateString("es-ES", { weekday: "short" }).replace(".", "");
  const mes = d.toLocaleDateString("es-ES", { month: "short" }).replace(".", "");
  // Una reservada del pasado sin asistencia marcada: no consta que viniera.
  const sinMarcar = !proxima && r.status === "reservada";
  const estado = sinMarcar ? "Sin asistencia marcada" : ESTADOS[r.status] || r.status;

  return `
    <article class="reserva cinta-${esc(r.discipline_color)}${proxima ? "" : " pasada"}${oculta ? " oculta" : ""}">
      <div class="reserva-fecha" aria-hidden="true"><span>${esc(diaSemana)}</span><strong>${d.getDate()}</strong><small>${esc(mes)}</small></div>
      <div class="reserva-datos">
        <strong>${esc(r.class_name || r.group_name)}</strong>
        <span class="muted">${esc(r.first_name)} ${esc(r.last_name)} · ${r.start_time}–${r.end_time} · ${esc(r.discipline_name)}</span>
        <span class="reserva-estado">${r.is_trial ? '<span class="badge prueba">Clase de prueba</span> ' : ""}<span class="badge ${sinMarcar ? "" : esc(r.status)}">${esc(estado)}</span></span>
        ${r.status === "cancelada" && r.cancel_note ? `<span class="cancel-note">${esc(r.cancel_note)}</span>` : ""}
      </div>
      ${proxima ? `<button class="btn btn-outline btn-sm" data-cancelar="${r.id}">Anular</button>` : ""}
    </article>`;
}

async function cancelarReserva(id, boton) {
  if (!confirm("¿Seguro que quieres anular esta reserva?")) return;
  boton.disabled = true;
  try {
    await api(`/bookings/${id}/cancel`, { method: "PUT" });
    cargarReservas();
  } catch (err) {
    boton.disabled = false;
    alert(err.message);
  }
}
