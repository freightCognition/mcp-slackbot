const { createClient } = require("@libsql/client");
const logger = require("./logger");

const db = createClient({
  url: process.env.LIBSQL_URL || "http://localhost:8081",
});

// Initialize schema
async function initDb() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      bearer_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Audit log for carrier wizard actions (invite/decline)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      slack_user_id TEXT NOT NULL,
      mc_number TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('invite', 'decline')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  logger.info("Database initialized");
}

// Get current tokens
async function getTokens() {
  const result = await db.execute(
    "SELECT bearer_token, refresh_token FROM tokens WHERE id = 1",
  );
  if (result.rows.length === 0) {
    return null;
  }
  return {
    bearerToken: result.rows[0].bearer_token,
    refreshToken: result.rows[0].refresh_token,
  };
}

// Save tokens (upsert)
async function saveTokens(bearerToken, refreshToken) {
  await db.execute({
    sql: `INSERT INTO tokens (id, bearer_token, refresh_token, updated_at)
          VALUES (1, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            bearer_token = excluded.bearer_token,
            refresh_token = excluded.refresh_token,
            updated_at = datetime('now')`,
    args: [bearerToken, refreshToken],
  });
  logger.info("Tokens saved to database");
}

// Log audit entry for carrier wizard actions
async function logAuditEntry(slackUserId, mcNumber, action) {
  await db.execute({
    sql: `INSERT INTO audit_log (slack_user_id, mc_number, action) VALUES (?, ?, ?)`,
    args: [slackUserId, mcNumber, action],
  });
  logger.info({ slackUserId, mcNumber, action }, "Audit entry logged");
}

module.exports = { db, initDb, getTokens, saveTokens, logAuditEntry };
