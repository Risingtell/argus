/**
 * PATRON — an autonomous buyer agent that is Argus's first customer.
 *
 * It has its own wallet and a hard budget, and it walks the full trust journey
 * a real agent would, paying real USD₮0 on X Layer at every step:
 *
 *   1. discover  GET  /            free — read the service card
 *   2. screen    POST /api/screen  $0.01 exact — "is this counterparty safe to pay?"
 *   3. audit     POST /api/audit   ≤$0.20 upto — adversarially test a target ASP
 *   4. certify   POST /api/certify $0.05 exact — buy the signed attestation
 *
 * Every spend decision is checked against the budget and printed, so a viewer
 * can watch the agent reason about money — not just spend it.
 *
 *   npm run patron                       → against local server, self-audit demo
 *   ARGUS_URL=… AUDIT_TARGET=… npm run patron
 */
import "dotenv/config";
import { X402Payer, type CallOutcome } from "../src/audit/payer.js";

const ARGUS_URL = (process.env.ARGUS_URL ?? "http://localhost:4000").replace(/\/+$/, "");
// Default subject: a well-known, heavily used contract (Permit2) — a "safe" verdict.
const COUNTERPARTY = process.env.SCREEN_ADDRESS ?? "0x000000000022D473030F116dDEE9F6B43aC78BA3";
// Default audit target: Argus's own screen endpoint — Argus eats its own dog food.
const AUDIT_TARGET = process.env.AUDIT_TARGET ?? `${ARGUS_URL}/api/screen`;

const BUDGET_USD = Number(process.env.PATRON_BUDGET_USD ?? 0.5);

const key = process.env.PATRON_PRIVATE_KEY ?? process.env.BUYER_PRIVATE_KEY;
if (!key) {
  console.error("Set PATRON_PRIVATE_KEY (or BUYER_PRIVATE_KEY) in .env — the patron needs a funded X Layer wallet.");
  process.exit(1);
}
const payer = new X402Payer(key);

let spentUsd = 0;
const receipts: Array<{ step: string; usd: number; tx: string | null }> = [];

function usd(atomic: string | undefined | null): number {
  return atomic ? Number(atomic) / 1e6 : 0; // USD₮0 has 6 decimals
}

function decide(step: string, priceUsd: number): boolean {
  const remaining = BUDGET_USD - spentUsd;
  if (priceUsd > remaining) {
    console.log(`  🧠 budget: $${remaining.toFixed(3)} left, ${step} costs ~$${priceUsd.toFixed(3)} — DECLINE`);
    return false;
  }
  console.log(`  🧠 budget: $${remaining.toFixed(3)} left, ${step} costs ~$${priceUsd.toFixed(3)} — worth it, PAY`);
  return true;
}

function record(step: string, out: CallOutcome): void {
  const paidUsd = usd(out.settlement?.amount);
  spentUsd += paidUsd;
  receipts.push({ step, usd: paidUsd, tx: out.settlement?.transaction ?? null });
  const tx = out.settlement?.transaction;
  console.log(`  💸 settled $${paidUsd.toFixed(4)}${tx ? ` — tx ${tx.slice(0, 14)}…` : ""} (HTTP ${out.httpStatus}, ${out.latencyMs}ms)`);
}

function fail(step: string, out: CallOutcome): never {
  console.error(`  ✗ ${step} failed: HTTP ${out.httpStatus} — ${out.rawBody.slice(0, 300)}`);
  process.exit(1);
}

console.log("PATRON — autonomous buyer agent");
console.log(`  wallet : ${payer.address}`);
console.log(`  budget : $${BUDGET_USD.toFixed(2)} USD₮0 (hard cap)`);
console.log(`  bureau : ${ARGUS_URL}\n`);

// ── 1. discover ───────────────────────────────────────────────────────────────
console.log("① discover — reading the service card (free)");
const card = await fetch(`${ARGUS_URL}/`).then((r) => r.json());
console.log(`  found "${card.name}" — ${card.tagline}`);

// ── 2. screen the counterparty ────────────────────────────────────────────────
console.log(`\n② screen — should I ever pay ${COUNTERPARTY.slice(0, 10)}…?`);
if (!decide("screen", 0.01)) process.exit(0);
const screenOut = await payer.call(`${ARGUS_URL}/api/screen`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ address: COUNTERPARTY }),
});
if (!screenOut.paid) fail("screen", screenOut);
record("screen", screenOut);
const verdict = screenOut.body as { verdict?: string; score?: number; recommendation?: string };
console.log(`  📋 verdict: ${String(verdict.verdict).toUpperCase()} (score ${verdict.score}) — ${verdict.recommendation}`);

// ── 3. order an adversarial audit of a target ASP ────────────────────────────
console.log(`\n③ audit — is the service at ${AUDIT_TARGET} honest? (metered, cap $0.20)`);
if (!decide("audit", 0.2)) process.exit(0);
const auditOut = await payer.call(`${ARGUS_URL}/api/audit`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    target: { url: AUDIT_TARGET, method: "POST", sampleBody: { address: COUNTERPARTY } },
  }),
});
if (!auditOut.paid) fail("audit", auditOut);
record("audit", auditOut);
const report = auditOut.body as {
  auditId?: string;
  grade?: string;
  score?: number;
  testsRun?: number;
  billedUsd?: string;
  results?: Array<{ passed: boolean; title: string; detail: string }>;
};
console.log(`  📋 grade ${report.grade} (${report.score}/100) — ${report.testsRun} probes run, billed ${report.billedUsd} of the $0.20 cap`);
for (const r of report.results ?? []) console.log(`     ${r.passed ? "✓" : "✗"} ${r.title}`);

// ── 4. buy the certificate ────────────────────────────────────────────────────
console.log(`\n④ certify — buy the signed attestation for audit ${report.auditId?.slice(0, 8)}…`);
if (!decide("certify", 0.05)) process.exit(0);
const certOut = await payer.call(`${ARGUS_URL}/api/certify`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ auditId: report.auditId }),
});
if (!certOut.paid) fail("certify", certOut);
record("certify", certOut);
const cert = certOut.body as { grade?: string; issuer?: string; signature?: string; digest?: string };
console.log(`  📜 certificate: grade ${cert.grade}, issuer ${cert.issuer}`);
console.log(`     sig ${cert.signature?.slice(0, 24)}… digest ${cert.digest?.slice(0, 24)}…`);

// ── receipt ───────────────────────────────────────────────────────────────────
console.log("\n═══ patron session receipt ═══");
for (const r of receipts) console.log(`  ${r.step.padEnd(8)} $${r.usd.toFixed(4)}  ${r.tx ?? "(no tx reported)"}`);
console.log(`  total    $${spentUsd.toFixed(4)} of $${BUDGET_USD.toFixed(2)} budget — every payment real, settled on X Layer`);
