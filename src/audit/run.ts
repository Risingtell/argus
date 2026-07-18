/**
 * Audit orchestrator — runs the probe suite against a target ASP, grades it,
 * persists the report, and returns it. The `audit` route meters billing by the
 * number of probes actually executed (never above the buyer's signed cap).
 */
import { randomUUID } from "node:crypto";
import { X402Payer } from "./payer.js";
import { PROBES, type ProbeContext, type ProbeResult } from "./probes.js";
import { saveAudit } from "../store.js";

const PRICE_PER_TEST_USD = 0.04; // audit cap is $0.20 → up to 5 probes billed
const CAP_USD = 0.2;
// Every paid probe now shares a single real payment to the target (see probes.ts),
// so worst case Argus spends the target's own per-call price once. Above this
// ceiling that one payment alone could eat more than the buyer's $0.20 cap, so
// paid probes are skipped rather than run at a loss. USD₮0, 6 decimals.
const MAX_SAFE_TARGET_ATOMIC = 150_000n; // $0.15

function formatUsd(atomic: bigint | null): string {
  return atomic == null ? "an unreadable" : `$${(Number(atomic) / 1_000_000).toFixed(4)}`;
}

export interface AuditTarget {
  url: string;
  method?: "GET" | "POST";
  sampleBody?: unknown;
  /** which probes to run, by id; default = all */
  only?: string[];
}

export type Grade = "A" | "B" | "C" | "D" | "F";

export interface AuditReport {
  auditId: string;
  target: string;
  method: string;
  auditedAt: string;
  score: number; // 0..100 weighted
  grade: Grade;
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

export async function runAudit(target: AuditTarget): Promise<AuditReport> {
  const method = target.method ?? "POST";
  const key = process.env.BUYER_PRIVATE_KEY;
  const payer = key ? new X402Payer(key) : null;

  const ctx: ProbeContext = { payer: payer as X402Payer, url: target.url, method, sampleBody: target.sampleBody };

  if (payer) {
    const requestInit: RequestInit =
      method === "POST"
        ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(target.sampleBody ?? {}) }
        : { method: "GET" };
    const quote = await payer.quote(target.url, requestInit).catch(() => null);
    if (quote) {
      const atomic = quote.value ? BigInt(quote.value) : null;
      if (atomic == null || atomic > MAX_SAFE_TARGET_ATOMIC) {
        ctx.blockedReason = `Target quotes ${formatUsd(atomic)} per call — above Argus's $0.15 safe-audit ceiling; paid probes skipped rather than risk the buyer's $0.20 cap on one payment.`;
      }
    }
    // quote === null means the target never 402'd on the unpaid preflight, so the
    // shared paid probe can't actually spend anything against it either — no block needed.
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

  const report: AuditReport = {
    auditId: randomUUID(),
    target: target.url,
    method,
    auditedAt: new Date().toISOString(),
    score,
    grade: gradeFor(score, anyCritical),
    results,
    testsRun,
    billedUsd: `$${billed.toFixed(2)}`,
    auditorAddress: payer?.address ?? null,
  };
  saveAudit(report);
  return report;
}
