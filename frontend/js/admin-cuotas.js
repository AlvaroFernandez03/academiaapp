// js/admin-cuotas.js
let tabActual = "cuotas";

document.addEventListener("DOMContentLoaded", async () => {
  await renderHeader();
  const account = getAccount();
  if (!getToken() || !account) { window.location.href = "acceso.html?next=admin-cuotas.html"; return; }
  if (account.role !== "admin") {
    document.querySelector("main").innerHTML = `<div class="empty-state"><h3>Sin acceso</h3><p>Esta página es solo para la administración de la academia.</p></div>`;
    return;
  }

  document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => abrirTab(b.dataset.tab)));
  abrirTab("cuotas");
});

function abrirTab(tab) {
  tabActual = tab;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === tab));
  document.getElementById("aviso").innerHTML = "";
  ({ cuotas: cargarCuotas, pagos: cargarPagos, planes: cargarPlanes, ajustes: cargarAjustes })[tab]();
}

function aviso(texto, tipo = "ok") {
  document.getElementById("aviso").innerHTML = `<div class="notice ${tipo}">${esc(texto)}</div>`;
}
function contenido(html) {
  document.getElementById("contenido").innerHTML = html;
}

function abrirModal(html) {
  const modal = document.getElementById("modal");
  modal.innerHTML = `<div class="form-card">${html}</div>`;
  modal.classList.remove("hidden");
  modal.onclick = (e) => { if (e.target === modal) cerrarModal(); };
  modal.querySelectorAll("[data-cerrar]").forEach((b) => b.addEventListener("click", cerrarModal));
}
function cerrarModal() {
  const modal = document.getElementById("modal");
  modal.classList.add("hidden");
  modal.innerHTML = "";
}

// ---------------------------------------------------------------------------
// CUOTAS
// ---------------------------------------------------------------------------
let cuotasCache = [];

async function cargarCuotas() {
  contenido(`
    <div class="filter-row">
      <select id="filtro-estado">
        <option value="">Todas</option>
        ${Object.entries(ESTADOS_CUOTA).map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}
      </select>
      <input id="filtro-texto" placeholder="Buscar por nombre o email…">
    </div>
    <div id="tabla-cuotas"><p class="muted">Cargando…</p></div>`);

  document.getElementById("filtro-estado").addEventListener("change", pedirCuotas);
  document.getElementById("filtro-texto").addEventListener("input", pintarCuotas);
  pedirCuotas();
}

async function pedirCuotas() {
  const estado = document.getElementById("filtro-estado").value;
  try {
    cuotasCache = await api(`/admin/billing/memberships${estado ? "?status=" + estado : ""}`);
    pintarCuotas();
  } catch (err) {
    document.getElementById("tabla-cuotas").innerHTML = `<p class="form-message error">${esc(err.message)}</p>`;
  }
}

