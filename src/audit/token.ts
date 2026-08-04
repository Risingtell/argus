/**
 * Self-verifying audit tokens.
 *
 * `auditId` used to be a random UUID, looked up server-side against a local
 * JSON file to recover the grade/score at certify time. On Render's free tier
 * that file does not survive a redeploy or an idle spin-down, so a buyer who
 * paid for `/api/audit` and came back later for `/api/certify` could get
 * "unknown auditId" for an audit that genuinely happened.
 *
 * Instead, `auditId` now IS the certifiable result: a compact JSON payload plus
 * an HMAC over it, both base64url-encoded. `certify()` verifies the HMAC and
 * reads the payload directly — no lookup, so no dependency on the audit
 * finishing before the process restarts. The wire contract for callers is
 * unchanged (auditId is still one opaque string field).
 *
 * The HMAC key is derived from the treasury signing key that's already
 * required at boot, so this needs no new secret to configure.
 */
import crypto from "node:crypto";

export interface AuditCapsule {
  target: string;
  grade: string;
  score: number;
  testsRun: number;
  issuedAt: number; // unix seconds
}

const b64u = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function hmacKey(): Buffer {
  const secret = process.env.MPP_MERCHANT_PRIVATE_KEY ?? process.env.BUYER_PRIVATE_KEY ?? "";
  // Domain-separated derivation: a plain hash of an existing secret, not the
  // secret itself, so a leaked token payload+signature can't be used to
  // recover any key material actually used for signing/settlement elsewhere.
  return crypto.createHash("sha256").update("argus-audit-token/1:" + secret).digest();
}

export function signAuditToken(capsule: AuditCapsule): string {
  const body = b64u(Buffer.from(JSON.stringify(capsule), "utf8"));
  const sig = b64u(crypto.createHmac("sha256", hmacKey()).update(body).digest());
  return `${body}.${sig}`;
}

export class InvalidAuditTokenError extends Error {}

export function verifyAuditToken(token: string): AuditCapsule {
  const parts = token.split(".");
  if (parts.length !== 2) throw new InvalidAuditTokenError(`unknown auditId: ${token}`);
  const [body, sig] = parts;
  const expected = b64u(crypto.createHmac("sha256", hmacKey()).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new InvalidAuditTokenError(`unknown or tampered auditId: ${token}`);
  }
  try {
    return JSON.parse(unb64u(body).toString("utf8")) as AuditCapsule;
  } catch {
    throw new InvalidAuditTokenError(`unknown auditId: ${token}`);
  }
}
