import { describe, it, expect, beforeEach } from "vitest";
import {
  installMockAxios,
  installMockSlackBolt,
  installMockDb,
} from "./helpers/cjs-mocks.js";

// Captured side effects from the mocks
const axiosPostCalls = [];
const axiosPostResponses = [];
const saveTokensCalls = [];

function buildAxiosError(status, data) {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status, data };
  return err;
}

installMockSlackBolt();
installMockDb({
  getTokens: async () => null,
  saveTokens: async (bearer, refresh) => {
    saveTokensCalls.push({ bearer, refresh });
  },
});
installMockAxios({
  request: async () => {
    throw new Error("axios(config) not configured for this test file");
  },
  post: async (url, data, config) => {
    axiosPostCalls.push({ url, data, config });
    const next = axiosPostResponses.shift();
    if (!next) {
      throw new Error(
        "axiosPostResponses queue exhausted — test did not queue enough responses",
      );
    }
    if (next.ok) return { data: next.data };
    throw buildAxiosError(next.status, next.data);
  },
});

process.env.BEARER_TOKEN = "test-bearer";
process.env.REFRESH_TOKEN = "test-refresh";
process.env.TOKEN_ENDPOINT_URL = "http://localhost/token";
process.env.CLIENT_ID = "test-username";
process.env.CLIENT_SECRET = "test-password";
process.env.SLACK_SIGNING_SECRET = "test-signing";
process.env.SLACK_BOT_TOKEN = "xoxb-test";
process.env.SLACK_APP_TOKEN = "xapp-test";

const { refreshAccessToken, __getTokensForTest, __setTokensForTest } =
  await import("../app.js");

const INITIAL_BEARER = "initial-bearer";
const INITIAL_REFRESH = "initial-refresh";

