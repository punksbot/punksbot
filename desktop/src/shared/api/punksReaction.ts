import { PunksDesktopFailure } from "./punksFailure";

/** Maximum number of Unicode scalar values accepted by the authority. */
export const MAX_PUNKS_REACTION_SCALARS = 64;

/** Maximum UTF-8 byte length of a custom Reaction shortcode body. */
export const MAX_PUNKS_REACTION_SHORTCODE_BYTES = 64;

/**
 * Canonicalizes the visible Reaction coordinate exactly as the authority does.
 * Empty legacy input is the frozen `+` coordinate; custom shortcodes are
 * lower-cased and all other values retain their Unicode scalar sequence.
 */
export function canonicalPunksReaction(value: string): string {
  if (/[\r\n\u2028\u2029]/u.test(value)) {
    throw new PunksDesktopFailure(
      "contract_violation",
      "Reaction cannot contain line separators",
    );
  }

  const normalized = value.trim().normalize("NFC");
  if (normalized.length === 0) return "+";

  if (normalized.startsWith(":") || normalized.endsWith(":")) {
    const shortcode = normalized.slice(1, -1);
    if (
      !normalized.startsWith(":") ||
      !normalized.endsWith(":") ||
      shortcode.length === 0 ||
      new TextEncoder().encode(shortcode).byteLength >
        MAX_PUNKS_REACTION_SHORTCODE_BYTES ||
      !/^[A-Za-z0-9_-]+$/u.test(shortcode)
    ) {
      throw new PunksDesktopFailure(
        "contract_violation",
        "A custom Reaction shortcode must contain 1-64 ASCII letters, digits, hyphens, or underscores",
      );
    }
    return `:${shortcode.toLowerCase()}:`;
  }

  if ([...normalized].length > MAX_PUNKS_REACTION_SCALARS) {
    throw new PunksDesktopFailure(
      "contract_violation",
      `Reaction exceeds ${MAX_PUNKS_REACTION_SCALARS} Unicode scalar values`,
    );
  }
  return normalized;
}
