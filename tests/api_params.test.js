import { describe, it, expect, beforeEach } from "vitest";
import {
  installMockAxios,
  installMockSlackBolt,
} from "./helpers/cjs-mocks.js";

const axiosCalls = [];

installMockSlackBolt();
installMockAxios({
  request: async (config) => {
    axiosCalls.push(config);
    return { data: { AssureAdvantage: [{ CarrierDetails: {} }] } };
  },
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

const { apiCall } = await import("../app.js");

describe("apiCall parameter handling", () => {
  beforeEach(() => {
    axiosCalls.length = 0;
  });

  it("sends parameters as query params, not request body", async () => {
    const params = { DocketNumber: "123456" };
    await apiCall("/api/v1/Carrier/GetCarrierData", params);

    expect(axiosCalls).toHaveLength(1);
    const config = axiosCalls[0];

    // Parameters must be sent as query string (config.params)
    expect(config.params).toEqual(params);

    // Must NOT send parameters as JSON body (config.data)
    expect(config.data).toBeUndefined();
  });

  it("sends DocketNumber param for carrier data lookups", async () => {
    const mcNumber = "789012";
    await apiCall("/api/v1/Carrier/GetCarrierData", {
      DocketNumber: mcNumber,
    });

    expect(axiosCalls).toHaveLength(1);
    expect(axiosCalls[0].params).toEqual({ DocketNumber: mcNumber });
    expect(axiosCalls[0].data).toBeUndefined();
  });

  it("sends docketNumber param for risk assessment lookups", async () => {
    const mcNumber = "789012";
    await apiCall("/api/v1/Carrier/GetCarrierRiskAssessment", {
      docketNumber: mcNumber,
    });

    expect(axiosCalls).toHaveLength(1);
    expect(axiosCalls[0].params).toEqual({ docketNumber: mcNumber });
    expect(axiosCalls[0].data).toBeUndefined();
  });
});
