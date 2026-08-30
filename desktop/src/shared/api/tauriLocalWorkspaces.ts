import { invokeTauri } from "@/shared/api/tauri";

export type LocalWorkspaceInfo = {
  id: string;
  name: string;
  ownerPubkey: string;
  archived: boolean;
  relayUrl: string;
  createdAt: number;
  updatedAt: number;
};

export function listLocalWorkspaces(): Promise<LocalWorkspaceInfo[]> {
  return invokeTauri<LocalWorkspaceInfo[]>("punks_local_list_workspaces");
}

export function createLocalWorkspace(
  name: string,
): Promise<LocalWorkspaceInfo> {
  return invokeTauri<LocalWorkspaceInfo>("punks_local_create_workspace", {
    name,
  });
}

export function renameLocalWorkspace(
  workspaceId: string,
  name: string,
): Promise<LocalWorkspaceInfo> {
  return invokeTauri<LocalWorkspaceInfo>("punks_local_rename_workspace", {
    workspaceId,
    name,
  });
}

export function setLocalWorkspaceArchived(
  workspaceId: string,
  archived: boolean,
): Promise<LocalWorkspaceInfo> {
  return invokeTauri<LocalWorkspaceInfo>("punks_local_set_workspace_archived", {
    workspaceId,
    archived,
  });
}
