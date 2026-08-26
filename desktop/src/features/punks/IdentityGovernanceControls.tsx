import {
  notifyManager,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";

import type {
  CreateWorkspaceInvitationResponse,
  PunkPublicSummary,
  WorkspaceGovernanceResponse,
  WorkspaceInvitationView,
} from "@punks/contracts";
import type { AuthenticationMethod } from "@/shared/api/punksClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./PunksDialog";

import { usePunksAccount, usePunksWorkspace } from "./PunksRuntime";

const roleLabels = {
  owner: "Owner",
  moderator: "Moderator",
  member: "Member",
  guest: "Guest",
} as const;

type WorkspaceRole = keyof typeof roleLabels;

function governanceKey(workspaceId: string, generation: number) {
  return ["punks", "workspace-governance", workspaceId, generation] as const;
}

export function purgePrivateIdentitySidecars(
  queryClient: QueryClient,
  workspaceId: string,
  generation: number,
) {
  const searchPrefix = ["punks", "punk-search", workspaceId, generation];
  const authorsPrefix = ["punks", "authors", workspaceId, generation];
  void queryClient.cancelQueries({ queryKey: searchPrefix });
  void queryClient.cancelQueries({ queryKey: authorsPrefix });
  const searchKeys = queryClient
    .getQueriesData({ queryKey: searchPrefix })
    .map(([key]) => key);
  const authorKeys = queryClient
    .getQueriesData({ queryKey: authorsPrefix })
    .map(([key]) => key);
  notifyManager.batch(() => {
    for (const key of searchKeys) {
      queryClient.setQueryData(key, { pages: [], pageParams: [] });
    }
    for (const key of authorKeys) queryClient.setQueryData(key, []);
  });
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function mutationMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The Workspace authority did not accept this action.";
}

export function parseWorkspaceInvitationInput(
  value: string,
  origin: string,
): string | null {
  const candidate = value.trim();
  const codePattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/u;
  if (codePattern.test(candidate)) return candidate;
  try {
    const url = new URL(candidate);
    const expectedOrigin = new URL(origin).origin;
    if (
      url.origin !== expectedOrigin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    const match = url.pathname.match(/^\/invite\/([^/]+)\/?$/u);
    const code = match?.[1] ? decodeURIComponent(match[1]) : "";
    return codePattern.test(code) ? code : null;
  } catch {
    return null;
  }
}

function MemberRow({
  canManage,
  member,
  name,
  ownerPunkId,
  pending,
  revision,
  onRemove,
  onRole,
  onTransfer,
}: {
  canManage: boolean;
  member: WorkspaceGovernanceResponse["members"][number];
  name: string;
  ownerPunkId: string;
  pending: boolean;
  revision: number;
  onRemove(targetPunkId: string, expectedRevision: number): void;
  onRole(
    targetPunkId: string,
    role: Exclude<WorkspaceRole, "owner">,
    expectedRevision: number,
  ): void;
  onTransfer(targetPunkId: string, name: string): void;
}) {
  const primaryOwner = member.punkId === ownerPunkId;
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {primaryOwner ? "Primary Owner" : roleLabels[member.role]}
        </p>
      </div>
      {canManage && !primaryOwner ? (
        <>
          <label className="sr-only" htmlFor={`punks-role-${member.punkId}`}>
            Role for {name}
          </label>
          <select
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            disabled={pending}
            id={`punks-role-${member.punkId}`}
            onChange={(event) => {
              const role = event.target.value;
              if (
                role === "moderator" ||
                role === "member" ||
                role === "guest"
              ) {
                onRole(member.punkId, role, revision);
              }
            }}
            value={member.role}
          >
            {member.role === "owner" ? (
              <option disabled value="owner">
                Owner
              </option>
            ) : null}
            <option value="moderator">Moderator</option>
            <option value="member">Member</option>
            <option value="guest">Guest</option>
          </select>
          <button
            className="rounded-md border border-destructive/50 px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
            disabled={pending}
            onClick={() => onRemove(member.punkId, revision)}
            type="button"
          >
            Remove
          </button>
          <button
            className="rounded-md border border-border px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            disabled={pending}
            onClick={() => onTransfer(member.punkId, name)}
            type="button"
          >
            Transfer ownership
          </button>
        </>
      ) : null}
    </li>
  );
}

function TransferOwnershipDialog({
  candidate,
  method,
  onClose,
  onConfirm,
  onMethod,
  onReauthenticate,
  pending,
  reauthenticated,
}: {
  candidate: { punkId: string; name: string } | null;
  method: AuthenticationMethod;
  onClose(): void;
  onConfirm(): void;
  onMethod(method: AuthenticationMethod): void;
  onReauthenticate(): void;
  pending: boolean;
  reauthenticated: boolean;
}) {
  const [confirmation, setConfirmation] = useState("");
  const confirmed = candidate !== null && confirmation === candidate.name;
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          setConfirmation("");
          onClose();
        }
      }}
      open={candidate !== null}
    >
      <DialogContent className="max-w-md border border-border p-5">
        <DialogTitle>Transfer Workspace ownership</DialogTitle>
        <DialogDescription className="mt-1">
          This atomically makes {candidate?.name ?? "the selected Punk"} the
          primary Owner and changes your role to Member.
        </DialogDescription>
        <label className="mt-4 grid gap-1 text-sm">
          Reauthentication method
          <select
            className="rounded-md border border-border bg-background px-2 py-2"
            disabled={pending}
            onChange={(event) =>
              onMethod(event.target.value as AuthenticationMethod)
            }
            value={method}
          >
            <option value="passkey">Passkey</option>
            <option value="google">Google</option>
            <option value="github">GitHub</option>
          </select>
        </label>
        <label className="mt-4 grid gap-1 text-sm">
          Type {candidate?.name ?? "the Punk name"} to confirm
          <input
            autoComplete="off"
            className="rounded-md border border-border bg-background px-3 py-2"
            disabled={pending}
            onChange={(event) => setConfirmation(event.target.value)}
            value={confirmation}
          />
        </label>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
            disabled={!confirmed || pending || reauthenticated}
            onClick={onReauthenticate}
            type="button"
          >
            {reauthenticated ? "Reauthenticated" : "Reauthenticate"}
          </button>
          <button
            className="rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground disabled:opacity-50"
            disabled={!confirmed || !reauthenticated || pending}
            onClick={onConfirm}
            type="button"
          >
            Transfer ownership
          </button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground" role="status">
          {reauthenticated
            ? "Fresh authorization confirmed. Review the target, then transfer."
            : "A fresh browser or passkey reauthentication is required."}
        </p>
      </DialogContent>
    </Dialog>
  );
}

