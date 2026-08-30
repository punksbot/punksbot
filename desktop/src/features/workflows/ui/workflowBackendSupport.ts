export function workflowBackendSupportWarning(
  action: string,
  fullLocal: boolean,
): string | null {
  if (fullLocal) return null;
  switch (action) {
    case "send_dm":
      return "Backend note: `send_dm` is not executed yet, so runs fail at this step.";
    case "set_channel_topic":
      return "Backend note: `set_channel_topic` is not executed yet, so runs fail at this step.";
    case "request_approval":
      return "Backend note: approval gates still stop runs with WF-08; approval records are not persisted yet.";
    default:
      return null;
  }
}
