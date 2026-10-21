// demo.js — modo DEMO para el portfolio (solo se activa con DEMO=1).
//
// Cuando esta app se publica como demostración pública (en Render), las
// variables de entorno llevan DEMO=1 y este archivo hace tres cosas, sin
// tocar el resto del código:
//
//  1. Añade a cada página una cinta «Demo» con las cuentas de prueba. Un clic
//     en una cuenta cierra la sesión que hubiera, abre la página de acceso y
//     entra con esa cuenta. También lleva un enlace de vuelta al portfolio.
//  2. Bloquea lo que dejaría fuera a las siguientes visitas (cambiar la
//     contraseña de una cuenta de prueba, desactivarla...).
//  3. Nada más. En tu ordenador, sin DEMO=1, la app funciona como siempre.
//
// Los datos de la demo se reinician solos: en el plan gratuito de Render el
// disco no es permanente, así que cada vez que el servidor se duerme (tras un
// rato sin visitas) y se vuelve a despertar, la base de datos se crea de
// nuevo con los datos de ejemplo.
const fs = require("fs");
const path = require("path");

const CONFIG = (() => {
  // Cuentas de ejemplo de la academia (db/seed.js).
  const CUENTAS = ["admin@academia.com", "beatriz@ejemplo.com", "marta.instructor@academia.com", "carlos@ejemplo.com",
    "javier.instructor@academia.com", "diego.instructor@academia.com"];
  const esCuentaDemo = (id) => {
    const db = require("./db/database");
    const a = db.prepare("SELECT email FROM accounts WHERE id = ?").get(Number(id));
    return !!a && CUENTAS.includes(a.email);
  };
  const idDeRuta = (req) => req.path.split("/")[4]; // /api/admin/accounts/:id/...
  return {
    cinta: {
      nombre: "AcademiaApp",
      acceso: "acceso.html",
      clave: "academia123",
      cuentas: [
        { rol: "Administración de la academia", email: "admin@academia.com" },
        { rol: "Familia: madre y dos hijos", email: "beatriz@ejemplo.com" },
        { rol: "Instructora (pasar lista)", email: "marta.instructor@academia.com" },
        { rol: "Alumno adulto", email: "carlos@ejemplo.com" },
      ],
    },
    bloqueos: [
      { metodo: "PUT", ruta: "^/api/account/password$" },
      { metodo: "POST", ruta: "^/api/auth/reset$" },
      { metodo: "POST", ruta: "^/api/admin/accounts/\\d+/reset-password$", si: (req) => esCuentaDemo(idDeRuta(req)) },
      { metodo: "PUT", ruta: "^/api/admin/accounts/\\d+(/active|/role)?$", si: (req) => esCuentaDemo(idDeRuta(req)) },
    ],
  };
})();

module.exports = function activarDemo(app, carpetaFrontend) {
  if (process.env.DEMO !== "1") return;
  const raiz = path.resolve(carpetaFrontend);
  const portfolio = process.env.PORTFOLIO_URL || "https://alvarofernandez03.github.io/";
  const cinta = `(${codigoCinta.toString()})(${JSON.stringify({ ...CONFIG.cinta, portfolio })});`;

  app.get("/__demo/cinta.js", (req, res) => {
    res.type("application/javascript").set("Cache-Control", "no-cache").send(cinta);
  });

  // 2. Lo que no se puede hacer en la demo pública.
  app.use((req, res, next) => {
    const bloqueo = CONFIG.bloqueos.find((b) => b.metodo === req.method && new RegExp(b.ruta).test(req.path));
    if (bloqueo && (!bloqueo.si || bloqueo.si(req))) {
      return res.status(403).json({
        error: "En la demo pública esto está desactivado, para que todo el mundo pueda entrar con las cuentas de prueba.",
      });
    }
    next();
  });

  // 1. La cinta se añade al final de cada página HTML.
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const ruta = req.path === "/" ? "/index.html" : req.path;
    if (!ruta.endsWith(".html")) return next();
    let archivo;
    try {
      archivo = path.resolve(raiz, "." + decodeURIComponent(ruta));
    } catch (_) {
      return next();
    }
    if (!archivo.startsWith(raiz + path.sep)) return next();
    fs.readFile(archivo, "utf8", (err, html) => {
      if (err) return next();
      const etiqueta = '<script src="/__demo/cinta.js" defer></script>';
      const conCinta = html.includes("</body>") ? html.replace("</body>", `${etiqueta}\n</body>`) : html + etiqueta;
      res.type("html").set("Cache-Control", "no-cache").send(conCinta);
    });
  });

  console.log("🎭 Modo DEMO: cinta con las cuentas de prueba y cambios de contraseña bloqueados.");
};

