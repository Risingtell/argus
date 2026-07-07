/**
 * On-chain signals for counterparty screening, read live from X Layer.
 *
 * Baseline signals come from plain RPC (balance, nonce, code). Richer history
 * signals (first-seen age, counterparty graph, flagged-contract interaction)
 * require an indexer — modelled here as an optional `HistorySource` so they can
 * be plugged in (OKX Explorer API) without faking data we don't have.
 */
import { formatEther, getAddress, type Address } from "viem";
import { publicClient } from "../chain/xlayer.js";

export interface ChainSignals {
  address: Address;
  isContract: boolean;
  balanceOkb: number;
  nonce: number;
  /** true once the account has ever sent a tx (nonce > 0) */
  hasOutboundActivity: boolean;
  /** populated only when a HistorySource is configured; null otherwise */
  history: HistorySignals | null;
}

export interface HistorySignals {
  firstSeenDaysAgo: number | null;
  interactedWithFlagged: boolean;
  distinctCounterparties: number | null;
}

export interface HistorySource {
  lookup(address: Address): Promise<HistorySignals>;
}

let historySource: HistorySource | null = null;
export function setHistorySource(src: HistorySource): void {
  historySource = src;
}

export async function getChainSignals(input: string): Promise<ChainSignals> {
  const address = getAddress(input); // checksums + validates; throws on malformed
  const [code, balanceWei, nonce] = await Promise.all([
    publicClient.getCode({ address }),
    publicClient.getBalance({ address }),
    publicClient.getTransactionCount({ address }),
  ]);
  return {
    address,
    isContract: !!code && code !== "0x",
    balanceOkb: Number(formatEther(balanceWei)),
    nonce,
    hasOutboundActivity: nonce > 0,
    history: historySource ? await historySource.lookup(address) : null,
  };
}
