// js/horario.js — horario en calendario semanal
//
// Escritorio: una columna por día y las horas en vertical; cada clase es un
// bloque del color de su disciplina, tan alto como lo que dura. Las franjas
// largas sin ninguna clase (por ejemplo, de 12:00 a 17:00) se pliegan para no
// dejar media pantalla vacía.
// Móvil: una pestaña por día y sus clases en lista.
// Al pulsar una clase se abre un panel con los detalles y la reserva.

const PX_HORA = 66; // alto de una hora en el calendario
const PX_HUECO = 34; // alto de una franja plegada sin clases
const SEMANAS_MAX = 6; // se puede mirar (y reservar) hasta 6 semanas vista
const movil = window.matchMedia("(max-width: 760px)");
const DIAS_CORTOS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const estado = {
  clases: [],
  disciplinas: [],
  filtro: new URLSearchParams(location.search).get("disciplina") || "",
  lunes: lunesDe(hoyISO()),
  diaMovil: null,
  ocupacion: new Map(), // "clase|fecha" -> { taken, waitlist }
  canceladas: new Map(), // "clase|fecha" -> motivo
  mias: new Map(), // "clase|fecha" -> [{ id, member_id, nombre, status }]
  miembros: null,
  abierta: null, // { id, fecha, origen } de la clase del panel
};
const clave = (id, fecha) => `${id}|${fecha}`;

// ---------------------------------------------------------------------------
// Fechas (siempre en hora local, como "2026-10-05")
// ---------------------------------------------------------------------------
function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function hoyISO() { return isoLocal(new Date()); }
function fechaDe(iso) { return new Date(iso + "T12:00:00"); }
function sumarDias(iso, n) { const d = fechaDe(iso); d.setDate(d.getDate() + n); return isoLocal(d); }
function lunesDe(iso) { const d = fechaDe(iso); return sumarDias(iso, -((d.getDay() + 6) % 7)); }
const minutos = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const fechaDeClase = (c) => sumarDias(estado.lunes, (c.day_of_week + 6) % 7);
function textoFecha(iso, opciones) { return fechaDe(iso).toLocaleDateString("es-ES", opciones); }
function edades(c) {
  if (c.min_age == null && c.max_age == null) return "Todas las edades";
  if (c.max_age == null) return `Desde ${c.min_age} años`;
  if (c.min_age == null) return `Hasta ${c.max_age} años`;
  return `${c.min_age}–${c.max_age} años`;
}

// ---------------------------------------------------------------------------
// Arranque y datos
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  await renderHeader();
  document.getElementById("semana-anterior").addEventListener("click", () => cambiarSemana(-1));
  document.getElementById("semana-siguiente").addEventListener("click", () => cambiarSemana(1));
  document.getElementById("semana-hoy").addEventListener("click", () => cambiarSemana(0));
  document.getElementById("panel-fondo").addEventListener("click", cerrarPanel);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && estado.abierta) cerrarPanel(); });
  movil.addEventListener("change", pintar);

  try {
    const [clases, disciplinas] = await Promise.all([api("/schedule/classes"), api("/schedule/disciplines").catch(() => [])]);
    estado.clases = clases;
    estado.disciplinas = disciplinas;
  } catch (err) {
    document.getElementById("calendario").innerHTML = `<p class="form-message error">${esc(err.message)}</p>`;
    return;
  }
  if (estado.filtro && !estado.disciplinas.some((d) => d.slug === estado.filtro)) estado.filtro = "";

  const desde = lunesDe(hoyISO());
  const hasta = sumarDias(desde, SEMANAS_MAX * 7 - 1);
  try {
    (await api(`/schedule/cancellations?from=${desde}&to=${hasta}`)).forEach((c) =>
      estado.canceladas.set(clave(c.class_schedule_id, c.date), c.reason || "")
    );
  } catch (_) {
    // Sin este dato el horario se ve igual; el servidor rechazaría reservar una sesión cancelada.
  }
  await cargarMias();
  pintarFiltros();
  await cargarSemana();
});