// ---------------------------------------------------------------------------
// La cinta (este código se ejecuta en el navegador, no en el servidor)
// ---------------------------------------------------------------------------
function codigoCinta(cfg) {
  if (window.__cintaDemo) return;
  window.__cintaDemo = true;

  const PLEGADA = "cinta-demo-plegada";
  const leer = () => { try { return sessionStorage.getItem(PLEGADA); } catch (e) { return null; } };
  const guardar = (v) => { try { sessionStorage.setItem(PLEGADA, v); } catch (e) {} };

  const estilo = document.createElement("style");
  estilo.textContent = `
    .cdemo{position:fixed;left:12px;bottom:12px;z-index:2147483000;font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#F4F1EA;letter-spacing:0;text-transform:none;text-align:left}
    .cdemo *{box-sizing:border-box;margin:0;padding:0;font:inherit;color:inherit}
    .cdemo-boton{display:inline-flex;align-items:center;gap:8px;background:#17181C;border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:7px 13px 7px 10px;cursor:pointer;box-shadow:0 8px 24px -10px rgba(0,0,0,.55);font-weight:700}
    .cdemo-boton:focus-visible,.cdemo-cuenta:focus-visible,.cdemo a:focus-visible{outline:2px solid #F5C518;outline-offset:2px}
    .cdemo-punto{width:8px;height:8px;border-radius:50%;background:#3DDC84;box-shadow:0 0 0 3px rgba(61,220,132,.2)}
    .cdemo-tarjeta{width:min(330px,calc(100vw - 24px));background:#17181C;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:14px 14px 12px;margin-bottom:8px;box-shadow:0 18px 40px -14px rgba(0,0,0,.6)}
    .cdemo[data-plegada="1"] .cdemo-tarjeta{display:none}
    .cdemo-titulo{font-weight:700;font-size:14px;margin-bottom:4px}
    .cdemo-texto{color:#B9B6AE;font-size:12.5px;margin-bottom:10px}
    .cdemo-lista{display:flex;flex-direction:column;gap:6px;list-style:none}
    .cdemo-cuenta{display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;background:#22242A;border:1px solid transparent;border-radius:9px;padding:8px 10px;cursor:pointer;text-align:left}
    .cdemo-cuenta:hover{border-color:rgba(245,197,24,.6)}
    .cdemo-cuenta b{display:block;font-weight:700;font-size:12.5px}
    .cdemo-cuenta small{display:block;color:#9C998F;font-size:11.5px;word-break:break-all}
    .cdemo-cuenta i{font-style:normal;font-size:11.5px;font-weight:700;color:#F5C518;white-space:nowrap}
    .cdemo-clave{margin-top:8px;font-size:12px;color:#B9B6AE}
    .cdemo-clave code{font-family:ui-monospace,Consolas,monospace;background:#22242A;padding:1px 6px;border-radius:5px;color:#F4F1EA}
    .cdemo-pie{display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.1);font-size:12px}
    .cdemo-pie a{color:#F5C518;text-decoration:underline;text-underline-offset:2px}
    @media print{.cdemo{display:none}}`;
  document.head.appendChild(estilo);

  const raiz = document.createElement("aside");
  raiz.className = "cdemo";
  raiz.setAttribute("aria-label", "Información de la demo");
  // Abierta la primera vez (para que se vean las cuentas); luego, como se dejó.
  raiz.dataset.plegada = leer() === "1" ? "1" : "0";

  const tarjeta = document.createElement("div");
  tarjeta.className = "cdemo-tarjeta";
  tarjeta.id = "cdemo-tarjeta";
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  tarjeta.innerHTML = `
    <p class="cdemo-titulo">${esc(cfg.nombre)} · demo</p>
    <p class="cdemo-texto">Datos de ejemplo: puedes tocar lo que quieras, se reinician solos. Entra con una cuenta de prueba:</p>
    <ul class="cdemo-lista">${cfg.cuentas.map((c, i) => `
      <li><button type="button" class="cdemo-cuenta" data-i="${i}">
        <span><b>${esc(c.rol)}</b><small>${esc(c.email)}</small></span><i>Entrar →</i>
      </button></li>`).join("")}
    </ul>
    <p class="cdemo-clave">Contraseña de todas: <code>${esc(cfg.clave)}</code></p>
    <p class="cdemo-pie"><a href="${esc(cfg.portfolio)}">← Volver al portfolio</a><span>Álvaro Fernández</span></p>`;

  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "cdemo-boton";
  boton.setAttribute("aria-controls", "cdemo-tarjeta");
  const pintarBoton = () => {
    const plegada = raiz.dataset.plegada === "1";
    boton.setAttribute("aria-expanded", String(!plegada));
    boton.innerHTML = `<span class="cdemo-punto" aria-hidden="true"></span>${plegada ? "Demo · cuentas de prueba" : "Ocultar"}`;
  };
  boton.addEventListener("click", () => {
    raiz.dataset.plegada = raiz.dataset.plegada === "1" ? "0" : "1";
    guardar(raiz.dataset.plegada);
    pintarBoton();
  });
  pintarBoton();

  raiz.append(tarjeta, boton);
  document.body.appendChild(raiz);

  // El formulario de acceso de la página (el primero visible con email y contraseña).
  function formularioAcceso() {
    for (const f of document.querySelectorAll("form")) {
      const email = f.querySelector('input[type="email"]');
      const clave = f.querySelector('input[type="password"]');
      if (email && clave && f.offsetParent !== null) return { f, email, clave };
    }
    return null;
  }
  function entrar(i) {
    const c = cfg.cuentas[i];
    const acceso = formularioAcceso();
    if (!acceso) {
      // Se cierra la sesión que hubiera (todo lo guardado es de esta app) y se va al acceso.
      try { localStorage.clear(); } catch (e) {}
      location.href = `${cfg.acceso}#demo-${i}`;
      return;
    }
    const poner = (input, valor) => {
      input.value = valor;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    poner(acceso.email, c.email);
    poner(acceso.clave, cfg.clave);
    raiz.dataset.plegada = "1";
    guardar("1");
    pintarBoton();
    if (acceso.f.requestSubmit) acceso.f.requestSubmit();
    else acceso.f.querySelector('[type="submit"]').click();
  }
  tarjeta.querySelectorAll("[data-i]").forEach((b) => b.addEventListener("click", () => entrar(Number(b.dataset.i))));

  // Llegada desde «Entrar →» en otra página: se rellena y se entra.
  const m = location.hash.match(/^#demo-(\d+)$/);
  if (m && cfg.cuentas[Number(m[1])]) {
    history.replaceState(null, "", location.pathname + location.search);
    setTimeout(() => entrar(Number(m[1])), 350);
  }
}
