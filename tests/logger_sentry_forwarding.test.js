import { describe, it, expect, afterEach } from "vitest";
import { createRequire } from "node:module";
import { dirname, resolve } from "path";
import { fileURLToPath } from "node:url";
import {
  installMockSentryNode,
  installMockSentryInit,
  projectResolve,
  clearCached,
} from "./helpers/cjs-mocks.js";

const here = dirname(fileURLToPath(import.meta.url));
const projectRequire = createRequire(resolve(here, "../package.json"));

const LOGGER_PATH = projectResolve("./logger");
const SENTRY_INIT_PATH = projectResolve("./sentry-init");
const SENTRY_NODE_PATH = projectResolve("@sentry/node");

function makeLoggerSpies() {
  const calls = { trace: [], debug: [], info: [], warn: [], error: [], fatal: [] };
  const logger = {};
  for (const m of Object.keys(calls)) {
    logger[m] = (...args) => calls[m].push(args);
  }
  return { logger, calls };
}

function loadLoggerFresh(configured, loggerImpl) {
  delete projectRequire.cache[LOGGER_PATH];
  installMockSentryInit({ sentryConfigured: () => configured });
  installMockSentryNode({ logger: loggerImpl });
  return projectRequire(LOGGER_PATH);
}

afterEach(() => {
  clearCached(LOGGER_PATH);
  clearCached(SENTRY_INIT_PATH);
  clearCached(SENTRY_NODE_PATH);
});

describe("Sentry.logger forwarding from Pino", () => {
  it("calls Sentry.logger.info for info-level logs with sanitized attrs", () => {
    const { logger: loggerImpl, calls } = makeLoggerSpies();
    const logger = loadLoggerFresh(true, loggerImpl);
    logger.info({ event: "api.call", endpoint: "/carriers/search" }, "carrier lookup");
    expect(calls.info).toHaveLength(1);
    expect(calls.info[0][0]).toBe("carrier lookup");
    expect(calls.info[0][1]).toMatchObject({ event: "api.call", endpoint: "/carriers/search" });
  });

  it("calls Sentry.logger.warn for warn-level logs", () => {
    const { logger: loggerImpl, calls } = makeLoggerSpies();
    const logger = loadLoggerFresh(true, loggerImpl);
    logger.warn({ event: "rate_limit", attempt: 3 }, "rate limit approaching");
    expect(calls.warn).toHaveLength(1);
    expect(calls.warn[0][0]).toBe("rate limit approaching");
    expect(calls.warn[0][1]).toMatchObject({ event: "rate_limit", attempt: 3 });
  });

  it("calls Sentry.logger.error for error-level logs", () => {
    const { logger: loggerImpl, calls } = makeLoggerSpies();
    const logger = loadLoggerFresh(true, loggerImpl);
    logger.error({ event: "payment_failed", status: 402 }, "card declined");
    expect(calls.error).toHaveLength(1);
    expect(calls.error[0][0]).toBe("card declined");
  });

  it("does not call Sentry.logger when sentryConfigured() is false", () => {
    const { logger: loggerImpl, calls } = makeLoggerSpies();
    const logger = loadLoggerFresh(false, loggerImpl);
    logger.info({ event: "test" }, "should not reach sentry");
    logger.warn({ event: "test" }, "nor this");
    expect(calls.info).toHaveLength(0);
    expect(calls.warn).toHaveLength(0);
  });

  it("sanitizes sensitive keys before forwarding", () => {
    const { logger: loggerImpl, calls } = makeLoggerSpies();
    const logger = loadLoggerFresh(true, loggerImpl);
    logger.warn({ event: "token_refresh", bearerToken: "secret", refreshToken: "also-secret" }, "refreshed");
    expect(calls.warn).toHaveLength(1);
    const attrs = calls.warn[0][1];
    expect(attrs.bearerToken).toBe("[redacted]");
    expect(attrs.refreshToken).toBe("[redacted]");
    expect(attrs.event).toBe("token_refresh");
  });

  it("drops keys not on the allowlist before forwarding", () => {
    const { logger: loggerImpl, calls } = makeLoggerSpies();
    const logger = loadLoggerFresh(true, loggerImpl);
    logger.info({ event: "test", unknownField: "should be dropped" }, "msg");
    const attrs = calls.info[0][1];
    expect("unknownField" in attrs).toBe(false);
    expect(attrs.event).toBe("test");
  });

  it("handles string-only messages (no context object)", () => {
    const { logger: loggerImpl, calls } = makeLoggerSpies();
    const logger = loadLoggerFresh(true, loggerImpl);
    logger.info("plain string message");
    expect(calls.info).toHaveLength(1);
    expect(calls.info[0][0]).toBe("plain string message");
    expect(calls.info[0][1]).toEqual({});
  });

  it("does not throw if Sentry.logger throws internally", () => {
    const logger = loadLoggerFresh(true, {
      info: () => { throw new Error("sentry exploded"); },
      warn: () => {},
    });
    expect(() => logger.info({ event: "test" }, "msg")).not.toThrow();
  });
});

describe("pinoLevelToSentryLogger", () => {
  it("maps all Pino level numbers to correct Sentry logger method names", () => {
    const { logger: loggerImpl } = makeLoggerSpies();
    const logger = loadLoggerFresh(false, loggerImpl);
    const { pinoLevelToSentryLogger } = logger.__test__;
    expect(pinoLevelToSentryLogger(60)).toBe("fatal");
    expect(pinoLevelToSentryLogger(50)).toBe("error");
    expect(pinoLevelToSentryLogger(40)).toBe("warn");
    expect(pinoLevelToSentryLogger(30)).toBe("info");
    expect(pinoLevelToSentryLogger(20)).toBe("debug");
    expect(pinoLevelToSentryLogger(10)).toBe("trace");
  });

  it("uses boundary values correctly (e.g. 59 → error, 60 → fatal)", () => {
    const { logger: loggerImpl } = makeLoggerSpies();
    const logger = loadLoggerFresh(false, loggerImpl);
    const { pinoLevelToSentryLogger } = logger.__test__;
    expect(pinoLevelToSentryLogger(59)).toBe("error");
    expect(pinoLevelToSentryLogger(60)).toBe("fatal");
    expect(pinoLevelToSentryLogger(49)).toBe("warn");
    expect(pinoLevelToSentryLogger(50)).toBe("error");
  });
});
