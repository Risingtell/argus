# Contributing

Argus is a live OKX Agent Payments Protocol service (x402 + MPP) on X Layer.
Issues and pull requests are welcome.

## Reporting a bug

Open an issue with:
- What you ran (`npm run smoke`, `npm run verify`, a specific route call) and what you expected
- The actual output, including any error text
- Whether it reproduces against a fresh clone (`git clone`, `npm install`, no other setup)

## Making a change

1. Fork and clone the repo
2. `npm install`
3. `cp .env.example .env` and fill in credentials if your change touches a paid route
4. `npm run build` (typecheck) and `npm run smoke` (no credentials needed) before opening a PR
5. Describe what changed and why in the PR description

## Security issues

Do not open a public issue for a security vulnerability — see [SECURITY.md](SECURITY.md).
