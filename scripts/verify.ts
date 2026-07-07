/**
 * On-chain verifier — trust bureau, verified the same way it verifies others.
 *
 * Re-derives Argus's revenue from X Layer chain data alone: every USD₮0
 * Transfer into the treasury (PAY_TO), plus current balances of every wallet in
 * the system. No Argus API, no database — a judge can run `npm run verify` and
 * check our claims against the chain directly.
 */
import "dotenv/config";
import { createPublicClient, erc20Abi, formatUnits, getAddress, http, parseAbiItem } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { publicClient, USDT0, xlayer } from "../src/chain/xlayer.js";

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

const LOOKBACK = BigInt(process.env.VERIFY_LOOKBACK_BLOCKS ?? 400_000); // ~2 weeks of X Layer blocks
const CHUNK = BigInt(process.env.VERIFY_CHUNK ?? 10_000);

// rpc.xlayer.tech caps eth_getLogs at 100 blocks; drpc's free tier allows 10k.
// Balances still go through the default client — only log scans use this one.
const scanClient = createPublicClient({
  chain: xlayer,
  transport: http(process.env.VERIFY_RPC ?? "https://xlayer.drpc.org"),
});

const payTo = process.env.PAY_TO;
if (!payTo || payTo.length !== 42) {
  console.error("PAY_TO missing from .env — nothing to verify.");
  process.exit(1);
}
const treasury = getAddress(payTo);
const partner = process.env.SPLIT_PARTNER ? getAddress(process.env.SPLIT_PARTNER) : null;
const buyer = process.env.BUYER_PRIVATE_KEY ? privateKeyToAccount(process.env.BUYER_PRIVATE_KEY as Hex).address : null;
const patron = process.env.PATRON_PRIVATE_KEY ? privateKeyToAccount(process.env.PATRON_PRIVATE_KEY as Hex).address : null;

async function usdt0Balance(addr: `0x${string}`): Promise<string> {
  const bal = await publicClient.readContract({ address: USDT0, abi: erc20Abi, functionName: "balanceOf", args: [addr] });
  return formatUnits(bal, 6);
}

async function gasBalance(addr: `0x${string}`): Promise<string> {
  return formatUnits(await publicClient.getBalance({ address: addr }), 18);
}

console.log("ARGUS — on-chain verification (X Layer, eip155:196)");
console.log(`  settlement token: USD₮0 ${USDT0}\n`);

// ── wallet roll call ──────────────────────────────────────────────────────────
const wallets: Array<[string, `0x${string}` | null]> = [
  ["treasury (PAY_TO)", treasury],
  ["split partner", partner],
  ["auditor/buyer", buyer],
  ["patron", patron && patron !== buyer ? patron : null],
];
for (const [label, addr] of wallets) {
  if (!addr) continue;
  const [usd, gas] = await Promise.all([usdt0Balance(addr), gasBalance(addr)]);
  console.log(`  ${label.padEnd(18)} ${addr}  ${usd} USD₮0  |  ${gas} OKB`);
}

// ── re-derive revenue from Transfer logs ──────────────────────────────────────
const latest = await publicClient.getBlockNumber();
const from = latest > LOOKBACK ? latest - LOOKBACK : 0n;
console.log(`\n  scanning USD₮0 transfers to treasury, blocks ${from}..${latest} (chunks of ${CHUNK})`);

interface Row {
  tx: string;
  from: string;
  usd: number;
  block: bigint;
}
const rows: Row[] = [];

let start = from;
let chunk = CHUNK;
while (start <= latest) {
  const end = start + chunk - 1n > latest ? latest : start + chunk - 1n;
  try {
    const logs = await scanClient.getLogs({
      address: USDT0,
      event: TRANSFER,
      args: { to: treasury },
      fromBlock: start,
      toBlock: end,
    });
    for (const log of logs) {
      rows.push({
        tx: log.transactionHash,
        from: getAddress(log.args.from!),
        usd: Number(formatUnits(log.args.value!, 6)),
        block: log.blockNumber,
      });
    }
    start = end + 1n;
    chunk = CHUNK;
  } catch (e) {
    // RPC range limit — halve and retry down to the 100-block floor
    if (chunk <= 100n) {
      console.error(`  RPC refused 100-block ranges near block ${start}: ${(e as Error).message.split("\n")[0]}`);
      break;
    }
    chunk = chunk / 2n < 100n ? 100n : chunk / 2n;
  }
}

if (rows.length === 0) {
  console.log("  no inbound USD₮0 transfers found in the scanned window.");
} else {
  const total = rows.reduce((s, r) => s + r.usd, 0);
  const payers = new Set(rows.map((r) => r.from));
  console.log(`\n  ${rows.length} settlements  |  ${payers.size} distinct payer wallets  |  $${total.toFixed(4)} USD₮0 total\n`);
  const shown = rows.slice(-40);
  for (const r of shown) {
    console.log(`   block ${r.block}  $${r.usd.toFixed(4).padStart(8)}  from ${r.from.slice(0, 10)}…  tx ${r.tx}`);
  }
  if (rows.length > shown.length) console.log(`   … and ${rows.length - shown.length} earlier settlements`);
  console.log(`\n  every row above is a real USD₮0 transfer on X Layer — check any tx on https://www.oklink.com/x-layer`);
}
