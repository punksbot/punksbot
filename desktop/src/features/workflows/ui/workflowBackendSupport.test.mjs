import assert from "node:assert/strict";
import test from "node:test";

import { workflowBackendSupportWarning } from "./workflowBackendSupport.ts";

test("Full Local announces no missing backend action that LocalAuthority implements", () => {
  for (const action of [
    "send_message",
    "send_dm",
    "add_reaction",
    "call_webhook",
    "request_approval",
    "set_channel_topic",
    "delay",
  ]) {
    assert.equal(workflowBackendSupportWarning(action, true), null, action);
  }
});

test("hosted builds retain truthful warnings for their unfinished actions", () => {
  assert.match(
    workflowBackendSupportWarning("send_dm", false) ?? "",
    /not executed yet/,
  );
  assert.match(
    workflowBackendSupportWarning("request_approval", false) ?? "",
    /WF-08/,
  );
  assert.equal(workflowBackendSupportWarning("send_message", false), null);
});
