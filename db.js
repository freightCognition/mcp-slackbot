const { createClient } = require('@libsql/client');
const logger = require('./logger');

const db = createClient({
  url: process.env.LIBSQL_URL || 'http://localhost:8080'
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
  logger.info('Database initialized');
}

// Get current tokens
async function getTokens() {
  const result = await db.execute('SELECT bearer_token, refresh_token FROM tokens WHERE id = 1');
  if (result.rows.length === 0) {
    return null;
  }
  return {
    bearerToken: result.rows[0].bearer_token,
    refreshToken: result.rows[0].refresh_token
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
    args: [bearerToken, refreshToken]
  });
  logger.info('Tokens saved to database');
}

module.exports = { db, initDb, getTokens, saveTokens };
