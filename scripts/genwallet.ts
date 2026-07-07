/**
 * Generate Argus's operating wallets and write them into .env SAFELY.
 *
 * - Private keys are generated locally, written to .env, and NEVER printed.
 * - Only public addresses are shown.
 * - Re-run safe: a var already holding a real (non-placeholder) value is kept,
 *   so this never clobbers a funded wallet.
 *
 * Wallets:
 *   BUYER_PRIVATE_KEY        the throwaway buyer/patron (FUND THIS with USD₮0)
 *   PAY_TO / MPP_MERCHANT_PRIVATE_KEY   Argus treasury — receives payments, signs certs & sessions
 *   SPLIT_PARTNER            a data-partner address for the revenue-split demo (receive-only)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ENV = ".env";
const isPlaceholder = (v: string | undefined) => !v || v === "0x..." || v.trim() === "";

function readEnv(): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of readFileSync(ENV, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

function setEnv(lines: string[], key: string, value: string): string[] {
  let found = false;
  const out = lines.map((l) => {
    if (l.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return l;
  });
  if (!found) out.push(`${key}=${value}`);
  return out;
}

const env = readEnv();
let lines = readFileSync(ENV, "utf8").split(/\r?\n/);
const report: string[] = [];

// Treasury (payee + signer)
if (isPlaceholder(env.get("MPP_MERCHANT_PRIVATE_KEY")) || isPlaceholder(env.get("PAY_TO"))) {
  const pk = generatePrivateKey();
  const addr = privateKeyToAccount(pk).address;
  lines = setEnv(lines, "MPP_MERCHANT_PRIVATE_KEY", pk);
  lines = setEnv(lines, "PAY_TO", addr);
  report.push(`  Treasury (PAY_TO, receives + signs) : ${addr}   [new]`);
} else {
  report.push(`  Treasury (PAY_TO)                   : ${env.get("PAY_TO")}   [kept]`);
}

// Buyer / patron (throwaway — needs funding)
let buyerAddr: string;
if (isPlaceholder(env.get("BUYER_PRIVATE_KEY"))) {
  const pk = generatePrivateKey();
  buyerAddr = privateKeyToAccount(pk).address;
  lines = setEnv(lines, "BUYER_PRIVATE_KEY", pk);
  report.push(`  Buyer / patron (FUND THIS)          : ${buyerAddr}   [new]`);
} else {
  buyerAddr = privateKeyToAccount(env.get("BUYER_PRIVATE_KEY") as `0x${string}`).address;
  report.push(`  Buyer / patron (FUND THIS)          : ${buyerAddr}   [kept]`);
}

// Split partner (receive-only)
if (isPlaceholder(env.get("SPLIT_PARTNER"))) {
  const addr = privateKeyToAccount(generatePrivateKey()).address;
  lines = setEnv(lines, "SPLIT_PARTNER", addr);
  report.push(`  Split partner (revenue-share demo)  : ${addr}   [new]`);
}

writeFileSync(ENV, lines.join("\n"));

console.log("Argus wallets — private keys written to .env (hidden), addresses below:\n");
console.log(report.join("\n"));
console.log(`\n➡  Fund the BUYER address with ~$10 USD₮0 on X Layer (chain 196):`);
console.log(`   ${buyerAddr}`);
console.log(`   USD₮0 token: 0x779ded0c9e1022225f8e0630b35a9b54be713736`);
