/**
 * Seed blocklist for counterparty screening.
 *
 * This is a STARTER set of illustrative, well-known flagged addresses so the
 * engine returns real verdicts out of the box. In production this is backed by
 * a maintained feed (OFAC SDN crypto list, chain-abuse reports, drainer
 * signatures). `reason`/`source` are surfaced as evidence in the screen verdict.
 *
 * Addresses are stored lowercase; lookups lowercase the input.
 */
export interface BlocklistEntry {
  address: string;
  category: "sanctioned" | "mixer" | "drainer" | "scam" | "phishing";
  reason: string;
  source: string;
}

const SEED: BlocklistEntry[] = [
  {
    address: "0x8589427373d6d84e98730d7795d8f6f8731fda16",
    category: "mixer",
    reason: "Tornado Cash donation/router address (sanctioned mixer)",
    source: "OFAC SDN 2022-08-08",
  },
  {
    address: "0x722122df12d4e14e13ac3b6895a86e84145b6967",
    category: "mixer",
    reason: "Tornado Cash proxy",
    source: "OFAC SDN 2022-08-08",
  },
  {
    address: "0xa7e5d5a720f06526557c513402f2e6b5fa20b008",
    category: "drainer",
    reason: "Address associated with a wallet-drainer campaign",
    source: "chain-abuse report (illustrative seed)",
  },
];

// Normalize + drop any malformed seed rows (keeps the list honest if edited by hand).
const BLOCKLIST = new Map<string, BlocklistEntry>();
for (const e of SEED) {
  const a = e.address.toLowerCase();
  if (/^0x[0-9a-f]{40}$/.test(a)) BLOCKLIST.set(a, { ...e, address: a });
}

export interface BlocklistHit extends BlocklistEntry {}

export function checkBlocklist(address: string): BlocklistHit | null {
  return BLOCKLIST.get(address.toLowerCase()) ?? null;
}

export function blocklistSize(): number {
  return BLOCKLIST.size;
}
