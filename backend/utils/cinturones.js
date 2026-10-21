// utils/cinturones.js
//
// Colores de cinturón de BJJ que la academia puede dar a cada disciplina
// (horario, menús, su página). Se guarda la CLAVE ("azul"); el tono exacto lo
// pone la hoja de estilos, así se puede retocar sin tocar la base de datos.
const COLORES_CINTURON = ["blanco", "gris", "amarillo", "naranja", "verde", "azul", "morado", "marron", "negro"];

// Disciplinas sin color elegido (las creadas antes de existir esta opción):
// se reparten estos por orden, para que ninguna se quede sin color.
const ROTACION = ["azul", "morado", "naranja", "verde", "marron", "negro", "amarillo", "gris"];

function colorDisciplina(d) {
  if (d.color && COLORES_CINTURON.includes(d.color)) return d.color;
  return ROTACION[(Math.max(1, Number(d.id) || 1) - 1) % ROTACION.length];
}

module.exports = { COLORES_CINTURON, colorDisciplina };
