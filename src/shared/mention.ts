/** Leading @Name in a prompt pins the job to that machine. */

export function parseAtMention(raw: string): { mention?: string; prompt: string } {
  const trimmed = raw.trim();
  const m = trimmed.match(/^@(?:"([^"]+)"|(\S+))(?:\s+|$)/);
  if (!m) return { prompt: trimmed };
  const mention = (m[1] ?? m[2] ?? "").trim();
  if (!mention) return { prompt: trimmed };
  return { mention, prompt: trimmed.slice(m[0].length).trim() };
}

export function normalizeMachineName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Resolve @HQ / @Block2 / @Sandras-MBP-2 to a registered worker name. */
export function matchWorkerName(
  mention: string,
  names: string[],
): { name: string } | { error: string } {
  const needle = normalizeMachineName(mention);
  if (!needle) return { error: "missing machine name after @" };
  const scored = names
    .map((name) => ({ name, key: normalizeMachineName(name) }))
    .filter((row) => row.key.length > 0);

  const exact = scored.filter((row) => row.key === needle);
  if (exact.length === 1) return { name: exact[0]!.name };

  const prefixed = scored.filter((row) => row.key.startsWith(needle));
  if (prefixed.length === 1) return { name: prefixed[0]!.name };
  if (prefixed.length > 1) {
    return { error: `ambiguous @${mention} — try ${hint(prefixed.map((r) => r.name))}` };
  }

  const contained = scored.filter((row) => row.key.includes(needle));
  if (contained.length === 1) return { name: contained[0]!.name };
  if (contained.length > 1) {
    return { error: `ambiguous @${mention} — try ${hint(contained.map((r) => r.name))}` };
  }

  return { error: `no machine named @${mention}` };
}

function hint(names: string[]): string {
  return names
    .slice(0, 4)
    .map((n) => `@${n.replace(/\s+/g, "")}`)
    .join(" or ");
}
