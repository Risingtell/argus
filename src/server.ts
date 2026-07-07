/**
 * Argus — the trust bureau of the agent economy.
 *
 * Payment-protected trust services on X Layer (eip155:196), settled in USD₮0
 * via the OKX Agent Payments Protocol. Two surfaces, one trust engine:
 *
 *   Surface A — screen the WALLET before you pay it (day-one demand):
 *     POST /api/screen     x402 exact     $0.001  is this counterparty safe to pay?
 *
 *   Surface B — trust the SERVICE before you hire it (marketplace quality):
 *     POST /api/audit      x402 upto      ≤$0.20  adversarially test a target ASP
 *     POST /api/certify    x402 exact     $0.05   issue an on-chain quality attestation
 *     POST /session/monitor  MPP session          continuous re-audit channel
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
import { screen } from "./engine/screen.js";
import { runAudit } from "./audit/run.js";
import { certify } from "./certify/attest.js";
import { monitorEnrollHandler, watchSessionHandler } from "./payments/mpp.js";

const PORT = Number(process.env.PORT ?? 4000);
const PAY_TO = process.env.PAY_TO ?? "0x0000000000000000000000000000000000000000";
const NETWORK = "eip155:196" as const; // X Layer mainnet — the only supported network

const facilitatorClient = new OKXFacilitatorClient({
  apiKey: process.env.OKX_API_KEY!,
  secretKey: process.env.OKX_SECRET_KEY!,
  passphrase: process.env.OKX_PASSPHRASE!,
  syncSettle: true, // confirm settlement on-chain before delivering a verdict/certificate
});

const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(NETWORK, new ExactEvmScheme())
  .register(NETWORK, new UptoEvmScheme());

const httpServer = new x402HTTPResourceServer(resourceServer, {
  "POST /api/screen": {
    description: "Counterparty risk verdict for a wallet — safe / caution / block",
    mimeType: "application/json",
    accepts: { scheme: "exact", network: NETWORK, payTo: PAY_TO, price: "$0.001", maxTimeoutSeconds: 300 },
  },
  "POST /api/audit": {
    description: "Adversarially test a target ASP; buyer signs a $0.20 cap, billed per test executed",
    mimeType: "application/json",
    accepts: { scheme: "upto", network: NETWORK, payTo: PAY_TO, price: "$0.20", maxTimeoutSeconds: 600 },
  },
  "POST /api/certify": {
    description: "Issue a signed, on-chain-verifiable quality attestation for an audited ASP",
    mimeType: "application/json",
    accepts: { scheme: "exact", network: NETWORK, payTo: PAY_TO, price: "$0.05", maxTimeoutSeconds: 300 },
  },
});

const app = express();
app.use(express.json());

// Free discovery route — also the URL the marketplace listing points at.
app.get("/", (_req, res) =>
  res.json({
    name: "Argus",
    tagline: "The trust bureau of the agent economy",
    surfaces: {
      screen: "POST /api/screen — $0.001 x402/exact — is this wallet safe to pay?",
      audit: "POST /api/audit — ≤$0.20 x402/upto metered — adversarially test a target ASP",
      certify: "POST /api/certify — $0.05 x402/exact — on-chain quality attestation",
      monitor: "POST /api/monitor — $0.05 MPP/charge+split — enroll for continuous monitoring",
      watch: "POST /session/watch — MPP session channel — pay-per-recheck",
    },
    protocols: ["x402: exact, upto", "MPP: charge (+splits), session"],
    network: "X Layer (eip155:196), settled in USD₮0",
  }),
);

app.use(paymentMiddlewareFromHTTPServer(httpServer));

app.post("/api/screen", async (req, res) => {
  const { address } = req.body ?? {};
  if (!address) return res.status(400).json({ error: "body must include { address }" });
  try {
    res.json(await screen(String(address)));
  } catch (e) {
    res.status(400).json({ error: `invalid address: ${(e as Error).message}` });
  }
});

app.post("/api/audit", async (req, res) => {
  const { target } = req.body ?? {};
  if (!target?.url) return res.status(400).json({ error: "body must include { target: { url, ... } }" });
  const report = await runAudit(target);
  // Meter: bill only for tests actually executed, never above the signed cap.
  setSettlementOverrides(res, { amount: report.billedUsd });
  res.json(report);
});

app.post("/api/certify", async (req, res) => {
  const { auditId } = req.body ?? {};
  if (!auditId) return res.status(400).json({ error: "body must include { auditId }" });
  try {
    res.json(await certify(String(auditId)));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// MPP-gated routes (self-handle their own 402 — not intercepted by the x402 middleware above)
app.post("/api/monitor", monitorEnrollHandler);
app.post("/session/watch", watchSessionHandler);

app.listen(PORT, async () => {
  await resourceServer.initialize();
  console.log(`Argus watching on :${PORT} — trust services live on X Layer (${NETWORK})`);
});
