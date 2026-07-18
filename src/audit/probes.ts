/**
 * Adversarial probes — the questions Argus asks of another ASP, each answered
 * by really paying it and checking what happens. Every probe is one billable
 * unit of work (the `audit` route meters by tests executed).
 *
 * These are *conformance & honesty* checks against a service that has agreed to
 * be audited — not intrusion testing. We pay, we observe, we verify on-chain.
 */
import { decodeEventLog, getAddress, parseAbiItem } from "viem";
import { publicClient, USDT0 } from "../chain/xlayer.js";
import type { CallOutcome, Preflight, X402Payer } from "./payer.js";

export interface ProbeContext {
  payer: X402Payer;
  url: string;
  method: "GET" | "POST";
  sampleBody?: unknown;
  /** The one unpaid 402 fetch shared by challengeWellFormed and every paid probe
   *  below — set by the orchestrator before any probe runs. Paying against its
   *  `.challenge` (rather than re-fetching) guarantees the price a probe checks
   *  is the price it actually pays. */
  preflight?: Preflight;
  /** Set by the orchestrator when the target's own price makes a full paid audit
   *  unsafe to run — paid probes short-circuit without spending. */
  blockedReason?: string;
  /** Cache: the in-flight/settled promise for the one real payment shared by every
   *  paid probe below, so a 5-probe audit triggers at most one settlement instead
   *  of four — cached as a Promise (not just the resolved value) so a probe that
   *  throws mid-payment can't cause a second probe to retry and pay again. */
  paidOutcome?: Promise<CallOutcome>;
}

export interface ProbeResult {
  id: string;
  title: string;
  weight: number;
  passed: boolean;
  severity: "info" | "warn" | "critical";
  detail: string;
  evidence?: Record<string, unknown>;
  /** false when the probe spent nothing (payer unavailable or price-safety block) — excluded from billing. */
  executed?: boolean;
}

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

/** The USD₮0 actually delivered to `payee` in settlement tx `tx`, read from chain — the ground truth. */
async function onchainSettledAmount(tx: string, payee: string): Promise<bigint | null> {
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: tx as `0x${string}` });
    const usdt0 = getAddress(USDT0);
    let total: bigint | null = null;
    for (const log of receipt.logs) {
      if (getAddress(log.address) !== usdt0) continue;
      try {
        const ev = decodeEventLog({ abi: [TRANSFER], data: log.data, topics: log.topics });
        if (getAddress(ev.args.to) === getAddress(payee)) total = (total ?? 0n) + ev.args.value;
      } catch {
        /* not a Transfer log */
      }
    }
    return total;
  } catch {
    return null;
  }
}

export function buildRequestInit(method: "GET" | "POST", sampleBody?: unknown): RequestInit {
  return method === "POST"
    ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sampleBody ?? {}) }
    : { method: "GET" };
}

function init(ctx: ProbeContext): RequestInit {
  return buildRequestInit(ctx.method, ctx.sampleBody);
}

/**
 * The one real payment shared by every probe below that needs to observe a paid
 * delivery. Pays against `ctx.preflight.challenge` directly when one was already
 * fetched (no second unpaid round-trip — the price checked is the price paid);
 * falls back to a fresh `payer.call()` only when there's no challenge to reuse
 * (e.g. the target isn't payment-gated at all, so nothing is actually spent).
 */
function getSharedPayment(ctx: ProbeContext): Promise<CallOutcome> {
  if (!ctx.paidOutcome) {
    const challenge = ctx.preflight?.challenge;
    ctx.paidOutcome = challenge ? ctx.payer.pay(ctx.url, init(ctx), challenge) : ctx.payer.call(ctx.url, init(ctx));
  }
  return ctx.paidOutcome;
}

function skipped(id: string, title: string, weight: number, reason: string): ProbeResult {
  return { id, title, weight, passed: false, severity: "warn", detail: reason, executed: false };
}

/** 1. A payment-gated endpoint must answer an unpaid request with a well-formed 402. */
async function challengeWellFormed(ctx: ProbeContext): Promise<ProbeResult> {
  const pre = ctx.preflight ?? (await ctx.payer.preflight(ctx.url, init(ctx)).catch(() => null));
  const passed = pre?.status === 402 && pre.hasChallengeHeader;
  return {
    id: "challenge-wellformed",
    title: "Returns a well-formed 402 payment challenge",
    weight: 15,
    passed,
    severity: passed ? "info" : "critical",
    detail: passed
      ? "Unpaid request correctly challenged with PAYMENT-REQUIRED."
      : `Expected 402 + PAYMENT-REQUIRED header; got ${pre?.status ?? "no response"}${pre?.hasChallengeHeader ? "" : " with no challenge header"}.`,
    evidence: { status: pre?.status ?? null, hasChallengeHeader: pre?.hasChallengeHeader ?? false },
  };
}

/** 2. After a valid payment, the service must actually deliver a response. */
async function deliversAfterPayment(ctx: ProbeContext): Promise<ProbeResult> {
  if (ctx.blockedReason) return skipped("delivers-after-payment", "Delivers the resource after payment", 25, ctx.blockedReason);
  const out = await getSharedPayment(ctx);
  const delivered = out.httpStatus < 300 && out.rawBody.trim().length > 0;
  return {
    id: "delivers-after-payment",
    title: "Delivers the resource after payment",
    weight: 25,
    passed: delivered,
    severity: delivered ? "info" : "critical",
    detail: delivered
      ? `Paid and received HTTP ${out.httpStatus} with a non-empty body.`
      : `Paid but got HTTP ${out.httpStatus} / empty body — took the money without delivering.`,
    evidence: { httpStatus: out.httpStatus, settlementTx: out.settlement?.transaction ?? null },
  };
}

