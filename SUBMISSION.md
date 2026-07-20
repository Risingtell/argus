# Argus — OKX.AI Genesis submission runbook

Deadline: **2026-07-27 23:59 UTC**.

Steps 1 and 2 (deploy, list) are **done**. What's left is Step 3: record, post, submit.

| | |
|---|---|
| Live service | https://argus-qt77.onrender.com |
| Landing page + free demo | https://argus-qt77.onrender.com/site |
| OKX.AI Agent ID | **#5246** (listed, live, review passed) |
| Repo | https://github.com/Risingtell/argus |
| Network | X Layer (eip155:196), settled in USD₮0 |

---

## ✅ Step 1 — Deployed

Render web service from the committed `render.yaml` (persistent process: file-backed
audit store, MPP session state, facilitator warm-up loop). Health check:
`https://argus-qt77.onrender.com/healthz` → `{"ok":true,"paymentsReady":true}`.

> Free tier sleeps after ~15 min idle (first call then takes ~50s). **Ping it right before
> recording the demo and before the judges' review window**, or bump to the $7/mo instance.

## ✅ Step 2 — Listed on OKX.AI

Agent **#5246**, three A2MCP services, review passed. Live prices as listed:

| Service | Fee | Endpoint |
|---|---|---|
| Wallet Risk Screening | `0.01` | `/api/screen` |
| Agent Service Audit | `0.2` | `/api/audit` |
| On-chain Quality Certificate | `0.05` | `/api/certify` |

Plus two MPP surfaces not listed as separate services: `/api/monitor` (charge + 10% split
to the rule-pack author) and `/session/watch` (session channel, per-recheck vouchers).

---

## Step 3 — Record, post, submit

### 90-second demo script

Anchor on the **live `/site` page**, not the raw JSON card — it has the pitch, live
pricing, on-chain evidence, and a free demo widget a judge can click without a wallet.

| Time | Show | Say |
|---|---|---|
| 0:00 | `/site` hero | "Argus is the trust bureau of the agent economy." |
| 0:12 | Free demo widget — screen a flagged wallet, live verdict | "Before your agent pays anyone, it can ask Argus whether that wallet is safe — free to try, right here." |
| 0:30 | `npm run patron` — screen step, real $0.01 settlement | "Same call, paid: a real USD₮0 settlement on X Layer." |
| 0:45 | Audit step — 5 probes, grade | "It audits other agent services by actually *being their customer* — paying them and checking whether the receipt they hand back is real on-chain." |
| 1:05 | Certify step — EIP-712 certificate | "A service that passes gets a signed certificate any agent can verify offline." |
| 1:15 | `npm run verify` — 37 settlements re-derived from chain | "Every number Argus claims is re-derived straight from X Layer. No database, no API — just the chain." |
| 1:28 | okx.ai listing #5246 | "Argus. Pre-hire trust for the agent economy." |

Record with the service already warm. `npm run patron` needs the auditor wallet funded
(currently `$0.918605` USD₮0 — enough for a full screen→audit→certify pass).

### X post (must include #OKXAI + the demo clip)

> Meet **Argus** — the trust bureau of the agent economy, live on OKX.AI.
>
> Before your agent pays a wallet or hires another service, Argus vets it — by *actually
> paying the target* and verifying every receipt on-chain. Wallet risk screening,
> adversarial service audits, and signed EIP-712 quality certificates, settled per query
> in USD₮0 on X Layer.
>
> 37 real settlements. Buyers who aren't me. Independently red-teamed by another live
> ASP, who found a real bug — fixed the same day.
>
> Re-derive every number yourself: `npm run verify` reads it straight off X Layer.
>
> #OKXAI

### Google form

**https://forms.gle/mddEUagmDbyV37ws8** — ASP name, Agent ID **5246**, description, type,
X post link. Submit before **2026-07-27 23:59 UTC**.

> Submit the form **twice** — once for Argus (#5246), once for VigilOK (#6032). The form
> takes one Agent ID per submission. VigilOK's own runbook: `C:\Users\HP\vigilok\SUBMISSION.md`.

---

## Live proof (re-derived from chain, 2026-07-20)

`npm run verify` scans USD₮0 Transfer logs into the treasury from a fixed genesis block —
no Argus API, no database involved:

- **37 settlements · 4 distinct payer wallets · $1.1260 USD₮0** into treasury
  `0x70146b6152ad60ddA4628a618f0515f6305A34c2`.
- Payers include buyers with no connection to this project, a peer ASP's red-team wallet,
  and OKX-escrow-routed marketplace purchases — not only our own demo agent.
- Self-audit grades **A (100/100)**, all 5 probes passing; EIP-712 certificates issued.

Sample txs (OKLink → https://www.oklink.com/x-layer/tx/`<hash>`):

- screen `0x88aac1b962dd19ccde86e42f22d8bd4454446e610b96ce2854815f827a48b94c`
- audit `0x5b23872adc0836785072a0d3efbbb66d3762fdd7209f9df4f99673db4cb5dd96`
- certify `0xe0fbfc894ad422a426ede1e634cde8d69cab465844417836d08f7ddc8f1fe2dc`

## Independent review

Red-teamed by **Warden #3808** (a live ASP in the same campaign, not affiliated): real
paid adversarial calls across every surface, on-chain verification of each settlement,
malformed-input and replay attempts, and a recursive self-audit attempt. One real bug
found and fixed the same session; credited in the README acknowledgments.
