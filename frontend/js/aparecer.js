// js/aparecer.js — lo que aparece al bajar por la página (portada y páginas
// de disciplina).
//
// Cómo se usa: cualquier elemento con data-aparece="…" empieza oculto y se
// muestra con una transición en cuanto entra en la pantalla:
//
//   data-aparece="izquierda" | "derecha"  entra deslizándose desde ese lado
//   data-aparece="arriba"                 sube un poco mientras aparece
//   data-aparece="pop"                    crece desde un poco más pequeño
//   data-aparece="tirar"                  se descubre de izquierda a derecha,
//                                         como un cinturón que se desenrolla
//
// style="--orden: 3" retrasa ese elemento (3 × 80 ms) para que los de un
// mismo grupo vayan saliendo uno detrás de otro.
//
// Y data-contar="16" hace que un número cuente de 0 a 16 al aparecer.
//
// Si la persona tiene activado "reducir movimiento" en su sistema (o el
// navegador es muy antiguo), no se anima nada: todo se ve desde el principio.
// Las transiciones en sí están en css/style.css (busca "APARECER AL BAJAR").

const SIN_MOVIMIENTO = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const CON_ANIMACION = !SIN_MOVIMIENTO && "IntersectionObserver" in window;

// La clase .anim en <html> es la que permite ocultar lo que aún no ha
// aparecido: si este script no llegara a cargarse, nada quedaría escondido.
if (CON_ANIMACION) document.documentElement.classList.add("anim");

// Lo que se vigila -> los elementos que hay que mostrar cuando entre en
// pantalla. Normalmente es el propio elemento; pero uno "tirar" empieza
// recortado del todo (no ocupa nada visible) y el navegador nunca avisaría
// de que ha entrado: en ese caso se vigila a su contenedor.
const pendientes = new Map();

const observadorAparecer = CON_ANIMACION
  ? new IntersectionObserver(
      (entradas) => {
        entradas.forEach((e) => {
          if (!e.isIntersecting) return;
          (pendientes.get(e.target) || []).forEach(mostrarElemento);
          pendientes.delete(e.target);
          observadorAparecer.unobserve(e.target);
        });
      },
      // Aparece cuando ya se ve un poco (no justo al asomar por abajo).
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
    )
  : null;

function mostrarElemento(el) {
  el.classList.add("visible");
  if (el.dataset.contar) contarHasta(el);
}

// Llamar después de pintar contenido nuevo.
function prepararApariciones(raiz = document) {
  const elementos = raiz.querySelectorAll("[data-aparece]:not(.visible), [data-contar]:not(.visible)");
  elementos.forEach((el) => {
    if (!CON_ANIMACION) return el.classList.add("visible");
    if (el.dataset.contar) el.textContent = formatoContador(el, 0);
    const vigilado = el.dataset.aparece === "tirar" ? el.parentElement : el;
    if (!pendientes.has(vigilado)) pendientes.set(vigilado, []);
    pendientes.get(vigilado).push(el);
    observadorAparecer.observe(vigilado);
  });
}

function formatoContador(el, n) {
  return `${el.dataset.prefijo || ""}${n}${el.dataset.sufijo || ""}`;
}

// Cuenta de 0 al número final en ~0,9 s, frenando al final.
function contarHasta(el) {
  const final = Number(el.dataset.contar) || 0;
  if (!CON_ANIMACION || final <= 0) { el.textContent = formatoContador(el, final); return; }
  const inicio = performance.now();
  const duracion = 900;
  const paso = (ahora) => {
    const t = Math.min(1, (ahora - inicio) / duracion);
    const suave = 1 - Math.pow(1 - t, 3);
    el.textContent = formatoContador(el, Math.round(final * suave));
    if (t < 1) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}

// ---------------------------------------------------------------------------
// Pasos que se activan al pasar por el centro de la pantalla (lo usa
// "Cómo empezar" en la portada para cambiar el color del cinturón).
// alActivar(indice, elemento) se llama cada vez que cambia el paso activo.
// ---------------------------------------------------------------------------
function seguirPasos(pasos, alActivar) {
  if (!pasos.length) return;
  if (!("IntersectionObserver" in window)) return alActivar(0, pasos[0]);
  let activo = -1;
  const io = new IntersectionObserver(
    (entradas) => {
      entradas.forEach((e) => {
        if (!e.isIntersecting) return;
        const i = pasos.indexOf(e.target);
        if (i !== activo) { activo = i; alActivar(i, e.target); }
      });
    },
    // Una franja estrecha en el centro de la pantalla.
    { rootMargin: "-45% 0px -50% 0px", threshold: 0 }
  );
  pasos.forEach((p) => io.observe(p));
  alActivar(0, pasos[0]);
}
