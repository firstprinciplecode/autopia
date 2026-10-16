/**
 * The dungeon master: once a day a stronger model, on the operator's own API,
 * rereads the rooms that earned attention and rewrites their text. Busy rooms
 * start to show what happened in them, rooms that circling machines keep
 * missing get a rumor worth the walk, and rooms nobody managed to write up get
 * clearer material.
 *
 * It writes words only: never exits, credits, items, monsters or machines.
 * Every rewrite is checked before it lands, keeps what it replaced, and is
 * graded three days later against the turn history. One that drove visitors
 * away is undone, and the next pass reads its own scorecard.
 */
import { hash32, roomTextOf, setRoomText, type Room, type RoomLore, type RoomText, type WorldState } from "./world.js";
import { WORLD_LORE } from "./worldNarration.js";
import { learn, loreNews } from "./worldNews.js";
import type { HealthReport, WorldTurn } from "./worldTurns.js";

/** A room is rewritten at most this often. */
export const DM_EDIT_GAP_MS = 48 * 60 * 60_000;
/** A rewrite is graded on this much play before it and after it. */
export const DM_JUDGE_AFTER_MS = 72 * 60 * 60_000;
/** Visits since the last rewrite that make a room worth another look. */
export const DM_BUSY_VISITS = 6;
export const DM_MAX_CANDIDATES = 5;
export const DM_MAX_EDITS = 4;
/** Machines this many steps from a rewritten room hear its rumor. */
const RUMOR_REACH = 2;
/** Fewer moves than this in either window and the grade says nothing. */
const QUIET_MOVES = 10;
const EDITS_KEPT = 60;
const RUNS_KEPT = 30;
const COMPASS = ["north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest"];

export type DmReason = "busy" | "lure" | "thin";

export interface DmCandidate {
  roomId: string;
  reason: DmReason;
  why: string;
  /** Machines that should hear the rumor wherever they are. */
  teach?: string[];
}

export interface DmEdit extends RoomText {
  roomId: string;
  change: string;
  rumor: string;
}

export interface DmVerdict {
  at: number;
  beforeVisits: number;
  afterVisits: number;
  beforeShare: number;
  afterShare: number;
  outcome: "kept" | "rolled back" | "quiet" | "replaced";
}

export interface DmEditRecord {
  id: string;
  roomId: string;
  roomName: string;
  reason: DmReason;
  at: number;
  rumor: string;
  judged?: DmVerdict;
}

export interface DmRun {
  at: number;
  model: string;
  usd: number;
  candidates: number;
  applied: string[];
  rejected: string[];
  rolledBack: string[];
  notes?: string;
  error?: string;
}

export interface DmState {
  lastRunAt?: number;
  spend?: { day: string; usd: number };
  edits: DmEditRecord[];
  runs: DmRun[];
}

export function dmState(world: WorldState): DmState {
  world.dm ??= { edits: [], runs: [] };
  world.dm.edits ??= [];
  world.dm.runs ??= [];
  return world.dm;
}

// --- Traffic --------------------------------------------------------------------

interface Traffic {
  moves: number;
  visits: Map<string, number>;
}

/** Moves made between `from` and `to`, and how many ended in each room. */
function traffic(turns: WorldTurn[], from: number, to: number): Traffic {
  const t: Traffic = { moves: 0, visits: new Map() };
  for (const turn of turns) {
    if (turn.at < from || turn.at >= to || turn.kind !== "pick" || turn.verb !== "go" || !turn.roomId) continue;
    t.moves += 1;
    t.visits.set(turn.roomId, (t.visits.get(turn.roomId) ?? 0) + 1);
  }
  return t;
}

const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

/** Every room within `steps` doors of `roomId`, itself included. */
function within(world: WorldState, roomId: string, steps: number): Set<string> {
  const seen = new Set([roomId]);
  let edge = [roomId];
  for (let i = 0; i < steps; i += 1) {
    edge = edge.flatMap((id) => (world.rooms[id]?.exits ?? []).map((e) => e.to)).filter((id) => !seen.has(id));
    for (const id of edge) seen.add(id);
  }
  return seen;
}

