# Security Policy

Argus moves real money (USD₮0 on X Layer, settled via the OKX Agent Payments
Protocol). Treat anything that could misdirect funds, forge a receipt, or
bypass a payment check as a security issue, not a regular bug.

## Reporting a Vulnerability

Email **risingtell@gmail.com** with:
- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- Whether it's already been exploited on the live deployment

Please do not open a public GitHub issue for a live vulnerability — the
service is deployed and actively settling real payments at
[argus-qt77.onrender.com](https://argus-qt77.onrender.com).

We'll acknowledge reports promptly and credit responsible disclosure in the
README, the same way we've credited independent red-team findings before
(see the Acknowledgments section).

## Scope

In scope: the payment flows (x402 `exact`/`upto`, MPP `charge`/`session`),
the audit/certify logic, on-chain settlement verification, and anything that
could let a caller pay less than quoted, replay a payment, or receive a
certificate the audit didn't actually earn.

Out of scope: the underlying `@okxweb3/*` SDKs and the OKX facilitator itself
— report those to OKX directly.
