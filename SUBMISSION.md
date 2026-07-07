# Argus — OKX.AI Genesis submission runbook

Everything needed to take Argus from "working locally" to "listed and submitted."
Deadline: **2026-07-17 23:59 UTC**. Do the steps in order.

---

## Step 1 — Deploy the ASP (get a permanent public URL)

Argus needs a persistent process (file-backed audit store, MPP session state, the
facilitator warm-up loop), so it runs as a **web service**, not a serverless function.
Render's blueprint is already committed (`render.yaml`).

1. Go to **render.com** and sign in with GitHub.
2. **New +** → **Blueprint** → pick the repo **Risingtell/argus**. Render reads `render.yaml`.
3. Set the secret env vars (copy the values from your local `C:\Users\HP\argus\.env` —
   do **not** paste them anywhere public):
   `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`, `PAY_TO`,
   `MPP_MERCHANT_PRIVATE_KEY`, `MPP_SECRET_KEY`, `SPLIT_PARTNER`, `BUYER_PRIVATE_KEY`.
   (Leave `OKX_BASE_URL` unset — Render reaches web3.okx.com directly, no relay needed.)
4. **Apply** and wait for the build. You'll get a URL like `https://argus.onrender.com`.
5. Confirm it's healthy: open `https://<your-url>/healthz` — it should read
   `{"ok":true,"paymentsReady":true}`. If `paymentsReady` is false, give it a minute
   (facilitator warm-up) and refresh.

> Free tier sleeps after ~15 min idle (first call then takes ~50s). For the OKX review
> window and the live demo, either ping it to keep it warm or bump to the $7/mo instance
> so it's always on.

**After deploy, replace `https://argus.onrender.com` below with your real URL.**

---

## Step 2 — List Argus as an ASP on OKX.AI

Done through the OKX Onchain OS agent flow + your Agentic Wallet (email login), which
writes the identity on-chain. Argus registers as an **Agent-to-MCP (A2MCP)** provider —
pay-per-call, x402-gated, exactly what the deployed endpoints already are.

### ASP identity

- **Name:** `Argus`
- **Description:**
  > The trust bureau of the agent economy. Argus vets other agent services before you
  > hire them and screens counterparty wallets before you pay them — by actually paying
  > the target and verifying every receipt on-chain. Pre-hire trust for the agent
  > marketplace, settled per query in USD₮0 on X Layer.
- **Avatar:** required, square (1:1), ≤1MB. *(the one asset still to make — see note below)*

### Services (one ASP, three A2MCP services)

**1. Wallet Risk Screening** — fee `0.001`
> Instant safe / caution / block risk verdict on any wallet you're about to pay, from
> live X Layer signals plus a sanctioned-address blocklist.
> Provide the counterparty wallet address; get a scored verdict with specific risk flags
> and a pay / don't-pay recommendation.
- Endpoint: `https://argus.onrender.com/api/screen`

**2. Agent Service Audit** — fee `0.2`
> Adversarial honesty audit of another agent service: five paid probes check 402
> compliance, delivery, on-chain receipt truth, overcharging and replay, graded A–F.
> Provide the target service's endpoint URL and a sample request; get a graded report,
> billed only for the probes actually run.
- Endpoint: `https://argus.onrender.com/api/audit`

**3. On-chain Quality Certificate** — fee `0.05`
> Turns a passed audit into a signed, verifiable EIP-712 quality attestation any agent
> can check offline before hiring the service.
> Provide the audit ID from a prior audit; get a signed certificate with grade, score
> and expiry.
- Endpoint: `https://argus.onrender.com/api/certify`

> OKX reviews within 24h; the result comes to the email on your Agentic Wallet and in the
> agent window. An unreviewed/failed listing is still reachable by Agent ID, but must pass
> and go live to count for the hackathon.

---

## Step 3 — X post + Google form

### X post (include #OKXAI + a ≤90s demo clip)

> Meet **Argus** — the trust bureau of the agent economy, live on OKX.AI.
>
> Before your agent pays a wallet or hires another service, Argus vets it — by *actually
> paying the target* and verifying every receipt on-chain. Wallet risk screening,
> adversarial service audits, and signed on-chain quality certificates, all settled
> per-query in USD₮0 on X Layer.
>
> Demo: an autonomous buyer agent screens a wallet, audits a service (grade A, 5 probes),
> and buys a certificate — 3 real settlements, 100% on-chain, zero humans.
>
> #OKXAI

### 90-second demo script

| Time | Show | Say |
|---|---|---|
| 0:00 | `GET /` service card | "This is Argus — the trust bureau of the agent economy." |
| 0:10 | `npm run patron`, screen step (Tornado → BLOCK, Permit2 → SAFE) | "It screens counterparty wallets before you pay them." |
| 0:30 | audit step — $0.20 paid, 5 probes, grade A | "It audits other agent services by really paying them and checking the receipts on-chain." |
| 0:55 | certify step — EIP-712 certificate | "A passing service gets a signed, verifiable certificate." |
| 1:05 | `npm run verify` — 23 real settlements | "Every payment is real, re-derived straight from X Layer — check any tx on OKLink." |
| 1:20 | the okx.ai listing | "Argus. Pre-hire trust for the agent economy." |

### Google form

Submit **https://forms.gle/mddEUagmDbyV37ws8** with the ASP details + the link to your X
post, before 2026-07-17 23:59 UTC.

---

## Live proof (already on-chain)

- 23 real USD₮0 settlements on X Layer, self-audit grades **A (100/100)**, EIP-712 certs issued.
- Re-derive it yourself: `npm run verify`.
- Sample txs (OKLink → https://www.oklink.com/x-layer):
  - screen `0x88aac1b962dd19ccde86e42f22d8bd4454446e610b96ce2854815f827a48b94c`
  - audit `0x5b23872adc0836785072a0d3efbbb66d3762fdd7209f9df4f99673db4cb5dd96`
  - certify `0xe0fbfc894ad422a426ede1e634cde8d69cab465844417836d08f7ddc8f1fe2dc`
