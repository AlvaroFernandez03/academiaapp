// db/database.js
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { createTables } = require("./schema");
const { seed } = require("./seed");
const { createBillingTables } = require("./schema-billing");
const { seedBilling } = require("./seed-billing");
const { seedApp } = require("./seed-app");

// ACADEMIA_DB_PATH permite usar otro archivo (lo usan las pruebas
// automáticas, para no tocar nunca la base de datos real de la academia).
const dbPath = process.env.ACADEMIA_DB_PATH || path.join(__dirname, "academia.db");
const db = new DatabaseSync(dbPath);

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// SEED_DEMO_DATA=0 -> la academia arranca vacía, solo con los ajustes por
// defecto: es lo que se usa en la instalación real. Sin la variable (o con
// 1) se crean los datos de ejemplo, como hasta ahora. Los datos de ejemplo
// solo se crean en una base de datos vacía: nunca tocan una que ya tiene datos.
const demo = process.env.SEED_DEMO_DATA !== "0";

createTables(db);
createBillingTables(db);
seed(db, { demo });
seedBilling(db, { demo });
seedApp(db, { demo });

module.exports = db;
