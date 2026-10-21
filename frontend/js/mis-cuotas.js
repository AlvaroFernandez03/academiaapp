// js/mis-cuotas.js
let datos = null; // respuesta de /billing/overview

document.addEventListener("DOMContentLoaded", async () => {
  await renderHeader();
  if (!getToken()) { window.location.href = "acceso.html?next=mis-cuotas.html"; return; }

  await gestionarVueltaDeStripe();
  cargar();
});

// ---------------------------------------------------------------------------
// Vuelta desde la página de Stripe donde se guarda la tarjeta.
// Stripe nos devuelve a mis-cuotas.html?setup=ok&session_id=... Confirmamos
// con el servidor en ese momento (así la cuota se activa al instante) — y
// si esa petición fallara, el webhook de Stripe hace lo mismo por detrás.
// ---------------------------------------------------------------------------
async function gestionarVueltaDeStripe() {
  const params = new URLSearchParams(location.search);
  const setup = params.get("setup");
  if (!setup) return;

  // Limpiamos la URL para que un recargar de página no repita la confirmación.
  history.replaceState(null, "", "mis-cuotas.html");

  // El backend manda a Stripe volver con ?setup=cancelado (aceptamos también "cancel").
  if (setup === "cancelado" || setup === "cancel") {
    aviso("No se ha guardado ninguna tarjeta. Puedes intentarlo de nuevo cuando quieras.", "warn");
    return;
  }
  const sessionId = params.get("session_id");
  if (setup === "ok" && sessionId) {
    try {
      await api("/billing/confirm-setup", { method: "POST", body: JSON.stringify({ session_id: sessionId }) });
      aviso("Tarjeta guardada. Las cuotas pendientes se han puesto en marcha.", "ok");
    } catch (err) {
      aviso(`La tarjeta se ha guardado, pero no hemos podido confirmar el cobro todavía: ${esc(err.message)} Si en unos minutos sigue igual, pulsa «Reintentar cobro».`, "warn");
    }
  }
}

function aviso(html, tipo = "") {
  document.getElementById("aviso").innerHTML = `<div class="notice ${tipo}">${html}</div>`;
}

async function cargar() {
  try {
    datos = await api("/billing/overview");
    pintarMetodoPago();
    pintarMiembros();
    pintarPagos();
  } catch (err) {
    document.getElementById("miembros").innerHTML = `<p class="form-message error">${esc(err.message)}</p>`;
  }
}

// ---------------------------------------------------------------------------
// Bloque "forma de pago"
// ---------------------------------------------------------------------------
function pintarMetodoPago() {
  const cont = document.getElementById("metodo-pago");
  if (datos.card_demo) {
    cont.innerHTML = `<div class="billing-card" style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
         <div><strong>Sin tarjeta guardada</strong> <span class="badge pendiente_pago">Demostración</span><div class="muted" style="font-size:0.85rem;">Añádela una vez y las cuotas con tarjeta se cobrarán solas cada mes. También puedes pagar en recepción.</div></div>
         <button class="btn btn-primary btn-sm" id="btn-setup">Añadir tarjeta</button>
       </div>`;
    document.getElementById("btn-setup").addEventListener("click", avisoDemoTarjeta);
    return;
  }
  if (!datos.stripe_enabled) {
    cont.innerHTML = `<div class="notice">Las cuotas se pagan en recepción (efectivo, transferencia, Bizum o datáfono).</div>`;
    return;
  }

  cont.innerHTML = datos.has_payment_method
    ? `<div class="billing-card" style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
         <div><strong>Tarjeta guardada</strong><div class="muted" style="font-size:0.85rem;">Las cuotas con tarjeta se cobran solas cada mes.</div></div>
         <button class="btn btn-outline btn-sm" id="btn-portal">Cambiar tarjeta y ver facturas</button>
       </div>`
    : `<div class="billing-card" style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
         <div><strong>Sin tarjeta guardada</strong><div class="muted" style="font-size:0.85rem;">Añádela una vez y las cuotas con tarjeta se cobrarán solas cada mes.</div></div>
         <button class="btn btn-primary btn-sm" id="btn-setup">Añadir tarjeta</button>
       </div>`;

  const portal = document.getElementById("btn-portal");
  if (portal) portal.addEventListener("click", irAlPortal);
  const setupBtn = document.getElementById("btn-setup");
  if (setupBtn) setupBtn.addEventListener("click", irAGuardarTarjeta);
}