async function cargarMias() {
  estado.mias.clear();
  if (!getToken()) return;
  try {
    const hoy = hoyISO();
    (await api("/bookings/mine"))
      .filter((b) => b.date >= hoy && (b.status === "reservada" || b.status === "en_espera"))
      .forEach((b) => {
        const k = clave(b.class_schedule_id, b.date);
        if (!estado.mias.has(k)) estado.mias.set(k, []);
        estado.mias.get(k).push({ id: b.id, member_id: b.member_id, nombre: b.first_name, status: b.status });
      });
  } catch (_) {}
}

async function cargarOcupacion() {
  estado.ocupacion.clear();
  try {
    (await api(`/schedule/occupancy?from=${estado.lunes}&to=${sumarDias(estado.lunes, 6)}`)).forEach((o) =>
      estado.ocupacion.set(clave(o.class_schedule_id, o.date), { taken: o.taken, waitlist: o.waitlist })
    );
  } catch (_) {}
}

async function cargarSemana() {
  await cargarOcupacion();
  pintar();
}

function cambiarSemana(paso) {
  const primero = lunesDe(hoyISO());
  const ultimo = sumarDias(primero, (SEMANAS_MAX - 1) * 7);
  const nuevo = paso === 0 ? primero : sumarDias(estado.lunes, paso * 7);
  if (nuevo < primero || nuevo > ultimo) return;
  estado.lunes = nuevo;
  estado.diaMovil = null;
  cargarSemana();
}

// ---------------------------------------------------------------------------
// Filtros por disciplina (con su color de cinturón)
// ---------------------------------------------------------------------------
function pintarFiltros() {
  const cont = document.getElementById("filtros");
  const chip = (slug, contenido) =>
    `<button class="chip${estado.filtro === slug ? " activo" : ""}" data-filtro="${esc(slug)}" aria-pressed="${estado.filtro === slug}">${contenido}</button>`;
  cont.innerHTML =
    chip("", "Todas") + estado.disciplinas.map((d) => chip(d.slug, `${cinta(d.color)}${esc(d.name)}`)).join("");
  cont.querySelectorAll("[data-filtro]").forEach((b) =>
    b.addEventListener("click", () => {
      estado.filtro = b.dataset.filtro;
      const url = new URL(location.href);
      if (estado.filtro) url.searchParams.set("disciplina", estado.filtro);
      else url.searchParams.delete("disciplina");
      history.replaceState(null, "", url);
      pintarFiltros();
      pintar();
    })
  );
}

function clasesVisibles() {
  return estado.clases.filter((c) => !estado.filtro || c.discipline_slug === estado.filtro);
}

// ---------------------------------------------------------------------------
// Estado de una sesión concreta (clase + fecha)
// ---------------------------------------------------------------------------
function sesion(c, fecha) {
  const k = clave(c.id, fecha);
  const occ = estado.ocupacion.get(k) || { taken: 0, waitlist: 0 };
  const ahora = new Date();
  const hoy = hoyISO();
  const minAhora = ahora.getHours() * 60 + ahora.getMinutes();
  const pasada = fecha < hoy || (fecha === hoy && minutos(c.end_time) <= minAhora);
  // Empezada: a partir de su hora de inicio ya no se reserva ni se anula
  // (el servidor aplica la misma regla).
  const empezada = pasada || (fecha === hoy && minutos(c.start_time) <= minAhora);
  return {
    fecha,
    cancelada: estado.canceladas.has(k),
    motivo: estado.canceladas.get(k) || "",
    pasada,
    empezada,
    taken: occ.taken,
    waitlist: occ.waitlist,
    libres: Math.max(0, c.capacity - occ.taken),
    completa: occ.taken >= c.capacity,
    mias: estado.mias.get(k) || [],
  };
}

function textoPlazas(c, s) {
  if (s.cancelada) return "Cancelada";
  if (s.pasada) return "Finalizada";
  if (s.empezada) return "En curso";
  if (s.completa) return s.waitlist ? `Completa · ${s.waitlist} en espera` : "Completa";
  return `${s.libres} ${s.libres === 1 ? "plaza libre" : "plazas libres"}`;
}

// ---------------------------------------------------------------------------
// Pintar
// ---------------------------------------------------------------------------
function diasDeLaSemana() {
  const hayDomingo = estado.clases.some((c) => c.day_of_week === 0);
  const dias = [1, 2, 3, 4, 5, 6];
  if (hayDomingo) dias.push(0);
  return dias.map((dow) => ({ dow, fecha: sumarDias(estado.lunes, (dow + 6) % 7) }));
}

