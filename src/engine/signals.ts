/**
 * On-chain signals for counterparty screening, read live from X Layer.
 *
 * Everything here comes from plain RPC (balance, nonce, code). Richer history
 * signals (first-seen age, counterparty graph, flagged-contract interaction)
 * would need an indexer or block-explorer API — deliberately not built, since
 * a binary-search-over-blocks version using only the RPC this file already
 * has would add several seconds of latency to every screen() call, and a
 * balance-only heuristic would miss any address whose first activity was
 * receiving an ERC-20 rather than native OKB. Worth doing for real against a
 * real indexer if this ever needs it, not worth faking with a slow half-answer.
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
  };
}
