/**
 * Argus — the onchain intelligence bureau for the agent economy.
 *
 * Payment-protected intelligence services on X Layer (eip155:196),
 * settled in USD₮0 via the OKX Agent Payments Protocol.
 *
 * Capability map (one product, every payment primitive):
 *   POST /api/explain    x402 exact     $0.01   one-shot tx/wallet explanation
 *   POST /api/report     x402 upto      ≤$0.10  forensic report, billed by actual usage
 *   GET  /api/risk-feed  x402 deferred  $0.001  high-frequency risk pings
 *   POST /session/watch  MPP session            continuous monitoring channel
 *   POST /api/charge     MPP charge+splits      10% data-partner revenue share
 */
import "dotenv/config";
import express from "express";
import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import {
  x402ResourceServer,
  x402HTTPResourceServer,
  paymentMiddlewareFromHTTPServer,
  setSettlementOverrides,
} from "@okxweb3/x402-express";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { UptoEvmScheme } from "@okxweb3/x402-evm/upto/server";
import { AggrDeferredEvmScheme } from "@okxweb3/x402-evm/deferred/server";
import { explain } from "./engine/explain.js";

const PORT = Number(process.env.PORT ?? 4000);
const PAY_TO = process.env.PAY_TO!;
const NETWORK = "eip155:196" as const; // X Layer mainnet — the only supported network

const facilitatorClient = new OKXFacilitatorClient({
  apiKey: process.env.OKX_API_KEY!,
  secretKey: process.env.OKX_SECRET_KEY!,
  passphrase: process.env.OKX_PASSPHRASE!,
  syncSettle: true, // wait for on-chain confirmation before delivering intelligence
});

const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(NETWORK, new ExactEvmScheme())
  .register(NETWORK, new UptoEvmScheme())
  .register(NETWORK, new AggrDeferredEvmScheme());

const httpServer = new x402HTTPResourceServer(resourceServer, {
  "POST /api/explain": {
    description: "Plain-English explanation + risk flags for a wallet or transaction (Solana + X Layer/EVM)",
    mimeType: "application/json",
    accepts: {
      scheme: "exact",
      network: NETWORK,
      payTo: PAY_TO,
      price: "$0.01",
      maxTimeoutSeconds: 300,
    },
  },
  "POST /api/report": {
    description: "Deep forensic wallet report — buyer signs a $0.10 cap, billed by actual analysis depth",
    mimeType: "application/json",
    accepts: {
      scheme: "upto",
      network: NETWORK,
      payTo: PAY_TO,
      price: "$0.10", // cap — actual charge set per-request via setSettlementOverrides
      maxTimeoutSeconds: 300,
    },
  },
  "GET /api/risk-feed": {
    description: "High-frequency wallet risk pings, facilitator-batched settlement",
    mimeType: "application/json",
    accepts: {
      scheme: "deferred",
      network: NETWORK,
      payTo: PAY_TO,
      price: "$0.001",
      maxTimeoutSeconds: 300,
    },
  },
});

const app = express();
app.use(express.json());

// Free health/info route — also what the marketplace listing points at
app.get("/", (_req, res) =>
  res.json({
    name: "Argus",
    tagline: "Onchain intelligence bureau for the agent economy",
    services: ["explain ($0.01/call)", "report (≤$0.10 metered)", "risk-feed ($0.001 batched)", "watch (session channel)"],
    network: "X Layer (eip155:196), USD₮0",
  }),
);

app.use(paymentMiddlewareFromHTTPServer(httpServer));

app.post("/api/explain", async (req, res) => {
  const { target, chain } = req.body ?? {};
  if (!target) return res.status(400).json({ error: "body must include { target, chain? }" });
  const result = await explain(String(target), chain);
  res.json(result);
});

app.post("/api/report", async (req, res) => {
  const { target, chain } = req.body ?? {};
  if (!target) return res.status(400).json({ error: "body must include { target, chain? }" });
  const result = await explain(String(target), chain, { deep: true });
  // Bill by actual work done, never above the signed cap.
  setSettlementOverrides(res, { amount: result.billedUsd });
  res.json(result);
});

app.get("/api/risk-feed", async (req, res) => {
  const target = String(req.query.target ?? "");
  if (!target) return res.status(400).json({ error: "query must include ?target=" });
  const result = await explain(target, undefined, { quick: true });
  res.json({ target, risk: result.risk, at: new Date().toISOString() });
});

app.listen(PORT, async () => {
  await resourceServer.initialize();
  console.log(`Argus watching on :${PORT} — payments live on X Layer (${NETWORK})`);
});
