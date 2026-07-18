/**
 * Audit orchestrator — runs the probe suite against a target ASP, grades it,
 * persists the report, and returns it. The `audit` route meters billing by the
 * number of probes actually executed (never above the buyer's signed cap).
 */
import { randomUUID } from "node:crypto";
import { X402Payer, type Preflight } from "./payer.js";
import { PROBES, buildRequestInit, type ProbeContext, type ProbeResult } from "./probes.js";
import { saveAudit } from "../store.js";

export const PRICE_PER_TEST_USD = 0.04; // audit cap is $0.20 → up to 5 probes billed
export const CAP_USD = 0.2;
// Every paid probe shares a single real payment to the target (see probes.ts), so
// worst case Argus spends the target's own per-call price once. Derived from
// CAP_USD (not an independent literal) so the two can never drift out of sync:
// above this fraction of the buyer's cap, that one payment alone risks eating
// it, so paid probes are skipped rather than run at a loss. USD₮0, 6 decimals.
const SAFE_SPEND_FRACTION = 0.75;
const MAX_SAFE_TARGET_ATOMIC = BigInt(Math.round(CAP_USD * SAFE_SPEND_FRACTION * 1_000_000));

function formatUsd(atomic: bigint | null): string {
  return atomic == null ? "an unverifiable amount" : `$${(Number(atomic) / 1_000_000).toFixed(4)}`;
}

export interface AuditTarget {
  url: string;
  method?: "GET" | "POST";
  sampleBody?: unknown;
  /** which probes to run, by id; default = all */
  only?: string[];
}

/** "U" (unrated) means Argus couldn't safely finish the paid probes — not a pass, not a fail. */
export type Grade = "A" | "B" | "C" | "D" | "F" | "U";

export interface AuditReport {
  auditId: string;
  target: string;
  method: string;
  auditedAt: string;
  score: number; // 0..100 weighted, only meaningful when grade !== "U"
  grade: Grade;
  /** true when one or more probes were skipped (price-safety block or auditor
   *  misconfiguration) rather than actually run — grade is forced to "U" in that case. */
  incomplete: boolean;
  results: ProbeResult[];
  testsRun: number;
  billedUsd: string; // e.g. "$0.16"
  auditorAddress: string | null;
}

function gradeFor(score: number, anyCritical: boolean): Grade {
  if (anyCritical) return score >= 60 ? "C" : score >= 40 ? "D" : "F";
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

/**
 * Fetch the target's unpaid 402 challenge and decide whether it's safe to pay
 * against — fails closed (blocked) whenever the price can't be verified, not
 * just when it's verified-and-too-high, so a broken or evasive target can't
 * talk its way into an unbounded real payment.
 */
async function checkPriceSafety(
  payer: X402Payer,
  url: string,
  requestInit: RequestInit,
): Promise<{ preflight?: Preflight; blockedReason?: string }> {
  const pre = await payer.preflight(url, requestInit).catch(() => null);
  if (!pre) {
    return { blockedReason: "Could not reach the target to verify its price before spending — paid probes skipped rather than pay blind." };
  }
  if (pre.status === 402 && !pre.challenge) {
    // 402'd but the challenge didn't parse — could be a broken target, or a
    // dishonest one deliberately garbling the free check while answering the
    // real paid request normally. Either way, fail closed, not open.
    return { preflight: pre, blockedReason: "Target returned a 402 with an unparseable payment challenge — paid probes skipped rather than pay against an unverifiable price." };
  }
  if (pre.challenge) {
    const atomic = pre.challenge.quote?.value ? BigInt(pre.challenge.quote.value) : null;
    if (atomic == null || atomic > MAX_SAFE_TARGET_ATOMIC) {
      return {
        preflight: pre,
        blockedReason: `Target quotes ${formatUsd(atomic)} per call — above Argus's ${formatUsd(MAX_SAFE_TARGET_ATOMIC)} safe-audit ceiling; paid probes skipped rather than risk the buyer's $${CAP_USD.toFixed(2)} cap on one payment.`,
      };
    }
  }
  // pre.status !== 402 — target isn't payment-gated at all, so the shared paid
  // probe can't actually spend anything against it either. No block needed.
  return { preflight: pre };
}

export async function runAudit(target: AuditTarget): Promise<AuditReport> {
  const method = target.method ?? "POST";
  const key = process.env.BUYER_PRIVATE_KEY;
  const payer = key ? new X402Payer(key) : null;

  const ctx: ProbeContext = { payer: payer as X402Payer, url: target.url, method, sampleBody: target.sampleBody };

  if (payer) {
    const requestInit = buildRequestInit(method, target.sampleBody);
    const gate = await checkPriceSafety(payer, target.url, requestInit);
    ctx.preflight = gate.preflight;
    ctx.blockedReason = gate.blockedReason;
  }

  const selected = target.only?.length ? PROBES.filter((p) => target.only!.includes(p.name)) : PROBES;
  const results: ProbeResult[] = [];

  for (const probe of selected) {
    if (!payer) {
      results.push({
        id: probe.name,
        title: probe.name,
        weight: 0,
        passed: false,
        severity: "warn",
        detail: "Auditor wallet not configured (BUYER_PRIVATE_KEY) — probe skipped.",
        executed: false,
      });
      continue;
    }
    try {
      results.push(await probe(ctx));
    } catch (e) {
      results.push({
        id: probe.name,
        title: probe.name,
        weight: 10,
        passed: false,
        severity: "warn",
        detail: `Probe errored: ${(e as Error).message}`,
      });
    }
  }

  const totalWeight = results.reduce((s, r) => s + r.weight, 0) || 1;
  const earned = results.reduce((s, r) => s + (r.passed ? r.weight : 0), 0);
  const score = Math.round((earned / totalWeight) * 100);
  const anyCritical = results.some((r) => !r.passed && r.severity === "critical");

  const testsRun = results.filter((r) => r.executed !== false).length;
  const billed = Math.min(CAP_USD, testsRun * PRICE_PER_TEST_USD);

  // Any skipped probe (price-safety block or auditor misconfiguration) means the
  // adversarial checks didn't actually run — score them as "unrated," never as a
  // numeric pass/fail grade a buyer could mistake for "this target failed."
  const incomplete = results.some((r) => r.executed === false);
  const grade = incomplete ? "U" : gradeFor(score, anyCritical);

  const report: AuditReport = {
    auditId: randomUUID(),
    target: target.url,
    method,
    auditedAt: new Date().toISOString(),
    score,
    grade,
    incomplete,
    results,
    testsRun,
    billedUsd: `$${billed.toFixed(2)}`,
    auditorAddress: payer?.address ?? null,
  };
  saveAudit(report);
  return report;
}
