import { invokeTauri } from "@/shared/api/tauri";

export type LocalAccountInfo = {
  id: string;
  pubkey: string;
  displayName: string;
  mergedInto: string | null;
  active: boolean;
  generation: number;
};

export function listLocalAccounts(): Promise<LocalAccountInfo[]> {
  return invokeTauri<LocalAccountInfo[]>("punks_local_list_accounts");
}

export function createLocalAccount(
  displayName: string,
): Promise<LocalAccountInfo> {
  return invokeTauri<LocalAccountInfo>("punks_local_create_account", {
    displayName,
  });
}

export function switchLocalAccount(
  accountId: string,
  expectedGeneration: number,
): Promise<LocalAccountInfo> {
  return invokeTauri<LocalAccountInfo>("punks_local_switch_account", {
    accountId,
    expectedGeneration,
  });
}

export function mergeLocalAccounts(
  sourceAccountId: string,
  targetAccountId: string,
): Promise<LocalAccountInfo[]> {
  return invokeTauri<LocalAccountInfo[]>("punks_local_merge_accounts", {
    sourceAccountId,
    targetAccountId,
  });
}

export function renameLocalAccount(
  accountId: string,
  displayName: string,
  expectedGeneration: number,
): Promise<LocalAccountInfo[]> {
  return invokeTauri<LocalAccountInfo[]>("punks_local_rename_account", {
    accountId,
    displayName,
    expectedGeneration,
  });
}

export function deleteLocalAccount(
  accountId: string,
  expectedGeneration: number,
): Promise<LocalAccountInfo[]> {
  return invokeTauri<LocalAccountInfo[]>("punks_local_delete_account", {
    accountId,
    expectedGeneration,
  });
}

export function importLocalAccount(input: {
  displayName: string;
  password: string;
}): Promise<LocalAccountInfo | null> {
  return invokeTauri<LocalAccountInfo | null>(
    "punks_local_import_account",
    input,
  );
}

export function exportLocalAccount(
  accountId: string,
  password: string,
): Promise<string | null> {
  return invokeTauri<string | null>("punks_local_export_account", {
    accountId,
    password,
  });
}