describe("refreshAccessToken", () => {
  beforeEach(() => {
    axiosPostCalls.length = 0;
    axiosPostResponses.length = 0;
    saveTokensCalls.length = 0;
    __setTokensForTest(INITIAL_BEARER, INITIAL_REFRESH);
  });

  it("normal refresh: rotates both tokens and persists", async () => {
    axiosPostResponses.push({
      ok: true,
      data: { access_token: "new-bearer-1", refresh_token: "new-refresh-1" },
    });

    const result = await refreshAccessToken();

    expect(result).toEqual({
      success: true,
      newRefreshIssued: true,
      usedPasswordFallback: false,
    });
    expect(axiosPostCalls).toHaveLength(1);
    expect(axiosPostCalls[0].url).toBe("http://localhost/token");
    expect(axiosPostCalls[0].data).toContain("grant_type=refresh_token");
    expect(axiosPostCalls[0].data).toContain(
      `refresh_token=${INITIAL_REFRESH}`,
    );
    expect(saveTokensCalls).toEqual([
      { bearer: "new-bearer-1", refresh: "new-refresh-1" },
    ]);
    expect(__getTokensForTest()).toEqual({
      bearer: "new-bearer-1",
      refresh: "new-refresh-1",
    });
  });

  it("refresh response without a new refresh_token: keeps old refresh, updates bearer", async () => {
    axiosPostResponses.push({
      ok: true,
      data: { access_token: "new-bearer-only" },
    });

    const result = await refreshAccessToken();

    expect(result).toEqual({
      success: true,
      newRefreshIssued: false,
      usedPasswordFallback: false,
    });
    expect(__getTokensForTest()).toEqual({
      bearer: "new-bearer-only",
      refresh: INITIAL_REFRESH,
    });
  });

  it("invalid_grant triggers password-grant fallback that succeeds", async () => {
    axiosPostResponses.push({
      ok: false,
      status: 400,
      data: { error: "invalid_grant" },
    });
    axiosPostResponses.push({
      ok: true,
      data: { access_token: "pw-bearer", refresh_token: "pw-refresh" },
    });

    const result = await refreshAccessToken();

    expect(result).toEqual({
      success: true,
      newRefreshIssued: true,
      usedPasswordFallback: true,
    });
    expect(axiosPostCalls).toHaveLength(2);
    expect(axiosPostCalls[0].data).toContain("grant_type=refresh_token");
    expect(axiosPostCalls[1].data).toContain("grant_type=password");
    expect(axiosPostCalls[1].data).toContain("username=test-username");
    expect(axiosPostCalls[1].data).toContain("password=test-password");
    expect(saveTokensCalls).toEqual([
      { bearer: "pw-bearer", refresh: "pw-refresh" },
    ]);
    expect(__getTokensForTest()).toEqual({
      bearer: "pw-bearer",
      refresh: "pw-refresh",
    });
  });

  it("invalid_grant + password fallback also fails: returns failure, tokens unchanged, nothing persisted", async () => {
    axiosPostResponses.push({
      ok: false,
      status: 400,
      data: { error: "invalid_grant" },
    });
    axiosPostResponses.push({
      ok: false,
      status: 400,
      data: {
        error: "invalid_grant",
        error_description: "bad username or password",
      },
    });

    const result = await refreshAccessToken();

    expect(result).toEqual({
      success: false,
      newRefreshIssued: false,
      usedPasswordFallback: true,
    });
    expect(axiosPostCalls).toHaveLength(2);
    expect(saveTokensCalls).toHaveLength(0);
    expect(__getTokensForTest()).toEqual({
      bearer: INITIAL_BEARER,
      refresh: INITIAL_REFRESH,
    });
  });

  it("password fallback response missing refresh_token: fails, tokens unchanged", async () => {
    axiosPostResponses.push({
      ok: false,
      status: 400,
      data: { error: "invalid_grant" },
    });
    axiosPostResponses.push({
      ok: true,
      data: { access_token: "only-bearer" },
    });

    const result = await refreshAccessToken();

    expect(result.success).toBe(false);
    expect(result.usedPasswordFallback).toBe(true);
    expect(saveTokensCalls).toHaveLength(0);
    expect(__getTokensForTest()).toEqual({
      bearer: INITIAL_BEARER,
      refresh: INITIAL_REFRESH,
    });
  });

  it("403 (non-invalid_grant 4xx) does NOT trigger password fallback", async () => {
    axiosPostResponses.push({
      ok: false,
      status: 403,
      data: { error: "forbidden" },
    });

    const result = await refreshAccessToken();

    expect(result).toEqual({
      success: false,
      newRefreshIssued: false,
      usedPasswordFallback: false,
    });
    expect(axiosPostCalls).toHaveLength(1);
    expect(saveTokensCalls).toHaveLength(0);
  });

  it("400 with a different error code does NOT trigger password fallback", async () => {
    axiosPostResponses.push({
      ok: false,
      status: 400,
      data: { error: "unsupported_grant_type" },
    });

    const result = await refreshAccessToken();

    expect(result.success).toBe(false);
    expect(result.usedPasswordFallback).toBe(false);
    expect(axiosPostCalls).toHaveLength(1);
    expect(saveTokensCalls).toHaveLength(0);
  });

  it("mutex deduplicates concurrent calls across the refresh+fallback path", async () => {
    axiosPostResponses.push({
      ok: false,
      status: 400,
      data: { error: "invalid_grant" },
    });
    axiosPostResponses.push({
      ok: true,
      data: { access_token: "mutex-bearer", refresh_token: "mutex-refresh" },
    });

    const [r1, r2] = await Promise.all([
      refreshAccessToken(),
      refreshAccessToken(),
    ]);

    expect(r1).toEqual({
      success: true,
      newRefreshIssued: true,
      usedPasswordFallback: true,
    });
    expect(r2).toEqual(r1);
    // Exactly 2 POSTs (one refresh, one password-grant) — not 4
    expect(axiosPostCalls).toHaveLength(2);
    expect(saveTokensCalls).toHaveLength(1);
  });
});
