export const MESSAGE_SEARCH_ALGORITHM = "hmac-sha256-conversation-v2" as const;
export const MESSAGE_SEARCH_NORMALIZATION =
  "unicode-nfkc-lowercase-letters-numbers-v1" as const;

export interface MessageSearchText {
  workspaceId: string;
  conversationId: string;
  plaintext: string;
}

export interface MessageSearchTokens {
  algorithm: typeof MESSAGE_SEARCH_ALGORITHM;
  tokens: string[];
}

export interface MessageSearchPlaintextDocument {
  content: string;
  topic: string | null;
}

const tokenPattern = /[\p{L}\p{N}]+/gu;
const MESSAGE_SEARCH_DOCUMENT_MAX_TOKENS = 1_024;
const MESSAGE_SEARCH_QUERY_MAX_TOKENS = 32;
const base64Alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64Url(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const word = (first << 16) | (second << 8) | third;
    output += base64Alphabet[(word >> 18) & 63];
    output += base64Alphabet[(word >> 12) & 63];
    output += index + 1 < bytes.length ? base64Alphabet[(word >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? base64Alphabet[word & 63] : "=";
  }
  return output.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function lexicalTerms(plaintext: string, maximum: number): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  const normalized = plaintext.normalize("NFKC").toLowerCase();
  for (const match of normalized.matchAll(tokenPattern)) {
    const term = match[0];
    if (seen.has(term)) {
      continue;
    }
    seen.add(term);
    terms.push(term);
    if (terms.length === maximum) {
      break;
    }
  }
  return terms;
}

async function derive(
  input: MessageSearchText,
  masterKey: Uint8Array,
  terms: string[],
): Promise<MessageSearchTokens> {
  if (input.workspaceId.trim().length === 0) {
    throw new Error("Workspace scope is required");
  }
  if (input.conversationId.trim().length === 0) {
    throw new Error("Conversation scope is required");
  }
  if (masterKey.byteLength < 32) {
    throw new Error("Message search master key must contain at least 32 bytes");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(masterKey).buffer,
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const encoder = new TextEncoder();
  const tokens: string[] = [];
  for (const term of terms) {
    const payload = encoder.encode(
      `punks.message-search.conversation.v2\u0000${input.workspaceId}\u0000${input.conversationId}\u0000${term}`,
    );
    const signature = await crypto.subtle.sign("HMAC", key, payload);
    tokens.push(`h2_${base64Url(new Uint8Array(signature))}`);
  }

  return { algorithm: MESSAGE_SEARCH_ALGORITHM, tokens };
}

export function deriveMessageSearchDocument(
  input: MessageSearchText,
  masterKey: Uint8Array,
): Promise<MessageSearchTokens> {
  return derive(
    input,
    masterKey,
    lexicalTerms(input.plaintext, MESSAGE_SEARCH_DOCUMENT_MAX_TOKENS),
  );
}

export async function deriveMessageSearchQuery(
  input: MessageSearchText,
  masterKey: Uint8Array,
): Promise<MessageSearchTokens> {
  const terms = lexicalTerms(
    input.plaintext,
    MESSAGE_SEARCH_QUERY_MAX_TOKENS + 1,
  );
  if (terms.length < 1 || terms.length > MESSAGE_SEARCH_QUERY_MAX_TOKENS) {
    throw new Error(
      "Message search query must contain between 1 and 32 unique terms",
    );
  }
  return derive(input, masterKey, terms);
}

/**
 * Revalidates a D1 candidate against the current decrypted version without
 * producing tokens or persisting normalized plaintext.
 */
export function messageSearchPlaintextMatchesQuery(
  document: MessageSearchPlaintextDocument,
  query: string,
): boolean {
  if (
    typeof document.content !== "string" ||
    (document.topic !== null && typeof document.topic !== "string") ||
    typeof query !== "string"
  ) {
    return false;
  }
  const queryTerms = lexicalTerms(query, MESSAGE_SEARCH_QUERY_MAX_TOKENS + 1);
  if (
    queryTerms.length < 1 ||
    queryTerms.length > MESSAGE_SEARCH_QUERY_MAX_TOKENS
  ) {
    return false;
  }
  const documentTerms = new Set(
    lexicalTerms(
      document.topic === null
        ? document.content
        : `${document.content}\u0000${document.topic}`,
      MESSAGE_SEARCH_DOCUMENT_MAX_TOKENS,
    ),
  );
  return queryTerms.every((term) => documentTerms.has(term));
}
