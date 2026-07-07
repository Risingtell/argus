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
import type { X402Payer } from "./payer.js";

export interface ProbeContext {
  payer: X402Payer;
  url: string;
  method: "GET" | "POST";
  sampleBody?: unknown;
}

export interface ProbeResult {
  id: string;
  title: string;
  weight: number;
  passed: boolean;
  severity: "info" | "warn" | "critical";
  detail: string;
  evidence?: Record<string, unknown>;
}

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

function init(ctx: ProbeContext): RequestInit {
  return ctx.method === "POST"
    ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ctx.sampleBody ?? {}) }
    : { method: "GET" };
}

/** 1. A payment-gated endpoint must answer an unpaid request with a well-formed 402. */
async function challengeWellFormed(ctx: ProbeContext): Promise<ProbeResult> {
  const res = await fetch(ctx.url, init(ctx));
  const hasHeader = !!res.headers.get("PAYMENT-REQUIRED") || !!res.headers.get("payment-required");
  const passed = res.status === 402 && hasHeader;
  return {
    id: "challenge-wellformed",
    title: "Returns a well-formed 402 payment challenge",
    weight: 15,
    passed,
    severity: passed ? "info" : "critical",
    detail: passed
      ? "Unpaid request correctly challenged with PAYMENT-REQUIRED."
      : `Expected 402 + PAYMENT-REQUIRED header; got ${res.status}${hasHeader ? "" : " with no challenge header"}.`,
    evidence: { status: res.status, hasChallengeHeader: hasHeader },
  };
}

/** 2. After a valid payment, the service must actually deliver a response. */
async function deliversAfterPayment(ctx: ProbeContext): Promise<ProbeResult> {
  const out = await ctx.payer.call(ctx.url, init(ctx));
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
  const out = await ctx.payer.call(ctx.url, init(ctx));
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
  const out = await ctx.payer.call(ctx.url, init(ctx));
  const quoted = out.quote?.value ? BigInt(out.quote.value) : null;
  const settled = out.settlement?.amount ? BigInt(out.settlement.amount) : null;
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
  const paid = await ctx.payer.call(ctx.url, init(ctx));
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
