import assert from "node:assert/strict";
import test from "node:test";

import {
  hasCompletePunksCapabilitySet,
  intersectPunksCapabilities,
  isPunksRouteMounted,
  PUNKS_MOUNTED_CAPABILITIES,
} from "./punksProfile.ts";

test("le produit local riche monte le profil social et les capacités autoritaires prêtes", () => {
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
    "message-lifecycle",
    "identity-governance",
    "presence",
    "search",
  ]);
  assert.equal(PUNKS_MOUNTED_CAPABILITIES.includes("home"), false);
  assert.equal(PUNKS_MOUNTED_CAPABILITIES.includes("message-lifecycle"), true);
});

test("chaque route canonique est liée au profil monté", () => {
  for (const kind of ["home", "workspace", "conversation", "message"]) {
    assert.equal(isPunksRouteMounted({ kind }), true, kind);
  }
});

test("la disponibilité est l'intersection fermée du client et de l'environnement", () => {
  const available = intersectPunksCapabilities([
    ...PUNKS_MOUNTED_CAPABILITIES,
    "moderation",
  ]);
  assert.equal(available.has("moderation"), false);
  assert.equal(hasCompletePunksCapabilitySet(available), true);

  available.delete("unicode-reactions");
  assert.equal(hasCompletePunksCapabilitySet(available), false);
});
