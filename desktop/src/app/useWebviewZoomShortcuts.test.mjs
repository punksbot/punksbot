import assert from "node:assert/strict";
import test from "node:test";

import {
  getNextZoomFactor,
  MAX_ZOOM_FACTOR,
} from "./useWebviewZoomShortcuts.ts";

test("keyboard text zoom reaches the required 200 percent boundary", () => {
  let zoom = 1;
  for (let index = 0; index < 20; index += 1) {
    zoom = getNextZoomFactor("increase", zoom);
  }
  assert.equal(MAX_ZOOM_FACTOR, 2);
  assert.equal(zoom, 2);
  assert.equal(getNextZoomFactor("increase", zoom), 2);
  assert.equal(getNextZoomFactor("reset", zoom), 1);
});
