import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

import {
  parseWorkspaceInvitationInput,
  purgePrivateIdentitySidecars,
} from "./IdentityGovernanceControls.tsx";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const code = `${workspaceId}.${"A".repeat(43)}`;
const origin = "https://staging.punks.bot";

test("invitation input accepts only a bare code or same-origin Punks link", () => {
  assert.equal(parseWorkspaceInvitationInput(`  ${code}  `, origin), code);
  assert.equal(
    parseWorkspaceInvitationInput(`${origin}/invite/${code}`, origin),
    code,
  );
  assert.equal(
    parseWorkspaceInvitationInput(`${origin}/invite/${code}/`, origin),
    code,
  );

  for (const candidate of [
    `https://evil.example/invite/${code}`,
    `${origin}/invite/${code}?redirect=https://evil.example`,
    `${origin}/invite/${code}#fragment`,
    `https://user:secret@staging.punks.bot/invite/${code}`,
    `${origin}/invite/not-a-code`,
  ]) {
    assert.equal(parseWorkspaceInvitationInput(candidate, origin), null);
  }
});

test("governance revocation purges only the private identity sidecars of its generation", () => {
  const queryClient = new QueryClient();
  const generation = 7;
  const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";
  const searchKey = [
    "punks",
    "punk-search",
    workspaceId,
    generation,
    "prefix:mar",
  ];
  const authorsKey = ["punks", "authors", workspaceId, generation, "batch"];
  const otherGenerationKey = [
    "punks",
    "punk-search",
    workspaceId,
    generation + 1,
    "prefix:mar",
  ];
  const otherWorkspaceKey = [
    "punks",
    "punk-search",
    otherWorkspaceId,
    generation,
    "prefix:mar",
  ];
  queryClient.setQueryData(searchKey, { private: "search" });
  queryClient.setQueryData(authorsKey, { private: "authors" });
  queryClient.setQueryData(otherGenerationKey, { retained: true });
  queryClient.setQueryData(otherWorkspaceKey, { retained: true });
  const searchObserver = new QueryObserver(queryClient, {
    queryKey: searchKey,
    enabled: false,
  });
  const authorsObserver = new QueryObserver(queryClient, {
    queryKey: authorsKey,
    enabled: false,
  });
  const unsubscribeSearch = searchObserver.subscribe(() => undefined);
  const unsubscribeAuthors = authorsObserver.subscribe(() => undefined);

  purgePrivateIdentitySidecars(queryClient, workspaceId, generation);

  assert.deepEqual(queryClient.getQueryData(searchKey), {
    pages: [],
    pageParams: [],
  });
  assert.deepEqual(queryClient.getQueryData(authorsKey), []);
  assert.deepEqual(searchObserver.getCurrentResult().data, {
    pages: [],
    pageParams: [],
  });
  assert.deepEqual(authorsObserver.getCurrentResult().data, []);
  assert.deepEqual(queryClient.getQueryData(otherGenerationKey), {
    retained: true,
  });
  assert.deepEqual(queryClient.getQueryData(otherWorkspaceKey), {
    retained: true,
  });
  unsubscribeSearch();
  unsubscribeAuthors();
});
