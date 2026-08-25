import assert from "node:assert/strict";
import test from "node:test";

import { parseWorkspaceInvitationInput } from "./IdentityGovernanceControls.tsx";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const code = `${workspaceId}.${"A".repeat(43)}`;
const origin = "https://staging.punks.bot";

test("invitation input accepts only a bare code or same-origin Punks link", () => {
  assert.equal(parseWorkspaceInvitationInput(`  ${code}  `, origin), code);
  assert.equal(
    parseWorkspaceInvitationInput(`${origin}/invite/${code}`, origin),
    code,
  );
  assert.equal(
    parseWorkspaceInvitationInput(`${origin}/invite/${code}/`, origin),
    code,
  );

  for (const candidate of [
    `https://evil.example/invite/${code}`,
    `${origin}/invite/${code}?redirect=https://evil.example`,
    `${origin}/invite/${code}#fragment`,
    `https://user:secret@staging.punks.bot/invite/${code}`,
    `${origin}/invite/not-a-code`,
  ]) {
    assert.equal(parseWorkspaceInvitationInput(candidate, origin), null);
  }
});
