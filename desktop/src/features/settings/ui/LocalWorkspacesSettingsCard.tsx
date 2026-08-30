import * as React from "react";
import {
  Archive,
  ArchiveRestore,
  LoaderCircle,
  Pencil,
  Plus,
} from "lucide-react";

import { useCommunities } from "@/features/communities/useCommunities";
import {
  createLocalWorkspace,
  listLocalWorkspaces,
  type LocalWorkspaceInfo,
  renameLocalWorkspace,
  setLocalWorkspaceArchived,
} from "@/shared/api/tauriLocalWorkspaces";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

export function LocalWorkspacesSettingsCard() {
  const communities = useCommunities();
  const [workspaces, setWorkspaces] = React.useState<LocalWorkspaceInfo[]>([]);
  const [newName, setNewName] = React.useState("");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editingName, setEditingName] = React.useState("");
  const [action, setAction] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    setWorkspaces(await listLocalWorkspaces());
  }, []);

  React.useEffect(() => {
    let active = true;
    void reload().catch((cause) => {
      if (active)
        setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      active = false;
    };
  }, [reload]);

  const run = React.useCallback(
    async (label: string, operation: () => Promise<void>) => {
      setAction(label);
      setError(null);
      try {
        await operation();
        await reload();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setAction(null);
      }
    },
    [reload],
  );

  async function create(event: React.FormEvent) {
    event.preventDefault();
    await run("create", async () => {
      const workspace = await createLocalWorkspace(newName);
      communities.addCommunity(toCommunity(workspace));
      setNewName("");
    });
  }

  async function saveRename(workspace: LocalWorkspaceInfo) {
    await run(`rename:${workspace.id}`, async () => {
      const renamed = await renameLocalWorkspace(workspace.id, editingName);
      communities.updateCommunity(workspace.id, { name: renamed.name });
      setEditingId(null);
      setEditingName("");
    });
  }

  async function archive(workspace: LocalWorkspaceInfo) {
    await run(`archive:${workspace.id}`, async () => {
      await setLocalWorkspaceArchived(workspace.id, true);
      communities.removeCommunity(workspace.id);
    });
  }

  async function restore(workspace: LocalWorkspaceInfo) {
    await run(`restore:${workspace.id}`, async () => {
      const restored = await setLocalWorkspaceArchived(workspace.id, false);
      communities.addCommunity(toCommunity(restored));
    });
  }

  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        description="Persistent, isolated local authorities for conversations, media, Git and automation."
        title="Local Workspaces"
      />

      {error ? (
        <div
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <form className="flex gap-2" onSubmit={create}>
        <Input
          disabled={action !== null}
          maxLength={80}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="New Workspace name"
          value={newName}
        />
        <Button disabled={!newName.trim() || action !== null} type="submit">
          {action === "create" ? (
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          Create
        </Button>
      </form>

      <div className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/70">
        {workspaces.map((workspace) => {
          const isActive = communities.activeCommunity?.id === workspace.id;
          const isEditing = editingId === workspace.id;
          const isBusy = action?.endsWith(workspace.id) === true;
          return (
            <div className="space-y-3 bg-card/40 px-4 py-4" key={workspace.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">
                      {workspace.name}
                    </p>
                    {isActive ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-2xs font-medium text-primary">
                        Active
                      </span>
                    ) : null}
                    {workspace.archived ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-2xs text-muted-foreground">
                        Archived
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {workspace.relayUrl}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {!workspace.archived ? (
                    <Button
                      disabled={isBusy}
                      onClick={() => {
                        setEditingId(workspace.id);
                        setEditingName(workspace.name);
                      }}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Pencil className="mr-2 h-3.5 w-3.5" />
                      Rename
                    </Button>
                  ) : null}
                  {workspace.archived ? (
                    <Button
                      disabled={isBusy}
                      onClick={() => void restore(workspace)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <ArchiveRestore className="mr-2 h-3.5 w-3.5" />
                      Restore
                    </Button>
                  ) : (
                    <Button
                      disabled={isActive || isBusy}
                      onClick={() => void archive(workspace)}
                      size="sm"
                      title={
                        isActive
                          ? "Switch to another Workspace before archiving"
                          : undefined
                      }
                      type="button"
                      variant="outline"
                    >
                      <Archive className="mr-2 h-3.5 w-3.5" />
                      Archive
                    </Button>
                  )}
                </div>
              </div>
              {isEditing ? (
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveRename(workspace);
                  }}
                >
                  <Input
                    autoFocus
                    disabled={isBusy}
                    maxLength={80}
                    onChange={(event) => setEditingName(event.target.value)}
                    value={editingName}
                  />
                  <Button
                    disabled={!editingName.trim() || isBusy}
                    size="sm"
                    type="submit"
                  >
                    Save
                  </Button>
                  <Button
                    onClick={() => setEditingId(null)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                </form>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function toCommunity(workspace: LocalWorkspaceInfo) {
  return {
    addedAt: new Date(workspace.createdAt * 1000).toISOString(),
    id: workspace.id,
    name: workspace.name,
    pubkey: workspace.ownerPubkey,
    relayUrl: workspace.relayUrl,
  };
}