async function irAGuardarTarjeta() {
  try {
    const { url } = await api("/billing/setup-session", { method: "POST" });
    window.location.href = url; // página segura de Stripe: los datos de la tarjeta nunca pasan por nuestro servidor
  } catch (err) {
    alert(err.message);
  }
}

// Modo demostración: se enseña cómo funcionaría el pago con tarjeta, sin
// guardar ninguna tarjeta ni crear la cuota.
function avisoDemoTarjeta() {
  abrirModal(`
    <h3 style="margin-bottom:8px;">Pago con tarjeta: próximamente</h3>
    <p style="margin-bottom:10px;">Aquí se abriría la <strong>página segura de Stripe</strong> para guardar la tarjeta una sola vez. A partir de ahí, cada cuota se cobraría sola cada mes, y la familia podría cambiar la tarjeta y descargar sus recibos.</p>
    <p class="muted" style="font-size:0.86rem; margin-bottom:14px;">Esta opción está en demostración: no se ha guardado ninguna tarjeta ni se ha cobrado nada. Mientras tanto, las cuotas se pueden contratar con pago en recepción.</p>
    <button class="btn btn-primary" data-cerrar>Entendido</button>`);
}

async function irAlPortal() {
  try {
    const { url } = await api("/billing/portal-session", { method: "POST" });
    window.location.href = url;
  } catch (err) {
    alert(err.message);
  }
}

// ---------------------------------------------------------------------------
// Una tarjeta por miembro, con sus cuotas y acciones
// ---------------------------------------------------------------------------
function pintarMiembros() {
  const cont = document.getElementById("miembros");
  if (datos.members.length === 0) {
    cont.innerHTML = `<div class="empty-state"><p>Añade primero a alguien en «Mi familia» para poder contratarle una cuota.</p><a class="btn btn-primary" href="mi-familia.html">Ir a Mi familia</a></div>`;
    return;
  }

  cont.innerHTML = datos.members
    .map(
      (m) => `
      <div class="billing-card">
        <div class="billing-card-head">
          ${avatarHtml(m)}
          <div style="flex:1;"><strong>${esc(m.first_name)} ${esc(m.last_name)}</strong></div>
          <button class="btn btn-outline btn-sm" data-contratar="${m.id}">Contratar cuota</button>
        </div>
        ${m.memberships.length ? m.memberships.map(lineaCuota).join("") : `<div class="membership-line"><span class="muted" style="font-size:0.87rem;">Sin cuota: puede hacer una clase de prueba gratuita.</span></div>`}
      </div>`
    )
    .join("");

  cont.querySelectorAll("[data-contratar]").forEach((b) => b.addEventListener("click", () => abrirContratar(Number(b.dataset.contratar))));
  cont.querySelectorAll("[data-accion]").forEach((b) => b.addEventListener("click", () => ejecutarAccion(b.dataset.accion, Number(b.dataset.id))));
}

