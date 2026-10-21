// js/common.js
const API = "/api";

function getToken() { return localStorage.getItem("academia_token"); }
function getAccount() {
  const raw = localStorage.getItem("academia_account");
  return raw ? JSON.parse(raw) : null;
}
function saveSession(token, account) {
  localStorage.setItem("academia_token", token);
  localStorage.setItem("academia_account", JSON.stringify(account));
}
function logout() {
  localStorage.removeItem("academia_token");
  localStorage.removeItem("academia_account");
  window.location.href = "index.html";
}

async function api(path, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(API + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Además del mensaje, el error lleva el código HTTP y lo que haya mandado
    // el servidor (algunas respuestas incluyen datos útiles, como la cuenta
    // que ya existe con un email).
    const err = new Error(data.error || "Algo ha ido mal. Inténtalo de nuevo.");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Vuelve a pedir al servidor los datos de la cuenta (nombre, rol...). Así, si
// la academia cambia el rol de alguien o desactiva su cuenta, la cabecera lo
// refleja sin tener que cerrar sesión. Si la sesión ya no vale, se borra y la
// página, al ver que no hay sesión, lleva a "Iniciar sesión".
async function refrescarCuenta() {
  if (!getToken()) return;
  try {
    const res = await fetch(`${API}/account`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (res.status === 401) {
      localStorage.removeItem("academia_token");
      localStorage.removeItem("academia_account");
      return;
    }
    if (!res.ok) return;
    const a = await res.json();
    localStorage.setItem(
      "academia_account",
      JSON.stringify({
        id: a.id, name: a.name, email: a.email, role: a.role,
        must_change_password: !!a.must_change_password,
        privacy_pending: !!a.privacy_pending,
      })
    );
  } catch (_) {
    // Sin conexión: seguimos con los datos que ya teníamos.
  }
}

// Iconos pequeños (SVG en línea: no dependen de ninguna web externa).
const ICONOS = {
  marca: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1.5" y="7" width="21" height="4.2" rx="1" fill="#0D1B3E"/><rect x="9.2" y="5.2" width="5.6" height="7.6" rx="1.3" fill="#0D1B3E" stroke="#F7C51E" stroke-width="1.2"/><path d="M10.2 12.4 7.4 20.5l2.6.6 2-6.4zM13.8 12.4l2.8 8.1-2.6.6-2-6.4z" fill="#0D1B3E"/></svg>`,
  flecha: `<svg class="flecha" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4.5 6 8.5l4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  cerrar: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
};

// Muestra de cinturón con el color de una disciplina (azul, morado...).
const cinta = (color) => `<span class="muestra-cinta cinta-${esc(color || "blanco")}"></span>`;

async function renderHeader() {
  const mount = document.getElementById("site-header");
  if (!mount) return;

  await refrescarCuenta();
  const account = getAccount();
  const pagina = location.pathname.split("/").pop() || "index.html";
  const enlace = (href, texto) => `<a href="${href}"${pagina === href ? ' class="activo" aria-current="page"' : ""}>${texto}</a>`;

  let enlaces = enlace("horario.html", "Horario") + `
    <div class="desplegable">
      <button class="nav-link" id="btn-disciplinas" aria-expanded="false" aria-controls="menu-disciplinas">Disciplinas ${ICONOS.flecha}</button>
      <div class="desplegable-panel" id="menu-disciplinas"><p class="muted" style="padding:10px 12px; font-size:.85rem;">Cargando…</p></div>
    </div>`;
  if (account) {
    enlaces += enlace("mis-reservas.html", "Mis reservas") + enlace("mi-familia.html", "Mi familia") + enlace("mis-cuotas.html", "Cuotas");
    if (account.role === "instructor" || account.role === "admin") enlaces += enlace("pasar-lista.html", "Pasar lista");
    if (account.role === "admin") enlaces += enlace("admin.html", "Administración");
    enlaces += `<span class="nav-sep"></span>
      <a href="mi-cuenta.html" class="nav-nombre${pagina === "mi-cuenta.html" ? " activo" : ""}" title="Mi cuenta">${esc(account.name.split(" ")[0])}</a>
      <a href="#" id="logout-link" class="nav-salir">Salir</a>`;
  } else {
    enlaces += `<span class="nav-sep"></span>${enlace("acceso.html", "Iniciar sesión")}`;
  }

  mount.innerHTML = `
    <div class="container header-top">
      <a href="index.html" class="brand"><span class="brand-marca">${ICONOS.marca}</span><span>Academia<b>App</b></span></a>
      <button class="menu-movil" id="menu-movil" aria-expanded="false" aria-controls="nav-principal" aria-label="Menú">${ICONOS.menu}</button>
      <nav class="nav-principal" id="nav-principal" aria-label="Principal">${enlaces}</nav>
    </div>
    ${
      account && account.must_change_password && !location.pathname.endsWith("mi-cuenta.html")
        ? `<div class="temp-pass-bar">Estás usando una contraseña temporal que te ha dado la academia. <a href="mi-cuenta.html?cambiar=1">Cámbiala ahora</a></div>`
        : ""
    }${
      account && !account.must_change_password && account.privacy_pending && !location.pathname.endsWith("privacidad.html")
        ? `<div class="temp-pass-bar">La academia ha actualizado su aviso de privacidad. <a href="privacidad.html?aceptar=1">Léelo y acéptalo</a></div>`
        : ""
    }`;

  if (account) {
    document.getElementById("logout-link").addEventListener("click", (e) => { e.preventDefault(); logout(); });
  }
  prepararMenus();
  ajustarCabecera();
  cargarMenuDisciplinas();
}

// Si los enlaces no caben en una línea (móvil, tablet, o una cuenta del
// equipo con muchos enlaces), la cabecera pasa al botón de menú.
function ajustarCabecera() {
  const cab = document.getElementById("site-header");
  const fila = cab && cab.querySelector(".header-top");
  if (!fila) return;
  cab.classList.remove("compacta");
  const nav = document.getElementById("nav-principal");
  const marca = fila.querySelector(".brand");
  const necesita = marca.offsetWidth + nav.scrollWidth + 24;
  cab.classList.toggle("compacta", window.innerWidth <= 760 || necesita > fila.clientWidth - 44);
}
window.addEventListener("resize", () => {
  clearTimeout(ajustarCabecera.t);
  ajustarCabecera.t = setTimeout(ajustarCabecera, 80);
});

// Menú del móvil y desplegable de disciplinas: se abren con clic (o toque) y
// se cierran al pulsar fuera o con Escape.
function prepararMenus() {
  const alternar = (boton, panel, abrir) => {
    const abierto = abrir ?? boton.getAttribute("aria-expanded") !== "true";
    boton.setAttribute("aria-expanded", String(abierto));
    panel.classList.toggle("abierto", abierto);
    if (boton.id === "menu-movil") boton.innerHTML = abierto ? ICONOS.cerrar : ICONOS.menu;
  };
  const movil = document.getElementById("menu-movil");
  const nav = document.getElementById("nav-principal");
  const btnDisc = document.getElementById("btn-disciplinas");
  const panelDisc = document.getElementById("menu-disciplinas");
  movil.addEventListener("click", () => alternar(movil, nav));
  btnDisc.addEventListener("click", (e) => { e.stopPropagation(); alternar(btnDisc, panelDisc); });
  document.addEventListener("click", (e) => {
    if (!panelDisc.contains(e.target)) alternar(btnDisc, panelDisc, false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (btnDisc.getAttribute("aria-expanded") === "true") { alternar(btnDisc, panelDisc, false); btnDisc.focus(); }
    else if (movil.getAttribute("aria-expanded") === "true") { alternar(movil, nav, false); movil.focus(); }
  });
}

// Cada disciplina del menú lleva a su página (disciplina.html), donde están
// sus grupos, su horario, quién la imparte y sus cuotas.
async function cargarMenuDisciplinas() {
  const panel = document.getElementById("menu-disciplinas");
  const actual = location.pathname.endsWith("disciplina.html") ? new URLSearchParams(location.search).get("d") : null;
  try {
    const disciplinas = await api("/schedule/disciplines");
    panel.innerHTML =
      disciplinas
        .map((d) => `<a href="disciplina.html?d=${encodeURIComponent(d.slug)}"${d.slug === actual ? ' aria-current="page"' : ""}>${cinta(d.color)}<span>${esc(d.name)}</span></a>`)
        .join("") + `<a class="todo" href="horario.html">Horario completo</a>`;
  } catch (_) {
    panel.innerHTML = `<a class="todo" href="horario.html">Horario completo</a>`;
  }
}

// ---------------------------------------------------------------------------
// Tablas en el móvil: cada fila se convierte en una tarjeta.
// ---------------------------------------------------------------------------
// En una pantalla estrecha, una tabla de 7 columnas obliga a desplazarse de
// lado y los botones (Pasar lista, Registrar pago...) quedan fuera de la
// vista. Aquí cada celda recibe el título de su columna (data-label) y la
// hoja de estilos, por debajo de 640 px, apila las celdas con ese título
// delante. Se hace solo para todas las tablas .data-table, también para las
// que se pintan después (al filtrar, al cambiar de pestaña...).
function etiquetarTabla(tabla) {
  const titulos = [...tabla.querySelectorAll("thead th")].map((th) => th.textContent.trim());
  if (!titulos.length) return;
  tabla.querySelectorAll("tbody tr").forEach((tr) => {
    let col = 0;
    [...tr.children].forEach((td) => {
      if (!td.hasAttribute("data-label")) td.setAttribute("data-label", td.colSpan > 1 ? "" : titulos[col] || "");
      col += td.colSpan || 1;
    });
  });
  tabla.classList.add("apilable");
}
new MutationObserver((cambios) => {
  for (const c of cambios) {
    c.addedNodes.forEach((n) => {
      if (n.nodeType !== 1) return;
      if (n.matches("table.data-table")) etiquetarTabla(n);
      n.querySelectorAll && n.querySelectorAll("table.data-table").forEach(etiquetarTabla);
      const tabla = n.closest && n.closest("table.data-table");
      if (tabla) etiquetarTabla(tabla);
    });
  }
}).observe(document.documentElement, { childList: true, subtree: true });

// "45,00 €" -> "45 €" cuando no hay céntimos (para precios grandes y limpios).
function precioCorto(cents) {
  const euros = Number(cents || 0) / 100;
  return Number.isInteger(euros) ? `${euros} €` : formatEuros(cents);
}

// Texto de edades de un grupo: "6–12 años", "Desde 16 años"...
function textoEdades(min, max) {
  if (min == null && max == null) return "Todas las edades";
  if (max == null) return `Desde ${min} años`;
  if (min == null) return `Hasta ${max} años`;
  return `${min}–${max} años`;
}

// Detalle de un plan para el tablón: su descripción o, si no tiene, qué incluye.
function detallePlan(p) {
  const partes = [p.description ? p.description.replace(/\.\s*$/, "") : p.scope === "all" ? "Todas las disciplinas" : p.discipline_name];
  if (p.max_classes_per_week && !/semana/i.test(p.description || "")) partes.push(`Hasta ${p.max_classes_per_week} clases por semana`);
  return partes.filter(Boolean).join(". ") + ".";
}

// "Javier Roldán" -> "JR"
function iniciales(nombre) {
  return String(nombre || "").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
}

const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

// ---------------------------------------------------------------------------
// Avatar de un miembro: la foto si tiene, o un círculo con sus iniciales si
// no. Se usa en "Mi familia" y en "Pasar lista", así que vive aquí para no
// repetir la misma lógica en dos sitios.
// ---------------------------------------------------------------------------
function avatarHtml(member, grande = false) {
  const clase = grande ? "avatar avatar-lg" : "avatar";
  const claseIniciales = grande ? "avatar-initials avatar-initials-lg" : "avatar-initials";

  if (member.avatar_file) {
    return `<img class="${clase}" src="/uploads/avatars/${encodeURIComponent(member.avatar_file)}" alt="Foto de ${esc(member.first_name)}">`;
  }
  const iniciales = (member.first_name[0] || "") + (member.last_name ? member.last_name[0] : "");
  return `<div class="${claseIniciales}">${esc(iniciales.toUpperCase())}</div>`;
}

// Sube (o cambia) la foto de un miembro. Usa fetch directamente en vez del
// helper api(), porque una subida de archivo va como multipart/form-data:
// si fijáramos "Content-Type: application/json" como hace api(), el
// servidor no podría leer el archivo.
async function subirAvatar(memberId, file) {
  const formData = new FormData();
  formData.append("avatar", file);

  const res = await fetch(`${API}/family/members/${memberId}/avatar`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "No se ha podido subir la foto.");
  return data;
}

// Importe en céntimos -> "45,00 €"
function formatEuros(cents) {
  return (Number(cents || 0) / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

// "2026-10-05" -> "5 oct 2026"
function formatFecha(iso) {
  if (!iso) return "—";
  const d = new Date(String(iso).slice(0, 10) + "T12:00:00");
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
}

// Escapa texto antes de meterlo en innerHTML (nombres, notas que escribe la gente).
function esc(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const ESTADOS_CUOTA = {
  pendiente_pago: "Pendiente de pago",
  procesando: "Procesando el cobro",
  activa: "Activa",
  pausada: "Pausada",
  impagada: "Pago pendiente",
  cancelada: "Dada de baja",
};
const METODOS_PAGO = { stripe: "Tarjeta", efectivo: "Efectivo", transferencia: "Transferencia", bizum: "Bizum", tpv: "Datáfono" };

// Convierte el texto del aviso de privacidad (que la academia escribe con un
// formato muy sencillo) en HTML SEGURO: primero se escapa todo y después se
// aplican solo estas marcas:
//   # Título   ## Apartado   - elemento de lista   **negrita**
//   una línea en blanco separa párrafos
function textoConFormato(texto) {
  const negrita = (t) => t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const bloques = String(texto || "").replace(/\r\n/g, "\n").split(/\n\s*\n/);
  return bloques
    .map((bloque) => {
      const lineas = bloque.split("\n").map((l) => esc(l.trim())).filter(Boolean);
      if (!lineas.length) return "";
      if (lineas.every((l) => l.startsWith("- "))) return `<ul class="lista-texto">${lineas.map((l) => `<li>${negrita(l.slice(2))}</li>`).join("")}</ul>`;
      return lineas
        .map((l) => {
          if (l.startsWith("## ")) return `<h2>${negrita(l.slice(3))}</h2>`;
          if (l.startsWith("# ")) return `<h1>${negrita(l.slice(2))}</h1>`;
          if (l.startsWith("- ")) return `<ul class="lista-texto"><li>${negrita(l.slice(2))}</li></ul>`;
          return `<p>${negrita(l)}</p>`;
        })
        .join("");
    })
    .join("");
}
