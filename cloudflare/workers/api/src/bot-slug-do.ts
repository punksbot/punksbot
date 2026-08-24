import { validateContract } from "@punks/contracts";
import { DurableObject } from "cloudflare:workers";

import type { ApiEnv } from "./env";
import type {
  BotQueryResult,
  BotSlugClaimResult,
  BotSlugResolution,
} from "./rpc";

type SlugRow = Record<
  "slug" | "status" | "bot_id" | "command_id" | "redirect_slug" | "attempts",
  string | number | null
>;

const botSlugPattern = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Global uniqueness and repair authority for one mutable Bot slug. */
export class BotSlugDO extends DurableObject<ApiEnv> {
  constructor(ctx: DurableObjectState, env: ApiEnv) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS slug_binding (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          slug TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'redirect')),
          bot_id TEXT NOT NULL,
          command_id TEXT NOT NULL,
          redirect_slug TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        ) STRICT
      `);
      const current = this.row();
      if (
        current?.status === "pending" &&
        (await this.ctx.storage.getAlarm()) === null
      ) {
        await this.ctx.storage.setAlarm(Date.now() + 1_000);
      }
    });
  }

  async claim(input: unknown): Promise<BotSlugClaimResult> {
    if (
      !isSlugCommand(input, ["botId", "commandId", "slug"]) ||
      !botSlugPattern.test(String(input.slug)) ||
      !uuidPattern.test(String(input.botId)) ||
      !uuidPattern.test(String(input.commandId))
    ) {
      return { ok: false, code: "invalid_request" };
    }
    const slug = String(input.slug);
    const botId = String(input.botId);
    const commandId = String(input.commandId);
    const current = this.row();
    if (current === undefined) {
      this.ctx.storage.sql.exec(
        `INSERT INTO slug_binding
          (singleton, slug, status, bot_id, command_id, redirect_slug, attempts, updated_at)
         VALUES (1, ?, 'pending', ?, ?, NULL, 0, ?)`,
        slug,
        botId,
        commandId,
        new Date().toISOString(),
      );
      await this.ctx.storage.setAlarm(Date.now() + 1_000);
      return { ok: true, botId, replayed: false };
    }
    if (
      current.command_id === commandId &&
      current.slug === slug &&
      current.bot_id === botId
    ) {
      return { ok: true, botId: String(current.bot_id), replayed: true };
    }
    return { ok: false, code: "slug_claimed" };
  }

  activate(input: unknown): boolean {
    if (
      !isSlugCommand(input, ["botId", "commandId", "slug"]) ||
      !uuidPattern.test(String(input.botId)) ||
      !uuidPattern.test(String(input.commandId))
    ) {
      return false;
    }
    const slug = String(input.slug);
    const botId = String(input.botId);
    const commandId = String(input.commandId);
    const current = this.row();
    if (
      current === undefined ||
      current.slug !== slug ||
      current.bot_id !== botId ||
      current.command_id !== commandId
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

  release(input: unknown): boolean {
    if (
      !isSlugCommand(input, ["botId", "commandId"]) ||
      !uuidPattern.test(String(input.botId)) ||
      !uuidPattern.test(String(input.commandId))
    ) {
      return false;
    }
    const botId = String(input.botId);
    const commandId = String(input.commandId);
    const current = this.row();
    if (
      current === undefined ||
      current.status !== "pending" ||
      current.bot_id !== botId ||
      current.command_id !== commandId
    ) {
      return false;
    }
    this.ctx.storage.sql.exec("DELETE FROM slug_binding WHERE singleton = 1");
    return true;
  }

  redirect(input: unknown): boolean {
    if (
      !isSlugCommand(input, ["botId", "slug"]) ||
      !botSlugPattern.test(String(input.slug)) ||
      !uuidPattern.test(String(input.botId))
    ) {
      return false;
    }
    const slug = String(input.slug);
    const botId = String(input.botId);
    const current = this.row();
    if (
      current === undefined ||
      current.status === "pending" ||
      current.bot_id !== botId
    ) {
      return false;
    }
    if (current.status === "redirect" && current.redirect_slug === slug) {
      return true;
    }
    this.ctx.storage.sql.exec(
      `UPDATE slug_binding
       SET status = 'redirect', redirect_slug = ?, updated_at = ?
       WHERE singleton = 1`,
      slug,
      new Date().toISOString(),
    );
    return true;
  }

  resolve(): BotSlugResolution {
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
        botId: String(current.bot_id),
        slug: String(current.redirect_slug),
      };
    }
    return { status: "active", botId: String(current.bot_id) };
  }

  override async alarm(): Promise<void> {
    const current = this.row();
    if (current === undefined || current.status !== "pending") {
      return;
    }
    const botId = String(current.bot_id);
    try {
      const raw: unknown = await this.env.BOTS.getByName(botId).query({
        contract: "bot.get@1",
        botId,
      });
      const result = validateBotQueryResult(raw, botId);
      if (result?.ok === true && result.state.slug === current.slug) {
        this.activate({
          slug: String(current.slug),
          botId,
          commandId: String(current.command_id),
        });
        return;
      }
    } catch {
      // The pending claim remains authoritative until a bounded retry succeeds.
    }
    const attempts = Number(current.attempts) + 1;
    this.ctx.storage.sql.exec(
      "UPDATE slug_binding SET attempts = ?, updated_at = ? WHERE singleton = 1",
      attempts,
      new Date().toISOString(),
    );
    this.scheduleAlarm(Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000));
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

function validateBotQueryResult(
  value: unknown,
  botId: string,
): BotQueryResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok === false) {
    return Object.keys(record).sort().join(",") === "code,ok" &&
      (record.code === "invalid_contract" ||
        record.code === "not_found" ||
        record.code === "internal")
      ? (record as Extract<BotQueryResult, { ok: false }>)
      : null;
  }
  return record.ok === true &&
    Object.keys(record).sort().join(",") === "ok,state" &&
    typeof record.state === "object" &&
    record.state !== null &&
    validateContract("punks://contracts/bot@1", record.state).valid &&
    Reflect.get(record.state, "id") === botId &&
    typeof Reflect.get(record.state, "slug") === "string" &&
    botSlugPattern.test(String(Reflect.get(record.state, "slug")))
    ? (record as Extract<BotQueryResult, { ok: true }>)
    : null;
}

function isSlugCommand(
  input: unknown,
  keys: readonly string[],
): input is Record<string, string> {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).sort().join(",") !== [...keys].sort().join(",")
  ) {
    return false;
  }
  return keys.every((key) => typeof Reflect.get(input, key) === "string");
}
