import { describe, expect, it } from "vitest";

import {
  encodeMessageContentEnvelope,
  MESSAGE_CONTENT_ENVELOPE_MAX_BYTES,
  messageContentEnvelopeFits,
} from "../src/message-content-envelope";

describe("Message content envelope limit", () => {
  it("measures the canonical UTF-8 envelope rather than JavaScript characters", () => {
    const overhead = encodeMessageContentEnvelope("", null).byteLength;
    expect(
      messageContentEnvelopeFits("a".repeat(65_536 - overhead), null),
    ).toBe(true);
    expect(
      messageContentEnvelopeFits("a".repeat(65_537 - overhead), null),
    ).toBe(false);
    expect(messageContentEnvelopeFits("😀".repeat(16_384), null)).toBe(false);
    expect(MESSAGE_CONTENT_ENVELOPE_MAX_BYTES).toBe(65_536);
  });
});
