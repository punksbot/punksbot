import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import type {
  CreateWorkspaceInvitationResponse,
  PunkPublicSummary,
  Workspace,
  WorkspaceInvitationView,
} from "@punks/contracts";
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
}: {
  canManage: boolean;
  member: Workspace["members"][number];
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
        </>
      ) : null}
    </li>
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
  const key = governanceKey(scope.lease.workspaceId, scope.lease.generation);
  const governanceQuery = useQuery({
    queryKey: key,
    queryFn: () => manager.run(scope, () => scope.session.getGovernance()),
    refetchOnWindowFocus: true,
  });
  const governance = governanceQuery.data;
  const summariesQuery = useQuery({
    queryKey: [
      ...key,
      "summaries",
      ...(governance?.members.map((member) => member.punkId) ?? []),
    ],
    enabled: governance !== undefined,
    queryFn: async () => {
      if (governance === undefined) return [];
      const pages = await Promise.all(
        chunks(
          governance.members.map((member) => member.punkId),
          100,
        ).map((punkIds) =>
          manager.run(scope, () => scope.session.getPunkSummaries(punkIds)),
        ),
      );
      return pages.flat();
    },
  });
  const summaries = useMemo(
    () =>
      new Map<string, PunkPublicSummary>(
        (summariesQuery.data ?? []).map((summary) => [summary.punkId, summary]),
      ),
    [summariesQuery.data],
  );
  const currentRole = governance?.members.find(
    (member) => member.punkId === scope.lease.punkId,
  )?.role;
  const canManage = currentRole === "owner";

  const updateGovernance = (workspace: Workspace) => {
    queryClient.setQueryData(key, workspace);
  };
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
    onSuccess: (response) => updateGovernance(response.workspace),
  });
  const removeMutation = useMutation({
    mutationFn: (input: { targetPunkId: string; expectedRevision: number }) =>
      manager.run(scope, () => scope.session.removeMember(input)),
    retry: false,
    onSuccess: (response) => updateGovernance(response.workspace),
  });
  const pending =
    createMutation.isPending ||
    revokeMutation.isPending ||
    roleMutation.isPending ||
    removeMutation.isPending;
  const error =
    createMutation.error ??
    revokeMutation.error ??
    roleMutation.error ??
    removeMutation.error;

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
            {governance.members.map((member) => (
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
                ownerPunkId={governance.ownerPunkId}
                pending={pending}
                revision={governance.revision}
              />
            ))}
          </ul>
        </>
      )}
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

export function InvitationClaimGate() {
  const account = usePunksAccount();
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<WorkspaceInvitationView | null>(null);
  const origin = account.compatibility?.origin ?? window.location.origin;
  const code = parseWorkspaceInvitationInput(input, origin);
  const previewMutation = useMutation({
    mutationFn: () => {
      if (code === null)
        throw new Error("Enter a valid invitation code or link");
      return account.client.getWorkspaceInvitation(code);
    },
    retry: false,
    onSuccess: setPreview,
  });
  const claimMutation = useMutation({
    mutationFn: () => {
      if (code === null || preview === null) {
        throw new Error("Review the invitation before accepting it");
      }
      return account.client.claimWorkspaceInvitation({
        code,
        expectedRevision: preview.workspaceRevision,
      });
    },
    retry: false,
    onSuccess: async () => {
      await account.refresh();
    },
  });
  const error = previewMutation.error ?? claimMutation.error;

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
          }}
          value={input}
        />
      </label>
      <button
        className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
        disabled={previewMutation.isPending || code === null}
        onClick={() => previewMutation.mutate()}
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
            disabled={claimMutation.isPending || preview.status !== "issued"}
            onClick={() => claimMutation.mutate()}
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
