import { PromotionFaultableDurableObject } from "../../../shared/promotion-faultable-do";
import { canonicalJson, sha256Hex } from "@punks/core";

import type { ApiEnv } from "./env";
import type { SlugClaimResult, SlugResolution } from "./rpc";

type SlugRow = Record<
  | "slug"
  | "status"
  | "workspace_id"
  | "command_id"
  | "redirect_slug"
  | "attempts",
  string | number | null
>;

export class WorkspaceSlugDO extends PromotionFaultableDurableObject<ApiEnv> {
  protected override async promotionRecoveryFingerprint(): Promise<string> {
    const current = this.row();
    if (current === undefined)
      throw new Error("promotion Workspace slug target is missing");
    return sha256Hex(canonicalJson(current));
  }

  constructor(ctx: DurableObjectState, env: ApiEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS slug_binding (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        slug TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'redirect')),
        workspace_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        redirect_slug TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      ) STRICT
    `);
  }

  claim(input: {
    slug: string;
    workspaceId: string;
    commandId: string;
  }): SlugClaimResult {
    const current = this.row();
    if (current === undefined) {
      this.ctx.storage.sql.exec(
        `INSERT INTO slug_binding
          (singleton, slug, status, workspace_id, command_id, redirect_slug, attempts, updated_at)
         VALUES (1, ?, 'pending', ?, ?, NULL, 0, ?)`,
        input.slug,
        input.workspaceId,
        input.commandId,
        new Date().toISOString(),
      );
      this.scheduleAlarm(1_000);
      return { ok: true, workspaceId: input.workspaceId, replayed: false };
    }

    if (current.command_id === input.commandId && current.slug === input.slug) {
      return {
        ok: true,
        workspaceId: String(current.workspace_id),
        replayed: true,
      };
    }
    return { ok: false, code: "slug_claimed" };
  }

  activate(input: {
    slug: string;
    workspaceId: string;
    commandId: string;
  }): boolean {
    const current = this.row();
    if (
      current === undefined ||
      current.slug !== input.slug ||
      current.workspace_id !== input.workspaceId ||
      current.command_id !== input.commandId
    ) {
      return false;
    }
    if (current.status === "active") {
      return true;
    }
    if (current.status !== "pending") {
      return false;
    }

    this.ctx.storage.sql.exec(
      `UPDATE slug_binding
       SET status = 'active', redirect_slug = NULL, updated_at = ?
       WHERE singleton = 1`,
      new Date().toISOString(),
    );
    return true;
  }

  override async alarm(): Promise<void> {
    const current = this.row();
    if (current === undefined || current.status !== "pending") {
      return;
    }

    const workspaceId = String(current.workspace_id);
    const workspace = this.env.WORKSPACES.getByName(workspaceId);
    const result = await workspace.query({
      contract: "workspace.get@1",
      workspaceId,
    });
    if (result.ok && result.state.slug === current.slug) {
      this.activate({
        slug: String(current.slug),
        workspaceId,
        commandId: String(current.command_id),
      });
      return;
    }

    const attempts = Number(current.attempts) + 1;
    this.ctx.storage.sql.exec(
      "UPDATE slug_binding SET attempts = ?, updated_at = ? WHERE singleton = 1",
      attempts,
      new Date().toISOString(),
    );
    this.scheduleAlarm(Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000));
  }

  release(input: { workspaceId: string; commandId: string }): boolean {
    const current = this.row();
    if (
      current === undefined ||
      current.status !== "pending" ||
      current.workspace_id !== input.workspaceId ||
      current.command_id !== input.commandId
    ) {
      return false;
    }
    this.ctx.storage.sql.exec("DELETE FROM slug_binding WHERE singleton = 1");
    return true;
  }

  redirect(input: { workspaceId: string; slug: string }): boolean {
    const current = this.row();
    if (
      current === undefined ||
      current.status === "pending" ||
      current.workspace_id !== input.workspaceId
    ) {
      return false;
    }
    if (current.status === "redirect" && current.redirect_slug === input.slug) {
      return true;
    }

    this.ctx.storage.sql.exec(
      `UPDATE slug_binding
       SET status = 'redirect', redirect_slug = ?, updated_at = ?
       WHERE singleton = 1`,
      input.slug,
      new Date().toISOString(),
    );
    return true;
  }

  resolve(): SlugResolution {
    const current = this.row();
    if (current === undefined) {
      return { status: "missing" };
    }
    if (current.status === "pending") {
      return { status: "pending" };
    }
    if (current.status === "redirect") {
      return {
        status: "redirect",
        workspaceId: String(current.workspace_id),
        slug: String(current.redirect_slug),
      };
    }
    return { status: "active", workspaceId: String(current.workspace_id) };
  }

  private row(): SlugRow | undefined {
    return this.ctx.storage.sql
      .exec<SlugRow>("SELECT * FROM slug_binding WHERE singleton = 1")
      .toArray()[0];
  }

  private scheduleAlarm(delayMs: number): void {
    this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.now() + delayMs));
  }
}
