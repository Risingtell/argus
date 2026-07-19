# ARGUS — the trust bureau of the agent economy

Agents are starting to hire other agents. On [okx.ai](https://www.okx.ai) a buyer agent can discover a service, pay it per call in USD₮0 on X Layer, and consume the result — no human in the loop. Which raises the question every marketplace eventually answers or dies from: **who vets the sellers?**

Argus is that answer. It audits, certifies, and continuously monitors Agentic Service Providers (ASPs) **by actually being their customer** — paying them real money over the OKX Agent Payments Protocol and verifying, on-chain, what happens next. Trust as a paid service, bought and sold agent-to-agent over the same rails it certifies.

## Services

| Route | What you buy | Price | Payment |
|---|---|---|---|
| `POST /api/screen` | Counterparty risk verdict for a wallet — safe / caution / block | $0.01 | x402 **exact** |
| `POST /api/audit` | Adversarial audit of a target ASP: 5 paid probes, graded A–F | ≤ $0.20 metered | x402 **upto** |
| `POST /api/certify` | Signed EIP-712 quality attestation for a passed audit | $0.05 | x402 **exact** |
| `POST /api/monitor` | Continuous-monitoring enrollment, revenue split with rule-pack author | $0.05 | MPP **charge + splits** |
| `POST /session/watch` | Pay-per-recheck monitoring channel (deposit once, voucher per check) | $0.001/check | MPP **session** |

One trust engine, the **entire Agent Payments Protocol surface**: x402 `exact`, x402 `upto` (server-side metering via settlement overrides), MPP `charge` with multi-recipient splits, and MPP `session` channels — all settling in USD₮0 on X Layer (`eip155:196`), verified and settled through the OKX facilitator.

## The audit: five questions, answered with money

Auditing an API by reading its docs is theater. Argus pays the target and checks the receipts:

1. **Well-formed challenge** — does an unpaid request get a proper 402 + `PAYMENT-REQUIRED`?
2. **Delivers after payment** — pay it, and did the resource actually arrive?
3. **Receipt is real** — the settlement tx it reports must be a genuine USD₮0 transfer to its declared payee, on-chain.
4. **No overcharge** — settled amount ≤ quoted amount, in base units.
5. **Rejects replay** — a reused payment signature must not buy a second delivery.

Probes 2-5 all pay against the *same* payment (one settlement, verified from every angle) rather than four independent ones, so auditing a target never costs Argus more than one call at that target's own price. If a target prices itself above Argus's safe-spend ceiling — or answers the free price check with something unverifiable — Argus declines to spend and returns grade **U** (unrated), never a false pass or fail.

Failures are graded by severity (a fabricated receipt is not a style issue), the report is billed per probe executed under the buyer's signed `upto` cap, and a passing grade can be minted into an **EIP-712 attestation** any agent can verify offline — recover the signer, check the grade, no Argus API required.

## `argus wrap` — the onboarding funnel

Any HTTP API becomes a sellable, auditable ASP in one command:

```bash
npm run wrap -- --target https://your-api.example.com/answer --price 0.002
```

That starts an x402-gated reverse proxy: unpaid calls get a 402 challenge, paid calls are forwarded verbatim. The wrapped service is a first-class ASP — so the full lifecycle is `wrap → audit → certify → sell`, without touching the target's code.

## Run it

```bash
npm install
cp .env.example .env      # fill in OKX SA API keys + wallets
npm run preflight         # credentials wired?
npm run dev               # the bureau, on :4000

npm run patron            # autonomous buyer: discover → screen → audit → certify,
                          # with its own wallet, hard budget, and printed reasoning
npm run verify            # re-derive every settlement from X Layer chain data alone
npm run smoke             # screen-engine spot check, no credentials needed
```

`npm run verify` is the honesty check: it scans USD₮0 `Transfer` logs to the treasury and prints every settlement with its tx hash — the same standard Argus holds audited ASPs to. Check any row on [OKLink](https://www.oklink.com/x-layer).

## Architecture

```
                 buyer agents (x402 clients)
                        │  USD₮0, X Layer
                        ▼
   ┌────────────────── ARGUS ──────────────────┐
   │  x402 exact ($0.01)    screen engine      │
   │  x402 upto  (≤$0.20)   audit harness ─────┼──► pays target ASPs
   │  x402 exact ($0.05)    EIP-712 certify    │    (5 adversarial probes)
   │  MPP charge + splits   monitor enroll     │
   │  MPP session channel   watch / recheck    │
   └───────────────┬───────────────────────────┘
                   │ verify / settle (signed HMAC)
                   ▼
        OKX facilitator (web3.okx.com)          X Layer RPC (receipts, logs)
```

- `src/engine/` — wallet screening: live X Layer signals + blocklist seeds
- `src/audit/` — the x402 payer (buyer half) and the five probes
- `src/certify/` — EIP-712 attestations, chainId 196, 30-day validity
- `src/payments/` — MPP charge-with-splits and session-channel handlers
- `src/wrap/` — the `argus wrap` CLI
- `agents/patron.ts` — autonomous buyer agent with budget reasoning
- `scripts/verify.ts` — trustless revenue re-derivation from chain data

## Why this matters

Payment rails give agents the ability to transact; they don't give them a reason to trust the counterparty. Credit bureaus, auditors, and ratings agencies exist because *markets price risk before they price anything else*. Argus is that institution for the agent economy — built natively on the rails it certifies, funded per query by the agents that need it, and honest because its own books are readable off the chain by anyone.

## Acknowledgments

Independently red-teamed by Warden #3808 — real paid adversarial testing across every surface, on-chain settlement verification, and a same-day bug report that led to a real fix.

## License

MIT
