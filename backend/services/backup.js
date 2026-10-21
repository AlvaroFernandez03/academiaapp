// services/backup.js
//
// Copias de seguridad automáticas:
//  - La base de datos se copia con "VACUUM INTO", que hace una copia
//    COHERENTE aunque la app esté recibiendo reservas en ese momento (copiar
//    el archivo a mano mientras funciona podría dejar una copia corrupta).
//  - Las fotos de perfil se copian a una carpeta espejo.
//  - Se hace una al día (se comprueba cada hora) y se guardan las últimas
//    BACKUP_KEEP (14 por defecto).
//
// OJO: estas copias viven en el MISMO ordenador que la app. Protegen de
// errores (algo borrado sin querer, una actualización que sale mal), pero no
// de que se estropee o se pierda el servidor. Para eso hay que guardar copias
// fuera: descargarlas desde el panel de vez en cuando, o activar las copias
// del proveedor del servidor cuando se despliegue.
const fs = require("fs");
const path = require("path");
const db = require("../db/database");
const { uploadsRoot } = require("../middleware/upload");

const NOMBRE = /^academia-\d{4}-\d{2}-\d{2}-\d{6}\.db$/;
const UN_DIA_MS = 24 * 60 * 60 * 1000;

function carpeta() {
  const dir = process.env.BACKUP_DIR || path.join(__dirname, "..", "backups");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const conservar = () => Math.max(1, Number(process.env.BACKUP_KEEP) || 14);

function listBackups() {
  const dir = carpeta();
  return fs
    .readdirSync(dir)
    .filter((f) => NOMBRE.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size: st.size, created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

function marcaDeTiempo(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function makeBackup() {
  const dir = carpeta();
  let nombre = `academia-${marcaDeTiempo()}.db`;
  // Dos copias en el mismo segundo (doble clic): no se pisan.
  for (let n = 1; fs.existsSync(path.join(dir, nombre)); n++) nombre = `academia-${marcaDeTiempo(new Date(Date.now() + n * 1000))}.db`;
  const destino = path.join(dir, nombre);

  // VACUUM INTO no admite parámetros "?": la ruta va entre comillas simples,
  // duplicando las que pudiera tener dentro.
  db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);

  // Fotos: copia espejo (solo añade o actualiza; las de miembros borrados se
  // quedan en la copia, que para eso es una copia de seguridad).
  let fotos = 0;
  if (fs.existsSync(uploadsRoot)) {
    fs.cpSync(uploadsRoot, path.join(dir, "fotos"), { recursive: true, force: true });
    const avatares = path.join(uploadsRoot, "avatars");
    fotos = fs.existsSync(avatares) ? fs.readdirSync(avatares).length : 0;
  }

  // Borrar las copias más antiguas que sobren.
  const todas = listBackups();
  todas.slice(conservar()).forEach((b) => fs.rmSync(path.join(dir, b.name), { force: true }));

  const st = fs.statSync(destino);
  return { name: nombre, size: st.size, created_at: st.mtime.toISOString(), photos: fotos, kept: Math.min(todas.length, conservar()) };
}

// Ruta segura a una copia para descargarla: solo nombres con el formato
// exacto (así nadie puede pedir "../../.env" u otro archivo del servidor).
function backupPath(nombre) {
  if (!NOMBRE.test(String(nombre))) return null;
  const ruta = path.join(carpeta(), nombre);
  return fs.existsSync(ruta) ? ruta : null;
}

// Se llama al arrancar y cada hora: hace copia si la última tiene más de un día.
function copiaSiToca() {
  const ultima = listBackups()[0];
  if (ultima && Date.now() - new Date(ultima.created_at).getTime() < UN_DIA_MS) return null;
  return makeBackup();
}

module.exports = { listBackups, makeBackup, backupPath, copiaSiToca };
