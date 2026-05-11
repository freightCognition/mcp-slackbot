const pino = require('pino');
const Sentry = require('@sentry/bun');
const { sentryConfigured } = require('./sentry-init');

function pinoLevelToSentry(level) {
  if (level >= 50) return 'error';
  if (level >= 40) return 'warning';
  if (level >= 30) return 'info';
  return 'debug';
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

  const data = {};
  if (context) {
    for (const [k, v] of Object.entries(context)) {
      if (k === 'err' && v instanceof Error) {
        data.error_name = v.name;
        data.error_message = v.message;
      } else {
        data[k] = v;
      }
    }
  }

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

module.exports = logger;
