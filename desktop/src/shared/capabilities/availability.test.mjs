import assert from "node:assert/strict";
import test from "node:test";

import {
  hasCompletePunksCapabilitySet,
  intersectPunksCapabilities,
  isPunksRouteMounted,
  PUNKS_MOUNTED_CAPABILITIES,
} from "./punksProfile.ts";

test("le candidat monte exactement le profil desktop-social-loop@1", () => {
  assert.deepEqual(PUNKS_MOUNTED_CAPABILITIES, [
    "compatibility",
    "account-session",
    "authentication",
    "workspace-selection",
    "stream-list",
    "message-history",
    "threads",
    "bounded-authors",
    "conversation-follow",
    "message-post",
    "unicode-reactions",
  ]);
  assert.equal(PUNKS_MOUNTED_CAPABILITIES.includes("home"), false);
  assert.equal(PUNKS_MOUNTED_CAPABILITIES.includes("message-lifecycle"), false);
});

test("chaque route canonique est liée au profil monté", () => {
  for (const kind of ["home", "workspace", "conversation", "message"]) {
    assert.equal(isPunksRouteMounted({ kind }), true, kind);
  }
});

test("la disponibilité est l'intersection fermée du client et de l'environnement", () => {
  const available = intersectPunksCapabilities([
    ...PUNKS_MOUNTED_CAPABILITIES,
    "message-lifecycle",
  ]);
  assert.equal(available.has("message-lifecycle"), false);
  assert.equal(hasCompletePunksCapabilitySet(available), true);

  available.delete("unicode-reactions");
  assert.equal(hasCompletePunksCapabilitySet(available), false);
});
