import { describe, expect, it } from "vitest";

import { passkeyPage } from "../src/desktop-auth-browser-page";

describe("desktop passkey browser page", () => {
  it("emits a syntactically valid module with base64url escaping", async () => {
    const page = passkeyPage({
      flowId: "d9428888-122b-4d9b-8f03-1a1127e667b8",
      purpose: "authentication",
      publicKey: { challenge: "AQID" },
    });
    const html = await page.text();
    const script = html.match(/<script type="module">([\s\S]*)<\/script>/)?.[1];
    expect(script).toBeTypeOf("string");
    expect(script).toContain('replace(/\\+/g,"-")');
    expect(script).toContain('replace(/\\//g,"_")');
  });
});
