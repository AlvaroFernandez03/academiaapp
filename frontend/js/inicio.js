// js/inicio.js — portada de la academia
//
// Se pinta entera con datos reales (GET /api/public/home): lo que la academia
// escribe en Administración → Academia (nombre, lema, presentación, contacto)
// y lo que ya hay en la app (disciplinas, grupos, horario, equipo y cuotas).
// Si mañana se añade una disciplina o cambia un precio, la portada cambia sola.
//
// Secciones, de arriba abajo:
//   1. Héroe: el nombre de la academia y un cinturón que se ata al cargar.
//   2. Hoy en el tatami: las clases del día en una línea de tiempo.
//   3. Disciplinas: una banda del color de cada una.
//   4. Cómo empezar: 5 pasos; el cinturón cambia de color (blanco → negro)
//      según se baja. Es el momento "especial" de la página.
//   5. El equipo.
//   6. Cuotas: tablón de precios.
//   7. Cuándo hay clase y cómo contactar.
//
// Lo que aparece al bajar lo controla js/aparecer.js (data-aparece).

const NOMBRES_DIA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

document.addEventListener("DOMContentLoaded", async () => {
  await renderHeader();
  const main = document.getElementById("portada");
  let datos;
  try {
    datos = await api("/public/home");
  } catch (err) {
    main.innerHTML = `
      <section class="heroe"><div class="container" style="padding-bottom:60px;">
        <h1 class="heroe-nombre">Reserva tu clase</h1>
        <p class="heroe-lema">No se ha podido cargar la información de la academia. El horario sigue disponible.</p>
        <div class="heroe-acciones"><a class="btn btn-primary btn-lg" href="horario.html">Ver el horario</a></div>
      </div></section>`;
    return;
  }

  const cuenta = getAccount();
  document.title = datos.academy.name;
  main.innerHTML = [
    heroe(datos, cuenta),
    `<section class="bloque hoy" id="hoy" hidden></section>`,
    disciplinas(datos),
    camino(datos, cuenta),
    equipo(datos),
    cuotas(datos),
    visita(datos, cuenta),
  ].join("");

  prepararApariciones(main);
  activarCamino();
  cargarHoy(datos);
});

