import * as React from "react";
import {
  Check,
  Download,
  FileUp,
  Merge,
  Pencil,
  Plus,
  Trash2,
  UsersRound,
} from "lucide-react";

import {
  createLocalAccount,
  deleteLocalAccount,
  exportLocalAccount,
  importLocalAccount,
  listLocalAccounts,
  type LocalAccountInfo,
  mergeLocalAccounts,
  renameLocalAccount,
  switchLocalAccount,
} from "@/shared/api/tauriLocalAccounts";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { MIN_PASSPHRASE_LEN } from "@/features/settings/lib/encryptedBackup";

const ITEM_CLASS =
  "flex min-h-9 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm outline-hidden transition-colors hover:bg-muted/50 focus-visible:bg-muted/50";

export function LocalAccountSwitcher({ onClose }: { onClose(): void }) {
  const [accounts, setAccounts] = React.useState<LocalAccountInfo[]>([]);
  const [displayName, setDisplayName] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [importDraft, setImportDraft] = React.useState<{
    displayName: string;
    password: string;
  } | null>(null);
  const [exportDraft, setExportDraft] = React.useState<{
    account: LocalAccountInfo;
    password: string;
  } | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      setAccounts(await listLocalAccounts());
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = accounts.find((account) => account.active) ?? null;
  const generation = active?.generation ?? accounts[0]?.generation ?? 0;

  async function selectAccount(account: LocalAccountInfo) {
    if (account.active || account.mergedInto) return;
    setPendingId(account.id);
    setError(null);
    try {
      await switchLocalAccount(account.id, generation);
      onClose();
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      await refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    const name = displayName.trim();
    if (!name) return;
    setPendingId("create");
    setError(null);
    try {
      await createLocalAccount(name);
      setDisplayName("");
      setCreating(false);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPendingId(null);
    }
  }

  async function mergeIntoActive(account: LocalAccountInfo) {
    if (!active || account.active || account.mergedInto) return;
    if (
      !window.confirm(
        `Merge ${account.displayName} into ${active.displayName}? The old identity will become an alias.`,
      )
    ) {
      return;
    }
    setPendingId(account.id);
    setError(null);
    try {
      setAccounts(await mergeLocalAccounts(account.id, active.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPendingId(null);
    }
  }

  async function renameAccount(account: LocalAccountInfo) {
    if (account.mergedInto) return;
    const name = window
      .prompt("Rename this local Punk", account.displayName)
      ?.trim();
    if (!name || name === account.displayName) return;
    setPendingId(account.id);
    setError(null);
    try {
      setAccounts(await renameLocalAccount(account.id, name, generation));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      await refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function deleteAccount(account: LocalAccountInfo) {
    if (account.active || account.mergedInto) return;
    if (
      !window.confirm(
        `Delete ${account.displayName} from this installation? Its published content remains in the local authority, but its private key will be removed from the system keychain.`,
      )
    ) {
      return;
    }
    setPendingId(account.id);
    setError(null);
    try {
      setAccounts(await deleteLocalAccount(account.id, generation));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      await refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function importAccount(event: React.FormEvent) {
    event.preventDefault();
    if (!importDraft?.displayName.trim() || !importDraft.password) return;
    setPendingId("import");
    setError(null);
    try {
      const imported = await importLocalAccount({
        displayName: importDraft.displayName.trim(),
        password: importDraft.password,
      });
      if (imported) {
        setImportDraft(null);
        await refresh();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPendingId(null);
    }
  }

  async function exportAccount(event: React.FormEvent) {
    event.preventDefault();
    if (!exportDraft || [...exportDraft.password].length < MIN_PASSPHRASE_LEN) {
      return;
    }
    setPendingId(exportDraft.account.id);
    setError(null);
    try {
      await exportLocalAccount(exportDraft.account.id, exportDraft.password);
      setExportDraft(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section
      aria-label="Local Punks accounts"
      data-testid="local-account-switcher"
    >
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <UsersRound className="size-3.5" aria-hidden="true" />
          Local Punks
        </span>
        <div className="flex items-center gap-0.5">
          <button
            aria-label="Import a local Punk"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => {
              setImportDraft({ displayName: "Imported Punk", password: "" });
              setExportDraft(null);
              setCreating(false);
              setError(null);
            }}
            type="button"
          >
            <FileUp className="size-3.5" aria-hidden="true" />
          </button>
          <button
            aria-label="Create a local Punk"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => {
              setCreating((value) => !value);
              setImportDraft(null);
              setExportDraft(null);
            }}
            type="button"
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {accounts.map((account) => (
        <div className="group/account flex items-center" key={account.id}>
          <button
            className={ITEM_CLASS}
            disabled={pendingId !== null || Boolean(account.mergedInto)}
            onClick={() => void selectAccount(account)}
            role="menuitem"
            type="button"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
              {account.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{account.displayName}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {account.mergedInto
                  ? "Merged identity"
                  : truncatePubkey(account.pubkey)}
              </span>
            </span>
            {account.active ? (
              <Check className="size-4 text-emerald-500" aria-label="Active" />
            ) : null}
          </button>
          {!account.mergedInto ? (
            <div className="mr-2 flex items-center gap-0.5 opacity-0 group-hover/account:opacity-100 focus-within:opacity-100">
              <button
                aria-label={`Rename ${account.displayName}`}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                disabled={pendingId !== null}
                onClick={() => void renameAccount(account)}
                type="button"
              >
                <Pencil className="size-3.5" aria-hidden="true" />
              </button>
              <button
                aria-label={`Export ${account.displayName}`}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                disabled={pendingId !== null}
                onClick={() => {
                  setExportDraft({ account, password: "" });
                  setImportDraft(null);
                  setCreating(false);
                }}
                type="button"
              >
                <Download className="size-3.5" aria-hidden="true" />
              </button>
              {active && !account.active ? (
                <button
                  aria-label={`Merge ${account.displayName} into ${active.displayName}`}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  disabled={pendingId !== null}
                  onClick={() => void mergeIntoActive(account)}
                  type="button"
                >
                  <Merge className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
              {!account.active ? (
                <button
                  aria-label={`Delete ${account.displayName}`}
                  className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  disabled={pendingId !== null}
                  onClick={() => void deleteAccount(account)}
                  type="button"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}

      {creating ? (
        <form className="flex gap-1 px-2 py-1" onSubmit={createAccount}>
          <input
            aria-label="New Punk display name"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-hidden focus:ring-1 focus:ring-ring"
            maxLength={80}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Punk name"
            value={displayName}
          />
          <button
            className="rounded-md border border-border px-2 text-xs hover:bg-muted"
            disabled={!displayName.trim() || pendingId !== null}
            type="submit"
          >
            Create
          </button>
        </form>
      ) : null}
      {importDraft ? (
        <form className="space-y-1 px-2 py-1" onSubmit={importAccount}>
          <input
            aria-label="Imported Punk display name"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-hidden focus:ring-1 focus:ring-ring"
            maxLength={80}
            onChange={(event) =>
              setImportDraft((current) =>
                current
                  ? { ...current, displayName: event.target.value }
                  : null,
              )
            }
            placeholder="Punk name"
            value={importDraft.displayName}
          />
          <div className="flex gap-1">
            <input
              aria-label="Backup passphrase"
              autoComplete="off"
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-hidden focus:ring-1 focus:ring-ring"
              onChange={(event) =>
                setImportDraft((current) =>
                  current ? { ...current, password: event.target.value } : null,
                )
              }
              placeholder="Backup passphrase"
              type="password"
              value={importDraft.password}
            />
            <button
              className="rounded-md border border-border px-2 text-xs hover:bg-muted"
              disabled={
                !importDraft.displayName.trim() ||
                !importDraft.password ||
                pendingId !== null
              }
              type="submit"
            >
              Import
            </button>
          </div>
        </form>
      ) : null}
      {exportDraft ? (
        <form className="space-y-1 px-2 py-1" onSubmit={exportAccount}>
          <p className="text-xs text-muted-foreground">
            Encrypt {exportDraft.account.displayName} with a passphrase.
          </p>
          <div className="flex gap-1">
            <input
              aria-label="Export passphrase"
              autoComplete="new-password"
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-hidden focus:ring-1 focus:ring-ring"
              minLength={MIN_PASSPHRASE_LEN}
              onChange={(event) =>
                setExportDraft((current) =>
                  current ? { ...current, password: event.target.value } : null,
                )
              }
              placeholder={`${MIN_PASSPHRASE_LEN}+ characters`}
              type="password"
              value={exportDraft.password}
            />
            <button
              className="rounded-md border border-border px-2 text-xs hover:bg-muted"
              disabled={
                [...exportDraft.password].length < MIN_PASSPHRASE_LEN ||
                pendingId !== null
              }
              type="submit"
            >
              Save
            </button>
          </div>
        </form>
      ) : null}
      {error ? (
        <p className="px-3 py-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
