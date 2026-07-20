/**
 * Argus `certify` — turn a passed audit into a signed, verifiable certificate.
 *
 * The certificate is an EIP-712 typed attestation signed by Argus's key. Any
 * buyer agent can recover the signer and check the grade before hiring the
 * subject ASP — trust that travels with the service, verifiable without
 * trusting Argus's API (the signature is the proof). The digest is designed to
 * be anchorable on X Layer for tamper-evident, on-chain-checkable certs.
 */
import { keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PROBES } from "../audit/probes.js";
import { getAudit } from "../store.js";

const DOMAIN = { name: "Argus", version: "1", chainId: 196 } as const;

const TYPES = {
  Attestation: [
    { name: "auditId", type: "string" },
    { name: "subject", type: "string" },
    { name: "grade", type: "string" },
    { name: "score", type: "uint256" },
    { name: "issuedAt", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
  ],
} as const;

const VALIDITY_DAYS = 30;

export interface Certificate {
  auditId: string;
  subject: string;
  grade: string;
  score: number;
  issuedAt: number;
  expiresAt: number;
  issuer: string; // Argus signer address
  signature: Hex;
  digest: Hex; // keccak of the canonical message — anchorable on-chain
  domain: typeof DOMAIN;
}

export async function certify(auditId: string): Promise<Certificate> {
  const audit = getAudit(auditId);
  if (!audit) throw new Error(`unknown auditId: ${auditId}`);
  if (audit.grade === "U") {
    throw new Error(`audit ${auditId} graded U (unrated) — not certifiable. ${audit.incomplete ? "The target's own price or reachability kept Argus from safely finishing the paid checks; certify() can't attest to an incomplete audit." : ""}`);
  }
  if (audit.grade === "F") throw new Error(`audit ${auditId} graded F — not certifiable`);
  // A certificate must attest to the FULL adversarial suite. Without this, a
  // buyer could audit their own endpoint with target.only=["challenge-wellformed"]
  // (the one probe that never pays), score 100 on the free check alone, and buy
  // a genuine Argus-signed "A" for $0.09 total — certificate farming.
  if (audit.testsRun < PROBES.length) {
    throw new Error(
      `audit ${auditId} executed ${audit.testsRun}/${PROBES.length} probes (partial audit) — only full-suite audits are certifiable.`,
    );
  }

  const key = process.env.MPP_MERCHANT_PRIVATE_KEY ?? process.env.BUYER_PRIVATE_KEY;
  if (!key) throw new Error("Argus signing key not configured (MPP_MERCHANT_PRIVATE_KEY)");
  const signer = privateKeyToAccount(key as Hex);

  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + VALIDITY_DAYS * 86_400;
  const message = {
    auditId,
    subject: audit.target,
    grade: audit.grade,
    score: BigInt(audit.score),
    issuedAt: BigInt(issuedAt),
    expiresAt: BigInt(expiresAt),
  };

  const signature = await signer.signTypedData({ domain: DOMAIN, types: TYPES, primaryType: "Attestation", message });
  const digest = keccak256(toHex(`${auditId}|${audit.target}|${audit.grade}|${audit.score}|${issuedAt}|${expiresAt}`));

  return {
    auditId,
    subject: audit.target,
    grade: audit.grade,
    score: audit.score,
    issuedAt,
    expiresAt,
    issuer: signer.address,
    signature,
    digest,
    domain: DOMAIN,
  };
}
