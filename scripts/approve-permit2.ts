/** One-time: approve Permit2 to move the buyer's USD₮0, so the `upto` (audit) scheme can meter payments. */
import "dotenv/config";
import { createPublicClient, createWalletClient, http, defineChain, erc20Abi, maxUint256, formatUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const USDT0 = "0x779ded0c9e1022225f8e0630b35a9b54be713736" as const;
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

const xlayer = defineChain({
  id: 196, name: "X Layer", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [process.env.XLAYER_RPC ?? "https://rpc.xlayer.tech"] } },
});
const account = privateKeyToAccount(process.env.BUYER_PRIVATE_KEY as Hex);
const pub = createPublicClient({ chain: xlayer, transport: http() });
const wallet = createWalletClient({ account, chain: xlayer, transport: http() });

const cur = await pub.readContract({ address: USDT0, abi: erc20Abi, functionName: "allowance", args: [account.address, PERMIT2] });
if (cur >= maxUint256 / 2n) {
  console.log(`Permit2 already approved (${formatUnits(cur, 6)}). Nothing to do.`);
} else {
  const hash = await wallet.writeContract({ address: USDT0, abi: erc20Abi, functionName: "approve", args: [PERMIT2, maxUint256] });
  console.log(`approve(Permit2, max) tx ${hash}`);
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`  ${r.status} in block ${r.blockNumber}`);
}
