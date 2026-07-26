/**
 * `agent-sandbox list` — list all sandboxes.
 */

import { listSandboxes } from "../lib/sandbox.js";
import type { MsbListEntry } from "../lib/sandbox.js";

/** Format a date string from an ISO timestamp or raw string. */
function fmtCreated(entry: MsbListEntry): string {
  const raw = entry.created_at;
  if (!raw) return "-";
  // Try ISO date parsing.
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 19).replace("T", " ");
  }
  return raw;
}

export async function listCommand(): Promise<void> {
  const entries = await listSandboxes();

  if (entries.length === 0) {
    console.log("No sandboxes found.");
    return;
  }

  // Determine column widths.
  const rows = entries.map((e) => ({
    name: e.name,
    status: e.status,
    created: fmtCreated(e),
  }));

  const nameW = Math.max(...rows.map((r) => r.name.length), 4);
  const statusW = Math.max(...rows.map((r) => r.status.length), 6);
  const createdW = Math.max(...rows.map((r) => r.created.length), 7);

  const sep = ` ${"─".repeat(nameW)} ─ ${"─".repeat(statusW)} ─ ${"─".repeat(createdW)} `;

  // Header
  console.log(`  ${"Name".padEnd(nameW)} │ ${"Status".padEnd(statusW)} │ Created`);
  console.log(` ┌${sep}┐`);

  for (const r of rows) {
    console.log(
      ` │ ${r.name.padEnd(nameW)} │ ${r.status.padEnd(statusW)} │ ${r.created}`,
    );
  }
  console.log(` └${sep}┘`);
}
