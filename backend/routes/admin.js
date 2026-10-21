// routes/admin.js — panel de administración (solo cuentas de administración)
//
// Toda la lógica vive en services/admin.js; aquí solo se traducen las
// peticiones y los errores. Las cuotas tienen su propio archivo
// (admin-billing.js), montado en /api/admin/billing.
const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const admin = require("../services/admin");
const backup = require("../services/backup");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

// Convierte los AdminError en respuestas con su código, su mensaje y, si los
// hay, datos extra (por ejemplo, la cuenta que ya existe con un email). Los
// errores inesperados se registran en el servidor y no se enseñan al navegador.
const handle = (fn) => (req, res) =>
  Promise.resolve()
    .then(() => fn(req))
    .then((r) => res.json(r))
    .catch((err) => {
      if (err instanceof admin.AdminError) return res.status(err.status).json({ error: err.message, ...err.extra });
      console.error("Error en administración:", err);
      res.status(500).json({ error: "Ha ocurrido un error inesperado." });
    });
const id = (req) => Number(req.params.id);
const activo = (req) => req.body.active === true || req.body.active === 1 || req.body.active === "1";

// --- Resumen ---
router.get("/summary", handle(() => admin.getSummary()));

// --- Disciplinas y grupos ---
router.get("/disciplines", handle(() => admin.listDisciplines()));
router.post("/disciplines", handle((req) => admin.createDiscipline(req.body)));
router.put("/disciplines/:id", handle((req) => admin.updateDiscipline(id(req), req.body)));
router.put("/disciplines/:id/active", handle((req) => admin.setDisciplineActive(id(req), activo(req))));
router.delete("/disciplines/:id", handle((req) => admin.deleteDiscipline(id(req))));

router.post("/groups", handle((req) => admin.createGroup(req.body)));
router.put("/groups/:id", handle((req) => admin.updateGroup(id(req), req.body)));
router.put("/groups/:id/active", handle((req) => admin.setGroupActive(id(req), activo(req))));
router.delete("/groups/:id", handle((req) => admin.deleteGroup(id(req))));

// --- Horario ---
router.get("/classes", handle(() => admin.listClasses()));
router.post("/classes", handle((req) => admin.createClass(req.body)));
router.put("/classes/:id", handle((req) => admin.updateClass(id(req), req.body)));
router.put("/classes/:id/active", handle((req) => admin.setClassActive(id(req), activo(req))));
router.delete("/classes/:id", handle((req) => admin.deleteClass(id(req))));
router.post("/classes/:id/cancel-session", handle((req) => admin.cancelSession(id(req), req.body, req.accountId)));
router.delete("/cancellations/:id", handle((req) => admin.restoreSession(id(req))));

// --- Equipo y cuentas ---
router.get("/team", handle(() => admin.listTeam()));
router.post("/team", handle((req) => admin.createStaff(req.body)));
router.put("/accounts/:id", handle((req) => admin.updateAccount(id(req), req.body)));
router.put("/accounts/:id/role", handle((req) => admin.setRole(id(req), req.body.role, req.accountId)));
router.put("/accounts/:id/active", handle((req) => admin.setAccountActive(id(req), activo(req), req.accountId)));
router.post("/accounts/:id/reset-password", handle((req) => admin.resetPassword(id(req), req.accountId)));

// --- Alumnos ---
router.get("/families", handle(() => admin.listFamilies()));
router.get("/members/:id", handle((req) => admin.getMemberDetail(id(req))));

// --- Academia: datos, aviso de privacidad y copias de seguridad ---
router.get("/academy", handle(() => admin.getAcademy()));
router.put("/academy", handle((req) => admin.updateAcademy(req.body)));
router.put("/privacy", handle((req) => admin.updatePrivacy(req.body)));

router.get("/backups", handle(() => backup.listBackups()));
router.post("/backups", handle(() => backup.makeBackup()));
// Descargar una copia (contiene TODOS los datos: solo administración).
router.get("/backups/:name", (req, res) => {
  const ruta = backup.backupPath(req.params.name);
  if (!ruta) return res.status(404).json({ error: "Copia no encontrada." });
  res.download(ruta, req.params.name);
});

// --- Emails: registro y bandeja de pruebas ---
router.get("/emails", handle(() => admin.listEmails()));
router.post("/emails/test", handle((req) => admin.sendTestEmail(req.accountId)));

module.exports = router;