function pintarCuotas() {
  const q = document.getElementById("filtro-texto").value.trim().toLowerCase();
  const filas = cuotasCache.filter((c) =>
    !q || `${c.first_name} ${c.last_name} ${c.account_name} ${c.account_email}`.toLowerCase().includes(q)
  );
  const cont = document.getElementById("tabla-cuotas");

  if (filas.length === 0) {
    cont.innerHTML = `<div class="empty-state"><p>No hay cuotas con ese filtro.</p></div>`;
    return;
  }

  cont.innerHTML = `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Alumno</th><th>Plan</th><th>Estado</th><th>Pago</th><th>Hasta / próximo cobro</th><th class="num">Precio</th><th></th></tr></thead>
      <tbody>
        ${filas
          .map((c) => {
            const acciones = [];
            if (c.payment_method === "manual" && c.status !== "cancelada") {
              acciones.push(`<button class="btn btn-primary btn-sm" data-pago="${c.id}">Registrar pago</button>`);
            }
            if (c.status !== "cancelada" && !c.cancel_at_period_end) {
              acciones.push(`<button class="btn btn-outline btn-sm" data-baja="${c.id}">Dar de baja</button>`);
            }
            let fecha = formatFecha(c.current_period_end);
            if (c.status === "pausada") fecha = `Pausada hasta ${formatFecha(c.paused_until)}`;
            if (c.cancel_at_period_end) fecha += " (baja a final de periodo)";
            return `<tr>
              <td><strong>${esc(c.first_name)} ${esc(c.last_name)}</strong>
                  <div class="muted" style="font-size:0.8rem;">${esc(c.account_name)} · ${esc(c.account_phone || c.account_email)}</div></td>
              <td>${esc(c.plan_name)}</td>
              <td><span class="badge ${c.status}">${ESTADOS_CUOTA[c.status] || c.status}</span></td>
              <td>${c.payment_method === "stripe" ? "Tarjeta" : "Recepción"}</td>
              <td>${c.current_period_end || c.status === "pausada" ? fecha : "—"}</td>
              <td class="num">${formatEuros(c.price_cents)}</td>
              <td><div class="ml-actions">${acciones.join("")}</div></td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table></div>`;

  cont.querySelectorAll("[data-pago]").forEach((b) => b.addEventListener("click", () => abrirPagoManual(Number(b.dataset.pago))));
  cont.querySelectorAll("[data-baja]").forEach((b) => b.addEventListener("click", () => darDeBaja(Number(b.dataset.baja))));
}

function abrirPagoManual(id) {
  const c = cuotasCache.find((x) => x.id === id);
  abrirModal(`
    <h3 style="margin-bottom:4px;">Registrar pago</h3>
    <p class="muted" style="font-size:0.86rem; margin-bottom:14px;">${esc(c.first_name)} ${esc(c.last_name)} · ${esc(c.plan_name)} · ${formatEuros(c.price_cents)}/mes</p>
    <div class="field"><label for="pm-metodo">Forma de pago</label>
      <select id="pm-metodo">
        <option value="efectivo">Efectivo</option><option value="bizum">Bizum</option>
        <option value="transferencia">Transferencia</option><option value="tpv">Datáfono</option>
      </select></div>
    <div class="field"><label for="pm-meses">Meses que paga</label><input type="number" id="pm-meses" min="1" max="12" value="1"></div>
    <p class="muted" id="pm-total" style="font-size:0.88rem; margin-bottom:12px;"></p>
    <div class="field"><label for="pm-notas">Notas (opcional)</label><input id="pm-notas" placeholder="Nº de recibo, referencia de Bizum…"></div>
    <button class="btn btn-primary" id="pm-guardar">Registrar</button>
    <button class="btn btn-outline" data-cerrar style="margin-left:8px;">Cancelar</button>
    <p id="pm-msg" class="form-message"></p>`);

  const total = () => {
    const meses = Number(document.getElementById("pm-meses").value) || 0;
    document.getElementById("pm-total").textContent = `Total a cobrar: ${formatEuros(c.price_cents * meses)}`;
  };
  document.getElementById("pm-meses").addEventListener("input", total);
  total();

  document.getElementById("pm-guardar").addEventListener("click", async () => {
    const btn = document.getElementById("pm-guardar");
    btn.disabled = true; // evita registrar el mismo pago dos veces por un doble clic
    try {
      await api(`/admin/billing/memberships/${id}/manual-payment`, {
        method: "POST",
        body: JSON.stringify({
          method: document.getElementById("pm-metodo").value,
          months: Number(document.getElementById("pm-meses").value),
          notes: document.getElementById("pm-notas").value.trim(),
        }),
      });
      cerrarModal();
      aviso("Pago registrado.");
      pedirCuotas();
    } catch (err) {
      const msg = document.getElementById("pm-msg");
      msg.textContent = err.message; msg.className = "form-message error";
      btn.disabled = false;
    }
  });
}

async function darDeBaja(id) {
  const c = cuotasCache.find((x) => x.id === id);
  const texto =
    c.payment_method === "stripe" && c.status === "activa"
      ? `¿Dar de baja «${c.plan_name}» de ${c.first_name}? No se volverá a cobrar; sigue activa hasta el final del periodo pagado.`
      : `¿Dar de baja «${c.plan_name}» de ${c.first_name}?`;
  if (!confirm(texto)) return;
  try {
    await api(`/admin/billing/memberships/${id}/cancel`, { method: "POST" });
    aviso("Baja registrada.");
    pedirCuotas();
  } catch (err) {
    alert(err.message);
  }
}

// ---------------------------------------------------------------------------
// PAGOS
// ---------------------------------------------------------------------------
async function cargarPagos() {
  contenido(`<p class="muted">Cargando…</p>`);
  try {
    const pagos = await api("/admin/billing/payments");
    if (pagos.length === 0) return contenido(`<div class="empty-state"><p>Todavía no hay pagos registrados.</p></div>`);

    const esteMes = new Date().toISOString().slice(0, 7);
    const totalMes = pagos.filter((p) => String(p.created_at).startsWith(esteMes)).reduce((s, p) => s + p.amount_cents, 0);

    contenido(`
      <div class="notice">Cobrado este mes (según los últimos 200 pagos): <strong>${formatEuros(totalMes)}</strong></div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Fecha</th><th>Familia</th><th>Concepto</th><th>Forma</th><th>Notas</th><th class="num">Importe</th></tr></thead>
        <tbody>
          ${pagos
            .map(
              (p) => `<tr>
                <td>${formatFecha(p.created_at)}</td>
                <td>${esc(p.account_name)}</td>
                <td>${esc(p.plan_name || "Cuota")}${p.member_first_name ? " · " + esc(p.member_first_name) : ""}</td>
                <td>${METODOS_PAGO[p.method] || esc(p.method)}</td>
                <td class="muted">${esc(p.notes || "")}</td>
                <td class="num">${formatEuros(p.amount_cents)}</td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table></div>`);
  } catch (err) {
    contenido(`<p class="form-message error">${esc(err.message)}</p>`);
  }
}

