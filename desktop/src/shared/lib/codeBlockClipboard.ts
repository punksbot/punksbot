import { copyTextToSystemClipboard } from "@/shared/api/tauriMedia";

const PUNKS_CODE_BLOCK_ATTRIBUTE = "data-punks-code-block";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function createPunksCodeBlockHtml(code: string) {
  // Keep the code as one text node; the paste reader recovers it via textContent.
  return `<pre ${PUNKS_CODE_BLOCK_ATTRIBUTE}="true"><code>${escapeHtml(code)}</code></pre>`;
}

export async function copyCodeBlockToClipboard(code: string) {
  const clipboard = navigator.clipboard;

  if (
    typeof ClipboardItem !== "undefined" &&
    typeof clipboard?.write === "function"
  ) {
    try {
      await clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([createPunksCodeBlockHtml(code)], {
            type: "text/html",
          }),
          "text/plain": new Blob([code], { type: "text/plain" }),
        }),
      ]);
      return;
    } catch (error) {
      console.warn("Failed to write rich code block clipboard data", error);
    }
  }

  await copyTextToSystemClipboard(code);
}

export function getPunksCodeBlockClipboardText(
  clipboardData: DataTransfer | null | undefined,
) {
  const html = clipboardData?.getData("text/html");
  if (!html?.includes(PUNKS_CODE_BLOCK_ATTRIBUTE)) {
    return null;
  }

  const document = new DOMParser().parseFromString(html, "text/html");
  const code = document.querySelector(`[${PUNKS_CODE_BLOCK_ATTRIBUTE}] code`);
  const fallback = document.querySelector(`[${PUNKS_CODE_BLOCK_ATTRIBUTE}]`);

  return code?.textContent ?? fallback?.textContent ?? null;
}
