import { describe, it, expect, beforeEach, mock } from "bun:test";

const sentryCalls = [];
const sentryCloseCalls = [];
let sentryCloseImpl = () => Promise.resolve(true);

// Bun's mock.module only intercepts ESM by name; the app uses CJS require,
// so we mock against the resolved path (same trick as api_params.test.js).
mock.module(require.resolve("@sentry/bun"), () => ({
  init: () => {},
  addBreadcrumb: () => {},
  captureException: (err, options) => {
    sentryCalls.push({ err, options });
  },
  close: (timeout) => {
    sentryCloseCalls.push(timeout);
    return sentryCloseImpl();
  },
}));

mock.module("@slack/bolt", () => {
  class MockApp {
    constructor() {}
    command() {}
    action() {}
    view() {}
    error() {}
    async start() {
      return {};
    }
  }
  return { App: MockApp };
});

// Axios mock — by default returns success; individual tests override the
// behavior to throw an error with a rich response body that must be scrubbed
// before reaching Sentry.
let axiosImpl = async () => ({ data: {} });
mock.module(require.resolve("axios"), () => {
  const mockAxios = (config) => axiosImpl(config);
  mockAxios.isAxiosError = () => false;
  mockAxios.create = () => mockAxios;
  return { default: mockAxios, __esModule: true };
});

process.env.BEARER_TOKEN = process.env.BEARER_TOKEN || "test-bearer";
process.env.REFRESH_TOKEN = process.env.REFRESH_TOKEN || "test-refresh";
process.env.TOKEN_ENDPOINT_URL =
  process.env.TOKEN_ENDPOINT_URL || "http://localhost/token";
process.env.CLIENT_ID = process.env.CLIENT_ID || "test-client-id";
process.env.CLIENT_SECRET = process.env.CLIENT_SECRET || "test-secret";
process.env.SLACK_SIGNING_SECRET =
  process.env.SLACK_SIGNING_SECRET || "test-signing";
process.env.SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || "xoxb-test";
process.env.SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN || "xapp-test";

const { apiCall, flushAndExit } = await import("../app.js");

describe("Sentry captureException payload sanitization (app.js)", () => {
  beforeEach(() => {
    sentryCalls.length = 0;
  });

  it("strips raw response body and only sends {status, code, message} on non-404 errors", async () => {
    axiosImpl = async () => {
      const err = new Error("Internal Server Error");
      err.response = {
        status: 500,
        data: {
          code: "ERR_SAFE_CODE",
          message: "Safe top-level message",
          // PII fields that must NOT reach Sentry:
          phone: "+1-555-867-5309",
          address: "742 Evergreen Terrace",
          contacts: [{ name: "J. Doe", email: "j@example.com" }],
          bearerToken: "shouldnt-leak",
        },
        headers: { authorization: "Bearer leakable" },
      };
      throw err;
    };

    await apiCall("/api/v1/Carrier/GetCarrierData", { DocketNumber: "1" });

    expect(sentryCalls.length).toBe(1);
    const { options } = sentryCalls[0];

    expect(options.extra).toBeDefined();
    expect(options.extra.response).toEqual({
      status: 500,
      code: "ERR_SAFE_CODE",
      message: "Safe top-level message",
    });

    expect(options.extra.responseData).toBeUndefined();
    expect(options.extra.headers).toBeUndefined();

    const serialized = JSON.stringify(options);
    expect(serialized.includes("742 Evergreen Terrace")).toBe(false);
    expect(serialized.includes("867-5309")).toBe(false);
    expect(serialized.includes("shouldnt-leak")).toBe(false);
    expect(serialized.includes("Bearer leakable")).toBe(false);

    expect(options.tags).toEqual({
      endpoint: "/api/v1/Carrier/GetCarrierData",
      status: 500,
    });
  });

  it("does not page Sentry on 404 errors", async () => {
    axiosImpl = async () => {
      const err = new Error("Not Found");
      err.response = { status: 404, data: { message: "no such carrier" } };
      throw err;
    };

    await apiCall("/api/v1/Carrier/GetCarrierData", { DocketNumber: "999" });

    expect(sentryCalls.length).toBe(0);
  });
});

describe("flushAndExit crash handler", () => {
  let originalExit;
  let exitCalls;

  beforeEach(() => {
    sentryCalls.length = 0;
    sentryCloseCalls.length = 0;
    exitCalls = [];
    sentryCloseImpl = () => Promise.resolve(true);
    originalExit = process.exit;
    process.exit = (code) => {
      exitCalls.push(code);
    };
  });

  function restoreExit() {
    process.exit = originalExit;
  }

  it("captures the exception, awaits Sentry.close(2000), then exits with code 1", async () => {
    try {
      const err = new Error("boom");
      await flushAndExit(err, "unhandledRejection");

      expect(sentryCalls.length).toBe(1);
      expect(sentryCalls[0].err).toBe(err);
      expect(sentryCalls[0].options).toEqual({
        tags: { source: "unhandledRejection" },
      });

      expect(sentryCloseCalls).toEqual([2000]);
      expect(exitCalls).toEqual([1]);
    } finally {
      restoreExit();
    }
  });

  it("still exits with code 1 when Sentry.close rejects", async () => {
    sentryCloseImpl = () => Promise.reject(new Error("close failed"));
    try {
      await flushAndExit(new Error("boom"), "uncaughtException");
      expect(exitCalls).toEqual([1]);
      expect(sentryCloseCalls).toEqual([2000]);
    } finally {
      restoreExit();
    }
  });
});
