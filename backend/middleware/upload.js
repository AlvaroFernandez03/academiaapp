// middleware/upload.js
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// UPLOADS_DIR permite guardar las fotos en otra carpeta (por ejemplo, un
// disco persistente en el servidor, o una carpeta temporal en las pruebas).
const uploadsRoot = process.env.UPLOADS_DIR || path.join(__dirname, "..", "uploads");
const uploadDir = path.join(uploadsRoot, "avatars");
fs.mkdirSync(uploadDir, { recursive: true });

const EXTENSIONES_PERMITIDAS = [".jpg", ".jpeg", ".png", ".webp"];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  // El nombre de archivo lleva un componente aleatorio (no solo el id del
  // miembro) para que nadie pueda adivinar la URL de la foto de otra
  // persona probando ids consecutivos. No es la única protección — la
  // subida en sí exige ser el dueño de la cuenta — pero conviene que la
  // URL tampoco sea predecible, tratándose muchas veces de fotos de menores.
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const aleatorio = crypto.randomBytes(10).toString("hex");
    cb(null, `member-${req.params.id}-${aleatorio}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!EXTENSIONES_PERMITIDAS.includes(ext)) {
      return cb(new Error("Solo se admiten imágenes JPG, PNG o WEBP."));
    }
    cb(null, true);
  },
});

module.exports = { upload, uploadDir, uploadsRoot };
