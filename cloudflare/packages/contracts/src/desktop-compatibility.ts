import { Validator } from "@cfworker/json-schema";

import desktopCompatibilityResponse from "../schemas/desktop.compatibility-response.schema.json";

const validator = new Validator(
  desktopCompatibilityResponse as never,
  "2020-12",
  false,
);

/** Validate the only response allowed across the desktop bootstrap boundary. */
export function validateDesktopCompatibilityResponse(
  value: unknown,
): { valid: true } | { valid: false; errors: readonly unknown[] } {
  const result = validator.validate(value);
  return result.valid
    ? { valid: true }
    : { valid: false, errors: result.errors };
}
