// middleware/rateLimit.js
//
// Límites de intentos, en memoria. Suficiente para una academia con un solo
// servidor (si algún día hubiera varios, habría que guardarlos en común).
//
// Dos tipos:
//  - limiteFallos: solo cuentan los intentos FALLIDOS (contraseña incorrecta).
//    Quien entra bien nunca se bloquea; quien prueba contraseñas a ciegas, sí.
//  - limitePeticiones: cuentan todas las peticiones (registro, "olvidé mi
//    contraseña"), que una persona normal no repite decenas de veces.
//
// La IP sale de req.ip. Detrás de un proxy (Caddy, Nginx...) hay que poner
// TRUST_PROXY=1 en el .env para que sea la IP real de quien se conecta.

function crearAlmacen(ventanaMs) {
  const registros = new Map(); // clave -> { n, reinicio }
  setInterval(() => {
    const ahora = Date.now();
    for (const [k, v] of registros) if (v.reinicio <= ahora) registros.delete(k);
  }, Math.min(ventanaMs, 5 * 60 * 1000)).unref();

  const vivo = (clave) => {
    const r = registros.get(clave);
    return r && r.reinicio > Date.now() ? r : null;
  };
  return {
    cuenta: (clave) => (vivo(clave) ? vivo(clave).n : 0),
    segundosRestantes: (clave) => (vivo(clave) ? Math.ceil((vivo(clave).reinicio - Date.now()) / 1000) : 0),
    sumar(clave) {
      const r = vivo(clave) || { n: 0, reinicio: Date.now() + ventanaMs };
      r.n++;
      registros.set(clave, r);
    },
    borrar: (clave) => registros.delete(clave),
    vaciar: () => registros.clear(),
  };
}

function responder429(res, segundos, texto) {
  const minutos = Math.max(1, Math.ceil(segundos / 60));
  res.set("Retry-After", String(segundos));
  return res.status(429).json({ error: `${texto} Vuelve a intentarlo en ${minutos} ${minutos === 1 ? "minuto" : "minutos"}.` });
}

// Límite por intentos fallidos. `claves(req)` devuelve una lista de
// [clave, máximo]: se bloquea si CUALQUIERA de ellas ha llegado a su máximo.
// La ruta llama a req.anotarFallo() cuando el intento falla y a
// req.limpiarFallos() cuando sale bien.
function limiteFallos({ ventanaMs, claves, texto }) {
  const almacen = crearAlmacen(ventanaMs);
  const mw = (req, res, next) => {
    const lista = claves(req).filter(([clave]) => clave);
    const bloqueada = lista.find(([clave, max]) => almacen.cuenta(clave) >= max);
    if (bloqueada) return responder429(res, almacen.segundosRestantes(bloqueada[0]), texto);
    req.anotarFallo = () => lista.forEach(([clave]) => almacen.sumar(clave));
    // Al acertar solo se perdonan los fallos de ESA cuenta, no los de la IP.
    req.limpiarFallos = () => lista.slice(0, 1).forEach(([clave]) => almacen.borrar(clave));
    next();
  };
  mw.vaciar = almacen.vaciar;
  return mw;
}

// Límite por número de peticiones.
function limitePeticiones({ ventanaMs, claves, texto }) {
  const almacen = crearAlmacen(ventanaMs);
  const mw = (req, res, next) => {
    const lista = claves(req).filter(([clave]) => clave);
    const bloqueada = lista.find(([clave, max]) => almacen.cuenta(clave) >= max);
    if (bloqueada) return responder429(res, almacen.segundosRestantes(bloqueada[0]), texto);
    lista.forEach(([clave]) => almacen.sumar(clave));
    next();
  };
  mw.vaciar = almacen.vaciar;
  return mw;
}

const QUINCE_MIN = 15 * 60 * 1000;
const UNA_HORA = 60 * 60 * 1000;
const email = (req) => String((req.body && req.body.email) || "").trim().toLowerCase();

const limites = {
  // 8 contraseñas incorrectas seguidas para una misma cuenta, o 30 desde una
  // misma IP (varias cuentas), bloquean 15 minutos.
  login: limiteFallos({
    ventanaMs: QUINCE_MIN,
    claves: (req) => [[email(req) && `login:${req.ip}:${email(req)}`, 8], [`login:${req.ip}`, 30]],
    texto: "Demasiados intentos fallidos.",
  }),
  // Cambiar la contraseña pide la actual: se limita igual, por cuenta.
  cambioContrasena: limiteFallos({
    ventanaMs: QUINCE_MIN,
    claves: (req) => [[`cambio:${req.accountId}`, 8]],
    texto: "Demasiados intentos con la contraseña actual incorrecta.",
  }),
  registro: limitePeticiones({
    ventanaMs: UNA_HORA,
    claves: (req) => [[`registro:${req.ip}`, 10]],
    texto: "Se han creado demasiadas cuentas desde esta conexión.",
  }),
  olvido: limitePeticiones({
    ventanaMs: UNA_HORA,
    claves: (req) => [[email(req) && `olvido:${email(req)}`, 5], [`olvido:${req.ip}`, 20]],
    texto: "Se han pedido demasiados enlaces para restablecer la contraseña.",
  }),
  restablecer: limitePeticiones({
    ventanaMs: UNA_HORA,
    claves: (req) => [[`restablecer:${req.ip}`, 30]],
    texto: "Demasiados intentos.",
  }),
};

module.exports = { limites, limiteFallos, limitePeticiones };