function IssuedInvitation({
  origin,
  result,
  onRevoke,
  pending,
}: {
  origin: string;
  result: CreateWorkspaceInvitationResponse;
  onRevoke(): void;
  pending: boolean;
}) {
  const link = `${new URL(origin).origin}/invite/${encodeURIComponent(result.code)}`;
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
      <p className="text-sm font-medium">Invitation ready</p>
      <code className="block break-all text-xs">{result.code}</code>
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-md border border-border px-2 py-1.5 text-sm hover:bg-accent"
          onClick={() => void navigator.clipboard.writeText(result.code)}
          type="button"
        >
          Copy code
        </button>
        <button
          className="rounded-md border border-border px-2 py-1.5 text-sm hover:bg-accent"
          onClick={() => void navigator.clipboard.writeText(link)}
          type="button"
        >
          Copy link
        </button>
        <button
          className="rounded-md border border-destructive/50 px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
          disabled={pending || result.invitation.status === "revoked"}
          onClick={onRevoke}
          type="button"
        >
          Revoke
        </button>
      </div>
    </div>
  );
}

function WorkspaceGovernanceDialog() {
  const account = usePunksAccount();
  const { manager, scope } = usePunksWorkspace();
  const queryClient = useQueryClient();
  const [inviteRole, setInviteRole] = useState<"member" | "guest">("member");
  const [issued, setIssued] =
    useState<CreateWorkspaceInvitationResponse | null>(null);
  const [transferCandidate, setTransferCandidate] = useState<{
    punkId: string;
    name: string;
  } | null>(null);
  const [reauthenticationMethod, setReauthenticationMethod] =
    useState<AuthenticationMethod>("passkey");
  const [transferReauthenticated, setTransferReauthenticated] = useState(false);
  const reauthenticationGeneration = useRef(0);
  const [lifecycleNotice, setLifecycleNotice] = useState<string | null>(null);
  const key = governanceKey(scope.lease.workspaceId, scope.lease.generation);
  const governanceQuery = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      manager.run(scope, () =>
        scope.session.getGovernancePage({ limit: 100, cursor: pageParam }),
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    refetchOnWindowFocus: true,
  });
  const governance = governanceQuery.data?.pages[0]?.workspace;
  const members =
    governanceQuery.data?.pages.flatMap((page) => page.members) ?? [];
  const summariesQuery = useQuery({
    queryKey: [...key, "summaries", ...members.map((member) => member.punkId)],
    enabled: governance !== undefined,
    queryFn: async () => {
      const pages = await Promise.all(
        chunks(
          members.map((member) => member.punkId),
          100,
        ).map((punkIds) =>
          manager.run(scope, () => scope.session.getPunkSummaries(punkIds)),
        ),
      );
      return pages.flatMap((page) => page.items);
    },
  });
  const summaries = useMemo(
    () =>
      new Map<string, PunkPublicSummary>(
        (summariesQuery.data ?? []).map((summary) => [summary.punkId, summary]),
      ),
    [summariesQuery.data],
  );
  const canManage = governance?.ownerPunkId === scope.lease.punkId;
  const createMutation = useMutation({
    mutationFn: () => {
      if (governance === undefined)
        throw new Error("Workspace roster is loading");
      return manager.run(scope, () =>
        scope.session.createInvitation({
          role: inviteRole,
          expectedRevision: governance.revision,
          ttlSeconds: 7 * 24 * 60 * 60,
          maxUses: 1,
        }),
      );
    },
    retry: false,
    onSuccess: setIssued,
  });
  const revokeMutation = useMutation({
    mutationFn: () => {
      if (issued === null || governance === undefined) {
        throw new Error("Invitation is unavailable");
      }
      return manager.run(scope, () =>
        scope.session.revokeInvitation({
          invitationId: issued.invitation.invitationId,
          expectedRevision: governance.revision,
        }),
      );
    },
    retry: false,
    onSuccess: (response) => {
      setIssued((current) =>
        current === null
          ? null
          : { ...current, invitation: response.invitation },
      );
    },
  });
  const roleMutation = useMutation({
    mutationFn: (input: {
      targetPunkId: string;
      role: "moderator" | "member" | "guest";
      expectedRevision: number;
    }) => manager.run(scope, () => scope.session.setMemberRole(input)),
    retry: false,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const removeMutation = useMutation({
    mutationFn: (input: { targetPunkId: string; expectedRevision: number }) =>
      manager.run(scope, () => scope.session.removeMember(input)),
    retry: false,
    onSuccess: async () => {
      purgePrivateIdentitySidecars(
        queryClient,
        scope.lease.workspaceId,
        scope.lease.generation,
      );
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const reauthenticationMutation = useMutation({
    mutationFn: async () => {
      const attempt = reauthenticationGeneration.current + 1;
      reauthenticationGeneration.current = attempt;
      setTransferReauthenticated(false);
      await account.client.startReauthentication(
        reauthenticationMethod,
        "transfer_workspace_ownership",
      );
      for (let poll = 0; poll < 800; poll += 1) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 750);
        });
        if (reauthenticationGeneration.current !== attempt) {
          throw new Error("Ownership reauthentication was cancelled");
        }
        const state = await account.client.getAccountSessionState();
        const phase = state.authentication.phase;
        if (phase === "confirmed") return;
        if (phase === "cancelled" || phase === "expired") {
          throw new Error("Ownership reauthentication was not completed");
        }
        if (phase === "failed") {
          throw new Error("Ownership reauthentication failed");
        }
      }
      throw new Error("Ownership reauthentication timed out");
    },
    retry: false,
    onSuccess: () => {
      setTransferReauthenticated(true);
      setLifecycleNotice(
        "Fresh reauthentication confirmed. Review and confirm the transfer.",
      );
    },
  });
  const transferMutation = useMutation({
    mutationFn: () => {
      if (governance === undefined || transferCandidate === null) {
        throw new Error("Ownership transfer is unavailable");
      }
      return manager.run(scope, () =>
        scope.session.transferOwnership({
          targetPunkId: transferCandidate.punkId,
          expectedRevision: governance.revision,
        }),
      );
    },
    retry: false,
    onSuccess: async () => {
      reauthenticationGeneration.current += 1;
      setTransferCandidate(null);
      setTransferReauthenticated(false);
      setLifecycleNotice("Workspace ownership transferred.");
      queryClient.removeQueries({ queryKey: key });
      await account.refresh();
    },
    onError: () => setTransferReauthenticated(false),
  });
  const pending =
    createMutation.isPending ||
    revokeMutation.isPending ||
    roleMutation.isPending ||
    removeMutation.isPending ||
    reauthenticationMutation.isPending ||
    transferMutation.isPending;
  const error =
    createMutation.error ??
    revokeMutation.error ??
    roleMutation.error ??
    removeMutation.error ??
    reauthenticationMutation.error ??
    transferMutation.error;

  return (
    <DialogContent className="max-h-[90dvh] overflow-y-auto border border-border p-5">
      <div>
        <DialogTitle>Members and invitations</DialogTitle>
        <DialogDescription className="mt-1">
          Roles are enforced by the Workspace authority.
        </DialogDescription>
      </div>

      {governanceQuery.isPending ? (
        <p className="mt-5 text-sm text-muted-foreground">Loading roster…</p>
      ) : governanceQuery.isError || governance === undefined ? (
        <p className="mt-5 text-sm text-destructive" role="alert">
          The Workspace roster is unavailable.
        </p>
      ) : (
        <>
          {canManage ? (
            <div className="mt-5 space-y-3 rounded-lg border border-border p-4">
              <h3 className="text-sm font-semibold">Issue an invitation</h3>
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-sm">
                  Promised role
                  <select
                    className="rounded-md border border-border bg-background px-2 py-1.5"
                    disabled={pending}
                    onChange={(event) =>
                      setInviteRole(event.target.value as "member" | "guest")
                    }
                    value={inviteRole}
                  >
                    <option value="member">Member</option>
                    <option value="guest">Guest</option>
                  </select>
                </label>
                <button
                  className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
                  disabled={pending}
                  onClick={() => createMutation.mutate()}
                  type="button"
                >
                  Create invitation
                </button>
              </div>
              {issued !== null ? (
                <IssuedInvitation
                  onRevoke={() => revokeMutation.mutate()}
                  origin={
                    account.compatibility?.origin ?? window.location.origin
                  }
                  pending={pending}
                  result={issued}
                />
              ) : null}
            </div>
          ) : null}

          <ul className="mt-5 space-y-2">
            {members.map((member) => (
              <MemberRow
                canManage={canManage}
                key={member.punkId}
                member={member}
                name={summaries.get(member.punkId)?.displayName ?? "Punk"}
                onRemove={(targetPunkId, expectedRevision) =>
                  removeMutation.mutate({ targetPunkId, expectedRevision })
                }
                onRole={(targetPunkId, role, expectedRevision) =>
                  roleMutation.mutate({
                    targetPunkId,
                    role,
                    expectedRevision,
                  })
                }
                onTransfer={(punkId, name) => {
                  setLifecycleNotice(null);
                  setTransferReauthenticated(false);
                  setTransferCandidate({ punkId, name });
                }}
                ownerPunkId={governance.ownerPunkId}
                pending={pending}
                revision={governance.revision}
              />
            ))}
          </ul>
          {governanceQuery.hasNextPage ? (
            <button
              className="mt-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
              disabled={governanceQuery.isFetchingNextPage}
              onClick={() => void governanceQuery.fetchNextPage()}
              type="button"
            >
              {governanceQuery.isFetchingNextPage
                ? "Loading members…"
                : `Load more members (${members.length}/${governance.memberCount})`}
            </button>
          ) : null}
        </>
      )}
      <TransferOwnershipDialog
        candidate={transferCandidate}
        method={reauthenticationMethod}
        onClose={() => {
          reauthenticationGeneration.current += 1;
          setTransferCandidate(null);
          setTransferReauthenticated(false);
          if (reauthenticationMutation.isPending) {
            void account.client.cancelAuthentication().catch(() => undefined);
          }
        }}
        onConfirm={() => transferMutation.mutate()}
        onMethod={(method) => {
          setReauthenticationMethod(method);
          setTransferReauthenticated(false);
        }}
        onReauthenticate={() => reauthenticationMutation.mutate()}
        pending={pending}
        reauthenticated={transferReauthenticated}
      />
      {lifecycleNotice !== null ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          {lifecycleNotice}
        </p>
      ) : null}
      {error !== null ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {mutationMessage(error)}
        </p>
      ) : null}
    </DialogContent>
  );
}