// ---------------------------------------------------------------------------
// PLANES
// ---------------------------------------------------------------------------
let planesCache = [];

async function cargarPlanes() {
  contenido(`<p class="muted">Cargando…</p>`);
  try {
    const [planes, disciplinas] = await Promise.all([api("/admin/billing/plans"), api("/schedule/disciplines")]);
    planesCache = planes;

    contenido(`
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Plan</th><th>Incluye</th><th>Límite</th><th class="num">Precio/mes</th><th class="num">Cuotas vivas</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${planes
            .map(
              (p) => `<tr style="${p.active ? "" : "opacity:.55;"}">
                <td><strong>${esc(p.name)}</strong>${p.description ? `<div class="muted" style="font-size:0.8rem;">${esc(p.description)}</div>` : ""}</td>
                <td>${p.scope === "all" ? "Todas las disciplinas" : esc(p.discipline_name)}</td>
                <td>${p.max_classes_per_week ? p.max_classes_per_week + "/semana" : "Ilimitado"}</td>
                <td class="num">${formatEuros(p.price_cents)}</td>
                <td class="num">${p.live_count}</td>
                <td>${p.active ? "Disponible" : "Retirado"}</td>
                <td><div class="ml-actions">
                  <button class="btn btn-outline btn-sm" data-precio="${p.id}">Cambiar precio</button>
                  <button class="btn btn-outline btn-sm" data-toggle="${p.id}">${p.active ? "Retirar" : "Volver a ofrecer"}</button>
                </div></td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table></div>

      <div class="form-card" style="margin:24px 0 0;">
        <h3 style="margin-bottom:12px;">Nuevo plan</h3>
        <div class="field"><label for="np-nombre">Nombre</label><input id="np-nombre" placeholder="Ej: BJJ + Judo"></div>
        <div class="field"><label for="np-desc">Descripción (opcional)</label><input id="np-desc"></div>
        <div class="field"><label for="np-scope">Incluye</label>
          <select id="np-scope">
            <option value="all">Todas las disciplinas</option>
            ${disciplinas.map((d) => `<option value="d-${d.id}">Solo ${esc(d.name)}</option>`).join("")}
          </select></div>
        <div class="field"><label for="np-precio">Precio al mes (€)</label><input type="number" id="np-precio" min="1" step="0.01"></div>
        <div class="field"><label for="np-limite">Clases por semana (vacío = ilimitado)</label><input type="number" id="np-limite" min="1" max="14"></div>
        <button class="btn btn-primary" id="np-crear">Crear plan</button>
        <p id="np-msg" class="form-message"></p>
      </div>`);

    document.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => alternarPlan(Number(b.dataset.toggle))));
    document.querySelectorAll("[data-precio]").forEach((b) => b.addEventListener("click", () => cambiarPrecio(Number(b.dataset.precio))));
    document.getElementById("np-crear").addEventListener("click", crearPlan);
  } catch (err) {
    contenido(`<p class="form-message error">${esc(err.message)}</p>`);
  }
}

async function crearPlan() {
  const msg = document.getElementById("np-msg");
  msg.textContent = ""; msg.className = "form-message";
  const scopeValor = document.getElementById("np-scope").value;
  try {
    await api("/admin/billing/plans", {
      method: "POST",
      body: JSON.stringify({
        name: document.getElementById("np-nombre").value,
        description: document.getElementById("np-desc").value,
        scope: scopeValor === "all" ? "all" : "discipline",
        discipline_id: scopeValor === "all" ? null : Number(scopeValor.slice(2)),
        price_cents: Math.round(Number(document.getElementById("np-precio").value) * 100),
        max_classes_per_week: document.getElementById("np-limite").value,
      }),
    });
    aviso("Plan creado.");
    cargarPlanes();
  } catch (err) {
    msg.textContent = err.message; msg.classList.add("error");
  }
}

async function alternarPlan(id) {
  const p = planesCache.find((x) => x.id === id);
  if (p.active && !confirm(`¿Retirar «${p.name}»? Dejará de ofrecerse a altas nuevas. Las ${p.live_count} cuotas que ya lo tienen siguen igual.`)) return;
  try {
    await api(`/admin/billing/plans/${id}`, { method: "PUT", body: JSON.stringify({ active: !p.active }) });
    cargarPlanes();
  } catch (err) {
    alert(err.message);
  }
}

async function cambiarPrecio(id) {
  const p = planesCache.find((x) => x.id === id);
  const valor = prompt(
    `Nuevo precio mensual para «${p.name}» (ahora ${formatEuros(p.price_cents)}).\n\nSolo se aplica a las altas NUEVAS: las cuotas ya contratadas mantienen su precio.`,
    (p.price_cents / 100).toFixed(2)
  );
  if (valor === null) return;
  const cents = Math.round(Number(String(valor).replace(",", ".")) * 100);
  try {
    await api(`/admin/billing/plans/${id}`, { method: "PUT", body: JSON.stringify({ price_cents: cents }) });
    aviso("Precio actualizado para las altas nuevas.");
    cargarPlanes();
  } catch (err) {
    alert(err.message);
  }
}

// ---------------------------------------------------------------------------
// AJUSTES
// ---------------------------------------------------------------------------
async function cargarAjustes() {
  contenido(`<p class="muted">Cargando…</p>`);
  try {
    const s = await api("/admin/billing/settings");
    contenido(`
      <div class="notice ${s.stripe_enabled ? "ok" : "warn"}">
        ${s.stripe_enabled
          ? "Pago con tarjeta (Stripe) activado."
          : s.card_demo
          ? "Pago con tarjeta en <strong>modo demostración</strong>: las familias ven la opción, pero no se cobra nada ni se crean cuotas con tarjeta. Para activarlo de verdad, pon STRIPE_SECRET_KEY en el .env del servidor y quita STRIPE_DEMO."
          : "Pago con tarjeta desactivado: falta STRIPE_SECRET_KEY en el archivo .env del servidor. Mientras tanto, las cuotas se cobran en recepción."}
      </div>
      <div class="form-card" style="margin:0; max-width:520px;">
        <div class="field"><label for="aj-modo">Cobro con tarjeta a familias con varias cuotas</label>
          <select id="aj-modo">
            <option value="separate" ${s.family_billing_mode === "separate" ? "selected" : ""}>Un cargo por cada cuota</option>
            <option value="combined" ${s.family_billing_mode === "combined" ? "selected" : ""}>Un único cargo mensual por familia</option>
          </select>
          <small class="muted">Afecta a las cuotas que se den de alta a partir de ahora.</small></div>
        <label class="checkbox-field"><input type="checkbox" id="aj-requiere" ${s.require_membership_to_book === "1" ? "checked" : ""}> Exigir cuota activa para reservar clases</label>
        <div class="field"><label for="aj-prueba">Clases de prueba gratuitas por alumno sin cuota</label><input type="number" id="aj-prueba" min="0" max="10" value="${esc(s.trial_classes)}"></div>
        <div class="field"><label for="aj-margen">Días de margen tras vencer una cuota en recepción</label><input type="number" id="aj-margen" min="0" max="60" value="${esc(s.grace_days)}"></div>
        <div class="field"><label for="aj-pausa">Duración máxima de una pausa (días)</label><input type="number" id="aj-pausa" min="7" max="365" value="${esc(s.max_pause_days)}"></div>
        <label class="checkbox-field"><input type="checkbox" id="aj-manual" ${s.allow_manual_payment === "1" ? "checked" : ""}> Permitir pagar en recepción</label>
        <button class="btn btn-primary" id="aj-guardar">Guardar ajustes</button>
        <p id="aj-msg" class="form-message"></p>
      </div>
      <div style="margin-top:22px;">
        <button class="btn btn-outline btn-sm" id="aj-revision">Ejecutar ahora la revisión de cuotas</button>
        <p class="muted" style="font-size:0.82rem; margin-top:6px;">El servidor la hace sola cada hora: marca vencidas, aplica bajas y reanuda pausas.</p>
      </div>`);

    document.getElementById("aj-guardar").addEventListener("click", guardarAjustes);
    document.getElementById("aj-revision").addEventListener("click", async () => {
      try {
        const r = await api("/admin/billing/maintenance/run", { method: "POST" });
        aviso(`Revisión hecha: ${r.overdue} vencidas, ${r.ended} bajas aplicadas, ${r.resumed} pausas reanudadas${r.errors.length ? `, ${r.errors.length} errores (ver consola del servidor)` : ""}.`, r.errors.length ? "warn" : "ok");
      } catch (err) {
        aviso(err.message, "warn");
      }
    });
  } catch (err) {
    contenido(`<p class="form-message error">${esc(err.message)}</p>`);
  }
}

async function guardarAjustes() {
  const msg = document.getElementById("aj-msg");
  msg.textContent = ""; msg.className = "form-message";
  try {
    await api("/admin/billing/settings", {
      method: "PUT",
      body: JSON.stringify({
        family_billing_mode: document.getElementById("aj-modo").value,
        require_membership_to_book: document.getElementById("aj-requiere").checked,
        trial_classes: Number(document.getElementById("aj-prueba").value),
        grace_days: Number(document.getElementById("aj-margen").value),
        max_pause_days: Number(document.getElementById("aj-pausa").value),
        allow_manual_payment: document.getElementById("aj-manual").checked,
      }),
    });
    msg.textContent = "Ajustes guardados."; msg.classList.add("success");
  } catch (err) {
    msg.textContent = err.message; msg.classList.add("error");
  }
}
