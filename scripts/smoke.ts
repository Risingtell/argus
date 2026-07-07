/** Smoke test: screen a few real addresses against live X Layer. No credentials needed. */
import { screen } from "../src/engine/screen.js";

const targets = [
  "0x8589427373D6D84E98730D7795D8f6f8731FDA16", // Tornado (blocklisted seed)
  "0x000000000022D473030F116dDEE9F6B43aC78BA3", // Permit2 (a real, heavily-used contract)
  "0x1111111111111111111111111111111111111111", // empty / never-used
];

for (const t of targets) {
  try {
    const r = await screen(t);
    console.log(`\n${r.address}`);
    console.log(`  verdict: ${r.verdict.toUpperCase()}  score:${r.score}`);
    console.log(`  ${r.recommendation}`);
    for (const f of r.flags) console.log(`   - [${f.code}] ${f.detail}`);
  } catch (e) {
    console.log(`\n${t}\n  ERROR: ${(e as Error).message}`);
  }
}
