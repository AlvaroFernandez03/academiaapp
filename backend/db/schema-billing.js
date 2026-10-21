// db/schema-billing.js
//
// Tablas de la fase de cuotas. Van aparte del esquema base porque se añaden
// a una base de datos que en la academia ya puede tener alumnos y reservas
// reales: todo usa CREATE TABLE IF NOT EXISTS y migraciones tolerantes, así
// que esta versión arranca sobre una base de datos existente sin perder nada.

function createBillingTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Planes de cuota. scope='discipline' da acceso a UNA disciplina; scope='all'
  // a todas. max_classes_per_week NULL significa sin límite semanal.
  db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price_cents INTEGER NOT NULL CHECK (price_cents > 0),
      scope TEXT NOT NULL CHECK (scope IN ('discipline', 'all')),
      discipline_id INTEGER,
      max_classes_per_week INTEGER CHECK (max_classes_per_week IS NULL OR max_classes_per_week > 0),
      stripe_product_id TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (discipline_id) REFERENCES disciplines (id),
      CHECK ((scope = 'discipline' AND discipline_id IS NOT NULL) OR (scope = 'all' AND discipline_id IS NULL))
    );
  `);

  // Una cuota (membership) une un MIEMBRO con un PLAN, y la paga la CUENTA
  // familiar. Ciclo de vida del estado:
  //
  //   pendiente_pago -> procesando -> activa <-> pausada
  //                                     |  \
  //                                     |   -> impagada -> activa (al pagar)
  //                                     v
  //                                  cancelada
  //
  // - price_cents se congela al contratar: si mañana sube el precio del plan,
  //   quien ya estaba apuntado sigue pagando lo que contrató.
  // - current_period_end es la fecha del próximo cobro (hasta cuándo está pagada).
  // - cancel_at_period_end = 1 significa "baja programada": sigue activa hasta
  //   current_period_end y entonces pasa a cancelada.
  // - pause_method recuerda CÓMO se pausó en Stripe, para saber cómo reanudarla.
  db.exec(`
    CREATE TABLE IF NOT EXISTS memberships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      plan_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      payment_method TEXT NOT NULL CHECK (payment_method IN ('stripe', 'manual')),
      status TEXT NOT NULL DEFAULT 'pendiente_pago'
        CHECK (status IN ('pendiente_pago', 'procesando', 'activa', 'pausada', 'impagada', 'cancelada')),
      price_cents INTEGER NOT NULL,
      current_period_end TEXT,
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
      paused_at TEXT,
      paused_until TEXT,
      pause_method TEXT CHECK (pause_method IS NULL OR pause_method IN ('manual', 'collection', 'item_removed')),
      stripe_subscription_id TEXT,
      stripe_subscription_item_id TEXT,
      action_url TEXT,
      activation_attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      cancelled_at TEXT,
      FOREIGN KEY (member_id) REFERENCES members (id),
      FOREIGN KEY (plan_id) REFERENCES plans (id),
      FOREIGN KEY (account_id) REFERENCES accounts (id)
    );
  `);

  // Un miembro no puede tener dos cuotas "vivas" del mismo plan a la vez. Lo
  // garantiza la propia base de datos (índice único parcial), no solo el
  // código: así ni dos clics seguidos pueden colar un duplicado.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_live
    ON memberships (member_id, plan_id) WHERE status != 'cancelada';
  `);

  // Pagos RECIBIDOS (el historial que ve la familia y el admin). Los de Stripe
  // se identifican por su factura, que es única: si Stripe nos avisa dos veces
  // del mismo pago, no se apunta dos veces.
  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      membership_id INTEGER,
      amount_cents INTEGER NOT NULL,
      method TEXT NOT NULL CHECK (method IN ('stripe', 'efectivo', 'transferencia', 'bizum', 'tpv')),
      period_start TEXT,
      period_end TEXT,
      stripe_invoice_id TEXT UNIQUE,
      notes TEXT,
      recorded_by_account_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts (id),
      FOREIGN KEY (membership_id) REFERENCES memberships (id)
    );
  `);

  // Eventos de Stripe ya procesados. Stripe reintenta sus avisos (webhooks)
  // si no le contestamos a tiempo, así que el mismo evento puede llegar dos
  // veces: guardamos su id para procesarlo una sola vez.
  db.exec(`
    CREATE TABLE IF NOT EXISTS stripe_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      processed_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const migraciones = [
    "ALTER TABLE accounts ADD COLUMN stripe_customer_id TEXT",
    "ALTER TABLE accounts ADD COLUMN stripe_default_pm TEXT",
    "ALTER TABLE accounts ADD COLUMN stripe_family_subscription_id TEXT",
    "ALTER TABLE bookings ADD COLUMN is_trial INTEGER NOT NULL DEFAULT 0",
  ];
  migraciones.forEach((sql) => {
    try {
      db.exec(sql);
    } catch (err) {
      if (!String(err.message).includes("duplicate column")) throw err;
    }
  });
}

module.exports = { createBillingTables };
