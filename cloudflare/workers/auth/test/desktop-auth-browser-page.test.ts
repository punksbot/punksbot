import { describe, expect, it, vi } from "vitest";

import { confirmationPage } from "../src/desktop-auth-browser-page";

describe("desktop OAuth browser page", () => {
  it("posts to a blocker-neutral confirmation path", async () => {
    const html = await confirmationPage(
      "d9428888-122b-4d9b-8f03-1a1127e667b8",
      "s".repeat(43),
      "c".repeat(43),
      "Punksbot",
      new Date(Date.now() + 60_000).toISOString(),
    ).text();
    expect(html).toContain('action="/api/auth/v1/desktop/browser"');
    expect(html).not.toContain("/browser/confirm");
    expect(html).not.toContain("/browser/oauth/confirm");
  });

  it("never renders a creation form when its server deadline has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2030-01-01T00:05:00.000Z"));
      const response = confirmationPage(
        "d9428888-122b-4d9b-8f03-1a1127e667b8",
        "s".repeat(43),
        "c".repeat(43),
        "Punksbot",
        "2030-01-01T00:05:00.000Z",
      );
      expect(response.status).toBe(410);
      const html = await response.text();
      expect(html).toContain("Connexion expirée");
      expect(html).not.toContain("<form");
    } finally {
      vi.useRealTimers();
    }
  });
});
