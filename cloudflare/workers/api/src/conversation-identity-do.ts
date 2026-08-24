import { DurableObject } from "cloudflare:workers";

import type { ApiEnv } from "./env";

export interface ConversationIdentityClaim {
  workspaceId: string;
  participantSetHash: string;
  conversationId: string;
  commandId: string;
}

export type ConversationIdentityClaimResult =
  | {
      ok: true;
      conversationId: string;
      status: "pending" | "active";
      sameCommand: boolean;
    }
  | { ok: false; code: "invalid_request" | "claim_in_progress" };

type ClaimRow = Record<
  | "workspace_id"
  | "participant_set_hash"
  | "conversation_id"
  | "command_id"
  | "status",
  string
>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hashPattern = /^[0-9a-f]{64}$/;

export class ConversationIdentityDO extends DurableObject<ApiEnv> {
  constructor(ctx: DurableObjectState, env: ApiEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS identity_claim (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        workspace_id TEXT NOT NULL,
        participant_set_hash TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'active')),
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
  }

  claim(input: ConversationIdentityClaim): ConversationIdentityClaimResult {
    if (!this.valid(input)) {
      return { ok: false, code: "invalid_request" };
    }
    const current = this.current();
    if (current === undefined) {
      this.ctx.storage.sql.exec(
        `INSERT INTO identity_claim
          (singleton, workspace_id, participant_set_hash, conversation_id,
           command_id, status, updated_at)
         VALUES (1, ?, ?, ?, ?, 'pending', ?)`,
        input.workspaceId,
        input.participantSetHash,
        input.conversationId,
        input.commandId,
        new Date().toISOString(),
      );
      return {
        ok: true,
        conversationId: input.conversationId,
        status: "pending",
        sameCommand: true,
      };
    }
    if (
      current.workspace_id !== input.workspaceId ||
      current.participant_set_hash !== input.participantSetHash
    ) {
      return { ok: false, code: "invalid_request" };
    }
    if (
      current.status === "pending" &&
      current.command_id !== input.commandId
    ) {
      return { ok: false, code: "claim_in_progress" };
    }
    return {
      ok: true,
      conversationId: current.conversation_id,
      status: current.status as "pending" | "active",
      sameCommand: current.command_id === input.commandId,
    };
  }

  activate(input: ConversationIdentityClaim): boolean {
    if (!this.valid(input)) {
      return false;
    }
    const current = this.current();
    if (
      current === undefined ||
      current.workspace_id !== input.workspaceId ||
      current.participant_set_hash !== input.participantSetHash ||
      current.conversation_id !== input.conversationId ||
      current.command_id !== input.commandId
    ) {
      return false;
    }
    this.ctx.storage.sql.exec(
      `UPDATE identity_claim SET status = 'active', updated_at = ?
       WHERE singleton = 1`,
      new Date().toISOString(),
    );
    return true;
  }

  release(input: ConversationIdentityClaim): boolean {
    if (!this.valid(input)) {
      return false;
    }
    const current = this.current();
    if (
      current === undefined ||
      current.status !== "pending" ||
      current.workspace_id !== input.workspaceId ||
      current.participant_set_hash !== input.participantSetHash ||
      current.conversation_id !== input.conversationId ||
      current.command_id !== input.commandId
    ) {
      return false;
    }
    this.ctx.storage.sql.exec("DELETE FROM identity_claim WHERE singleton = 1");
    return true;
  }

  private current(): ClaimRow | undefined {
    return this.ctx.storage.sql
      .exec<ClaimRow>(
        `SELECT workspace_id, participant_set_hash, conversation_id,
                command_id, status
         FROM identity_claim WHERE singleton = 1`,
      )
      .toArray()[0];
  }

  private valid(input: ConversationIdentityClaim): boolean {
    return (
      typeof input === "object" &&
      input !== null &&
      uuidPattern.test(input.workspaceId) &&
      hashPattern.test(input.participantSetHash) &&
      uuidPattern.test(input.conversationId) &&
      uuidPattern.test(input.commandId) &&
      this.ctx.id.name === `${input.workspaceId}:dm:${input.participantSetHash}`
    );
  }
}
