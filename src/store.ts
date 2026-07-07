/**
 * Tiny append-only JSON store for audit reports, so `certify` can look up an
 * audit by id after the fact. Gitignored (.data/). Not a database — a hackathon
 * needs durable-enough, not distributed.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { AuditReport } from "./audit/run.js";

const FILE = ".data/audits.json";

function load(): Record<string, AuditReport> {
  if (!existsSync(FILE)) return {};
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as Record<string, AuditReport>;
  } catch {
    return {};
  }
}

export function saveAudit(report: AuditReport): void {
  const all = load();
  all[report.auditId] = report;
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(all, null, 2));
}

export function getAudit(id: string): AuditReport | null {
  return load()[id] ?? null;
}
