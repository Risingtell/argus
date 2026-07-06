/**
 * Argus explain engine — plain-English intelligence on wallets & transactions.
 *
 * Solana support ported from SolMate; EVM/X Layer support via viem.
 * LLM narration via Groq (same pattern as Driplet's co-host).
 *
 * NOTE: stub — engine implementation lands in task #2.
 */

export interface ExplainOptions {
  deep?: boolean;   // forensic report mode (metered billing)
  quick?: boolean;  // risk-score only, no narration
}

export interface ExplainResult {
  target: string;
  chain: "solana" | "xlayer" | "evm";
  kind: "wallet" | "transaction" | "unknown";
  summary: string;
  risk: { score: number; flags: string[] };
  /** actual cost of this analysis, for upto-scheme settlement overrides (e.g. "$0.034") */
  billedUsd: string;
}

export async function explain(
  target: string,
  chain?: string,
  opts: ExplainOptions = {},
): Promise<ExplainResult> {
  // TODO(task #2): port SolMate Solana logic; add viem-based X Layer/EVM analysis;
  // Groq narration; risk heuristics; depth-based billing for deep mode.
  const detected: ExplainResult["chain"] =
    chain === "solana" || (!chain && !target.startsWith("0x")) ? "solana" : target.length === 66 || chain === "xlayer" ? "xlayer" : "evm";
  return {
    target,
    chain: detected,
    kind: target.startsWith("0x") && target.length === 66 ? "transaction" : "wallet",
    summary: "engine stub — analysis lands in task #2",
    risk: { score: 0, flags: [] },
    billedUsd: opts.deep ? "$0.03" : "$0.01",
  };
}