// ---------------------------------------------------------------------------
// Utilidades de texto
// ---------------------------------------------------------------------------
// ["BJJ", "Judo", "MMA"] -> "BJJ, Judo y MMA"
function enumerar(lista) {
  if (lista.length <= 1) return lista.join("");
  return `${lista.slice(0, -1).join(", ")} y ${lista[lista.length - 1]}`;
}
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function sumarDias(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const minutos = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const ahoraEnMinutos = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

// El lema: el que escriba la academia o, si no hay, uno con sus datos reales.
function lema(datos) {
  if (datos.academy.tagline) return datos.academy.tagline;
  const nombres = datos.disciplines.map((d) => d.name);
  if (!nombres.length) return "Artes marciales para toda la familia.";
  const edad = datos.stats.min_age;
  return `${enumerar(nombres)} para adultos y niños${edad != null ? ` desde los ${edad} años` : ""}.`;
}

// El cinturón grande, con los 4 grados de su puntera.
const cinturonGrande = (extra = "") =>
  `<div class="cinturon-grande ${extra}" aria-hidden="true"><span class="puntera">${[0, 1, 2, 3].map((n) => `<i style="--n:${n}"></i>`).join("")}</span></div>`;

// ---------------------------------------------------------------------------
// 1. Héroe
// ---------------------------------------------------------------------------
function heroe(datos, cuenta) {
  const { academy: a, stats: s, trial_classes: prueba } = datos;
  const acciones = cuenta
    ? `<a class="btn btn-primary btn-lg" href="horario.html">Reservar una clase</a>
       <a class="btn btn-claro btn-lg" href="mis-reservas.html">Mis reservas</a>`
    : `<a class="btn btn-primary btn-lg" href="acceso.html#registro">${prueba ? "Probar una clase gratis" : "Crear una cuenta"}</a>
       <a class="btn btn-claro btn-lg" href="horario.html">Ver el horario</a>`;

  const dato = (n, texto, sufijo = "") =>
    n ? `<div class="heroe-dato" data-aparece="arriba" style="--orden:${dato.i++}"><strong data-contar="${n}" data-sufijo="${sufijo}">${n}${sufijo}</strong><span>${texto}</span></div>` : "";
  dato.i = 4; // salen después del nombre, el lema y los botones

  return `
    <section class="heroe">
      <div class="container">
        <h1 class="heroe-nombre">${esc(a.name)}</h1>
        <p class="heroe-lema">${esc(lema(datos))}</p>
        <div class="heroe-acciones">${acciones}</div>
        ${prueba && !cuenta ? `<p class="heroe-prueba"><span class="muestra-cinta"></span>${prueba === 1 ? "La primera clase es gratis" : `Las ${prueba} primeras clases son gratis`}</p>` : ""}
        <div class="heroe-datos">
          ${dato(s.disciplines, s.disciplines === 1 ? "disciplina" : "disciplinas")}
          ${dato(s.classes_per_week, "clases a la semana")}
          ${s.min_age != null ? dato(s.min_age, "años, la edad para empezar") : ""}
          ${dato(s.instructors, s.instructors === 1 ? "instructor" : "instructores")}
        </div>
      </div>
      ${cinturonGrande()}
    </section>`;
}

// ---------------------------------------------------------------------------
// 2. Hoy en el tatami
// ---------------------------------------------------------------------------
// Las clases de hoy (si aún queda alguna) o las del próximo día con clases,
// dibujadas en una línea de tiempo con su color de disciplina.
async function cargarHoy(datos) {
  const seccion = document.getElementById("hoy");
  let clases;
  try { clases = await api("/schedule/classes"); } catch (_) { return; }
  if (!clases.length) return;

  // ¿Qué día enseñamos?
  const hoy = hoyISO();
  let fecha = null;
  for (let i = 0; i < 8 && !fecha; i++) {
    const f = sumarDias(hoy, i);
    const dow = new Date(f + "T12:00:00").getDay();
    const delDia = clases.filter((c) => c.day_of_week === dow);
    if (!delDia.length) continue;
    if (i === 0 && !delDia.some((c) => minutos(c.end_time) > ahoraEnMinutos())) continue; // hoy ya han terminado todas
    fecha = f;
  }
  if (!fecha) return;
  const dow = new Date(fecha + "T12:00:00").getDay();
  const delDia = clases.filter((c) => c.day_of_week === dow).sort((a, b) => minutos(a.start_time) - minutos(b.start_time));

  const [canceladas, ocupacion] = await Promise.all([
    api(`/schedule/cancellations?from=${fecha}&to=${fecha}`).catch(() => []),
    api(`/schedule/occupancy?from=${fecha}&to=${fecha}`).catch(() => []),
  ]);
  const cancelada = (c) => canceladas.find((x) => x.class_schedule_id === c.id);
  const ocupadas = (c) => (ocupacion.find((o) => o.class_schedule_id === c.id) || { taken: 0 }).taken;

  // Escala: de la hora en punto anterior a la primera clase a la siguiente a la última.
  const desde = Math.floor(minutos(delDia[0].start_time) / 60) * 60;
  const hasta = Math.ceil(Math.max(...delDia.map((c) => minutos(c.end_time))) / 60) * 60;
  const pct = (min) => ((min - desde) / (hasta - desde)) * 100;

  // Clases que coinciden en el tiempo: una fila (carril) cada una.
  const finCarril = [];
  delDia.forEach((c) => {
    let i = finCarril.findIndex((fin) => fin <= minutos(c.start_time));
    if (i < 0) { i = finCarril.length; finCarril.push(0); }
    finCarril[i] = minutos(c.end_time);
    c._carril = i;
  });
  const ALTO_CARRIL = 74;

  const esHoy = fecha === hoy;
  const ahora = ahoraEnMinutos();
  const titulo = esHoy ? "Hoy en el tatami" : fecha === sumarDias(hoy, 1) ? "Mañana en el tatami" : `El ${NOMBRES_DIA[dow].toLowerCase()} en el tatami`;
  const fechaLarga = new Date(fecha + "T12:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });

  const horas = [];
  for (let m = desde; m <= hasta; m += 60) horas.push(m);

  const barras = delDia
    .map((c, i) => {
      const anulada = cancelada(c);
      const pasada = esHoy && minutos(c.end_time) <= ahora;
      const libres = Math.max(0, c.capacity - ocupadas(c));
      const estado = anulada ? `Cancelada${anulada.reason ? `: ${anulada.reason}` : ""}` : pasada ? "Terminada" : libres ? plural(libres, "plaza libre", "plazas libres") : "Completa";
      return `
        <a class="jornada-clase cinta-${esc(c.discipline_color)}${pasada ? " pasada" : ""}${anulada ? " cancelada" : ""}"
           href="horario.html?disciplina=${encodeURIComponent(c.discipline_slug)}"
           style="left:calc(${pct(minutos(c.start_time))}% + 2px); width:calc(${pct(minutos(c.end_time)) - pct(minutos(c.start_time))}% - 4px); top:${c._carril * ALTO_CARRIL}px; --orden:${i};"
           data-aparece="tirar">
          <strong>${esc(c.name || c.group_name)}</strong>
          <small>${c.start_time}–${c.end_time} · ${esc(estado)}</small>
        </a>`;
    })
    .join("");

  seccion.innerHTML = `
    <div class="container">
      <div class="bloque-cab" data-aparece="arriba">
        <h2 class="bloque-titulo">${esc(titulo)}</h2>
        <p class="bloque-sub">${esc(fechaLarga.charAt(0).toUpperCase() + fechaLarga.slice(1))}. Pulsa una clase para ver su horario y reservar.</p>
      </div>
      <div class="jornada">
        <div class="jornada-eje" aria-hidden="true">${horas.map((m) => `<span style="left:${pct(m)}%">${String(m / 60).padStart(2, "0")}:00</span>`).join("")}</div>
        <div class="jornada-pista" style="height:${finCarril.length * ALTO_CARRIL - 10}px;">
          ${esHoy && ahora > desde && ahora < hasta ? `<div class="jornada-ahora" style="left:${pct(ahora)}%" aria-hidden="true"></div>` : ""}
          ${barras}
        </div>
      </div>
      <div class="jornada-pie">
        <span class="muted">${plural(delDia.length, "clase", "clases")} ${esHoy ? "hoy" : "ese día"}.</span>
        <a class="btn btn-outline" href="horario.html">Ver toda la semana</a>
      </div>
    </div>`;
  seccion.hidden = false;
  prepararApariciones(seccion);
}

// ---------------------------------------------------------------------------
// 3. Disciplinas
// ---------------------------------------------------------------------------
function disciplinas(datos) {
  if (!datos.disciplines.length) return "";
  const bandas = datos.disciplines
    .map((d, i) => {
      const grupos = d.groups.filter((g) => g.classes_per_week > 0);
      return `
        <article class="banda cinta-${esc(d.color)}" data-aparece="${i % 2 ? "derecha" : "izquierda"}">
          <div class="banda-color">
            <h3>${esc(d.name)}</h3>
            <span class="banda-nudo">${plural(d.classes_per_week, "clase", "clases")} a la semana<br>${plural(grupos.length, "grupo", "grupos")}</span>
          </div>
          <div class="banda-cuerpo">
            ${d.description ? `<p class="banda-texto">${esc(d.description)}</p>` : ""}
            ${grupos.length ? `<ul class="banda-grupos">${grupos
              .map((g) => `<li><strong>${esc(g.name)}</strong><span>${esc(textoEdades(g.min_age, g.max_age))}, ${plural(g.classes_per_week, "día", "días")} a la semana</span></li>`)
              .join("")}</ul>` : ""}
            ${d.instructors.length ? `<p class="banda-equipo">Con ${esc(enumerar(d.instructors))}.</p>` : ""}
            <div class="banda-acciones">
              <a class="btn btn-dark" href="disciplina.html?d=${encodeURIComponent(d.slug)}">Conocer ${esc(d.name)}</a>
              <a class="btn-link" href="horario.html?disciplina=${encodeURIComponent(d.slug)}">Ver su horario</a>
            </div>
          </div>
        </article>`;
    })
    .join("");
  return `
    <section class="bloque" id="disciplinas">
      <div class="container">
        <div class="bloque-cab" data-aparece="arriba">
          <h2 class="bloque-titulo">Disciplinas</h2>
          <p class="bloque-sub">Cada una con sus grupos por edad y nivel. Puedes entrenar una o combinarlas.</p>
        </div>
        <div class="disciplinas-lista">${bandas}</div>
      </div>
    </section>`;
}

// ---------------------------------------------------------------------------
// 4. Cómo empezar — el cinturón cambia de color a cada paso
// ---------------------------------------------------------------------------
function pasosCamino(datos, cuenta) {
  const prueba = datos.trial_classes;
  const precios = datos.plans.map((p) => p.price_cents);
  return [
    { cinta: "blanco", grado: "Cinturón blanco", titulo: "Crea tu cuenta familiar",
      texto: `Una sola cuenta para toda la familia. Tus hijos no necesitan contraseña: los añades tú desde «Mi familia».${cuenta ? "" : ` <a href="acceso.html#registro">Crear cuenta</a>`}` },
    { cinta: "azul", grado: "Cinturón azul", titulo: "Elige grupo y día",
      texto: `Cada grupo indica para qué edades es y cuántas plazas le quedan. Se reserva desde el móvil en un momento. <a href="horario.html">Ver el horario</a>` },
    prueba
      ? { cinta: "morado", grado: "Cinturón morado", titulo: "Ven a tu clase de prueba", texto: `${prueba === 1 ? "La primera clase es gratis" : `Las ${prueba} primeras clases son gratis`}. El instructor sabrá que vienes a probar.` }
      : { cinta: "morado", grado: "Cinturón morado", titulo: "Ven a tu primera clase", texto: "Llega unos minutos antes: el instructor te recibirá y te explicará cómo funciona." },
    { cinta: "marron", grado: "Cinturón marrón", titulo: "Elige tu cuota",
      texto: `${precios.length ? `Desde ${precioCorto(Math.min(...precios))} al mes, por disciplina o para todas. ` : ""}Se contrata desde la app y se puede pausar por lesión o vacaciones.` },
    { cinta: "negro", grado: "Cinturón negro", titulo: "Entrena y sube de grado",
      texto: "Reserva tus clases cada semana y avanza de cinturón en cinturón, a tu ritmo." },
  ];
}

function camino(datos, cuenta) {
  const pasos = pasosCamino(datos, cuenta);
  return `
    <section class="bloque camino" id="empezar">
      <div class="container camino-grid">
        <div class="camino-fijo">
          <h2 class="bloque-titulo">Cómo empezar</h2>
          <p class="bloque-sub">Del primer día al cinturón negro, paso a paso.</p>
          <div class="camino-cinturon cinta-blanco" id="camino-cinturon" aria-hidden="true"><span class="puntera"></span></div>
          <p class="camino-grado" id="camino-grado">Cinturón blanco</p>
          <p class="camino-nota">Los colores son los de los grados de Brazilian Jiu-Jitsu.</p>
        </div>
        <ol class="camino-pasos">
          ${pasos.map((p, i) => `
            <li class="paso cinta-${p.cinta}" data-cinta="${p.cinta}" data-grado="${esc(p.grado)}" data-aparece="arriba">
              <span class="paso-num">${i + 1}</span>
              <h3>${esc(p.titulo)}</h3>
              <p>${p.texto}</p>
            </li>`).join("")}
        </ol>
      </div>
    </section>`;
}

function activarCamino() {
  const cinturon = document.getElementById("camino-cinturon");
  const grado = document.getElementById("camino-grado");
  if (!cinturon) return;
  const pasos = [...document.querySelectorAll(".camino-pasos .paso")];
  seguirPasos(pasos, (i, paso) => {
    pasos.forEach((p) => p.classList.toggle("activo", p === paso));
    cinturon.className = `camino-cinturon cinta-${paso.dataset.cinta}`;
    grado.textContent = paso.dataset.grado;
  });
}

// ---------------------------------------------------------------------------
// 5. El equipo
// ---------------------------------------------------------------------------
// El aro de cada avatar se reparte entre los colores de las disciplinas que imparte.
function aro(disciplinas) {
  if (!disciplinas.length) return "var(--yellow) 0 100%";
  const parte = 100 / disciplinas.length;
  return disciplinas.map((d, i) => `var(--belt-${d.color}) ${i * parte}% ${(i + 1) * parte}%`).join(", ");
}

function tarjetaInstructor(p, i) {
  return `
    <li class="instructor" data-aparece="pop" style="--orden:${i}">
      <span class="instructor-aro" style="--aro:${aro(p.disciplines)}"><span>${esc(iniciales(p.name))}</span></span>
      <strong>${esc(p.name)}</strong>
      <span class="instructor-disc">${p.disciplines.map((d) => `<span class="cinta-${esc(d.color)}"><span class="muestra-cinta"></span>${esc(d.name)}</span>`).join("")}</span>
      <small>${plural(p.classes_per_week, "clase", "clases")} a la semana</small>
    </li>`;
}

function equipo(datos) {
  if (!datos.instructors.length) return "";
  return `
    <section class="bloque" id="equipo">
      <div class="container">
        <div class="bloque-cab" data-aparece="arriba">
          <h2 class="bloque-titulo">El equipo</h2>
          <p class="bloque-sub">Quién da las clases, y de qué.</p>
        </div>
        <ul class="equipo-lista">${datos.instructors.map(tarjetaInstructor).join("")}</ul>
      </div>
    </section>`;
}

// ---------------------------------------------------------------------------
// 6. Cuotas — tablón de precios
// ---------------------------------------------------------------------------
function filaPlan(p, i) {
  return `
    <div class="tablon-fila${p.scope === "all" ? " tablon-todas" : ""}" data-aparece="arriba" style="--orden:${i}">
      <div class="tablon-nombre">
        <strong>${p.scope === "discipline" ? cinta(p.discipline_color) : ""}${esc(p.name)}</strong>
        <small>${esc(detallePlan(p))}</small>
      </div>
      <span class="tablon-puntos" aria-hidden="true"></span>
      <span class="tablon-precio">${precioCorto(p.price_cents)}<small>/mes</small></span>
    </div>`;
}

function cuotas(datos) {
  if (!datos.plans.length) return "";
  return `
    <section class="bloque cuotas" id="cuotas">
      <div class="container">
        <div class="bloque-cab" data-aparece="arriba">
          <h2 class="bloque-titulo">Cuotas</h2>
          <p class="bloque-sub">Precio al mes, por persona: cada miembro de la familia tiene su cuota.</p>
        </div>
        <div class="tablon">${datos.plans.map(filaPlan).join("")}</div>
        ${datos.trial_classes ? `<p class="tablon-nota">Antes de contratar, ${datos.trial_classes === 1 ? "la primera clase es gratis" : `las ${datos.trial_classes} primeras clases son gratis`}.</p>` : ""}
      </div>
    </section>`;
}

// ---------------------------------------------------------------------------
// 7. Cuándo hay clase y contacto
// ---------------------------------------------------------------------------
const ICONOS_CONTACTO = {
  direccion: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.6" fill="currentColor"/></svg>`,
  telefono: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 3.5 9 3l1.7 4.3-2 1.4a12 12 0 0 0 6.6 6.6l1.4-2L21 15l-.5 2.4a2 2 0 0 1-2 1.6A15.5 15.5 0 0 1 5 5.5a2 2 0 0 1 1.6-2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
  email: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
};

function visita(datos, cuenta) {
  const a = datos.academy;
  const dias = datos.opening;
  let barras = "";
  if (dias.length) {
    const desde = Math.floor(Math.min(...dias.map((d) => minutos(d.from))) / 60) * 60;
    const hasta = Math.ceil(Math.max(...dias.map((d) => minutos(d.to))) / 60) * 60;
    const pct = (m) => ((m - desde) / (hasta - desde)) * 100;
    const hh = (m) => `${Math.floor(m / 60)}:00`;
    const semana = [1, 2, 3, 4, 5, 6, 0].filter((dow) => dow !== 0 || dias.some((d) => d.day_of_week === 0));
    barras = `
      <ul class="semana-barras">
        ${semana.map((dow, i) => {
          const d = dias.find((x) => x.day_of_week === dow);
          return `<li class="${d ? "" : "sin-clase"}">
            <span class="dia">${NOMBRES_DIA[dow]}</span>
            <span class="pista">${d ? `<i data-aparece="tirar" style="left:${pct(minutos(d.from))}%; width:${pct(minutos(d.to)) - pct(minutos(d.from))}%; --orden:${i};"></i>` : ""}</span>
            <span class="horas">${d ? `${d.from}–${d.to}` : "Sin clases"}</span>
          </li>`;
        }).join("")}
      </ul>
      <div class="semana-escala" aria-hidden="true"><span></span><span><span>${hh(desde)}</span><span>${hh(Math.round((desde + hasta) / 120) * 60)}</span><span>${hh(hasta)}</span></span><span></span></div>`;
  }

  const contacto = [
    a.address && `<li>${ICONOS_CONTACTO.direccion}<span>${esc(a.address)}</span></li>`,
    a.phone && `<li>${ICONOS_CONTACTO.telefono}<a href="tel:${esc(a.phone.replace(/\s+/g, ""))}">${esc(a.phone)}</a></li>`,
    a.email && `<li>${ICONOS_CONTACTO.email}<a href="mailto:${esc(a.email)}">${esc(a.email)}</a></li>`,
  ].filter(Boolean);

  return `
    <section class="bloque" id="visita">
      <div class="container visita-grid">
        <div>
          <div class="bloque-cab" data-aparece="arriba">
            <h2 class="bloque-titulo">Cuándo hay clase</h2>
            <p class="bloque-sub">De la primera a la última clase de cada día.</p>
          </div>
          ${barras}
        </div>
        <aside class="contacto" data-aparece="pop">
          <h3>Ven a vernos</h3>
          ${a.about ? `<p style="margin-bottom:18px; color:rgba(255,255,255,.82);">${esc(a.about)}</p>` : ""}
          ${contacto.length ? `<ul class="contacto-lista">${contacto.join("")}</ul>` : ""}
          <div class="heroe-acciones" style="margin-top:0; animation:none;">
            ${cuenta
              ? `<a class="btn btn-primary" href="horario.html">Reservar una clase</a>`
              : `<a class="btn btn-primary" href="acceso.html#registro">${datos.trial_classes ? "Probar una clase gratis" : "Crear una cuenta"}</a>
                 <a class="btn btn-claro" href="acceso.html">Iniciar sesión</a>`}
          </div>
          <span class="cinturon" aria-hidden="true"></span>
        </aside>
      </div>
    </section>`;
}