function pintar() {
  const primero = lunesDe(hoyISO());
  const domingo = sumarDias(estado.lunes, 6);
  const mismoMes = fechaDe(estado.lunes).getMonth() === fechaDe(domingo).getMonth();
  document.getElementById("semana-texto").innerHTML = `
    <strong>${estado.lunes === primero ? "Esta semana" : estado.lunes === sumarDias(primero, 7) ? "La semana que viene" : "Semana"}</strong>
    <span>${textoFecha(estado.lunes, mismoMes ? { day: "numeric" } : { day: "numeric", month: "short" })} – ${textoFecha(domingo, { day: "numeric", month: "short", year: "numeric" })}</span>`;
  document.getElementById("semana-anterior").disabled = estado.lunes <= primero;
  document.getElementById("semana-siguiente").disabled = estado.lunes >= sumarDias(primero, (SEMANAS_MAX - 1) * 7);
  document.getElementById("semana-hoy").disabled = estado.lunes === primero;

  const clases = clasesVisibles();
  const cont = document.getElementById("calendario");
  if (!clases.length) {
    cont.innerHTML = `<div class="empty-state"><p>No hay clases de esta disciplina en el horario.</p></div>`;
    return;
  }
  cont.innerHTML = movil.matches ? agendaMovil(clases) : calendario(clases);
  cont.querySelectorAll("[data-clase]").forEach((b) =>
    b.addEventListener("click", () => abrirPanel(Number(b.dataset.clase), b.dataset.fecha, b))
  );
  cont.querySelectorAll("[data-dia]").forEach((b) =>
    b.addEventListener("click", () => { estado.diaMovil = b.dataset.dia; pintar(); })
  );
}

// Tramos de horas que se dibujan: las horas con alguna clase, y en medio,
// plegadas, las franjas de 2 horas o más sin ninguna.
function calcularTramos(clases) {
  const horas = new Set();
  clases.forEach((c) => {
    for (let h = Math.floor(minutos(c.start_time) / 60); h * 60 < minutos(c.end_time); h++) horas.add(h);
  });
  const lista = [...horas].sort((a, b) => a - b);
  const tramos = [];
  let inicio = lista[0];
  let previa = lista[0];
  for (const h of lista.slice(1)) {
    if (h - previa <= 2) { previa = h; continue; } // una hora suelta sin clases no se pliega
    tramos.push({ tipo: "horas", desde: inicio, hasta: previa + 1 });
    tramos.push({ tipo: "hueco", desde: previa + 1, hasta: h });
    inicio = previa = h;
  }
  tramos.push({ tipo: "horas", desde: inicio, hasta: previa + 1 });
  let y = 0;
  tramos.forEach((t) => {
    t.y = y;
    t.alto = t.tipo === "horas" ? (t.hasta - t.desde) * PX_HORA : PX_HUECO;
    y += t.alto;
  });
  return tramos;
}
function yDe(min, tramos) {
  for (const t of tramos) {
    if (t.tipo === "horas" && min >= t.desde * 60 && min <= t.hasta * 60) return t.y + ((min - t.desde * 60) / 60) * PX_HORA;
  }
  return null;
}

// Clases que coinciden en el tiempo el mismo día: se reparten en carriles
// (una al lado de otra) en vez de taparse.
function repartirCarriles(clasesDia) {
  const ordenadas = [...clasesDia].sort((a, b) => minutos(a.start_time) - minutos(b.start_time));
  let grupo = [];
  let finGrupo = -1;
  const cerrar = () => {
    const finales = [];
    grupo.forEach((c) => {
      let i = finales.findIndex((fin) => fin <= minutos(c.start_time));
      if (i < 0) { i = finales.length; finales.push(0); }
      finales[i] = minutos(c.end_time);
      c._carril = i;
    });
    grupo.forEach((c) => (c._carriles = finales.length));
  };
  ordenadas.forEach((c) => {
    if (grupo.length && minutos(c.start_time) >= finGrupo) { cerrar(); grupo = []; finGrupo = -1; }
    grupo.push(c);
    finGrupo = Math.max(finGrupo, minutos(c.end_time));
  });
  if (grupo.length) cerrar();
  return ordenadas;
}

