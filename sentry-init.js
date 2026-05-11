const Sentry = require("@sentry/bun");
const pkg = require("./package.json");

const dsn = process.env.SENTRY_DSN;
let initialized = false;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "production",
    release: process.env.SENTRY_RELEASE || `mcp-slackbot@${pkg.version}`,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "1.0"),
    enableLogs: true,
    shutdownTimeout: 2000,
  });
  initialized = true;
} else {
  console.warn(
    "[sentry-init] SENTRY_DSN not set — Sentry is disabled (errors will only be logged locally)",
  );
}

function sentryConfigured() {
  return initialized;
}

module.exports = { sentryConfigured };