function lineaCuota(c) {
  const tarjeta = c.payment_method === "stripe";
  let detalle = "";
  let acciones = "";

  switch (c.status) {
    case "activa":
      detalle = c.cancel_at_period_end
        ? `Baja solicitada: sigue activa hasta el ${formatFecha(c.current_period_end)}.`
        : tarjeta
        ? `Próximo cobro: ${formatFecha(c.current_period_end)}.`
        : `Pagada hasta el ${formatFecha(c.current_period_end)}.`;
      if (!c.cancel_at_period_end) {
        acciones = `<button class="btn btn-outline btn-sm" data-accion="pausar" data-id="${c.id}">Pausar</button>
                    <button class="btn btn-outline btn-sm" data-accion="baja" data-id="${c.id}">Dar de baja</button>`;
      }
      break;
    case "pausada":
      detalle = `Pausada hasta el ${formatFecha(c.paused_until)}. Se reanuda sola ese día.`;
      acciones = `<button class="btn btn-outline btn-sm" data-accion="reanudar" data-id="${c.id}">Reanudar ya</button>`;
      break;
    case "impagada":
      detalle = tarjeta ? "No se ha podido cobrar la última cuota." : "La cuota ha vencido. Pásate por recepción para renovarla.";
      if (c.action_url && /^https:\/\//.test(c.action_url)) {
        acciones += `<a class="btn btn-primary btn-sm" href="${esc(c.action_url)}" target="_blank" rel="noopener">Completar pago</a> `;
      }
      if (tarjeta) acciones += `<button class="btn btn-outline btn-sm" data-accion="reintentar" data-id="${c.id}">Reintentar cobro</button>`;
      break;
    case "pendiente_pago":
      if (!tarjeta) {
        detalle = "Se activará en cuanto la pagues en recepción.";
      } else if (!datos.has_payment_method) {
        detalle = "Falta añadir una tarjeta para poder cobrarla.";
        acciones = `<button class="btn btn-primary btn-sm" data-accion="tarjeta" data-id="${c.id}">Añadir tarjeta</button>`;
      } else {
        detalle = "Todavía no se ha podido cobrar.";
        acciones = `<button class="btn btn-outline btn-sm" data-accion="reintentar" data-id="${c.id}">Reintentar cobro</button>`;
      }
      if (c.action_url && /^https:\/\//.test(c.action_url)) {
        acciones = `<a class="btn btn-primary btn-sm" href="${esc(c.action_url)}" target="_blank" rel="noopener">Completar pago</a> ` + acciones;
      }
      break;
    case "procesando":
      detalle = "Estamos confirmando el cobro con el banco. Recarga en unos segundos.";
      break;
    case "cancelada":
      detalle = "Dada de baja.";
      break;
  }

  // Una cuota pendiente de pago también se puede anular (por si se contrató por error).
  if (c.status === "pendiente_pago" || c.status === "impagada") {
    acciones += ` <button class="btn btn-outline btn-sm" data-accion="baja" data-id="${c.id}">Anular</button>`;
  }

  const limite = c.max_classes_per_week ? ` · ${c.max_classes_per_week} clases/semana` : "";
  return `
    <div class="membership-line">
      <div class="ml-info">
        <strong>${esc(c.plan_name)}</strong> <span class="badge ${c.status}">${ESTADOS_CUOTA[c.status] || c.status}</span>
        <div class="ml-sub">${formatEuros(c.price_cents)}/mes · ${tarjeta ? "Tarjeta" : "En recepción"}${limite}</div>
        <div class="ml-sub">${detalle}</div>
      </div>
      <div class="ml-actions">${acciones}</div>
    </div>`;
}

async function ejecutarAccion(accion, id) {
  try {
    if (accion === "pausar") return abrirPausa(id);
    if (accion === "tarjeta") return irAGuardarTarjeta();
    if (accion === "baja") {
      const c = buscarCuota(id);
      const texto =
        c.status === "activa"
          ? `¿Dar de baja «${c.plan_name}»? Seguirá activa hasta el final del periodo ya pagado (${formatFecha(c.current_period_end)}) y no se volverá a cobrar.`
          : `¿Anular «${c.plan_name}»?`;
      if (!confirm(texto)) return;
      await api(`/billing/memberships/${id}/cancel`, { method: "POST" });
      aviso("Baja registrada.", "ok");
    }
    if (accion === "reanudar") {
      await api(`/billing/memberships/${id}/resume`, { method: "POST" });
      aviso("Cuota reanudada.", "ok");
    }
    if (accion === "reintentar") {
      await api(`/billing/memberships/${id}/retry`, { method: "POST" });
      aviso("Hemos vuelto a intentar el cobro.", "ok");
    }
    cargar();
  } catch (err) {
    alert(err.message);
    cargar();
  }
}

