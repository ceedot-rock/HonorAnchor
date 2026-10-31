/**
 * canonical.ts — deterministic canonical JSON + SHA-256 fingerprinting.
 *
 * Canonical form: object keys sorted recursively (code-point order),
 * arrays keep order, separators (",", ":") with no whitespace — the same
 * shape the Python original uses (json.dumps(sort_keys=True,
 * separators=(",", ":"))). Only JSON-safe values are allowed, and every
 * number must be an integer: floats are rejected, never silently
 * coerced, because a receipt whose bytes depend on float formatting is
 * not verifiable. This is stricter than the Python _canon_safe coercion
 * and the difference is deliberate and documented.
 */
import { createHash } from "node:crypto";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error(`canonical: non-integer number rejected: ${value}`);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) {
        throw new Error(`canonical: undefined value rejected at key ${key}`);
      }
      out[key] = canonicalize(v);
    }
    return out;
  }
  throw new Error(`canonical: unsupported value type ${typeof value}`);
}

export function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

export function fingerprintOf(value: unknown): string {
  return sha256Hex(canonicalJson(value)).slice(0, 16);
}