const hh = (h) => `${String(h).padStart(2, "0")}:00`;

function calendario(clases) {
  const dias = diasDeLaSemana();
  const tramos = calcularTramos(clases);
  const alto = tramos.reduce((s, t) => s + t.alto, 0);
  const hoy = hoyISO();

  const fondo = tramos
    .map((t) =>
      t.tipo === "hueco"
        ? `<div class="cal-hueco" style="top:${t.y}px; height:${t.alto}px;"></div>`
        : Array.from({ length: t.hasta - t.desde }, (_, i) =>
            `<div class="cal-linea" style="top:${t.y + i * PX_HORA}px;"></div><div class="cal-linea media" style="top:${t.y + i * PX_HORA + PX_HORA / 2}px;"></div>`
          ).join("")
    )
    .join("");
  const etiquetas = tramos
    .map((t) =>
      t.tipo === "hueco"
        ? `<div class="cal-etiqueta hueco" style="top:${t.y}px; height:${t.alto}px;" title="De ${hh(t.desde)} a ${hh(t.hasta)} no hay clases">${t.desde}–${t.hasta} h</div>`
        : Array.from({ length: t.hasta - t.desde }, (_, i) => `<div class="cal-etiqueta" style="top:${t.y + i * PX_HORA}px;">${hh(t.desde + i)}</div>`).join("")
    )
    .join("");

  // Línea de "ahora" en la columna de hoy.
  const ahora = new Date();
  const yAhora = yDe(ahora.getHours() * 60 + ahora.getMinutes(), tramos);

  let n = 0;
  const columnas = dias
    .map(({ dow, fecha }) => {
      const delDia = repartirCarriles(clases.filter((c) => c.day_of_week === dow));
      const bloques = delDia
        .map((c) => {
          const s = sesion(c, fecha);
          const top = yDe(minutos(c.start_time), tramos);
          const altura = Math.max(30, yDe(minutos(c.end_time), tramos) - top);
          const ancho = 100 / c._carriles;
          const corto = altura < 58;
          const estrecho = c._carriles > 1;
          const clasesCss = ["cal-clase", `cinta-${c.discipline_color}`, s.pasada && "pasada", s.cancelada && "cancelada", s.mias.length && "mia", corto && "corto", estrecho && "estrecho", altura < 75 && "una-linea"]
            .filter(Boolean).join(" ");
          return `
            <button class="${clasesCss}" data-clase="${c.id}" data-fecha="${fecha}"
              style="top:${top + 2}px; height:${altura - 4}px; left:calc(${c._carril * ancho}% + 3px); width:calc(${ancho}% - 6px); --i:${n++};"
              aria-label="${esc(`${c.name}, ${DIAS_SEMANA[dow]} ${c.start_time} a ${c.end_time}. ${textoPlazas(c, s)}`)}">
              <span class="cc-hora">${estrecho ? c.start_time : `${c.start_time}–${c.end_time}`}</span>
              <span class="cc-nombre">${esc(c.name || c.group_name)}</span>
              ${s.mias.length
                ? `<span class="cc-mia" title="${esc(s.mias.map((m) => m.nombre).join(", "))}">✓ ${esc(s.mias.map((m) => m.nombre).join(", "))}</span>`
                : corto ? "" : `<span class="cc-info">${s.cancelada ? `Cancelada${s.motivo ? `: ${esc(s.motivo)}` : ""}` : textoPlazas(c, s)}</span>`}
            </button>`;
        })
        .join("");
      const esHoy = fecha === hoy;
      return `<div class="cal-col${esHoy ? " hoy" : ""}">${fondo}${esHoy && yAhora != null ? `<div class="cal-ahora" style="top:${yAhora}px;"></div>` : ""}${bloques}</div>`;
    })
    .join("");

  return `
    <div class="cal" style="--dias:${dias.length};">
      <div class="cal-cab">
        <div></div>
        ${dias.map(({ dow, fecha }) => `
          <div class="cal-cab-dia${fecha === hoy ? " hoy" : ""}${fecha < hoy ? " pasado" : ""}">
            <span>${DIAS_CORTOS[dow]}</span><strong>${fechaDe(fecha).getDate()}</strong>
          </div>`).join("")}
      </div>
      <div class="cal-cuerpo" style="height:${alto}px;">
        <div class="cal-horas">${etiquetas}</div>
        ${columnas}
      </div>
    </div>
    ${leyenda(clases)}`;
}

