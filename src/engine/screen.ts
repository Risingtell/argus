/**
 * Argus `screen` — "is this wallet safe to pay?"
 *
 * The day-one trust primitive: any agent, before paying any counterparty on the
 * marketplace, asks Argus for a verdict. Combines the seed blocklist with live
 * X Layer signals into a single decision an autonomous buyer can act on.
 */
import { getAddress } from "viem";
import { checkBlocklist } from "../data/blocklist.js";
import { getChainSignals } from "./signals.js";

export type Verdict = "safe" | "caution" | "block";

export interface RiskFlag {
  code: string;
  weight: number;
  detail: string;
}

export interface ScreenResult {
  address: string;
  verdict: Verdict;
  score: number; // 0 (clean) … 100 (block)
  flags: RiskFlag[];
  /** machine-actionable line for a buyer agent's decision loop */
  recommendation: string;
  checkedAt: string;
}

function verdictFor(score: number, hardBlock: boolean): Verdict {
  if (hardBlock || score >= 70) return "block";
  if (score >= 30) return "caution";
  return "safe";
}

export async function screen(input: string): Promise<ScreenResult> {
  const address = getAddress(input);
  const flags: RiskFlag[] = [];
  let hardBlock = false;

  const hit = checkBlocklist(address);
  if (hit) {
    hardBlock = true;
    flags.push({
      code: `blocklist:${hit.category}`,
      weight: 100,
      detail: `${hit.reason} (${hit.source})`,
    });
  }

  const signals = await getChainSignals(address);

  // Fresh, never-used account receiving a payment request = classic burner.
  if (!signals.hasOutboundActivity && !signals.isContract) {
    flags.push({
      code: "fresh-eoa",
      weight: 35,
      detail: "Externally-owned account with no outbound history (possible burner)",
    });
  }

  // No gas at all: can't pay its own disputes/refunds; often a throwaway.
  if (signals.balanceOkb === 0 && !signals.isContract) {
    flags.push({
      code: "zero-gas",
      weight: 15,
      detail: "Zero OKB balance — cannot fund on-chain refund/dispute actions",
    });
  }

  if (signals.history?.interactedWithFlagged) {
    flags.push({
      code: "flagged-counterparty",
      weight: 40,
      detail: "Has transacted with a flagged address",
    });
  }
  if (signals.history?.firstSeenDaysAgo != null && signals.history.firstSeenDaysAgo < 2) {
    flags.push({
      code: "very-new",
      weight: 20,
      detail: `First seen ${signals.history.firstSeenDaysAgo}d ago`,
    });
  }

  const score = Math.min(100, flags.reduce((s, f) => s + f.weight, 0));
  const verdict = verdictFor(score, hardBlock);

  const recommendation =
    verdict === "block"
      ? "DO NOT PAY — counterparty is blocked."
      : verdict === "caution"
        ? "PROCEED WITH CARE — use escrow, cap exposure, verify receipt on-chain."
        : "OK TO PAY — no elevated risk detected.";

  return {
    address,
    verdict,
    score,
    flags,
    recommendation,
    checkedAt: new Date().toISOString(),
  };
}
