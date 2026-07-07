/**
 * One-off: swap the patron wallet's bridged USDT (0x1E4a…) into USD₮0 (0x779Ded…),
 * the token the OKX Agent Payments Protocol actually settles in. Uses the OKX DEX
 * aggregator (v6) for calldata, signs with BUYER_PRIVATE_KEY. Approve → swap → verify.
 */
import "dotenv/config";
import crypto from "node:crypto";
import { createPublicClient, createWalletClient, http, defineChain, erc20Abi, formatUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const BASE = process.env.OKX_BASE_URL ?? "https://web3.okx.com";
const USDT = "0x1E4a5963aBFD975d8c9021ce480b42188849D41d";
const USDT0 = "0x779ded0c9e1022225f8e0630b35a9b54be713736" as const;
const AMOUNT = "2000000"; // 2 USDT (6 decimals)

const xlayer = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [process.env.XLAYER_RPC ?? "https://rpc.xlayer.tech"] } },
});

const account = privateKeyToAccount(process.env.BUYER_PRIVATE_KEY as Hex);
const pub = createPublicClient({ chain: xlayer, transport: http() });
const wallet = createWalletClient({ account, chain: xlayer, transport: http() });

function okx(path: string): Promise<any> {
  const ts = new Date().toISOString();
  const sign = crypto.createHmac("sha256", process.env.OKX_SECRET_KEY!).update(ts + "GET" + path).digest("base64");
  return fetch(BASE + path, {
    headers: {
      "OK-ACCESS-KEY": process.env.OKX_API_KEY!,
      "OK-ACCESS-SIGN": sign,
      "OK-ACCESS-TIMESTAMP": ts,
      "OK-ACCESS-PASSPHRASE": process.env.OKX_PASSPHRASE!,
      "Content-Type": "application/json",
    },
  }).then((r) => r.json());
}

async function usd0(): Promise<string> {
  const b = await pub.readContract({ address: USDT0, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  return formatUnits(b, 6);
}

console.log(`patron ${account.address}`);
console.log(`USD₮0 before: ${await usd0()}\n`);

// 1) Approve the OKX DEX router to spend USDT (skip if allowance already covers it).
const appr = await okx(`/api/v6/dex/aggregator/approve-transaction?chainIndex=196&chainId=196&tokenContractAddress=${USDT}&approveAmount=${AMOUNT}`);
if (appr.code !== "0") throw new Error(`approve quote failed: ${JSON.stringify(appr)}`);
const spender = appr.data[0].dexContractAddress as `0x${string}`;
const allowance = await pub.readContract({ address: USDT, abi: erc20Abi, functionName: "allowance", args: [account.address, spender] });
if (allowance < BigInt(AMOUNT)) {
  console.log(`approving OKX router ${spender}…`);
  const hash = await wallet.sendTransaction({ to: USDT, data: appr.data[0].data as Hex });
  console.log(`  approve tx ${hash}`);
  await pub.waitForTransactionReceipt({ hash });
  console.log("  approved.\n");
} else {
  console.log("allowance already sufficient — skipping approve.\n");
}

// 2) Fetch swap calldata and send it.
const swap = await okx(
  `/api/v6/dex/aggregator/swap?chainIndex=196&chainId=196&amount=${AMOUNT}` +
    `&fromTokenAddress=${USDT}&toTokenAddress=${USDT0}&userWalletAddress=${account.address}&slippagePercent=1`,
);
if (swap.code !== "0") throw new Error(`swap quote failed: ${JSON.stringify(swap)}`);
const tx = swap.data[0].tx;
console.log(`swapping via ${swap.data[0].routerResult?.dexRouterList?.[0]?.dexProtocol?.[0]?.dexName ?? "OKX router"}…`);
const swapHash = await wallet.sendTransaction({
  to: tx.to as `0x${string}`,
  data: tx.data as Hex,
  value: BigInt(tx.value ?? "0"),
  gas: tx.gas ? BigInt(tx.gas) : undefined,
});
console.log(`  swap tx ${swapHash}`);
const rcpt = await pub.waitForTransactionReceipt({ hash: swapHash });
console.log(`  ${rcpt.status} in block ${rcpt.blockNumber}\n`);

console.log(`USD₮0 after: ${await usd0()}`);