function leyenda(clases) {
  const usadas = estado.disciplinas.filter((d) => clases.some((c) => c.discipline_slug === d.slug));
  return `<div class="cal-leyenda">
    ${usadas.map((d) => `<span>${cinta(d.color)}${esc(d.name)}</span>`).join("")}
    ${getToken() ? `<span class="leyenda-mia">✓ Reservada por tu familia</span>` : ""}
  </div>`;
}

function agendaMovil(clases) {
  const dias = diasDeLaSemana();
  const hoy = hoyISO();
  const conClases = (dow) => clases.some((c) => c.day_of_week === dow);
  if (!estado.diaMovil || !dias.some((d) => d.fecha === estado.diaMovil)) {
    const candidato = dias.find((d) => d.fecha >= hoy && conClases(d.dow)) || dias.find((d) => conClases(d.dow)) || dias[0];
    estado.diaMovil = candidato.fecha;
  }
  const elegido = dias.find((d) => d.fecha === estado.diaMovil);
  const delDia = clases.filter((c) => c.day_of_week === elegido.dow).sort((a, b) => minutos(a.start_time) - minutos(b.start_time));

  const pestanas = dias
    .map(({ dow, fecha }) => {
      const colores = [...new Set(clases.filter((c) => c.day_of_week === dow).map((c) => c.discipline_color))];
      return `<button class="agenda-dia${fecha === estado.diaMovil ? " activo" : ""}${fecha === hoy ? " hoy" : ""}" data-dia="${fecha}" aria-pressed="${fecha === estado.diaMovil}">
        <span>${DIAS_CORTOS[dow]}</span><strong>${fechaDe(fecha).getDate()}</strong>
        <i class="puntos">${colores.map((c) => `<b class="cinta-${c}"></b>`).join("")}</i>
      </button>`;
    })
    .join("");

  const lista = delDia.length
    ? delDia
        .map((c, i) => {
          const s = sesion(c, elegido.fecha);
          const css = ["agenda-clase", `cinta-${c.discipline_color}`, s.pasada && "pasada", s.cancelada && "cancelada", s.mias.length && "mia"].filter(Boolean).join(" ");
          return `<button class="${css}" data-clase="${c.id}" data-fecha="${elegido.fecha}" style="--i:${i};">
            <span class="ac-hora"><strong>${c.start_time}</strong><small>${c.end_time}</small></span>
            <span class="ac-cuerpo">
              <span class="ac-nombre">${esc(c.name || c.group_name)}</span>
              <span class="ac-info">${esc(edades(c))} · ${esc(c.instructor_name.split(" ")[0])}</span>
              <span class="ac-estado">${s.cancelada ? `Cancelada${s.motivo ? `: ${esc(s.motivo)}` : ""}` : textoPlazas(c, s)}</span>
              ${s.mias.length ? `<span class="cc-mia">✓ ${esc(s.mias.map((m) => m.nombre).join(", "))}</span>` : ""}
            </span>
          </button>`;
        })
        .join("")
    : `<div class="empty-state"><p>Este día no hay clases${estado.filtro ? " de esta disciplina" : ""}.</p></div>`;

  return `<div class="agenda"><div class="agenda-dias">${pestanas}</div><div class="agenda-lista">${lista}</div></div>`;
}

// ---------------------------------------------------------------------------
// Panel de una clase: detalles y reserva
// ---------------------------------------------------------------------------
async function abrirPanel(id, fecha, origen) {
  const c = estado.clases.find((x) => x.id === id);
  if (!c) return;
  estado.abierta = { id, fecha, origen };
  const panel = document.getElementById("panel-clase");
  document.getElementById("panel-fondo").classList.remove("hidden");
  panel.hidden = false;
  requestAnimationFrame(() => panel.classList.add("abierto"));
  await pintarPanel();
  document.getElementById("panel-cerrar").focus();
}

