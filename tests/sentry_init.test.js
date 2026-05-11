import { describe, it, expect, beforeEach } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const SENTRY_INIT_PATH = resolve(__dirname, "../sentry-init.js");
const SENTRY_BUN_PATH = require.resolve("@sentry/bun");
const APP_PATH = resolve(__dirname, "../app.js");

const initCalls = [];

function installSentryMock() {
  require.cache[SENTRY_BUN_PATH] = {
    id: SENTRY_BUN_PATH,
    filename: SENTRY_BUN_PATH,
    loaded: true,
    exports: {
      init: (options) => {
        initCalls.push(options);
      },
      addBreadcrumb: () => {},
      captureException: () => {},
      close: () => Promise.resolve(true),
    },
  };
}

function loadSentryInitFresh() {
  delete require.cache[SENTRY_INIT_PATH];
  installSentryMock();
  return require(SENTRY_INIT_PATH);
}

describe("sentry-init configuration", () => {
  beforeEach(() => {
    initCalls.length = 0;
    delete process.env.SENTRY_DSN;
  });

  it("does not enable sendDefaultPii (protects Slack tokens and request bodies)", () => {
    process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/1";
    loadSentryInitFresh();
    expect(initCalls.length).toBe(1);
    expect(Boolean(initCalls[0].sendDefaultPii)).toBe(false);
  });

  it("does not enable includeLocalVariables (protects bearer/refresh tokens in scope at throw sites)", () => {
    process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/1";
    loadSentryInitFresh();
    expect(initCalls.length).toBe(1);
    expect(Boolean(initCalls[0].includeLocalVariables)).toBe(false);
  });

  it("skips Sentry.init when SENTRY_DSN is unset and reports sentryConfigured() === false", () => {
    const { sentryConfigured } = loadSentryInitFresh();
    expect(initCalls.length).toBe(0);
    expect(sentryConfigured()).toBe(false);
  });

  it("calls Sentry.init exactly once and reports sentryConfigured() === true when SENTRY_DSN is set", () => {
    process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/1";
    const { sentryConfigured } = loadSentryInitFresh();
    expect(initCalls.length).toBe(1);
    expect(initCalls[0].dsn).toBe("https://public@example.ingest.sentry.io/1");
    expect(sentryConfigured()).toBe(true);
  });

  it("loads sentry-init in app.js BEFORE @slack/bolt and axios to preserve auto-instrumentation order", () => {
    const source = readFileSync(APP_PATH, "utf-8");
    const lines = source.split("\n");
    const findLine = (needle) => lines.findIndex((line) => line.includes(needle));

    const sentryInitLine = findLine('require("./sentry-init")');
    const boltLine = findLine('require("@slack/bolt")');
    const axiosLine = findLine('require("axios")');

    expect(sentryInitLine).toBeGreaterThanOrEqual(0);
    expect(boltLine).toBeGreaterThan(sentryInitLine);
    expect(axiosLine).toBeGreaterThan(sentryInitLine);
  });
});
