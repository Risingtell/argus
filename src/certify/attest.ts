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
  if (audit.grade === "F") throw new Error(`audit ${auditId} graded F — not certifiable`);

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