function cerrarPanel() {
  const panel = document.getElementById("panel-clase");
  panel.classList.remove("abierto");
  document.getElementById("panel-fondo").classList.add("hidden");
  const origen = estado.abierta && estado.abierta.origen;
  estado.abierta = null;
  setTimeout(() => { if (!estado.abierta) panel.hidden = true; }, 250);
  // Volver a poner el foco en la clase (si sigue en pantalla).
  if (origen && document.body.contains(origen)) origen.focus();
}

function edadEl(fechaNacimiento, enFecha) {
  if (!fechaNacimiento) return null;
  const n = fechaDe(fechaNacimiento);
  const f = fechaDe(enFecha);
  let e = f.getFullYear() - n.getFullYear();
  if (f.getMonth() < n.getMonth() || (f.getMonth() === n.getMonth() && f.getDate() < n.getDate())) e--;
  return e;
}

async function pintarPanel(mensaje) {
  const { id, fecha } = estado.abierta;
  const c = estado.clases.find((x) => x.id === id);
  const s = sesion(c, fecha);
  const panel = document.getElementById("panel-clase");
  const porcentaje = Math.min(100, Math.round((s.taken / c.capacity) * 100));

  let reserva = "";
  if (s.cancelada) {
    reserva = `<div class="notice warn"><strong>Ese día no hay clase.</strong>${s.motivo ? ` Motivo: ${esc(s.motivo)}.` : ""} Elige otra semana con las flechas del horario.</div>`;
  } else if (s.pasada) {
    reserva = `<p class="muted">Esta sesión ya ha terminado.</p>`;
  } else if (s.empezada) {
    reserva = `<p class="muted">Esta sesión ya ha empezado: no se puede reservar ni anular.</p>`;
  } else if (!getToken()) {
    reserva = `<a class="btn btn-primary btn-block" href="acceso.html">Inicia sesión para reservar</a>
      <p class="muted panel-nota">¿Aún no tienes cuenta? Puedes crearla en la misma página.</p>`;
  } else {
    if (!estado.miembros) {
      try { estado.miembros = await api("/family/members"); } catch (_) { estado.miembros = []; }
    }
    if (!estado.miembros.length) {
      reserva = `<p class="muted" style="margin-bottom:12px;">Para reservar, añade primero a quien entrena (tú o tus hijos).</p>
        <a class="btn btn-primary btn-block" href="mi-familia.html">Ir a Mi familia</a>`;
    } else {
      const reservados = new Map(s.mias.map((m) => [m.member_id, m]));
      const fueraDeEdad = (m) => {
        const edad = edadEl(m.birth_date, fecha);
        return edad != null && ((c.min_age != null && edad < c.min_age) || (c.max_age != null && edad > c.max_age));
      };
      const libres = estado.miembros.filter((m) => !reservados.has(m.id));
      // Se marca de entrada a quien encaja por edad (si no, al primero libre).
      const sugerido = libres.find((m) => !fueraDeEdad(m)) || libres[0] || {};
      reserva = `
        <h3 class="panel-sub">¿Para quién?</h3>
        <div class="quien">
          ${estado.miembros
            .map((m) => {
              const r = reservados.get(m.id);
              const edad = edadEl(m.birth_date, fecha);
              const fuera = fueraDeEdad(m);
              return `<label class="quien-op${r ? " hecha" : ""}${fuera && !r ? " fuera" : ""}">
                <input type="radio" name="quien" value="${m.id}" ${r ? "disabled" : ""} ${!r && m.id === sugerido.id ? "checked" : ""}>
                ${avatarHtml(m)}
                <span class="quien-texto"><strong>${esc(m.first_name)}</strong>
                  <small>${r ? (r.status === "reservada" ? "Ya tiene plaza" : "En lista de espera") : fuera ? `Tiene ${edad} años: el grupo es de ${esc(edades(c).toLowerCase())}` : edad != null ? `${edad} años` : ""}</small>
                </span>
                ${r ? `<button type="button" class="btn-link" data-anular="${r.id}">Anular</button>` : ""}
              </label>`;
            })
            .join("")}
        </div>
        ${libres.length
          ? `<button class="btn btn-primary btn-block" id="btn-reservar">${s.completa ? "Apuntarme a la lista de espera" : "Reservar plaza"}</button>
             ${s.completa ? `<p class="muted panel-nota">Está completa: si alguien anula, la primera persona de la lista pasa a tener plaza automáticamente.</p>` : ""}`
          : `<p class="muted panel-nota">Toda tu familia está apuntada a esta sesión.</p>`}`;
    }
  }

  panel.innerHTML = `
    <div class="panel-cab cinta-${c.discipline_color}">
      <button class="panel-cerrar" id="panel-cerrar" aria-label="Cerrar">${ICONOS.cerrar}</button>
      <span class="panel-disciplina">${esc(c.discipline_name)}</span>
      <h2 id="panel-titulo">${esc(c.name || c.group_name)}</h2>
      <span class="panel-cinta"></span>
    </div>
    <div class="panel-cuerpo">
      ${mensaje || ""}
      <dl class="panel-datos">
        <div><dt>Cuándo</dt><dd>${esc(textoFecha(fecha, { weekday: "long", day: "numeric", month: "long" }))}<br><strong>${c.start_time} – ${c.end_time}</strong></dd></div>
        <div><dt>Grupo</dt><dd>${esc(c.group_name)} · ${esc(edades(c))}</dd></div>
        <div><dt>Imparte</dt><dd>${esc(c.instructor_name)}</dd></div>
      </dl>
      ${s.cancelada || s.empezada ? "" : `
      <div class="aforo">
        <div class="aforo-texto"><span>${textoPlazas(c, s)}</span><span class="muted">${s.taken}/${c.capacity}</span></div>
        <div class="aforo-barra${s.completa ? " llena" : porcentaje >= 75 ? " casi" : ""}"><span style="width:${porcentaje}%"></span></div>
      </div>`}
      <div class="panel-reserva">${reserva}</div>
      <p id="panel-msg" class="form-message"></p>
    </div>`;

  document.getElementById("panel-cerrar").addEventListener("click", cerrarPanel);
  const btn = document.getElementById("btn-reservar");
  if (btn) btn.addEventListener("click", () => reservar(c, fecha, btn));
  panel.querySelectorAll("[data-anular]").forEach((b) =>
    b.addEventListener("click", (e) => { e.preventDefault(); anular(Number(b.dataset.anular), b); })
  );
}