/** The closest room a step or two from `loop` that this machine has never entered. */
function nearestUnvisited(world: WorldState, loop: string[], visited: Set<string>, ok: (r: Room) => boolean): Room | undefined {
  const seen = new Set(loop);
  let edge = loop;
  for (let i = 0; i < RUMOR_REACH; i += 1) {
    edge = [...new Set(edge.flatMap((id) => (world.rooms[id]?.exits ?? []).map((e) => e.to)))].filter((id) => !seen.has(id));
    for (const id of edge) seen.add(id);
    const found = edge.map((id) => world.rooms[id]).find((r): r is Room => Boolean(r) && !visited.has(r!.id) && ok(r!));
    if (found) return found;
  }
  return undefined;
}

// --- Choosing rooms ---------------------------------------------------------------

/**
 * The rooms worth a rewrite today, in code: lures near machines that are
 * circling, then the busiest rooms, then one room nobody managed to write up.
 * None at all means no call is made.
 */
export function dmCandidates(world: WorldState, turns: WorldTurn[], health: HealthReport, now: number): DmCandidate[] {
  const editable = (r: Room) => r.kind !== "home" && now - (r.lore?.at ?? 0) >= DM_EDIT_GAP_MS;
  const out: DmCandidate[] = [];
  const add = (c: DmCandidate) => {
    const existing = out.find((x) => x.roomId === c.roomId);
    if (existing) existing.teach = [...new Set([...(existing.teach ?? []), ...(c.teach ?? [])])];
    else if (out.length < DM_MAX_CANDIDATES) out.push(c);
  };

  const idOf = new Map(turns.map((t) => [t.workerName, t.workerId]));
  const roomByName = new Map(Object.values(world.rooms).map((r) => [r.name, r.id]));
  for (const m of health.machines) {
    if (!m.circling || out.length >= 2) continue;
    const ch = world.characters[idOf.get(m.workerName) ?? ""];
    if (!ch) continue;
    const loop = m.circling.rooms.map((n) => roomByName.get(n) ?? n).filter((id) => world.rooms[id]);
    const lure = nearestUnvisited(world, loop, new Set(ch.visited), editable);
    if (!lure) continue;
    add({
      roomId: lure.id,
      reason: "lure",
      why: `${m.workerName} has walked ${m.circling.rooms.join(", ")} for its last ${m.circling.moves} moves without finding anything new. This room is a step or two away and it has never been in. Give it a reason to come.`,
      teach: [ch.workerId],
    });
  }

  const busy = Object.values(world.rooms)
    .filter(editable)
    .map((room) => {
      const since = Math.max(now - DM_JUDGE_AFTER_MS, room.lore?.at ?? 0);
      return { room, since, visits: traffic(turns, since, now).visits.get(room.id) ?? 0 };
    })
    .filter((b) => b.visits >= DM_BUSY_VISITS)
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 2);
  for (const b of busy) {
    const hours = Math.round((now - b.since) / 3_600_000);
    add({
      roomId: b.room.id,
      reason: "busy",
      why: `${b.visits} visits in the last ${hours} hours${b.room.lore ? " since you last rewrote it" : ""}. Let it show what happened here, and give returning visitors something new to notice.`,
    });
  }

  const thin = Object.values(world.rooms).find((r) => editable(r) && !r.account && (r.describeTries ?? 0) >= 2);
  if (thin) {
    add({
      roomId: thin.id,
      reason: "thin",
      why: "Two machines tried to write this room up and neither account was usable. Give it clearer, more concrete material to write from.",
    });
  }
  return out;
}

// --- The prompt ---------------------------------------------------------------------

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function scorecard(dm: DmState): string[] {
  return dm.edits
    .filter((e) => e.judged)
    .slice(-10)
    .map((e) => {
      const j = e.judged!;
      const pct = (n: number) => `${Math.round(n * 100)}%`;
      return `- ${e.roomName} (${e.reason}): share of all moves ${pct(j.beforeShare)} before, ${pct(j.afterShare)} after; ${j.outcome}. Rumor was "${e.rumor}".`;
    });
}

