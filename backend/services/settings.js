// services/settings.js
const db = require("../db/database");

function getSetting(key, fallback = null) {
  const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return r ? r.value : fallback;
}

function getAllSettings() {
  const out = {};
  db.prepare("SELECT key, value FROM settings").all().forEach((r) => { out[r.key] = r.value; });
  return out;
}

function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, String(value));
}

module.exports = { getSetting, getAllSettings, setSetting };