async function refrescarTras() {
  await Promise.all([cargarMias(), cargarOcupacion()]);
  pintar();
}

async function reservar(c, fecha, btn) {
  const msg = document.getElementById("panel-msg");
  msg.textContent = ""; msg.className = "form-message";
  const elegido = document.querySelector('input[name="quien"]:checked');
  if (!elegido) { msg.textContent = "Elige para quién es la reserva."; msg.classList.add("error"); return; }
  const miembro = estado.miembros.find((m) => m.id === Number(elegido.value));
  btn.disabled = true;
  try {
    const r = await api("/bookings", { method: "POST", body: JSON.stringify({ member_id: miembro.id, class_schedule_id: c.id, date: fecha }) });
    await refrescarTras();
    const texto = r.status === "en_espera"
      ? `<strong>${esc(miembro.first_name)} está en la lista de espera.</strong> Si queda una plaza libre, se le asignará sola.`
      : `<strong>¡Plaza reservada para ${esc(miembro.first_name)}!</strong>${r.is_trial ? " Es su clase de prueba gratuita: el instructor lo sabrá al pasar lista." : ""}`;
    await pintarPanel(`<div class="notice ok panel-ok">${texto} <a class="btn-link" href="mis-reservas.html">Ver mis reservas</a></div>`);
  } catch (err) {
    msg.textContent = err.message; msg.classList.add("error");
    btn.disabled = false;
  }
}

async function anular(bookingId, boton) {
  boton.disabled = true;
  try {
    await api(`/bookings/${bookingId}/cancel`, { method: "PUT" });
    await refrescarTras();
    await pintarPanel(`<div class="notice ok panel-ok">Reserva anulada.</div>`);
  } catch (err) {
    const msg = document.getElementById("panel-msg");
    msg.textContent = err.message; msg.className = "form-message error";
    boton.disabled = false;
  }
}
