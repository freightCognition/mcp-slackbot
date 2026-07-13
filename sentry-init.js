const Sentry = require("@sentry/node");
const pkg = require("./package.json");

let initialized = false;
function sentryConfigured() {
  return initialized;
}

function clampSampleRate(raw, fallback = 1.0) {
  const parsed = parseFloat(raw);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(0, Math.min(1, value));
}

// Export before init so the lazy require('./logger') in the else branch
// resolves against a complete module.exports (avoids circular-require pitfall).
module.exports = { sentryConfigured, clampSampleRate };

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "production",
    release: process.env.SENTRY_RELEASE || `mcp-slackbot@${pkg.version}`,
    tracesSampleRate: clampSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE),
    enableLogs: true,
    shutdownTimeout: 2000,
  });
  initialized = true;
} else {
  // Defer logger.warn to nextTick so this works regardless of whether
  // sentry-init or logger is the require entrypoint — both modules must
  // be fully loaded before we can safely call logger.warn.
  process.nextTick(() => {
    const logger = require("./logger");
    logger.warn(
      { event: "sentry.init", enabled: false, reason: "SENTRY_DSN not set" },
      "Sentry disabled — errors will only be logged locally",
    );
  });
}
