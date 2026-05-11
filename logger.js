const pino = require('pino');
const Sentry = require('@sentry/node');
const { sentryConfigured } = require('./sentry-init');

function pinoLevelToSentry(level) {
  if (level >= 50) return 'error';
  if (level >= 40) return 'warning';
  if (level >= 30) return 'info';
  return 'debug';
}

const SENSITIVE_KEY_PATTERN =
  /(password|token|secret|api[_-]?key|authorization|cookie|cred|bearer|refresh|signing|client[_-]?secret)/i;

const ALLOWED_KEYS = new Set([
  'event',
  'endpoint',
  'status',
  'method',
  'channel',
  'user',
  'team',
  'signal',
  'wizardId',
  'mcNumber',
  'dotNumber',
  'page',
  'reason',
  'enabled',
  'source',
  'duration_ms',
  'attempt',
]);

const MAX_STRING_LEN = 256;

function sanitizeValue(v) {
  if (v == null) return v;
  if (typeof v === 'string') {
    return v.length > MAX_STRING_LEN ? `${v.slice(0, MAX_STRING_LEN)}…` : v;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return '[redacted:complex]';
}

function sanitizeBreadcrumbContext(context) {
  const out = {};
  if (!context) return out;
  for (const [k, v] of Object.entries(context)) {
    if (k === 'err' && v instanceof Error) {
      out.error_name = v.name;
      out.error_message = v.message;
      continue;
    }
    if (SENSITIVE_KEY_PATTERN.test(k)) {
      out[k] = '[redacted]';
      continue;
    }
    if (!ALLOWED_KEYS.has(k)) continue;
    out[k] = sanitizeValue(v);
  }
  return out;
}

function addBreadcrumbFromArgs(inputArgs, level) {
  let context;
  let message;
  const [first, second] = inputArgs;
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    context = first;
    message = typeof second === 'string' ? second : undefined;
  } else if (typeof first === 'string') {
    message = first;
  }

  const data = sanitizeBreadcrumbContext(context);

  Sentry.addBreadcrumb({
    category: 'log',
    level: pinoLevelToSentry(level),
    message,
    data,
  });
}

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: {
    service: 'mcp-slackbot'
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    }
  },
  hooks: {
    logMethod(inputArgs, method, level) {
      if (sentryConfigured() && level >= 30) {
        try {
          addBreadcrumbFromArgs(inputArgs, level);
        } catch {
          // Never let breadcrumb capture break logging
        }
      }
      return method.apply(this, inputArgs);
    }
  }
});

logger.__test__ = { sanitizeBreadcrumbContext };

module.exports = logger;
