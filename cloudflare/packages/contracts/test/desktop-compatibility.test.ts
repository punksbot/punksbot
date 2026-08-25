import { describe, expect, it } from "vitest";

import { validateDesktopCompatibilityResponse } from "../src/desktop-compatibility";

const response = {
  contract: "desktop.compatibility-response@1",
  compatible: true,
  profile: "desktop-social-loop@1",
  registryVersion: 1,
  minimumClientVersion: "0.6.0",
  environment: "staging",
  origin: "https://staging.punks.bot",
  capabilities: ["compatibility"],
};

describe("desktop compatibility bootstrap contract", () => {
  it("accepts the closed response and rejects an unknown field", () => {
    expect(validateDesktopCompatibilityResponse(response).valid).toBe(true);
    expect(
      validateDesktopCompatibilityResponse({ ...response, leaked: true }).valid,
    ).toBe(false);
  });
});