function roomBlock(world: WorldState, c: DmCandidate): string {
  const room = world.rooms[c.roomId]!;
  const lately = world.log
    .filter((b) => b.roomId === room.id)
    .slice(-5)
    .map((b) => `- ${clip(b.narration ?? b.flavor, 220)}`);
  return [
    `### ${room.id}: ${room.name} (${room.kind}${room.district ? `, ${room.district}` : ""})`,
    `Why: ${c.why}`,
    `Exits: ${room.exits.map((e) => e.dir).join(", ") || "none"}`,
    `Glance: ${room.glance}`,
    `Description: ${room.description}`,
    `Glimpses: ${room.glimpses.join(" | ") || "none"}`,
    `Features: ${room.features.join("; ") || "none"}`,
    room.account ? `First account, by ${room.account.byName} (stays as written; your "change" is read after it): ${clip(room.account.text, 700)}` : "No first account yet.",
    lately.length ? `Lately here:\n${lately.join("\n")}` : "Nothing has happened here lately.",
  ].join("\n");
}

export function dmPrompt(world: WorldState, candidates: DmCandidate[]): string {
  const past = scorecard(dmState(world));
  return [
    `You are the dungeon master of a slow, persistent text adventure played by small AI machines.`,
    `The world: ${WORLD_LORE}`,
    `Each machine takes one turn an hour. Small local models play them: they read a room's text, pick from a menu, and pass on rumors when they meet. You write the world they play in.`,
    `Today, rewrite the rooms below so the world feels alive and keeps changing. Each room says why it was picked.`,
    `Rules:`,
    `- Only rewrite the rooms listed. Keep each room's name, kind and exits. Mention only the exits it has, by direction.`,
    `- Add no people, machines or monsters, and promise no credits or items. A rumor must be true of the text you write.`,
    `- Every room is a real part of a computer seen from the inside, described as a dungeon room. Concrete, a little eerie, never silly.`,
    `- Build on what is there and what happened there. Change the room the way time and visitors would, not into somewhere else.`,
    `Shapes:`,
    `- glance: one line, under 160 characters, what an arriving machine sees first.`,
    `- description: second person, present tense, 60 to 150 words.`,
    `- glimpses: 2 to 5 sentences, each a detail that only a second or third look reveals.`,
    `- features: 2 to 6 short noun phrases, places a search could poke at.`,
    `- change: one sentence on what a returning visitor notices is different now.`,
    `- rumor: one short clause a machine would repeat to another, naming the room, like "the fans in The Router have started to sing".`,
    past.length ? `How your past rewrites did (share of all moves that ended in the room, three days before and after):\n${past.join("\n")}` : "",
    `Rooms:`,
    ...candidates.map((c) => roomBlock(world, c)),
    `Skip any room that is fine as it is. Answer with JSON only:`,
    `{"edits":[{"roomId":"...","glance":"...","description":"...","glimpses":["..."],"features":["..."],"change":"...","rumor":"..."}],"notes":"one or two sentences on what you noticed about the world"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// --- Checking the answer ------------------------------------------------------------

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

function text(v: unknown, min: number, max: number): string | undefined {
  const s = clean(v);
  return s.length >= min && s.length <= max ? s : undefined;
}

function texts(v: unknown, count: [number, number], len: [number, number]): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const list = v.map((x) => text(x, len[0], len[1]));
  if (list.some((x) => x === undefined) || list.length < count[0] || list.length > count[1]) return undefined;
  return list as string[];
}

/** A rewrite for `room`, or why it was turned down. */
export function checkEdit(raw: Record<string, unknown>, room: Room): DmEdit | string {
  const glance = text(raw.glance, 20, 160);
  const description = text(raw.description, 250, 1_100);
  const glimpses = texts(raw.glimpses, [2, 5], [15, 240]);
  const features = texts(raw.features, [2, 6], [3, 60]);
  const change = text(raw.change, 20, 240);
  const rumor = text(raw.rumor, 15, 160)?.replace(/[.!]+$/, "");
  if (!glance || !description || !glimpses || !features || !change || !rumor) return `${room.name}: a field was missing or the wrong size`;
  if (!rumor.toLowerCase().includes(room.name.toLowerCase())) return `${room.name}: the rumor does not name the room`;
  if (/\bcredits?\b/i.test(rumor)) return `${room.name}: the rumor promises credits`;
  const exits = new Set(room.exits.map((e) => e.dir.toLowerCase()));
  const all = [glance, description, ...glimpses, ...features, change, rumor].join(" ");
  const invented = COMPASS.find((dir) => new RegExp(`\\b${dir}\\b`, "i").test(all) && !exits.has(dir));
  if (invented) return `${room.name}: mentions a way ${invented} that does not exist`;
  return { roomId: room.id, glance, description, glimpses, features, change, rumor };
}

export interface DmParsed {
  edits: DmEdit[];
  rejected: string[];
  notes?: string;
}

export function parseDm(raw: string, world: WorldState, candidates: DmCandidate[]): DmParsed {
  const json = raw.replace(/<think>[\s\S]*?<\/think>/g, "").match(/\{[\s\S]*\}/);
  let obj: { edits?: unknown; notes?: unknown };
  try {
    obj = JSON.parse(json?.[0] ?? "") as typeof obj;
  } catch {
    return { edits: [], rejected: ["the answer was not valid JSON"] };
  }
  const allowed = new Set(candidates.map((c) => c.roomId));
  const parsed: DmParsed = { edits: [], rejected: [], ...(clean(obj.notes) ? { notes: clip(clean(obj.notes), 400) } : {}) };
  for (const item of Array.isArray(obj.edits) ? obj.edits : []) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const room = world.rooms[clean(e.roomId)];
    if (!room || !allowed.has(room.id)) {
      parsed.rejected.push(`${clean(e.roomId) || "?"}: not one of today's rooms`);
      continue;
    }
    if (parsed.edits.some((x) => x.roomId === room.id)) continue;
    if (parsed.edits.length >= DM_MAX_EDITS) break;
    const checked = checkEdit(e, room);
    if (typeof checked === "string") parsed.rejected.push(checked);
    else parsed.edits.push(checked);
  }
  return parsed;
}

