/** verify.ts — offline trail verification CLI. Usage:
 *   npm run verify -- --trail runs/<runId>/trail.jsonl --issuer-pubkey <hex>
 * Exit 0 iff every line verifies.
 */
import { verifyTrail } from "./receipts.js";

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const trail = flag("--trail");
const issuer = flag("--issuer-pubkey");
if (!trail) {
  console.error("usage: npm run verify -- --trail <trail.jsonl> [--issuer-pubkey <hex>]");
  process.exit(2);
}
const results = verifyTrail(trail, issuer);
for (const r of results) {
  console.log(`line ${r.line}: ${r.ok ? "OK" : `FAIL ${r.error ?? ""}: ${r.detail ?? ""}`} ${r.verdict ? `(${r.verdict})` : ""}`);
}
const bad = results.filter((r) => !r.ok);
console.log(`${results.length - bad.length}/${results.length} verified`);
process.exit(bad.length === 0 ? 0 : 1);
