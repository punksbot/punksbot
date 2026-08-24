import { useState } from "react";

import type { MessageView } from "@punks/contracts";

export type MessageLifecycleActions = {
  canEdit: boolean;
  canRetract: boolean;
  canRestore: boolean;
  topicRequired?: boolean;
  pending?: boolean;
  onEdit(content: string, topic: string | null): Promise<void>;
  onRetract(): Promise<void>;
  onRestore(): Promise<void>;
};

export function MessageLifecycleControls({
  actions,
  message,
}: {
  actions: MessageLifecycleActions | null;
  message: MessageView;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState("");
  const [topic, setTopic] = useState("");
  const [failure, setFailure] = useState(false);

  if (actions === null) return null;

  const pending = actions.pending === true;
  const active = message.status === "active";
  const startEditing = () => {
    setContent(message.content ?? "");
    setTopic(message.topic ?? "");
    setFailure(false);
    setEditing(true);
  };
  const saveEdit = async () => {
    if (!content.trim() || (actions.topicRequired && !topic.trim()) || pending)
      return;
    setFailure(false);
    try {
      await actions.onEdit(content.trim(), topic.trim() || null);
      setEditing(false);
    } catch {
      setFailure(true);
    }
  };
  const retract = async () => {
    if (pending) return;
    setFailure(false);
    try {
      await actions.onRetract();
      setEditing(false);
    } catch {
      setFailure(true);
    }
  };
  const restore = async () => {
    if (pending) return;
    setFailure(false);
    try {
      await actions.onRestore();
    } catch {
      setFailure(true);
    }
  };

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3 text-sm">
      {editing && actions.canEdit && active ? (
        <div className="space-y-2" data-testid={`punks-edit-${message.id}`}>
          <label
            className="block text-xs text-muted-foreground"
            htmlFor={`punks-edit-content-${message.id}`}
          >
            Edit Message
          </label>
          <textarea
            className="min-h-16 w-full resize-y rounded-md border border-border bg-background p-2 text-message outline-none focus:ring-2 focus:ring-primary"
            disabled={pending}
            id={`punks-edit-content-${message.id}`}
            onChange={(event) => setContent(event.target.value)}
            value={content}
          />
          <label
            className="block text-xs text-muted-foreground"
            htmlFor={`punks-edit-topic-${message.id}`}
          >
            {actions.topicRequired
              ? "Subject required for this Stream"
              : "Subject (optional)"}
          </label>
          <input
            className="w-full rounded-md border border-border bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            disabled={pending}
            id={`punks-edit-topic-${message.id}`}
            onChange={(event) => setTopic(event.target.value)}
            value={topic}
          />
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-md bg-primary px-2 py-1 text-sm text-primary-foreground disabled:opacity-50"
              data-testid={`punks-save-edit-${message.id}`}
              disabled={
                pending ||
                !content.trim() ||
                (actions.topicRequired === true && !topic.trim())
              }
              onClick={() => void saveEdit()}
              type="button"
            >
              {pending ? "Saving…" : "Save edit"}
            </button>
            <button
              className="rounded-md border border-border px-2 py-1 text-sm hover:bg-accent disabled:opacity-50"
              disabled={pending}
              onClick={() => setEditing(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {active && !editing && actions.canEdit ? (
        <button
          className="rounded-md border border-border px-2 py-1 text-sm hover:bg-accent disabled:opacity-50"
          data-testid={`punks-start-edit-${message.id}`}
          disabled={pending}
          onClick={startEditing}
          type="button"
        >
          Edit
        </button>
      ) : null}
      {active && actions.canRetract ? (
        <button
          className="rounded-md border border-border px-2 py-1 text-sm hover:bg-accent disabled:opacity-50"
          data-testid={`punks-retract-${message.id}`}
          disabled={pending}
          onClick={() => void retract()}
          type="button"
        >
          {pending ? "Retracting…" : "Retract"}
        </button>
      ) : null}
      {!active && message.status === "retracted" && actions.canRestore ? (
        <button
          className="rounded-md border border-border px-2 py-1 text-sm hover:bg-accent disabled:opacity-50"
          data-testid={`punks-restore-${message.id}`}
          disabled={pending}
          onClick={() => void restore()}
          type="button"
        >
          {pending ? "Restoring…" : "Restore"}
        </button>
      ) : null}
      {failure ? (
        <p className="text-xs text-destructive" role="alert">
          The Message lifecycle action was not accepted. Check the Stream state
          and try again.
        </p>
      ) : null}
    </div>
  );
}