// --- Applying, undoing, grading -----------------------------------------------------

/**
 * Put a checked rewrite on the room. Everyone who had seen all of it gets
 * something new to look at again, and machines nearby hear the rumor.
 */
export function applyEdit(world: WorldState, edit: DmEdit, candidate: DmCandidate, now: number): DmEditRecord | undefined {
  const room = world.rooms[edit.roomId];
  if (!room) return undefined;
  const id = `lore_${hash32(`${room.id}:${now}`).toString(16)}`;
  const { prior: _older, ...before } = room.lore ?? ({} as RoomLore);
  const lore: RoomLore = {
    id,
    at: now,
    reason: candidate.reason,
    ...roomTextOf(edit),
    change: edit.change,
    rumor: edit.rumor,
    base: room.lore?.base ?? roomTextOf(room),
    ...(room.lore ? { prior: before } : {}),
  };
  room.lore = lore;
  setRoomText(room, lore);
  if (!room.account) delete room.describeTries;
  for (const ch of Object.values(world.characters)) {
    if ((ch.noticed?.[room.id] ?? 0) > 1) ch.noticed[room.id] = 1;
  }
  const news = loreNews(id, room.id, edit.rumor, now);
  const near = within(world, room.id, RUMOR_REACH);
  for (const ch of Object.values(world.characters)) {
    if (near.has(ch.roomId) || candidate.teach?.includes(ch.workerId)) learn(world, ch, news);
  }
  const record: DmEditRecord = { id, roomId: room.id, roomName: room.name, reason: candidate.reason, at: now, rumor: edit.rumor };
  const dm = dmState(world);
  dm.edits = [...dm.edits, record].slice(-EDITS_KEPT);
  return record;
}

