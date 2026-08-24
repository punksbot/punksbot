import { clientProblem } from "./client-error";

/**
 * Validation locale des curseurs opaques, miroir exact de
 * `punks-account-client/src/validation.rs` : un curseur contrefait est rejeté
 * en `contract_violation` AVANT toute I/O, fail closed.
 */

const DIRECTORY_CURSOR = /^[A-Za-z0-9._~-]{1,1024}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function validateDirectoryCursor(cursor: string): void {
  if (!DIRECTORY_CURSOR.test(cursor)) {
    throw clientProblem("Directory continuation cursor is not opaque", {
      kind: "contract_violation",
    });
  }
}

export function validateHistoryCursor(cursor: string): void {
  const segments = cursor.split(".");
  const [prefix, payload, signature, ...rest] = segments;
  const valid =
    cursor.length >= 10 &&
    cursor.length <= 512 &&
    prefix === "mhc1" &&
    payload !== undefined &&
    payload.length > 0 &&
    BASE64URL.test(payload) &&
    signature !== undefined &&
    signature.length === 43 &&
    BASE64URL.test(signature) &&
    rest.length === 0;
  if (!valid) {
    throw clientProblem("Message history cursor is not opaque", {
      kind: "contract_violation",
    });
  }
}
