import assert from "node:assert/strict";
import test from "node:test";

import {
  SHORTCUT_CAPABILITIES,
  SURFACE_CAPABILITIES,
  capabilityForRoutePath,
  capabilityForShortcut,
} from "./surfaces.ts";

test("chaque route de découverte porte exactement une capacité", () => {
  assert.equal(capabilityForRoutePath("/"), "home");
  assert.equal(capabilityForRoutePath("/agents"), "bots");
  assert.equal(capabilityForRoutePath("/agents/other"), "bots");
  assert.equal(capabilityForRoutePath("/pulse"), "pulse");
  assert.equal(capabilityForRoutePath("/projects"), "repositories");
  assert.equal(capabilityForRoutePath("/projects/x"), "repositories");
  assert.equal(capabilityForRoutePath("/workflows"), "workflows");
  assert.equal(capabilityForRoutePath("/workflows/y"), "workflows");
  assert.equal(capabilityForRoutePath("/messages/new"), "direct-conversations");
  assert.equal(capabilityForRoutePath("/channels/abc/posts/def"), "forum");
  assert.equal(capabilityForRoutePath("/channels/abc"), "stream-list");
});

test("les surfaces neutres ne portent aucune capacité", () => {
  assert.equal(capabilityForRoutePath("/settings"), null);
  assert.equal(capabilityForRoutePath("/reminders"), null);
  assert.equal(capabilityForRoutePath("/messages"), null);
});

test("un préfixe ne capture pas une route voisine", () => {
  assert.equal(capabilityForRoutePath("/pulses"), null);
  assert.equal(capabilityForRoutePath("/workflows-extra"), null);
  assert.equal(capabilityForRoutePath("/channelsx/abc"), null);
});

test("chaque raccourci est relié à une capacité déclarée", () => {
  for (const id of Object.keys(SHORTCUT_CAPABILITIES)) {
    const capability = capabilityForShortcut(id);
    assert.ok(
      SURFACE_CAPABILITIES.includes(capability),
      `raccourci ${id} → capacité inconnue ${capability}`,
    );
  }
  assert.equal(capabilityForShortcut("search-everything"), "command-palette");
  assert.equal(capabilityForShortcut("start-huddle"), "huddles");
});
