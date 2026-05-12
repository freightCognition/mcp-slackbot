import { describe, it, expect } from "vitest";

const logger = require("../logger");
const { sanitizeBreadcrumbContext, pinoLevelToSentryLogger, sanitizeLogMessage } = logger.__test__;

describe("sanitizeBreadcrumbContext", () => {
  it("returns an empty object for null/undefined input", () => {
    expect(sanitizeBreadcrumbContext(undefined)).toEqual({});
    expect(sanitizeBreadcrumbContext(null)).toEqual({});
  });

  it("keeps whitelisted keys with scalar values verbatim", () => {
    const result = sanitizeBreadcrumbContext({
      event: "api.call",
      endpoint: "/carriers/search",
      status: 200,
      enabled: true,
      duration_ms: 42,
    });
    expect(result).toEqual({
      event: "api.call",
      endpoint: "/carriers/search",
      status: 200,
      enabled: true,
      duration_ms: 42,
    });
  });

  it("drops unknown keys not on the whitelist", () => {
    const result = sanitizeBreadcrumbContext({
      endpoint: "/foo",
      randomField: "should be dropped",
      anotherUnknown: 123,
    });
    expect(result).toEqual({ endpoint: "/foo" });
  });

  it("redacts keys matching sensitive patterns regardless of value", () => {
    const sensitiveKeys = [
      "password",
      "bearerToken",
      "refreshToken",
      "client_secret",
      "api_key",
      "apiKey",
      "authorization",
      "cookie",
      "signing_secret",
      "credentials",
    ];
    for (const key of sensitiveKeys) {
      const result = sanitizeBreadcrumbContext({ [key]: "leakable" });
      expect(result[key]).toBe("[redacted]");
    }
  });

  it("replaces complex (object/array) values with a marker", () => {
    const result = sanitizeBreadcrumbContext({
      endpoint: { nested: "object" },
      status: [1, 2, 3],
      page: 2,
    });
    expect(result.endpoint).toBe("[redacted:complex]");
    expect(result.status).toBe("[redacted:complex]");
    expect(result.page).toBe(2);
  });

  it("truncates long strings to 256 characters with an ellipsis", () => {
    const long = "x".repeat(300);
    const result = sanitizeBreadcrumbContext({ endpoint: long });
    expect(result.endpoint.length).toBe(257);
    expect(result.endpoint.endsWith("…")).toBe(true);
    expect(result.endpoint.startsWith("xxx")).toBe(true);
  });

  it("converts err:Error into error_name + error_message without leaking the stack", () => {
    const err = new TypeError("nope");
    err.stack = "Error: nope\n    at secret-path/file.js:1:1";
    const result = sanitizeBreadcrumbContext({ err, endpoint: "/x" });
    expect(result.error_name).toBe("TypeError");
    expect(result.error_message).toBe("nope");
    expect(result.endpoint).toBe("/x");
    expect("err" in result).toBe(false);
    expect("stack" in result).toBe(false);
    for (const v of Object.values(result)) {
      if (typeof v === "string") {
        expect(v.includes("secret-path")).toBe(false);
      }
    }
  });

  it("does not throw when the err key holds a non-Error value", () => {
    const result = sanitizeBreadcrumbContext({ err: "plain string", endpoint: "/x" });
    expect(result.endpoint).toBe("/x");
    expect(result.error_name).toBeUndefined();
  });

  it("preserves null and undefined values for allowed keys without throwing", () => {
    const result = sanitizeBreadcrumbContext({ endpoint: null, status: undefined });
    expect(result.endpoint).toBeNull();
    expect(result.status).toBeUndefined();
  });
});

describe("sanitizeLogMessage", () => {
  it("returns empty string for non-string input", () => {
    expect(sanitizeLogMessage(undefined)).toBe('');
    expect(sanitizeLogMessage(null)).toBe('');
    expect(sanitizeLogMessage(42)).toBe('');
  });

  it("passes through a clean message unchanged", () => {
    expect(sanitizeLogMessage("carrier lookup succeeded")).toBe("carrier lookup succeeded");
  });

  it("redacts token=value patterns", () => {
    expect(sanitizeLogMessage("token=abc123 found")).toBe("token=[redacted] found");
    expect(sanitizeLogMessage("bearer=eyJhbGc")).toBe("bearer=[redacted]");
  });

  it("redacts key: value patterns with colon separator", () => {
    expect(sanitizeLogMessage("password: hunter2")).toBe("password=[redacted]");
    expect(sanitizeLogMessage("secret: s3cr3t")).toBe("secret=[redacted]");
  });

  it("redacts multiple sensitive patterns in one message", () => {
    const result = sanitizeLogMessage("token=abc secret=xyz refreshing");
    expect(result).toBe("token=[redacted] secret=[redacted] refreshing");
  });

  it("redacts client_secret and client-secret variants", () => {
    expect(sanitizeLogMessage("client_secret=s3cr3t")).toBe("client_secret=[redacted]");
    expect(sanitizeLogMessage("client-secret=s3cr3t")).toBe("client-secret=[redacted]");
  });

  it("is case-insensitive", () => {
    expect(sanitizeLogMessage("TOKEN=abc123")).toBe("TOKEN=[redacted]");
    expect(sanitizeLogMessage("Bearer=xyz")).toBe("Bearer=[redacted]");
  });
});

describe("pinoLevelToSentryLogger", () => {
  it("maps standard Pino levels to Sentry logger method names", () => {
    expect(pinoLevelToSentryLogger(10)).toBe("trace");
    expect(pinoLevelToSentryLogger(20)).toBe("debug");
    expect(pinoLevelToSentryLogger(30)).toBe("info");
    expect(pinoLevelToSentryLogger(40)).toBe("warn");
    expect(pinoLevelToSentryLogger(50)).toBe("error");
    expect(pinoLevelToSentryLogger(60)).toBe("fatal");
  });
});
