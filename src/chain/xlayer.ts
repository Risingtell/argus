/**
 * X Layer (eip155:196) chain definition + shared viem public client.
 * The only network the OKX Agent Payments Protocol settles on.
 */
import { createPublicClient, defineChain, http } from "viem";

export const xlayer = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [process.env.XLAYER_RPC ?? "https://rpc.xlayer.tech"] } },
  blockExplorers: { default: { name: "OKLink", url: "https://www.oklink.com/x-layer" } },
});

/** USD₮0 — the settlement token for every Argus service (6 decimals). */
export const USDT0 = "0x779ded0c9e1022225f8e0630b35a9b54be713736" as const;

export const publicClient = createPublicClient({ chain: xlayer, transport: http() });
