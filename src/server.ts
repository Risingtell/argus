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
  // HMAC signs only timestamp+method+path+body, so the API host is swappable —
  // lets dev boxes on networks that can't reach web3.okx.com route via a relay.
  ...(process.env.OKX_BASE_URL ? { baseUrl: process.env.OKX_BASE_URL } : {}),
});

const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(NETWORK, new ExactEvmScheme())
  .register(NETWORK, new UptoEvmScheme());

// The SDK's x402 v2 wire format puts the payment challenge only in the
// PAYMENT-REQUIRED response header (base64). Some client SDKs' replay
// handshake expects the same challenge mirrored in the JSON response body —
// without it they can settle on-chain but never complete the replay to
// receive the paid resource. `unpaidResponseBody` is the SDK's documented
// hook for this: it reconstructs the identical (deterministic, nonce-free)
// PaymentRequired object the middleware already puts in the header, and
// returns it as the body too, so either parsing style works.
function mirrorChallengeInBody(
  accepts: { scheme: string; network: typeof NETWORK; payTo: string; price: string; maxTimeoutSeconds: number },
  description: string,
  mimeType: string,
) {
  return async (context: { adapter: { getUrl(): string } }) => {
    const requirements = await resourceServer.buildPaymentRequirementsFromOptions([accepts], context);
    const paymentRequired = await resourceServer.createPaymentRequiredResponse(
      requirements,
      { url: context.adapter.getUrl(), description, mimeType },
      "Payment required",
    );
    return { contentType: "application/json", body: paymentRequired };
  };
}

const screenAccepts = { scheme: "exact", network: NETWORK, payTo: PAY_TO, price: "$0.001", maxTimeoutSeconds: 300 };
const auditAccepts = { scheme: "upto", network: NETWORK, payTo: PAY_TO, price: "$0.20", maxTimeoutSeconds: 600 };
const certifyAccepts = { scheme: "exact", network: NETWORK, payTo: PAY_TO, price: "$0.05", maxTimeoutSeconds: 300 };

const httpServer = new x402HTTPResourceServer(resourceServer, {
  "POST /api/screen": {
    description: "Counterparty risk verdict for a wallet — safe / caution / block",
    mimeType: "application/json",
    accepts: screenAccepts,
    unpaidResponseBody: mirrorChallengeInBody(
      screenAccepts,
      "Counterparty risk verdict for a wallet — safe / caution / block",
      "application/json",
    ),
  },
  "POST /api/audit": {
    description: "Adversarially test a target ASP; buyer signs a $0.20 cap, billed per test executed",
    mimeType: "application/json",
    accepts: auditAccepts,
    unpaidResponseBody: mirrorChallengeInBody(
      auditAccepts,
      "Adversarially test a target ASP; buyer signs a $0.20 cap, billed per test executed",
      "application/json",
    ),
  },
  // Some marketplace validators (e.g. OKX's `onchainos agent x402-check`) probe
  // a listed endpoint with an unpaid GET to confirm it answers the x402
  // challenge before ever sending a real paid POST. The unpaid challenge is
  // method-agnostic — this doesn't add a working GET audit flow, it just makes
  // the same 402 challenge answer GET too, so the probe passes. Paid POST
  // metering below is untouched.
  "GET /api/audit": {
    description: "Adversarially test a target ASP; buyer signs a $0.20 cap, billed per test executed",
    mimeType: "application/json",
    accepts: auditAccepts,
    unpaidResponseBody: mirrorChallengeInBody(
      auditAccepts,
      "Adversarially test a target ASP; buyer signs a $0.20 cap, billed per test executed",
      "application/json",
    ),
  },
  "POST /api/certify": {
    description: "Issue a signed, on-chain-verifiable quality attestation for an audited ASP",
    mimeType: "application/json",
    accepts: certifyAccepts,
    unpaidResponseBody: mirrorChallengeInBody(
      certifyAccepts,
      "Issue a signed, on-chain-verifiable quality attestation for an audited ASP",
      "application/json",
    ),
  },
});

const app = express();
// Render/Cloudflare terminate TLS in front of this app, so req.protocol is
// "http" unless we trust their X-Forwarded-Proto header — without this, the
// x402 SDK builds 402 challenge resource URLs as http://, which a strict
// client can reject even though the endpoint is genuinely https-only.
app.set("trust proxy", true);
app.use(express.json());

// Facilitator readiness. The resource server must load supported payment kinds
// from the OKX facilitator before it can build 402 challenges. On a hosted ASP
// that call can transiently fail (network blip, credential rotation), so we do
// NOT let it crash the process — we boot, serve discovery for marketplace
// review, and retry init in the background until it succeeds. When the operator
// fixes credentials, the live deployment self-heals with no restart.
let paymentsReady = false;

async function initWithRetry(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      // The HTTP resource server is what the payment middleware consumes; init it
      // here (not the middleware, see below) so failures land in this catch.
      await httpServer.initialize();
      paymentsReady = true;
      console.log(`Facilitator ready — paid surfaces live on X Layer (${NETWORK}).`);
      return;
    } catch (e) {
      const wait = Math.min(60_000, 2_000 * attempt);
      console.warn(`Facilitator init failed (attempt ${attempt}): ${(e as Error).message}. Retrying in ${wait / 1000}s.`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// A hosted ASP must outlive a facilitator or RPC blip. Log stray async failures
// instead of letting Node's default handler take the whole process down.
process.on("unhandledRejection", (reason) => console.error("unhandledRejection:", reason));

// Free discovery route — also the URL the marketplace listing points at.
app.get("/", (_req, res) =>
  res.json({
    name: "Argus",
    tagline: "The trust bureau of the agent economy",
    paymentsReady,
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

// Health probe for the host's load balancer — always 200 once the process is up.
app.get("/healthz", (_req, res) => res.json({ ok: true, paymentsReady }));

// Guard the paid surfaces until the facilitator has loaded — a 503 with a clear
// reason is far better than a cryptic middleware crash mid-request.
app.use((req, res, next) => {
  if (!paymentsReady && req.method === "POST") {
    return res.status(503).json({ error: "payment facilitator initializing — retry shortly", paymentsReady });
  }
  next();
});

// syncFacilitatorOnStart=false: don't let the middleware eagerly (and un-caught-ly)
// initialize the facilitator at construction time. We own init via initWithRetry();
// the 503 guard above ensures no paid request reaches here before it succeeds.
app.use(paymentMiddlewareFromHTTPServer(httpServer, undefined, undefined, false));

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

app.listen(PORT, () => {
  console.log(`Argus watching on :${PORT} — discovery live, warming facilitator (${NETWORK})…`);
  void initWithRetry();
});
