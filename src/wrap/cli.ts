/**
 * `argus wrap` — turn any existing HTTP API into a paid ASP in one command.
 *
 *   npm run wrap -- --target https://api.example.com/answer --price 0.002 --port 4100
 *
 * Starts an x402-gated reverse proxy on X Layer: unpaid requests get a proper
 * 402 challenge; paid requests are forwarded verbatim to the target and the
 * response returned. The wrapped service is a first-class ASP — Argus can
 * audit and certify it like any other, which is the point: wrap → audit →
 * certify → sell, without touching the target's code.
 *
 * Uses the same facilitator credentials as the bureau (.env), pays out to
 * WRAP_PAY_TO (falls back to PAY_TO).
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import express from "express";
import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import {
  x402ResourceServer,
  x402HTTPResourceServer,
  paymentMiddlewareFromHTTPServer,
} from "@okxweb3/x402-express";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";

const { values } = parseArgs({
  options: {
    target: { type: "string", short: "t" },
    price: { type: "string", short: "p", default: "0.002" },
    port: { type: "string", default: "4100" },
    description: { type: "string", short: "d" },
  },
});

if (!values.target) {
  console.error("usage: npm run wrap -- --target <url> [--price 0.002] [--port 4100] [--description …]");
  process.exit(1);
}
const TARGET = values.target.replace(/\/+$/, "");
const PRICE = `$${Number(values.price)}`;
const PORT = Number(values.port);
const NETWORK = "eip155:196" as const;
const PAY_TO = process.env.WRAP_PAY_TO ?? process.env.PAY_TO;
if (!PAY_TO) {
  console.error("Set WRAP_PAY_TO or PAY_TO in .env — the wrapped API needs a payout wallet.");
  process.exit(1);
}
const DESCRIPTION = values.description ?? `x402-wrapped: ${TARGET}`;

const facilitatorClient = new OKXFacilitatorClient({
  apiKey: process.env.OKX_API_KEY!,
  secretKey: process.env.OKX_SECRET_KEY!,
  passphrase: process.env.OKX_PASSPHRASE!,
  syncSettle: true,
  ...(process.env.OKX_BASE_URL ? { baseUrl: process.env.OKX_BASE_URL } : {}),
});

const resourceServer = new x402ResourceServer(facilitatorClient).register(NETWORK, new ExactEvmScheme());

const accepts = { scheme: "exact", network: NETWORK, payTo: PAY_TO, price: PRICE, maxTimeoutSeconds: 300 } as const;
const httpServer = new x402HTTPResourceServer(resourceServer, {
  "GET /": { description: DESCRIPTION, mimeType: "application/json", accepts },
  "POST /": { description: DESCRIPTION, mimeType: "application/json", accepts },
});

const app = express();
app.use(express.json());

// Free discovery card — where a marketplace listing or an auditor starts.
app.get("/card", (_req, res) =>
  res.json({
    name: "argus-wrapped ASP",
    target: TARGET,
    price: `${PRICE} USD₮0 per call (x402 exact)`,
    network: "X Layer (eip155:196)",
    payTo: PAY_TO,
    wrappedBy: "Argus — the trust bureau of the agent economy",
  }),
);

app.use(paymentMiddlewareFromHTTPServer(httpServer));

// Paid from here on: forward the call verbatim, return what the target returns.
app.all("/", async (req, res) => {
  const qs = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  try {
    const upstream = await fetch(TARGET + qs, {
      method: req.method,
      headers: { "content-type": "application/json" },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : JSON.stringify(req.body ?? {}),
    });
    const text = await upstream.text();
    res.status(upstream.status);
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("content-type", ct);
    res.send(text);
  } catch (e) {
    res.status(502).json({ error: `wrapped target unreachable: ${(e as Error).message}` });
  }
});

app.listen(PORT, async () => {
  await resourceServer.initialize();
  console.log(`argus wrap — ${TARGET}`);
  console.log(`  now selling at http://localhost:${PORT}/ for ${PRICE} per call (payout → ${PAY_TO})`);
  console.log(`  discovery card: http://localhost:${PORT}/card`);
});