function buscarCuota(id) {
  for (const m of datos.members) {
    const c = m.memberships.find((x) => x.id === id);
    if (c) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Modales
// ---------------------------------------------------------------------------
function abrirModal(html) {
  const modal = document.getElementById("modal");
  modal.innerHTML = `<div class="form-card">${html}</div>`;
  modal.classList.remove("hidden");
  modal.onclick = (e) => { if (e.target === modal) cerrarModal(); };
  const cerrar = modal.querySelector("[data-cerrar]");
  if (cerrar) cerrar.addEventListener("click", cerrarModal);
}
function cerrarModal() {
  const modal = document.getElementById("modal");
  modal.classList.add("hidden");
  modal.innerHTML = "";
}

function abrirContratar(memberId) {
  const miembro = datos.members.find((m) => m.id === memberId);
  // No ofrecemos planes que ya tiene vivos (el servidor lo impediría igualmente).
  const yaTiene = new Set(miembro.memberships.filter((c) => c.status !== "cancelada").map((c) => c.plan_id));
  const planes = datos.plans.filter((p) => !yaTiene.has(p.id));

  if (planes.length === 0) {
    abrirModal(`<h3>No hay más planes disponibles</h3><p class="muted" style="margin:10px 0;">${esc(miembro.first_name)} ya tiene todos los planes que ofrece la academia.</p><button class="btn btn-outline" data-cerrar>Cerrar</button>`);
    return;
  }

  const metodos = [];
  if (datos.stripe_enabled) metodos.push({ v: "stripe", t: "Con tarjeta", d: "Se cobra sola cada mes." });
  if (datos.card_demo) metodos.push({ v: "stripe", t: "Con tarjeta", d: "Se cobra sola cada mes. (Próximamente)" });
  if (datos.allow_manual_payment) metodos.push({ v: "manual", t: "En recepción", d: "Efectivo, transferencia, Bizum o datáfono." });

  abrirModal(`
    <h3 style="margin-bottom:4px;">Contratar cuota</h3>
    <p class="muted" style="font-size:0.86rem; margin-bottom:14px;">Para ${esc(miembro.first_name)} ${esc(miembro.last_name)}</p>

    <div class="field"><label>Plan</label>
      ${planes
        .map(
          (p, i) => `
        <label class="radio-row"><input type="radio" name="plan" value="${p.id}" ${i === 0 ? "checked" : ""}>
          <span><strong>${esc(p.name)}</strong> — ${formatEuros(p.price_cents)}/mes
            <small>${p.scope === "all" ? "Todas las disciplinas" : esc(p.discipline_name)}${p.max_classes_per_week ? ` · ${p.max_classes_per_week} clases/semana` : " · clases ilimitadas"}${p.description ? " · " + esc(p.description) : ""}</small>
          </span></label>`
        )
        .join("")}
    </div>

    <div class="field"><label>Forma de pago</label>
      ${metodos
        .map((m, i) => `<label class="radio-row"><input type="radio" name="metodo" value="${m.v}" ${i === 0 ? "checked" : ""}><span><strong>${m.t}</strong><small>${m.d}</small></span></label>`)
        .join("")}
    </div>

    <button class="btn btn-primary" id="confirmar-contrato">Contratar</button>
    <button class="btn btn-outline" data-cerrar style="margin-left:8px;">Cancelar</button>
    <p id="contrato-msg" class="form-message"></p>`);

  document.getElementById("confirmar-contrato").addEventListener("click", () => contratar(memberId));
}

async function contratar(memberId) {
  const msg = document.getElementById("contrato-msg");
  const btn = document.getElementById("confirmar-contrato");
  msg.textContent = ""; msg.className = "form-message";
  const metodo = document.querySelector('input[name="metodo"]:checked').value;
  if (metodo === "stripe" && datos.card_demo) return avisoDemoTarjeta();
  btn.disabled = true;

  try {
    const r = await api("/billing/memberships", {
      method: "POST",
      body: JSON.stringify({
        member_id: memberId,
        plan_id: Number(document.querySelector('input[name="plan"]:checked').value),
        payment_method: metodo,
      }),
    });
    cerrarModal();

    if (r.next_step === "add_payment_method") {
      if (confirm("Cuota creada. Para activarla falta guardar una tarjeta. ¿Ir ahora a la página segura de pago?")) return irAGuardarTarjeta();
      aviso("Cuota creada. Se activará cuando añadas una tarjeta.", "warn");
    } else if (r.next_step === "pay_at_desk") {
      aviso("Cuota creada. Se activará en cuanto la pagues en recepción.", "ok");
    } else {
      aviso(r.membership && r.membership.status === "activa" ? "¡Cuota activada!" : "Cuota creada. Revisa su estado abajo.", "ok");
    }
    cargar();
  } catch (err) {
    msg.textContent = err.message; msg.classList.add("error");
    btn.disabled = false;
  }
}

function abrirPausa(id) {
  const c = buscarCuota(id);
  const hoy = new Date();
  const manana = new Date(hoy); manana.setDate(hoy.getDate() + 1);
  const max = new Date(hoy); max.setDate(hoy.getDate() + datos.max_pause_days);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  abrirModal(`
    <h3 style="margin-bottom:4px;">Pausar «${esc(c.plan_name)}»</h3>
    <p class="muted" style="font-size:0.86rem; margin-bottom:14px;">
      Por lesión, vacaciones… Mientras esté pausada no se cobra ni se puede reservar con ella.
      ${c.payment_method === "manual" ? "Los días de pausa se suman a la fecha hasta la que tienes pagado." : ""}
      Máximo ${datos.max_pause_days} días.
    </p>
    <div class="field"><label for="pausa-hasta">¿Hasta cuándo?</label>
      <input type="date" id="pausa-hasta" min="${iso(manana)}" max="${iso(max)}"></div>
    <button class="btn btn-primary" id="confirmar-pausa">Pausar</button>
    <button class="btn btn-outline" data-cerrar style="margin-left:8px;">Cancelar</button>
    <p id="pausa-msg" class="form-message"></p>`);

  document.getElementById("confirmar-pausa").addEventListener("click", async () => {
    const msg = document.getElementById("pausa-msg");
    try {
      await api(`/billing/memberships/${id}/pause`, { method: "POST", body: JSON.stringify({ until: document.getElementById("pausa-hasta").value }) });
      cerrarModal();
      aviso("Cuota pausada.", "ok");
      cargar();
    } catch (err) {
      msg.textContent = err.message; msg.className = "form-message error";
    }
  });
}

// ---------------------------------------------------------------------------
// Historial de pagos
// ---------------------------------------------------------------------------
function pintarPagos() {
  const cont = document.getElementById("pagos");
  if (datos.payments.length === 0) {
    cont.innerHTML = `<p class="muted">Todavía no hay pagos registrados.</p>`;
    return;
  }
  cont.innerHTML = `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Fecha</th><th>Concepto</th><th>Periodo</th><th>Forma</th><th class="num">Importe</th></tr></thead>
      <tbody>
        ${datos.payments
          .map(
            (p) => `<tr>
              <td>${formatFecha(p.created_at)}</td>
              <td>${esc(p.plan_name || "Cuota")}${p.member_first_name ? " · " + esc(p.member_first_name) : ""}</td>
              <td>${p.period_start ? formatFecha(p.period_start) + " – " + formatFecha(p.period_end) : "—"}</td>
              <td>${METODOS_PAGO[p.method] || esc(p.method)}</td>
              <td class="num">${formatEuros(p.amount_cents)}</td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table></div>`;
}
