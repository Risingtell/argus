/**
 * Preflight — confirms the OKX credentials are wired into .env without ever
 * printing the secret or passphrase. Run after filling .env: `npm run preflight`.
 */
import "dotenv/config";

function mask(v: string): string {
  return v.length <= 12 ? `${v.slice(0, 2)}…(${v.length} chars)` : `${v.slice(0, 8)}…${v.slice(-4)}`;
}

const checks: Array<[string, "id" | "secret"]> = [
  ["OKX_API_KEY", "id"],
  ["OKX_SECRET_KEY", "secret"],
  ["OKX_PASSPHRASE", "secret"],
];

let ok = true;
console.log("Argus preflight — credential wiring\n");
for (const [name, kind] of checks) {
  const v = process.env[name];
  if (!v) {
    ok = false;
    console.log(`  ✗ ${name}  — MISSING`);
  } else if (kind === "id") {
    console.log(`  ✓ ${name}  ${mask(v)}`);
  } else {
    console.log(`  ✓ ${name}  set (${v.length} chars, hidden)`);
  }
}

// Optional wallet/funding vars (not required yet)
for (const name of ["PAY_TO", "BUYER_PRIVATE_KEY"]) {
  console.log(`  ${process.env[name] ? "•" : "·"} ${name}  ${process.env[name] ? "set" : "not set yet"}`);
}

console.log(ok ? "\nCredentials wired. Ready to settle." : "\nFill the missing values in C:\\Users\\HP\\argus\\.env and re-run.");
process.exit(ok ? 0 : 1);
