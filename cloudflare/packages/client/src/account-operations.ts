import {
  type ResolveAuthorsQuery,
  type ResolveAuthorsResponse,
  validateContract,
} from "@punks/contracts";

import { clientProblem, PunksClientError } from "./client-error";
import { validateDirectoryCursor } from "./cursors";

type LeasedRequest = (path: string, init?: RequestInit) => Promise<unknown>;

/** Rejects cyclic continuations before the client can issue another request. */
export function acceptNextDirectoryCursor(
  seen: Set<string>,
  cursor: string | null,
): string | null {
  if (cursor !== null) {
    validateDirectoryCursor(cursor);
    if (seen.has(cursor)) {
      throw clientProblem("Directory response repeated a continuation cursor", {
        kind: "contract_violation",
      });
    }
    seen.add(cursor);
  }
  return cursor;
}

/** Bounded author sidecar operation shared by each HTTP WorkspaceSession. */
export async function resolveAuthorsOperation(
  request: LeasedRequest,
  assertCurrent: () => void,
  workspaceId: string,
  authors: ResolveAuthorsQuery["authors"],
  signal?: AbortSignal,
): Promise<ResolveAuthorsResponse["authors"]> {
  const response = await request(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/authors/resolve`,
    {
      method: "POST",
      ...(signal === undefined ? {} : { signal }),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contract: "author.resolve@1",
        workspaceId,
        authors,
      } satisfies ResolveAuthorsQuery),
    },
  );
  if (
    !validateContract("punks://contracts/author.resolve-response@1", response)
      .valid ||
    (response as ResolveAuthorsResponse).workspaceId !== workspaceId
  ) {
    throw new PunksClientError(
      {
        type: "https://punks.bot/problems/client",
        title: "Punks client request failed",
        status: 500,
        code: "internal",
        detail: "Author response violated author.resolve-response@1",
        correlationId: crypto.randomUUID(),
        retry: "never",
      },
      "contract_violation",
    );
  }
  assertCurrent();
  return (response as ResolveAuthorsResponse).authors;
}
