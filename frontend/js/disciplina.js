// js/disciplina.js — la página de una disciplina (disciplina.html?d=slug)
//
// Todo sale de los datos de la app: la descripción y el color que la
// academia elige en Administración → Disciplinas y grupos, sus grupos, sus
// clases del horario, quién las imparte y las cuotas que la incluyen.
// Usa los mismos datos que la portada (GET /api/public/home) y el horario
// de esa disciplina (GET /api/schedule/classes?discipline=slug).

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
function enumerar(lista) {
  if (lista.length <= 1) return lista.join("");
  return `${lista.slice(0, -1).join(", ")} y ${lista[lista.length - 1]}`;
}

document.addEventListener("DOMContentLoaded", async () => {
  await renderHeader();
  const main = document.getElementById("disciplina");
  const slug = new URLSearchParams(location.search).get("d") || "";

  let datos, clases;
  try {
    [datos, clases] = await Promise.all([
      api("/public/home"),
      api(`/schedule/classes?discipline=${encodeURIComponent(slug)}`),
    ]);
  } catch (err) {
    main.innerHTML = `<div class="container section"><p class="form-message error">${esc(err.message)}</p></div>`;
    return;
  }

  const d = datos.disciplines.find((x) => x.slug === slug);
  if (!d) {
    main.innerHTML = `
      <div class="container section">
        <div class="titulo-pagina"><h1>Disciplina no encontrada</h1><span class="cinturon"></span>
          <p>Puede que ya no se imparta. Estas son las que hay ahora:</p></div>
        ${otras(datos, null)}
      </div>`;
    return;
  }

  document.title = `${d.name} | ${datos.academy.name}`;
  main.innerHTML = cabecera(d, datos) + `
    <div class="bloque" style="padding-top:clamp(40px,6vw,64px);"><div class="container">
      <div class="disc-grid">
        <section>
          <h2 data-aparece="arriba">Grupos</h2>
          ${grupos(d)}
        </section>
        <section>
          <h2 data-aparece="arriba">Cuándo</h2>
          ${semana(clases)}
          <p style="margin-top:14px;"><a class="btn btn-outline" href="horario.html?disciplina=${encodeURIComponent(d.slug)}">Reservar en el horario</a></p>
        </section>
      </div>
      ${equipoDe(d, datos)}
      ${cuotasDe(d, datos)}
      <section class="disc-seccion">
        <h2 data-aparece="arriba">Otras disciplinas</h2>
        ${otras(datos, d.slug)}
      </section>
    </div></div>`;
  prepararApariciones(main);
});

function cabecera(d, datos) {
  const cuenta = getAccount();
  const edades = d.groups.filter((g) => g.classes_per_week > 0 && g.min_age != null).map((g) => g.min_age);
  const intro = d.description || `${d.name}: ${plural(d.groups.length, "grupo", "grupos")} y ${plural(d.classes_per_week, "clase", "clases")} a la semana.`;
  return `
    <section class="disc-heroe cinta-${esc(d.color)}">
      <div class="container">
        <span class="migas"><a href="index.html#disciplinas">Disciplinas</a></span>
        <h1>${esc(d.name)}</h1>
        <p class="disc-intro">${esc(intro)}</p>
        <div class="disc-cifras">
          <div data-aparece="arriba" style="--orden:1"><strong data-contar="${d.classes_per_week}">${d.classes_per_week}</strong><span>clases a la semana</span></div>
          <div data-aparece="arriba" style="--orden:2"><strong data-contar="${d.groups.length}">${d.groups.length}</strong><span>${d.groups.length === 1 ? "grupo" : "grupos"}</span></div>
          ${edades.length ? `<div data-aparece="arriba" style="--orden:3"><strong data-contar="${Math.min(...edades)}">${Math.min(...edades)}</strong><span>años, la edad para empezar</span></div>` : ""}
        </div>
        <div class="heroe-acciones">
          <a class="btn btn-dark btn-lg" href="horario.html?disciplina=${encodeURIComponent(d.slug)}">Ver su horario y reservar</a>
          ${!cuenta && datos.trial_classes ? `<a class="btn btn-claro btn-lg" href="acceso.html#registro">Probar una clase gratis</a>` : ""}
        </div>
      </div>
      <div class="cinturon-grande" aria-hidden="true"><span class="puntera">${[0, 1, 2, 3].map((n) => `<i style="--n:${n}"></i>`).join("")}</span></div>
    </section>`;
}