export function WorkspaceGovernanceLauncher() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          className="w-full rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent/60"
          data-testid="punks-open-governance"
          type="button"
        >
          Members and invitations
        </button>
      </DialogTrigger>
      <WorkspaceGovernanceDialog />
    </Dialog>
  );
}

function WorkspaceDepartureLauncher() {
  const account = usePunksAccount();
  const { manager, scope, workspace } = usePunksWorkspace();
  const [confirmation, setConfirmation] = useState("");
  const isPrimaryOwner = workspace.role === "owner";
  const departure = useMutation({
    mutationFn: () => manager.run(scope, () => scope.session.leaveWorkspace()),
    retry: false,
    onSuccess: async () => {
      account.localStore?.clearLastWorkspaceId();
      account.localStore?.clearRouteCoordinates();
      await account.navigate({ kind: "home" }, true);
      await account.refresh();
    },
  });
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) setConfirmation("");
      }}
    >
      <DialogTrigger asChild>
        <button
          className="w-full rounded-md border border-destructive/40 px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
          data-testid="punks-open-workspace-departure"
          type="button"
        >
          Leave Workspace
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md border border-border p-5">
        <DialogTitle>Leave {workspace.name}</DialogTitle>
        <DialogDescription className="mt-1">
          {isPrimaryOwner
            ? "Transfer ownership before leaving this Workspace."
            : "Access, live updates and cached Workspace data are removed immediately."}
        </DialogDescription>
        {!isPrimaryOwner ? (
          <label className="mt-4 grid gap-1 text-sm">
            Type {workspace.name} to confirm
            <input
              autoComplete="off"
              className="rounded-md border border-border bg-background px-3 py-2"
              disabled={departure.isPending}
              onChange={(event) => setConfirmation(event.target.value)}
              value={confirmation}
            />
          </label>
        ) : null}
        <button
          className="mt-5 rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground disabled:opacity-50"
          data-testid="punks-confirm-workspace-departure"
          disabled={
            isPrimaryOwner ||
            confirmation !== workspace.name ||
            departure.isPending
          }
          onClick={() => departure.mutate()}
          type="button"
        >
          {departure.isPending ? "Leaving…" : "Leave Workspace"}
        </button>
        {departure.error !== null ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {mutationMessage(departure.error)}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function WorkspaceAccessLaunchers() {
  const { workspace } = usePunksWorkspace();
  return (
    <>
      {workspace.role === "owner" ? <WorkspaceGovernanceLauncher /> : null}
      <WorkspaceDepartureLauncher />
    </>
  );
}

export function InvitationClaimGate() {
  const account = usePunksAccount();
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<WorkspaceInvitationView | null>(null);
  const [pending, setPending] = useState<"preview" | "claim" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const origin = account.compatibility?.origin ?? window.location.origin;
  const code = parseWorkspaceInvitationInput(input, origin);
  const review = async () => {
    if (code === null) return;
    setPending("preview");
    setError(null);
    try {
      setPreview(await account.client.getWorkspaceInvitation(code));
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(null);
    }
  };
  const claim = async () => {
    if (code === null || preview === null) return;
    setPending("claim");
    setError(null);
    try {
      await account.client.claimWorkspaceInvitation({
        code,
        expectedRevision: preview.workspaceRevision,
      });
      await account.refresh();
    } catch (failure) {
      setError(failure);
      setPending(null);
    }
  };

  return (
    <section className="w-full max-w-md space-y-4 rounded-xl border border-border bg-background p-5">
      <div>
        <h1 className="text-lg font-semibold">Join a Workspace</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste the invitation code or its Punks link.
        </p>
      </div>
      <label className="grid gap-1 text-sm" htmlFor="punks-invitation-input">
        Invitation
        <input
          className="rounded-md border border-border bg-background px-3 py-2"
          id="punks-invitation-input"
          onChange={(event) => {
            setInput(event.target.value);
            setPreview(null);
            setError(null);
          }}
          value={input}
        />
      </label>
      <button
        className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
        disabled={pending !== null || code === null}
        onClick={() => void review()}
        type="button"
      >
        Review invitation
      </button>
      {preview !== null ? (
        <div className="space-y-2 rounded-md bg-muted/40 p-3">
          <p className="text-sm font-medium">{preview.workspace.name}</p>
          <p className="text-sm text-muted-foreground">
            Role: {roleLabels[preview.role]} · Status: {preview.status}
          </p>
          <button
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
            disabled={pending !== null || preview.status !== "issued"}
            onClick={() => void claim()}
            type="button"
          >
            Accept invitation
          </button>
        </div>
      ) : null}
      {error !== null ? (
        <p className="text-sm text-destructive" role="alert">
          {mutationMessage(error)}
        </p>
      ) : null}
    </section>
  );
}
