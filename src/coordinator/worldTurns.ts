/**
 * Every world job that settles is kept as a turn: what the machine was asked, what came back, and
 * what the world made of it. The live log keeps the last beats for players; turns are the full
 * record the health report reads to see how exploring, talking and writing are actually going.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/** Bump when a world prompt or menu rule changes, so turns can be compared before and after. */
export const PROMPT_VERSION = "2026-10-04";

export type TurnKind = "pick" | "account" | "narration" | "talk";

export interface WorldTurn {
  id: string;
  at: number;
  kind: TurnKind;
  promptVersion: string;
  /** The machine whose turn it was. */
  workerId: string;
  workerName: string;
  /** The machine that did the thinking, and with what. */
  helperName: string;
  model: string;
  prompt: string;
  output: string;
  error?: string;
  tokens: number;
  durationMs: number;
  costCredits: number;
  roomId?: string;
  roomName?: string;
  // Picks
  /** The answer named an item on the menu. */
  parsed?: boolean;
  chosenBy?: "model" | "policy";
  choice?: string;
  verb?: string;
  firstVisit?: boolean;
  /** A door to a room this machine has never entered was on the menu. */
  newDoorOffered?: boolean;
  /** No new door here, but one leads toward unexplored rooms. */
  towardOffered?: boolean;
  tookNew?: boolean;
  tookToward?: boolean;
  /** The menu led with rest because the machine was out of energy. */
  tired?: boolean;
  // Write-ups
  /** The account, narration or dialogue passed the checks and was kept. */
  accepted?: boolean;
  otherName?: string;
}

export interface TurnStore {
  record(turn: WorldTurn): Promise<void>;
  between(from: number, to: number): Promise<WorldTurn[]>;
}

/** Local runs: one JSON line per turn next to the state file. */
export class JsonlTurnStore implements TurnStore {
  constructor(private readonly path: string) {}