function grupos(d) {
  if (!d.groups.length) return `<p class="muted">Todavía no tiene grupos.</p>`;
  return d.groups
    .map((g, i) => `
      <article class="grupo-tarjeta cinta-${esc(d.color)}" data-aparece="arriba" style="--orden:${i}">
        <h3>${esc(g.name)} <span>${esc(textoEdades(g.min_age, g.max_age))}</span></h3>
        ${g.description ? `<p>${esc(g.description)}</p>` : ""}
        <p>${g.classes_per_week ? `${plural(g.classes_per_week, "clase", "clases")} a la semana` : "Ahora mismo sin clases en el horario"}</p>
      </article>`)
    .join("");
}

function semana(clases) {
  if (!clases.length) return `<p class="muted">Ahora mismo no tiene clases en el horario.</p>`;
  const orden = [1, 2, 3, 4, 5, 6, 0];
  const dias = orden.filter((dow) => clases.some((c) => c.day_of_week === dow));
  return `<ul class="semana-disc" data-aparece="arriba">
    ${dias.map((dow) => `
      <li>
        <span class="dia">${DIAS[dow]}</span>
        <span class="sesiones">${clases
          .filter((c) => c.day_of_week === dow)
          .map((c) => `<span><b>${c.start_time}–${c.end_time}</b>${esc(c.name || c.group_name)}, con ${esc(c.instructor_name.split(" ")[0])}</span>`)
          .join("")}</span>
      </li>`).join("")}
  </ul>`;
}

function equipoDe(d, datos) {
  const suyos = datos.instructors.filter((p) => p.disciplines.some((x) => x.slug === d.slug));
  if (!suyos.length) return "";
  return `
    <section class="disc-seccion">
      <h2 data-aparece="arriba">Quién la imparte</h2>
      <ul class="equipo-lista">${suyos
        .map((p, i) => `
          <li class="instructor" data-aparece="pop" style="--orden:${i}">
            <span class="instructor-aro" style="--aro:var(--belt-${esc(d.color)}) 0 100%"><span>${esc(iniciales(p.name))}</span></span>
            <strong>${esc(p.name)}</strong>
            ${p.disciplines.length > 1 ? `<span class="instructor-disc">También ${esc(enumerar(p.disciplines.filter((x) => x.slug !== d.slug).map((x) => x.name)))}</span>` : ""}
          </li>`)
        .join("")}</ul>
    </section>`;
}

function cuotasDe(d, datos) {
  const planes = datos.plans.filter((p) => p.scope === "all" || p.discipline_slug === d.slug);
  if (!planes.length) return "";
  return `
    <section class="disc-seccion">
      <h2 data-aparece="arriba">Cuotas que la incluyen</h2>
      <div class="tablon">${planes
        .map((p, i) => `
          <div class="tablon-fila${p.scope === "all" ? " tablon-todas" : ""}" data-aparece="arriba" style="--orden:${i}">
            <div class="tablon-nombre">
              <strong>${p.scope === "discipline" ? cinta(p.discipline_color) : ""}${esc(p.name)}</strong>
              <small>${esc(detallePlan(p))}</small>
            </div>
            <span class="tablon-puntos" aria-hidden="true"></span>
            <span class="tablon-precio">${precioCorto(p.price_cents)}<small>/mes</small></span>
          </div>`)
        .join("")}</div>
      ${datos.trial_classes ? `<p class="tablon-nota">Antes de contratar, ${datos.trial_classes === 1 ? "la primera clase es gratis" : `las ${datos.trial_classes} primeras clases son gratis`}.</p>` : ""}
    </section>`;
}

function otras(datos, actual) {
  const resto = datos.disciplines.filter((x) => x.slug !== actual);
  if (!resto.length) return `<p class="muted">No hay más disciplinas.</p>`;
  return `<div class="otras-disciplinas">${resto
    .map((x, i) => `<a href="disciplina.html?d=${encodeURIComponent(x.slug)}" data-aparece="pop" style="--orden:${i}">${cinta(x.color)}${esc(x.name)}</a>`)
    .join("")}</div>`;
}
