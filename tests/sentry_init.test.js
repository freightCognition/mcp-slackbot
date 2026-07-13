import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  installMockSentryNode,
  installMockLogger,
  projectResolve,
} from "./helpers/cjs-mocks.js";

const here = dirname(fileURLToPath(import.meta.url));
const projectRequire = createRequire(resolve(here, "../package.json"));

const SENTRY_INIT_PATH = resolve(here, "../sentry-init.js");
const LOGGER_PATH = projectResolve("./logger");
const APP_PATH = resolve(here, "../app.js");

const initCalls = [];
const loggerWarnCalls = [];

async function loadSentryInitFresh() {
  delete projectRequire.cache[SENTRY_INIT_PATH];
  installMockSentryNode({
    init: (options) => {
      initCalls.push(options);
    },
  });
  installMockLogger({
    warn: (...args) => loggerWarnCalls.push(args),
  });
  const mod = projectRequire(SENTRY_INIT_PATH);
  // Allow process.nextTick handlers inside sentry-init to run before assertions.
  await new Promise((r) => process.nextTick(r));
  return mod;
}

describe("sentry-init configuration", () => {
  beforeEach(() => {
    initCalls.length = 0;
    loggerWarnCalls.length = 0;
    delete process.env.SENTRY_DSN;
    delete process.env.SENTRY_TRACES_SAMPLE_RATE;
  });

  afterEach(() => {
    delete projectRequire.cache[LOGGER_PATH];
  });

  it("does not enable sendDefaultPii (protects Slack tokens and request bodies)", async () => {
    process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/1";
    await loadSentryInitFresh();
    expect(initCalls.length).toBe(1);
    expect(Boolean(initCalls[0].sendDefaultPii)).toBe(false);
  });

  it("does not enable includeLocalVariables (protects bearer/refresh tokens in scope at throw sites)", async () => {
    process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/1";
    await loadSentryInitFresh();
    expect(initCalls.length).toBe(1);
    expect(Boolean(initCalls[0].includeLocalVariables)).toBe(false);
  });

  it("skips Sentry.init when SENTRY_DSN is unset and reports sentryConfigured() === false", async () => {
    const { sentryConfigured } = await loadSentryInitFresh();
    expect(initCalls.length).toBe(0);
    expect(sentryConfigured()).toBe(false);
  });

  it("emits a structured Pino warn (not console.warn) when SENTRY_DSN is unset", async () => {
    await loadSentryInitFresh();
    expect(loggerWarnCalls.length).toBe(1);
    const [payload, message] = loggerWarnCalls[0];
    expect(payload).toEqual({
      event: "sentry.init",
      enabled: false,
      reason: "SENTRY_DSN not set",
    });
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
  });

  it("calls Sentry.init exactly once and reports sentryConfigured() === true when SENTRY_DSN is set", async () => {
    process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/1";
    const { sentryConfigured } = await loadSentryInitFresh();
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

describe("sentry-init tracesSampleRate clamping", () => {
  beforeEach(() => {
    initCalls.length = 0;
    loggerWarnCalls.length = 0;
    delete process.env.SENTRY_TRACES_SAMPLE_RATE;
    process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/1";
  });

  afterEach(() => {
    delete process.env.SENTRY_TRACES_SAMPLE_RATE;
    delete process.env.SENTRY_DSN;
    delete projectRequire.cache[LOGGER_PATH];
  });

  it("defaults to 1.0 when env var is unset", async () => {
    await loadSentryInitFresh();
    expect(initCalls[0].tracesSampleRate).toBe(1.0);
  });

  it("clamps to 1.0 when env var is greater than 1", async () => {
    process.env.SENTRY_TRACES_SAMPLE_RATE = "5";
    await loadSentryInitFresh();
    expect(initCalls[0].tracesSampleRate).toBe(1.0);
  });

  it("clamps to 0 when env var is negative", async () => {
    process.env.SENTRY_TRACES_SAMPLE_RATE = "-2";
    await loadSentryInitFresh();
    expect(initCalls[0].tracesSampleRate).toBe(0);
  });

  it("defaults to 1.0 when env var is non-numeric (NaN)", async () => {
    process.env.SENTRY_TRACES_SAMPLE_RATE = "banana";
    await loadSentryInitFresh();
    expect(initCalls[0].tracesSampleRate).toBe(1.0);
  });

  it("accepts valid decimal values as-is", async () => {
    process.env.SENTRY_TRACES_SAMPLE_RATE = "0.25";
    await loadSentryInitFresh();
    expect(initCalls[0].tracesSampleRate).toBe(0.25);
  });

  it("exposes clampSampleRate for direct use", async () => {
    const { clampSampleRate } = await loadSentryInitFresh();
    expect(clampSampleRate("0.5")).toBe(0.5);
    expect(clampSampleRate("9")).toBe(1);
    expect(clampSampleRate("-1")).toBe(0);
    expect(clampSampleRate("nope")).toBe(1.0);
    expect(clampSampleRate(undefined)).toBe(1.0);
    expect(clampSampleRate("nope", 0.3)).toBe(0.3);
  });
});