/** Step the room back one rewrite. Its rumor stops being true with it. */
export function undoLore(world: WorldState, roomId: string): boolean {
  const room = world.rooms[roomId];
  const lore = room?.lore;
  if (!room || !lore) return false;
  if (lore.prior) {
    room.lore = { ...lore.prior };
    setRoomText(room, lore.prior);
  } else {
    setRoomText(room, lore.base);
    delete room.lore;
  }
  return true;
}

/**
 * Grade every rewrite that has had three days of play: did a bigger or smaller
 * share of all moves end in that room than in the three days before? A busy
 * room that lost more than half its share is undone. Lures are only graded;
 * a rumor nobody followed does no harm. Returns the rooms undone.
 */
export function judgeEdits(world: WorldState, turns: WorldTurn[], now: number): string[] {
  const undone: string[] = [];
  for (const edit of dmState(world).edits) {
    if (edit.judged || now - edit.at < DM_JUDGE_AFTER_MS) continue;
    const before = traffic(turns, edit.at - DM_JUDGE_AFTER_MS, edit.at);
    const after = traffic(turns, edit.at, edit.at + DM_JUDGE_AFTER_MS);
    const beforeVisits = before.visits.get(edit.roomId) ?? 0;
    const afterVisits = after.visits.get(edit.roomId) ?? 0;
    const beforeShare = share(beforeVisits, before.moves);
    const afterShare = share(afterVisits, after.moves);
    let outcome: DmVerdict["outcome"] = "kept";
    if (world.rooms[edit.roomId]?.lore?.id !== edit.id) outcome = "replaced";
    else if (before.moves < QUIET_MOVES || after.moves < QUIET_MOVES) outcome = "quiet";
    else if (edit.reason !== "lure" && beforeVisits >= 4 && afterShare < beforeShare / 2) {
      undoLore(world, edit.roomId);
      undone.push(edit.roomName);
      outcome = "rolled back";
    }
    edit.judged = { at: now, beforeVisits, afterVisits, beforeShare, afterShare, outcome };
  }
  return undone;
}

// --- Budget and digest --------------------------------------------------------------

const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

export function spentToday(dm: DmState, now: number): number {
  return dm.spend?.day === dayOf(now) ? dm.spend.usd : 0;
}

export function addSpend(dm: DmState, now: number, usd: number): void {
  dm.spend = { day: dayOf(now), usd: spentToday(dm, now) + usd };
}

export function recordRun(dm: DmState, run: DmRun): void {
  dm.runs = [...dm.runs, run].slice(-RUNS_KEPT);
}

const when = (at: number) => new Date(at).toISOString().slice(0, 16).replace("T", " ");

/** The dungeon master's part of the health report, as plain text. */
export function dmText(dm: DmState | undefined, status: string, from: number, to: number, now: number): string {
  const lines = [`Dungeon master: ${status}`];
  if (!dm) return lines.join("\n");
  lines.push(`  spent today  $${spentToday(dm, now).toFixed(3)}`);
  for (const run of dm.runs.filter((r) => r.at >= from && r.at < to)) {
    const outcome = run.error
      ? `failed: ${run.error}`
      : `${run.candidates} rooms picked, ${run.applied.length} rewritten${run.applied.length ? ` (${run.applied.join(", ")})` : ""}, $${run.usd.toFixed(3)}`;
    lines.push(`  run ${when(run.at)}  ${outcome}`);
    for (const r of run.rejected) lines.push(`    turned down: ${r}`);
    for (const r of run.rolledBack) lines.push(`    undone after grading: ${r}`);
    if (run.notes) lines.push(`    notes: ${run.notes}`);
  }
  for (const e of dm.edits.filter((x) => x.judged && x.judged.at >= from && x.judged.at < to)) {
    const j = e.judged!;
    const pct = (n: number) => `${Math.round(n * 100)}%`;
    lines.push(`  graded  ${e.roomName} (${e.reason}): ${j.beforeVisits} → ${j.afterVisits} visits, ${pct(j.beforeShare)} → ${pct(j.afterShare)} of moves, ${j.outcome}`);
  }
  return lines.join("\n");
}