  async record(turn: WorldTurn): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(turn)}\n`);
  }

  async between(from: number, to: number): Promise<WorldTurn[]> {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as WorldTurn)
      .filter((t) => t.at >= from && t.at < to);
  }
}

// --- Health ---------------------------------------------------------------------

export interface MachineHealth {
  workerName: string;
  turns: number;
  picks: number;
  moves: number;
  newRooms: number;
  /** Moves into rooms already visited, as a share of all moves. */
  revisitShare: number;
  /** Set when the last moves stayed inside a few known rooms. */
  circling?: { rooms: string[]; moves: number };
  newDoorOffered: number;
  newDoorSkipped: number;
  towardOffered: number;
  towardSkipped: number;
  /** Picks the fallback made because the answer did not name a menu item. */
  policyPicks: number;
  rests: number;
  tiredRests: number;
  accounts: number;
  accountsKept: number;
  narrations: number;
  narrationsKept: number;
  talks: number;
  talksKept: number;
  /** Average word overlap of a meeting's dialogue with the same pair's previous one (0–1). */
  talkRepeat?: number;
  failedJobs: number;
  credits: number;
  tokens: number;
  flags: string[];
}

export interface ModelHealth {
  model: string;
  picks: number;
  unparsed: number;
  failed: number;
  avgMs: number;
}

export interface HealthReport {
  from: number;
  to: number;
  turns: number;
  machines: MachineHealth[];
  models: ModelHealth[];
  promptVersions: string[];
}

const CIRCLE_WINDOW = 16;
const CIRCLE_MAX_ROOMS = 6;

const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0);
const pct = (n: number) => `${Math.round(n * 100)}%`;

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z']{3,}/g) ?? []);
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const w of a) if (b.has(w)) common += 1;
  return common / (a.size + b.size - common);
}

function machineHealth(name: string, turns: WorldTurn[], previousTalk: Map<string, Set<string>>): MachineHealth {
  const picks = turns.filter((t) => t.kind === "pick" && !t.error);
  const moves = picks.filter((t) => t.verb === "go");
  const newRooms = moves.filter((t) => t.firstVisit).length;
  const accounts = turns.filter((t) => t.kind === "account");
  const narrations = turns.filter((t) => t.kind === "narration");
  const talks = turns.filter((t) => t.kind === "talk");

  const repeats: number[] = [];
  for (const t of talks.filter((x) => x.accepted && x.otherName)) {
    const pair = [t.workerName, t.otherName!].map((n) => n.toLowerCase()).sort().join("|");
    const now = words(t.output);
    const before = previousTalk.get(pair);
    if (before) repeats.push(overlap(before, now));
    previousTalk.set(pair, now);
  }

  const recent = moves.slice(-CIRCLE_WINDOW);
  const recentRooms = [...new Set(recent.map((t) => t.roomName ?? t.roomId ?? "?"))];
  const circling = recent.length >= CIRCLE_WINDOW && recentRooms.length <= CIRCLE_MAX_ROOMS && !recent.some((t) => t.firstVisit)
    ? { rooms: recentRooms, moves: recent.length }
    : undefined;

  const offered = picks.filter((t) => t.newDoorOffered);
  const toward = picks.filter((t) => t.towardOffered && !t.newDoorOffered);
  const h: MachineHealth = {
    workerName: name,
    turns: turns.length,
    picks: picks.length,
    moves: moves.length,
    newRooms,
    revisitShare: share(moves.length - newRooms, moves.length),
    ...(circling ? { circling } : {}),
    newDoorOffered: offered.length,
    newDoorSkipped: offered.filter((t) => !t.tookNew).length,
    towardOffered: toward.length,
    towardSkipped: toward.filter((t) => !t.tookToward).length,
    policyPicks: picks.filter((t) => t.chosenBy === "policy").length,
    rests: picks.filter((t) => t.verb === "rest").length,
    tiredRests: picks.filter((t) => t.verb === "rest" && t.tired).length,
    accounts: accounts.length,
    accountsKept: accounts.filter((t) => t.accepted).length,
    narrations: narrations.length,
    narrationsKept: narrations.filter((t) => t.accepted).length,
    talks: talks.length,
    talksKept: talks.filter((t) => t.accepted).length,
    ...(repeats.length ? { talkRepeat: repeats.reduce((s, r) => s + r, 0) / repeats.length } : {}),
    failedJobs: turns.filter((t) => t.error).length,
    credits: turns.reduce((s, t) => s + t.costCredits, 0),
    tokens: turns.reduce((s, t) => s + t.tokens, 0),
    flags: [],
  };

  if (h.circling) h.flags.push(`circling ${h.circling.rooms.length} known rooms over the last ${h.circling.moves} moves`);
  if (h.newDoorOffered >= 4 && share(h.newDoorSkipped, h.newDoorOffered) > 0.5) {
    h.flags.push(`skipped a new door ${h.newDoorSkipped} of ${h.newDoorOffered} times it was offered`);
  }
  if (h.towardOffered >= 4 && share(h.towardSkipped, h.towardOffered) > 0.6) {
    h.flags.push(`turned away from the way to unexplored rooms ${h.towardSkipped} of ${h.towardOffered} times`);
  }
  if (h.picks >= 5 && share(h.policyPicks, h.picks) > 0.2) h.flags.push(`${pct(share(h.policyPicks, h.picks))} of picks fell back to the policy`);
  if (h.accounts >= 2 && share(h.accountsKept, h.accounts) < 0.5) h.flags.push(`only ${h.accountsKept} of ${h.accounts} room write-ups were kept`);
  if (h.narrations >= 3 && share(h.narrationsKept, h.narrations) < 0.5) h.flags.push(`only ${h.narrationsKept} of ${h.narrations} narrations were kept`);
  if (h.talks >= 2 && share(h.talksKept, h.talks) < 0.5) h.flags.push(`only ${h.talksKept} of ${h.talks} conversations were kept`);
  if ((h.talkRepeat ?? 0) > 0.45) h.flags.push(`conversations repeat themselves (${pct(h.talkRepeat!)} word overlap with the last one)`);
  if (h.picks >= 5 && share(h.rests, h.picks) > 0.4) h.flags.push(`rested ${h.rests} of ${h.picks} turns`);
  if (h.turns >= 5 && share(h.failedJobs, h.turns) > 0.2) h.flags.push(`${h.failedJobs} of ${h.turns} world jobs failed`);
  return h;
}

/** How the world went between `from` and `to`, per machine and per model, with plain flags. */
export function worldHealth(turns: WorldTurn[], from: number, to: number): HealthReport {
  const inWindow = turns.filter((t) => t.at >= from && t.at < to).sort((a, b) => a.at - b.at);
  const byMachine = new Map<string, WorldTurn[]>();
  for (const t of inWindow) byMachine.set(t.workerName, [...(byMachine.get(t.workerName) ?? []), t]);
  const previousTalk = new Map<string, Set<string>>();
  const machines = [...byMachine]
    .map(([name, list]) => machineHealth(name, list, previousTalk))
    .sort((a, b) => b.flags.length - a.flags.length || a.workerName.localeCompare(b.workerName));

  const byModel = new Map<string, WorldTurn[]>();
  for (const t of inWindow) byModel.set(t.model, [...(byModel.get(t.model) ?? []), t]);
  const models = [...byModel].map(([model, list]) => {
    const picks = list.filter((t) => t.kind === "pick" && !t.error);
    const timed = list.filter((t) => !t.error && t.durationMs > 0);
    return {
      model,
      picks: picks.length,
      unparsed: picks.filter((t) => !t.parsed).length,
      failed: list.filter((t) => t.error).length,
      avgMs: timed.length ? Math.round(timed.reduce((s, t) => s + t.durationMs, 0) / timed.length) : 0,
    };
  }).sort((a, b) => b.picks - a.picks);

  return {
    from,
    to,
    turns: inWindow.length,
    machines,
    models,
    promptVersions: [...new Set(inWindow.map((t) => t.promptVersion))],
  };
}

/** The report as plain text for a terminal. */
export function healthText(report: HealthReport): string {
  const hours = Math.round((report.to - report.from) / 3_600_000);
  const lines = [`World health, last ${hours} h: ${report.turns} turns (prompts ${report.promptVersions.join(", ") || "none"})`];
  if (!report.turns) return `${lines[0]}\nNothing recorded yet.`;
  for (const m of report.machines) {
    lines.push("", `${m.workerName}${m.flags.length ? `  ⚠ ${m.flags.length}` : ""}`);
    lines.push(`  explore   ${m.moves} moves, ${m.newRooms} new rooms, ${pct(m.revisitShare)} revisits; new door taken ${m.newDoorOffered - m.newDoorSkipped}/${m.newDoorOffered}`);
    lines.push(`  choose    ${m.picks} picks, ${m.policyPicks} by fallback, ${m.rests} rests (${m.tiredRests} tired)`);
    lines.push(`  write     rooms ${m.accountsKept}/${m.accounts} kept, narration ${m.narrationsKept}/${m.narrations}, talks ${m.talksKept}/${m.talks}${m.talkRepeat !== undefined ? ` (${pct(m.talkRepeat)} repeat)` : ""}`);
    lines.push(`  spend     ${m.credits} credits, ${m.tokens} tokens, ${m.failedJobs} failed jobs`);
    for (const f of m.flags) lines.push(`  ! ${f}`);
  }
  lines.push("", "Models");
  for (const m of report.models) {
    lines.push(`  ${m.model.padEnd(16)} ${m.picks} picks, ${m.unparsed} unparsed, ${m.failed} failed, ${m.avgMs} ms avg`);
  }
  return lines.join("\n");
}