/** 3. The settlement the service reports must be real on X Layer: a USD₮0 transfer to its declared payee. */
async function receiptMatchesChain(ctx: ProbeContext): Promise<ProbeResult> {
  if (ctx.blockedReason) return skipped("receipt-onchain", "Reported settlement is real on-chain", 25, ctx.blockedReason);
  const out = await getSharedPayment(ctx);
  const tx = out.settlement?.transaction;
  const expectedPayee = out.quote?.payTo;
  if (!tx) {
    return {
      id: "receipt-onchain",
      title: "Reported settlement is real on-chain",
      weight: 25,
      passed: false,
      severity: "critical",
      detail: "Service returned no settlement transaction to verify.",
      evidence: { settlement: out.settlement },
    };
  }
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: tx as `0x${string}` });
    const usdt0 = getAddress(USDT0);
    let paidToPayee = false;
    let onchainAmount: string | null = null;
    for (const log of receipt.logs) {
      if (getAddress(log.address) !== usdt0) continue;
      try {
        const ev = decodeEventLog({ abi: [TRANSFER], data: log.data, topics: log.topics });
        if (expectedPayee && getAddress(ev.args.to) === getAddress(expectedPayee)) {
          paidToPayee = true;
          onchainAmount = ev.args.value.toString();
        }
      } catch {
        /* not a Transfer log */
      }
    }
    const passed = receipt.status === "success" && paidToPayee;
    return {
      id: "receipt-onchain",
      title: "Reported settlement is real on-chain",
      weight: 25,
      passed,
      severity: passed ? "info" : "critical",
      detail: passed
        ? `Verified USD₮0 transfer to declared payee in tx ${tx.slice(0, 10)}… (block ${receipt.blockNumber}).`
        : `Could not verify a USD₮0 transfer to the declared payee in ${tx.slice(0, 10)}… — settlement claim is unbacked.`,
      evidence: { tx, status: receipt.status, paidToPayee, onchainAmount, reportedAmount: out.settlement?.amount ?? null },
    };
  } catch (e) {
    return {
      id: "receipt-onchain",
      title: "Reported settlement is real on-chain",
      weight: 25,
      passed: false,
      severity: "critical",
      detail: `Settlement tx ${tx.slice(0, 10)}… not found on X Layer — fabricated receipt. (${(e as Error).message})`,
      evidence: { tx },
    };
  }
}

/** 4. The service must not charge more than it quoted. */
async function noOvercharge(ctx: ProbeContext): Promise<ProbeResult> {
  if (ctx.blockedReason) return skipped("no-overcharge", "Settled amount does not exceed the quote", 15, ctx.blockedReason);
  const out = await getSharedPayment(ctx);
  const quoted = out.quote?.value ? BigInt(out.quote.value) : null;
  // OKX's PAYMENT-RESPONSE leaves `amount` null, so trust the chain: the USD₮0
  // actually moved to the payee in the settlement tx is what the buyer was charged.
  const tx = out.settlement?.transaction;
  const payee = out.quote?.payTo;
  let settled = out.settlement?.amount ? BigInt(out.settlement.amount) : null;
  if (settled == null && tx && payee) settled = await onchainSettledAmount(tx, payee);
  if (quoted == null || settled == null) {
    return {
      id: "no-overcharge",
      title: "Settled amount does not exceed the quote",
      weight: 15,
      passed: false,
      severity: "warn",
      detail: "Could not compare quoted vs settled amount (missing value).",
      evidence: { quoted: quoted?.toString() ?? null, settled: settled?.toString() ?? null },
    };
  }
  const passed = settled <= quoted;
  return {
    id: "no-overcharge",
    title: "Settled amount does not exceed the quote",
    weight: 15,
    passed,
    severity: passed ? "info" : "critical",
    detail: passed
      ? `Settled ${settled} ≤ quoted ${quoted} base units.`
      : `OVERCHARGE: settled ${settled} > quoted ${quoted} base units.`,
    evidence: { quoted: quoted.toString(), settled: settled.toString() },
  };
}

/** 5. A stale payment signature must not buy a second delivery (replay / double-spend of a receipt). */
async function rejectsReplay(ctx: ProbeContext): Promise<ProbeResult> {
  if (ctx.blockedReason) return skipped("rejects-replay", "Rejects a replayed payment signature", 20, ctx.blockedReason);
  const paid = await getSharedPayment(ctx);
  if (!paid.paymentHeaders || paid.httpStatus >= 300) {
    return {
      id: "rejects-replay",
      title: "Rejects a replayed payment signature",
      weight: 20,
      passed: false,
      severity: "warn",
      detail: "Could not obtain a baseline paid response to attempt a replay.",
    };
  }
  const replay = await ctx.payer.raw(ctx.url, init(ctx), paid.paymentHeaders);
  const passed = replay.httpStatus !== 200;
  return {
    id: "rejects-replay",
    title: "Rejects a replayed payment signature",
    weight: 20,
    passed,
    severity: passed ? "info" : "critical",
    detail: passed
      ? `Replayed signature was refused (HTTP ${replay.httpStatus}).`
      : "Replayed the same signature and got 200 again — service honors reused authorizations (double-delivery).",
    evidence: { replayStatus: replay.httpStatus },
  };
}

export const PROBES: Array<(ctx: ProbeContext) => Promise<ProbeResult>> = [
  challengeWellFormed,
  deliversAfterPayment,
  receiptMatchesChain,
  noOvercharge,
  rejectsReplay,
];
