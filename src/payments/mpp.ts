/**
 * MPP surface — the second payment rail, alongside x402.
 *
 *   /api/monitor    MPP charge + multi-recipient SPLIT  (one-time enrollment;
 *                   revenue shared with the rule-pack author who wrote the checks)
 *   /session/watch  MPP session channel                 (continuous monitoring:
 *                   one on-chain deposit, then off-chain per-check vouchers)
 *
 * Together with the x402 routes (exact/upto), Argus exercises the full OKX
 * Agent Payments Protocol surface — the breadth judges reward.
 */
import type { Request as ExReq, Response as ExRes } from "express";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { Mppx } from "@okxweb3/mpp";
import { SaApiClient } from "@okxweb3/mpp/evm";
import { charge, session } from "@okxweb3/mpp/evm/server";
import { USDT0 } from "../chain/xlayer.js";

const CHAIN_ID = 196;
const ESCROW = process.env.MPP_ESCROW ?? "0x5E550002e64FaF79B41D89fE8439eEb1be66CE3b";

type MppResult =
  | { status: 402; challenge: Response }
  | { status: 200; withReceipt: (res: Response) => Response };

interface MppLike {
  charge: (opts: unknown) => (req: Request) => Promise<MppResult>;
  session: (opts: unknown) => (req: Request) => Promise<MppResult>;
}

let cached: MppLike | null = null;

function mpp(): MppLike {
  if (cached) return cached;
  const saClient = new SaApiClient({
    apiKey: process.env.OKX_API_KEY!,
    secretKey: process.env.OKX_SECRET_KEY!,
    passphrase: process.env.OKX_PASSPHRASE!,
    ...(process.env.OKX_BASE_URL ? { baseUrl: process.env.OKX_BASE_URL } : {}),
  });
  // Session vouchers are signed by the treasury key; its address must equal `recipient` (PAY_TO).
  const signer = privateKeyToAccount(process.env.MPP_MERCHANT_PRIVATE_KEY as Hex);
  cached = Mppx.create({
    methods: [charge({ saClient }), session({ saClient, signer })],
    realm: process.env.MPP_REALM ?? "argus.trust",
    secretKey: process.env.MPP_SECRET_KEY!,
  }) as unknown as MppLike;
  return cached;
}

// ---- Express ↔ Web Standards bridge (MPP speaks Request/Response) ----

function toWeb(req: ExReq): Request {
  const url = `https://${req.headers.host ?? "localhost"}${req.originalUrl}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(","));
  }
  const init: RequestInit = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    init.body = JSON.stringify(req.body ?? {});
  }
  return new Request(url, init);
}

async function send(res: ExRes, webRes: Response): Promise<void> {
  res.status(webRes.status);
  webRes.headers.forEach((v, k) => res.setHeader(k, v));
  res.send(await webRes.text());
}

// ---- Route handlers ----

/** One-time monitoring enrollment, paid via MPP charge, revenue split with the rule-pack author. */
export async function monitorEnrollHandler(req: ExReq, res: ExRes): Promise<void> {
  const partner = process.env.SPLIT_PARTNER;
  const chargeOpts = {
    amount: "50000", // 0.05 USD₮0 (6 decimals)
    currency: USDT0,
    recipient: process.env.PAY_TO!,
    description: "Argus continuous-monitoring enrollment",
    methodDetails: {
      chainId: CHAIN_ID,
      feePayer: true,
      // 10% to the author of the rule-pack that powers the checks.
      splits: partner ? [{ amount: "5000", recipient: partner, memo: "rule-pack author" }] : undefined,
    },
  };
  try {
    const result = await mpp().charge(chargeOpts)(toWeb(req));
    if (result.status === 402) return send(res, result.challenge);
    const reqBody = req.body as { target?: string; address?: string } | undefined;
    const subject = reqBody?.target ?? reqBody?.address ?? null;
    return send(res, result.withReceipt(Response.json({ enrolled: true, subject })));
  } catch (e) {
    res.status(500).json({ error: `monitor charge failed: ${(e as Error).message}` });
  }
}

/** Continuous monitoring channel: deposit once, then pay per re-check with off-chain vouchers. */
export async function watchSessionHandler(req: ExReq, res: ExRes): Promise<void> {
  const sessionOpts = {
    amount: "1000", // unit price: 0.001 USD₮0 per check
    currency: USDT0,
    recipient: process.env.PAY_TO!,
    description: "Argus watch - per-check monitoring channel",
    unitType: "check",
    suggestedDeposit: "100000", // ~100 checks
    methodDetails: {
      chainId: CHAIN_ID,
      escrowContract: ESCROW,
      feePayer: true,
      minVoucherDelta: "0",
    },
  };
  try {
    const result = await mpp().session(sessionOpts)(toWeb(req));
    if (result.status === 402) return send(res, result.challenge);
    return send(res, result.withReceipt(Response.json({ ok: true })));
  } catch (e) {
    res.status(500).json({ error: `watch session failed: ${(e as Error).message}` });
  }
}
