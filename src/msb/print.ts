/**
 * Shell-safe command formatting.
 *
 * Print mode outputs commands as a single copyable shell line per argv,
 * with arguments quoted only when needed. Secret arguments are emitted
 * verbatim (they contain only source-env names and allowed hosts, no
 * values) so redaction is unnecessary by construction.
 */

/**
 * Quote a single argument for inclusion in a shell command line.
 * Empty strings are rendered as `''`; everything else is escaped using
 * POSIX shell rules so that copy/paste reproduces the exact argv.
 */
export function quoteArg(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  // If the string is purely alphanumeric + safe punctuation, emit verbatim.
  // Otherwise wrap in single quotes and escape any embedded single quotes.
  if (/^[A-Za-z0-9_./:=@,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Format an argv array as a single shell command line. */
export function formatArgv(argv: string[]): string {
  return argv.map(quoteArg).join(" ");
}

/**
 * Render a sequence of argv groups (e.g. for multi-step `run`) as a
 * copyable block. Each line is one full command; blank line separates
 * groups if requested.
 */
export function formatArgvGroups(groups: string[][], separator = true): string {
  return groups
    .map((argv) => formatArgv(argv))
    .join(separator ? "\n\n" : "\n");
}
