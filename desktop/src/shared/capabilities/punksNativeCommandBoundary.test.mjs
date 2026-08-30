import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runtime = await readFile(
  new URL("../../../src-tauri/src/punks_runtime.rs", import.meta.url),
  "utf8",
);
const handler = runtime.match(/tauri::generate_handler!\[([\s\S]*?)\]\)/u)?.[1];

test("the rich local runtime registers every authoritative desktop command already implemented", () => {
  assert.ok(handler, "Punks Tauri handler must remain statically inspectable");
  for (const command of [
    // T2 — message lifecycle.
    "punks_edit_message",
    "punks_retract_message",
    "punks_restore_message",
    // T4 — private identity and governance.
    "punks_get_punk_profile",
    "punks_update_punk_profile",
    "punks_get_punk_summaries",
    "punks_search_punks",
    "punks_create_workspace_invitation",
    "punks_get_workspace_invitation",
    "punks_claim_workspace_invitation",
    "punks_revoke_workspace_invitation",
    "punks_get_workspace_governance",
    "punks_set_workspace_member_role",
    "punks_remove_workspace_member",
    "punks_leave_workspace",
    "punks_transfer_workspace_ownership",
    // T8 — ephemeral presence.
    "punks_hold_presence",
    "punks_presence_next",
    "punks_set_presence_status",
    "punks_signal_presence_typing",
    "punks_close_presence",
    // T9 — private search.
    "punks_search_messages",
  ]) {
    assert.match(handler, new RegExp(`\\b${command}\\b`, "u"), command);
  }
});
