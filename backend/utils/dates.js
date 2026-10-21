// utils/dates.js
// Fechas como texto "YYYY-MM-DD" en hora local. Trabajamos siempre con
// mediodía (12:00) al convertir, para que un cambio de horario de verano
// nunca desplace un día hacia atrás o hacia delante.

function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

// Suma meses respetando los finales de mes: 31 de enero + 1 mes = 28 (o 29)
// de febrero, no 3 de marzo (que es lo que haría JavaScript sin cuidado).
function addMonths(s, n) {
  const [y, m, d] = s.split("-").map(Number);
  const target = new Date(y, m - 1 + n, 1, 12);
  const ultimoDia = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, ultimoDia));
  return todayStr(target);
}

function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

function unixToDateStr(unix) {
  return todayStr(new Date(unix * 1000));
}

function toUnix(s) {
  const [y, m, d] = s.split("-").map(Number);
  return Math.floor(new Date(y, m - 1, d, 0, 0, 0).getTime() / 1000);
}

// Semana de lunes a domingo que contiene la fecha dada.
function weekRange(s) {
  const lunesOffset = (parseDate(s).getDay() + 6) % 7;
  const lunes = addDays(s, -lunesOffset);
  return { start: lunes, end: addDays(lunes, 6) };
}

function fechaLegible(s) {
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

// Hora local actual como "HH:MM" (se compara como texto con start_time).
function horaActual(d = new Date()) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ¿Ha empezado ya la sesión de una clase? (un día anterior a hoy, o hoy a
// partir de su hora de inicio). Se usa para no dejar reservar, anular ni
// "deshacer" nada de una clase que ya está en marcha o ha terminado.
function yaHaEmpezado(fecha, horaInicio) {
  const hoy = todayStr();
  return fecha < hoy || (fecha === hoy && horaInicio <= horaActual());
}

module.exports = {
  todayStr, parseDate, addDays, addMonths, daysBetween, unixToDateStr, toUnix, weekRange, fechaLegible,
  horaActual, yaHaEmpezado,
};
