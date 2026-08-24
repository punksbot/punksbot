import { WorkerEntrypoint } from "cloudflare:workers";

const calls = [];
let candidates = [];
let mode = "available";
let rawResult = null;
let holdReached = false;

function followsCursor(candidate, cursor) {
  if (cursor === undefined) {
    return true;
  }
  const [createdCursor, conversationId, messageId] = cursor;
  return (
    candidate.createdCursor < createdCursor ||
    (candidate.createdCursor === createdCursor &&
      (candidate.conversationId > conversationId ||
        (candidate.conversationId === conversationId &&
          candidate.messageId > messageId)))
  );
}

export default class SearchFixture extends WorkerEntrypoint {
  async searchMessages(input) {
    calls.push(structuredClone(input));
    if (rawResult !== null) {
      return structuredClone(rawResult);
    }
    if (mode === "throw") {
      throw new Error("fixture search unavailable");
    }
    if (mode === "unavailable") {
      return { ok: false, code: "storage_unavailable" };
    }
    if (mode === "malformed") {
      return { ok: true, candidates: [{ messageId: "malformed" }] };
    }
    while (mode === "held") {
      holdReached = true;
      await scheduler.wait(10);
    }
    const matching = candidates
      .filter(
        (candidate) =>
          candidate.workspaceId === input.workspaceId &&
          candidate.conversationId === input.conversationId &&
          followsCursor(candidate, input.cursor),
      )
      .sort(
        (left, right) =>
          right.createdCursor - left.createdCursor ||
          left.conversationId.localeCompare(right.conversationId) ||
          left.messageId.localeCompare(right.messageId),
      );
    const bounded = matching.slice(0, input.limit);
    const last = bounded.at(-1);
    return {
      ok: true,
      candidates: bounded.map(({ workspaceId: _, ...candidate }) => candidate),
      nextCursor:
        matching.length > input.limit && last !== undefined
          ? [last.createdCursor, last.conversationId, last.messageId]
          : null,
    };
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/__test/reset") {
      calls.length = 0;
      candidates = [];
      mode = "available";
      rawResult = null;
      holdReached = false;
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/__test/candidates") {
      candidates = structuredClone(await request.json());
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/__test/mode") {
      mode = (await request.json()).mode;
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/__test/result") {
      rawResult = structuredClone(await request.json());
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/__test/hold") {
      holdReached = false;
      mode = "held";
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/__test/release") {
      mode = "available";
      return Response.json({ ok: true });
    }
    if (request.method === "GET" && url.pathname === "/__test/hold") {
      return Response.json({ reached: holdReached });
    }
    if (request.method === "GET" && url.pathname === "/__test/calls") {
      return Response.json({ calls });
    }
    return new Response(null, { status: 404 });
  }
}
