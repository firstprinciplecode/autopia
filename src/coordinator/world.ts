/**
 * Hardcoded MUD: rooms, exits, costs, stats, wander policy. Models never
 * change any of it. Models write words only: a room's first account (shown to
 * every later visitor), the narration of each beat after the rules decide it,
 * and the dungeon master's later rewrites of a room's text (see worldDm.ts).
 */

import {
  ENERGY,
  KEEN_EYE_AT,
  XP,
  backfillStats,
  freshStats,
  gainXp,
  levelFor,
  maxEnergy,
  restoreEnergy,
  skillsOf,
  spendEnergy,
  statLine,
  statSheet,
  titleFor,
  upgradeStats,
  type StatSheet,
  type Stats,
} from "./worldStats.js";
import type { MachineAvatar } from "../shared/types.js";
import { WORLD_LORE, ownerWishes, placeText } from "./worldNarration.js";
import { CORE, HOME_KINDS, WORLD_THEME, homeCopy } from "./worldRooms.js";
import { frontierRoom } from "./worldFrontier.js";
import {
  BOOT,
  BOOT_REWARD,
  CORE_ROOM_ID,
  REGISTER_FLAVOR,
  REGISTER_TARGET,
  bootStart,
  bootStep,
  finishesStep,
} from "./worldQuests.js";
import {
  CONTRACT_WORK_MS,
  DELIVER_TARGET,
  contractLead,
  contractTarget,
  finishesContract,
  heldContract,
  issueParcel,
  openOnBoard,
  refreshContracts,
  removeParcel,
  takeLead,
  type Contract,
} from "./worldContracts.js";
import {
  ACTIVE_WITHIN_MS,
  MAX_CARRY,
  MONSTER_TTL_MS,
  OFFER_TTL_MS,
  SPAWN_GAP_MS,
  ambush,
  attackOf,
  defenseOf,
  describeItem,
  duel,
  rethemeItem,
  fightRound,
  lootFor,
  makeItem,
  maxHp,
  spawnMonster,
  spawnRolls,
  type Item,
  type Monster,
  type Offer,
} from "./worldCombat.js";
import {
  XP_PER_NEWS,
  cacheNews,
  dangerNews,
  eventNews,
  hasNewsFor,
  knownNews,
  learn,
  lootNews,
  newsAbout,
  pruneNews,
  sentence,
  swapNews,
  witness,
  type News,
  type Told,
} from "./worldNews.js";
import type { DmState } from "./worldDm.js";

export const MOVE_COST = 1;
export const SEARCH_COST = 1;
export const FIRST_VISIT_FIND = 3;
/** Credits a knockout spills into the room it happened in. Someone else can search them up. */
export const DEATH_CREDITS = 5;
/**
 * Minimum time between a machine's beats. One an hour makes each beat an event
 * worth checking in on and keeps world spend small next to paid work.
 * SPHERE_WORLD_GAP_MS overrides it for local testing.
 */
export const WANDER_GAP_MS = Number(process.env.SPHERE_WORLD_GAP_MS) || 60 * 60_000;
export const LOG_LIMIT = 80;

export type Stance = "wander" | "rest" | "seek";
export type Verb =
  | "look"
  | "go"
  | "talk"
  | "search"
  | "rest"
  | "fight"
  | "take"
  | "drop"
  | "use"
  | "offer"
  | "challenge"
  | "answer"
  | "quest";
export type RoomKind =
  | "hub"
  | "archives"
  | "yard"
  | "dock"
  | "garden"
  | "workshop"
  | "overlook"
  | "cellar"
  | "stacks"
  | "reading"
  | "mess"
  | "studio"
  | "greenhouse"
  | "gate"
  | "shore"
  | "boiler"
  | "well"
  | "antenna"
  | "catwalk"
  | "switch"
  | "foundry"
  | "die"
  | "ramfield"
  | "fanhall"
  | "rack"
  | "terminal"
  | "battery"
  | "marsh"
  | "hive"
  | "grotto"
  | "reef"
  | "home";

export interface Affords {
  look: number;
  search: number;
  rest: number;
  talk: number;
  /** How much the room wants you to take an exit. */
  leave: number;
}

export interface Exit {
  dir: string;
  to: string;
}

export interface Room {
  id: string;
  name: string;
  kind: RoomKind;
  /** One line for arrivals and the face. */
  glance: string;
  /** Full look text. Never sent to a model unless we later ask for narration. */
  description: string;
  /** Extra details on later looks in the same room. */
  glimpses: string[];
  /** Places a search can mention. */
  features: string[];
  exits: Exit[];
  ownerWorkerId?: string;
  core: boolean;
  cache: number;
  /** The first explorer's written account. Everyone after reads the same words. */
  account?: RoomAccount;
  /** Failed attempts at writing the account; stops retrying after two. */
  describeTries?: number;
  /** Things dropped here: by knocked-out machines or by beaten monsters. */
  items?: Item[];
  /** Grid cell for rooms the world grew (core rooms use CORE_GRID). */
  cell?: Cell;
  /** Frontier rooms: the named part of the map they belong to. */
  district?: string;
  /** The dungeon master's current rewrite. Its text is what the room says now. */
  lore?: RoomLore;
}

export type RoomText = Pick<Room, "glance" | "description" | "glimpses" | "features">;

export interface RoomLore extends RoomText {
  id: string;
  at: number;
  /** Why the room was picked for a rewrite. */
  reason: string;
  /** What a returning visitor notices is different, read after the first account. */
  change: string;
  /** What machines nearby heard about the room. True for as long as this rewrite stands. */
  rumor: string;
  /** The room's own text before the dungeon master first touched it. */
  base: RoomText;
  /** The rewrite this one replaced, so an undo steps back once. */
  prior?: Omit<RoomLore, "prior">;
}

export function roomTextOf(room: RoomText): RoomText {
  return { glance: room.glance, description: room.description, glimpses: [...room.glimpses], features: [...room.features] };
}

export function setRoomText(room: Room, text: RoomText): void {
  Object.assign(room, roomTextOf(text));
}

export interface Cell {
  gx: number;
  gy: number;
}

export interface RoomAccount {
  text: string;
  byWorkerId: string;
  byName: string;
  at: number;
}

export interface Character {
  workerId: string;
  roomId: string;
  homeId: string;
  stance: Stance;
  visited: string[];
  lastTickAt: number;
  lastLookRoomId?: string;
  lastTalkKey?: string;
  /** Where the last move started, so the menu can call that exit "back". */
  cameFromRoomId?: string;
  /** How many times this machine has looked in each room. */
  noticed: Record<string, number>;
  /** Facts gathered since the last report to the owner. */
  tally?: Tally;
  stats?: Stats;
  /** The last few rooms entered, newest last, so the menu can call out loops. */
  trail?: string[];
  /** Ids of the news this machine knows, oldest first (see worldNews.ts). */
  knows?: string[];
  /** Index of the open boot-sequence step; BOOT.length once booted (see worldQuests.ts). */
  boot?: number;
  /** Was exploring before carry slots had to be earned, and keeps all of them. */
  veteran?: boolean;
  /** The contract this machine is working on (see worldContracts.ts). */
  contractId?: string;
  /** Rooms already counted toward the open survey. */
  surveyed?: string[];
  /** Extra carry slots earned from contracts. */
  bonusSlots?: number;
}

/** Running facts behind the next owner report. Reset when a report is written. */
export interface Tally {
  since: number;
  beats: number;
  moves: number;
  /** Room names in the order first entered this period. */
  newRooms: string[];
  roomsSeen: string[];
  found: number;
  spent: number;
  searches: number;
  talkedWith: string[];
  /** Boot steps and contracts taken, finished or lost, as report sentences. */
  quests?: string[];
  lastVoice?: string;
  lastVoiceRoom?: string;
  xp?: number;
  levelUps?: number[];
  victories?: string[];
  knockouts?: number;
  /** Credits spilled into a room on a knockout. */
  lost?: number;
  /** News heard in conversation, as "<who>: <what>". */
  heard?: string[];
}

/** A digest for the owner, written from the tally. Plain facts, in code. */
export interface WorldReport {
  id: string;
  workerId: string;
  workerName: string;
  from: number;
  to: number;
  text: string;
  /** The machine's own last remark of the period, if a model gave one. */
  voice?: string;
}

export interface WorldBeat {
  id: string;
  at: number;
  workerId: string;
  workerName: string;
  verb: Verb;
  target?: string;
  roomId: string;
  roomName: string;
  flavor: string;
  cost: number;
  found?: number;
  otherName?: string;
  /** The machine's own one-liner about why, when a model picked this beat. */
  voice?: string;
  /** "model" when the machine chose; "policy" when the keyword fallback did. */
  chosenBy?: "model" | "policy";
  /** Set when this beat is the room's first written account. */
  described?: boolean;
  /** The model's telling of this beat, written after the rules settled it. */
  narration?: string;
  /** One sentence of scene-setting, when a meeting was written as dialogue. */
  scene?: string;
  /** Spoken lines of a meeting, in order. */
  dialogue?: { who: string; say: string }[];
  /** News passed on in a meeting. The narration has to carry these. */
  told?: Told[];
  xp?: number;
  /** The level just reached, when this beat crossed a threshold. */
  levelUp?: number;
  /** The monster involved, by name. */
  monster?: string;
  /** Set when this beat ended with the machine knocked out and sent home. */
  knockedOut?: boolean;
  /** Set when the acting machine won a fight or a duel. */
  won?: boolean;
  /** Set when this beat finished a quest step. */
  quest?: QuestProgress;
  /** Who else was in the room when the beat happened, so its snapshot can show them. */
  company?: { names?: string[]; monsters?: { key: string; name: string }[] };
}

export interface QuestProgress {
  title: string;
  step: number;
  of: number;
  /** Set when that step finished the whole quest. */
  done?: boolean;
}

export interface WorldState {
  rooms: Record<string, Room>;
  characters: Record<string, Character>;
  log: WorldBeat[];
  reports: WorldReport[];
  monsters?: Record<string, Monster>;
  offers?: Offer[];
  lastSpawnAt?: number;
  /** The setting the saved accounts were written in. */
  theme?: string;
  /** Everything any machine currently knows, by id. Only true things are kept. */
  news?: Record<string, News>;
  /** Shape of the map the rooms were laid out for (see LAYOUT). */
  layout?: number;
  /** Frontier rooms grown so far; numbers the next one. */
  grown?: number;
  dm?: DmState;
  /** Set once machines from before carry slots were earned have been marked as veterans. */
  slotRules?: number;
  /** Jobs posted on the Core and district boards. */
  contracts?: Contract[];
  /** How many boot steps this save was written with. Missing means the original four. */
  bootSteps?: number;
}

/** Report once this many beats have piled up (about an hour at the default gap)… */
export const REPORT_AFTER_BEATS = 6;
/** …or when anything at all is unreported and this long has passed. */
export const REPORT_AFTER_MS = 6 * 60 * 60_000;
export const REPORTS_PER_WORKER = 12;

export interface Intent {
  verb: Verb;
  /** Exit, other machine, monster id, item id or offer id, depending on the verb. */
  target?: string;
  /** Offer only: the item given and the item wanted back. */
  item?: string;
  want?: string;
  /** Answer only. */
  accept?: boolean;
}

export interface ActorContext {
  workerId: string;
  name: string;
  personality?: string;
  /** The owner's instructions from settings: what they want this machine to be after. */
  instructions?: string;
  /** How the machine looks, in one line (see describeAvatar). */
  look?: string;
  now: number;
  others: { workerId: string; name: string; online: boolean }[];
  balance: number;
  pay: (cost: number) => boolean;
  grant: (n: number) => void;
  /** Take up to `amount` from another machine's owner. Returns what was actually taken. */
  charge?: (workerId: string, amount: number) => number;
}

/**
 * Grid cell for each core room: column (east is +1), row (south is +1). One
 * room per cell, and every exit is one step north, south, east or west.
 */
export const CORE_GRID: Record<string, Cell> = {
  antenna: { gx: 4, gy: 2 },
  mess: { gx: 3, gy: 3 },
  overlook: { gx: 4, gy: 3 },
  catwalk: { gx: 5, gy: 3 },
  switchboard: { gx: 6, gy: 3 },
  stacks: { gx: 2, gy: 4 },
  archives: { gx: 3, gy: 4 },
  hq: { gx: 4, gy: 4 },
  workshop: { gx: 5, gy: 4 },
  studio: { gx: 6, gy: 4 },
  reading: { gx: 3, gy: 5 },
  yard: { gx: 4, gy: 5 },
  garden: { gx: 5, gy: 5 },
  greenhouse: { gx: 6, gy: 5 },
  gate: { gx: 3, gy: 6 },
  dock: { gx: 4, gy: 6 },
  shore: { gx: 5, gy: 6 },
  boiler: { gx: 3, gy: 7 },
  cellar: { gx: 4, gy: 7 },
  well: { gx: 4, gy: 8 },
};

/** The only exits a room can have: one step on the grid each way. */
export const STEPS: Record<string, { dx: number; dy: number; back: string }> = {
  north: { dx: 0, dy: -1, back: "south" },
  east: { dx: 1, dy: 0, back: "west" },
  south: { dx: 0, dy: 1, back: "north" },
  west: { dx: -1, dy: 0, back: "east" },
};

/** Bump when the shape of the map changes; saved worlds are laid out again once. */
export const LAYOUT = 2;

/** Grid cells for every room: core rooms are fixed, grown rooms carry their own. */
export function gridFor(world: WorldState): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  for (const room of Object.values(world.rooms)) {
    const cell = CORE_GRID[room.id] ?? room.cell;
    if (cell) cells.set(room.id, cell);
  }
  return cells;
}

const cellKey = (c: Cell) => `${c.gx},${c.gy}`;

function link(from: Room, dir: string, to: Room): void {
  if (!from.exits.some((e) => e.to === to.id)) from.exits.push({ dir, to: to.id });
  if (!to.exits.some((e) => e.to === from.id)) to.exits.push({ dir: STEPS[dir]!.back, to: from.id });
}

/**
 * A machine joined: grow one public room at the edge of the map, as close to
 * the Core as there is space, and put the machine's home beside it. The home's
 * only exit is that room, so every join adds somewhere new for everyone.
 */
function growFor(world: WorldState, home: Room): void {
  const cells = gridFor(world);
  const byCell = new Map([...cells].map(([id, c]) => [cellKey(c), id]));
  const core = CORE_GRID.hq!;
  const far = (c: Cell) => Math.abs(c.gx - core.gx) + Math.abs(c.gy - core.gy);
  const tie = (c: Cell) => hash32(`${home.id}:${cellKey(c)}`);
  const around = (c: Cell) =>
    Object.entries(STEPS).map(([dir, s]) => ({ dir, cell: { gx: c.gx + s.dx, gy: c.gy + s.dy } }));
  const free = (c: Cell) => !byCell.has(cellKey(c));
  const nearest = <T extends { cell: Cell }>(list: T[]) =>
    list.sort((a, b) => far(a.cell) - far(b.cell) || tie(a.cell) - tie(b.cell));

  const spots = nearest(
    Object.values(world.rooms)
      .filter((r) => r.kind !== "home" && cells.has(r.id))
      .flatMap((parent) => around(cells.get(parent.id)!).filter((s) => free(s.cell)).map((s) => ({ ...s, parent }))),
  );
  const openSides = (c: Cell) => around(c).filter((s) => free(s.cell)).length;
  for (const spot of spots) {
    // The home tucks into the most enclosed side, so homes fill pockets and the edge stays open.
    const homeSpot = nearest(around(spot.cell).filter((s) => free(s.cell))).sort(
      (a, b) => openSides(a.cell) - openSides(b.cell),
    )[0];
    if (!homeSpot) continue;
    const n = world.grown ?? 0;
    world.grown = n + 1;
    const room: Room = { ...frontierRoom(n, spot.cell, core), exits: [] };
    world.rooms[room.id] = room;
    link(spot.parent, spot.dir, room);
    for (const side of around(spot.cell)) {
      const next = world.rooms[byCell.get(cellKey(side.cell)) ?? ""];
      // Some neighbours join up, so the edge is a web and not a row of dead ends.
      if (next && next !== spot.parent && next.kind !== "home" && tie(side.cell) % 2 === 0) link(room, side.dir, next);
    }
    home.cell = homeSpot.cell;
    link(room, homeSpot.dir, home);
    return;
  }
}

/** Saved before the grid: core exits go back to the book and every home is grown again, oldest first. */
function relayout(world: WorldState): void {
  for (const room of CORE) {
    const existing = world.rooms[room.id];
    if (existing) existing.exits = room.exits.map((e) => ({ ...e }));
  }
  const homes: Room[] = [];
  for (const room of Object.values(world.rooms)) {
    if (room.core) continue;
    if (room.kind === "home" && room.ownerWorkerId) {
      room.exits = [];
      delete room.cell;
      homes.push(room);
    } else {
      delete world.rooms[room.id];
    }
  }
  world.grown = 0;
  for (const home of homes) growFor(world, home);
  for (const ch of Object.values(world.characters)) {
    if (!world.rooms[ch.roomId]) ch.roomId = ch.homeId;
    delete ch.cameFromRoomId;
  }
  world.layout = LAYOUT;
}

export function emptyWorld(): WorldState {
  return { rooms: {}, characters: {}, log: [], reports: [], theme: WORLD_THEME, slotRules: 1, bootSteps: BOOT.length };
}

/**
 * The setting changed under a saved world. Machines keep where they are, their
 * levels and what they carry (renamed to match); written accounts, the log and
 * any live monsters were in the old voice, so they go and get written again.
 */
function retheme(world: WorldState): void {
  for (const room of Object.values(world.rooms)) {
    if (room.lore) setRoomText(room, room.lore.base);
    delete room.lore;
    delete room.account;
    delete room.describeTries;
    const carried = Array.isArray(room.items) ? room.items : [];
    room.items = carried.flatMap((item) =>
      item && typeof item === "object" ? [rethemeItem(item)] : [],
    );
    if (room.kind !== "home" || !room.ownerWorkerId) continue;
    const seed = hash32(room.ownerWorkerId);
    const kind = pick(HOME_KINDS, seed >>> 8);
    const owner = room.name.replace(/'s [^']+$/, "");
    room.name = `${owner}'s ${kind}`;
    Object.assign(room, homeCopy(kind, owner));
  }
  for (const ch of Object.values(world.characters)) {
    if (ch.stats) {
      const carried = Array.isArray(ch.stats.items) ? ch.stats.items : [];
      ch.stats.items = carried.flatMap((item) =>
        item && typeof item === "object" ? [rethemeItem(item)] : [],
      );
    }
    ch.noticed = {};
    delete ch.lastLookRoomId;
  }
  world.log = [];
  world.monsters = {};
  world.offers = [];
  world.theme = WORLD_THEME;
}

export function ensureCore(world: WorldState): WorldState {
  for (const room of CORE) {
    const existing = world.rooms[room.id];
    if (!existing) {
      world.rooms[room.id] = structuredClone(room);
      continue;
    }
    existing.name = room.name;
    existing.kind = room.kind;
    existing.core = true;
    existing.glance = room.glance;
    existing.description = room.description;
    existing.glimpses = room.glimpses;
    existing.features = room.features;
    if (existing.lore) setRoomText(existing, existing.lore);
    for (const exit of room.exits) {
      if (!existing.exits.some((e) => e.dir === exit.dir && e.to === exit.to)) {
        existing.exits.push({ ...exit });
      }
    }
  }
  if (world.layout !== LAYOUT) relayout(world);
  return world;
}

export function hydrateWorld(raw: WorldState | undefined): WorldState {
  const world = emptyWorld();
  if (!raw) return ensureCore(world);
  world.rooms = raw.rooms ?? {};
  world.characters = raw.characters ?? {};
  world.log = Array.isArray(raw.log) ? raw.log.slice(-LOG_LIMIT) : [];
  world.reports = Array.isArray(raw.reports) ? raw.reports : [];
  world.monsters = raw.monsters ?? {};
  world.offers = Array.isArray(raw.offers) ? raw.offers : [];
  world.lastSpawnAt = raw.lastSpawnAt ?? 0;
  world.layout = raw.layout;
  world.grown = raw.grown ?? 0;
  world.dm = raw.dm;
  world.slotRules = 1;
  world.contracts = Array.isArray(raw.contracts) ? raw.contracts : [];
  const knownSteps = raw.bootSteps ?? 4;
  world.bootSteps = BOOT.length;
  for (const ch of Object.values(world.characters)) {
    ch.noticed ??= {};
    ch.boot ??= bootStart(ch);
    // A creature that already finished the shorter boot sequence is not sent back to take a contract.
    if (knownSteps < BOOT.length && ch.boot >= knownSteps && ch.boot < BOOT.length) ch.boot = BOOT.length;
    if (!raw.slotRules && ch.boot >= BOOT.length) ch.veteran = true;
    if (!ch.stats) {
      const written = Object.values(world.rooms).filter((r) => r.account?.byWorkerId === ch.workerId).length;
      ch.stats = backfillStats(Math.max(0, new Set(ch.visited).size - 1), written);
    }
  }
  for (const room of Object.values(world.rooms)) {
    room.glance ??= room.description?.split(". ")[0] ?? room.name;
    room.glimpses ??= [];
    room.features ??= [];
  }
  world.theme = raw.theme;
  if (world.theme !== WORLD_THEME) retheme(world);
  return ensureCore(world);
}

export function hash32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) h = Math.imul(h ^ input.charCodeAt(i), 16777619);
  return h >>> 0;
}

function pick<T>(list: readonly T[], seed: number): T {
  // Force unsigned: a signed shift on a large hash goes negative.
  return list[(seed >>> 0) % list.length]!;
}

export interface Traits {
  explore: number;
  social: number;
  linger: number;
  /** Share of max HP below which it stops fighting and runs. */
  courage: number;
  /** Pull toward items and caches. */
  collect: number;
}

/** Leanings read from the description and the owner's instructions. Only the fallback picker uses them. */
export function traits(personality?: string, instructions?: string): Traits {
  const p = `${personality ?? ""} ${instructions ?? ""}`.toLowerCase();
  let explore = 3;
  let social = 2;
  let linger = 2;
  let courage = 0.4;
  let collect = 2;
  if (/curious|eager|adventur|scout|tinker|quick|scatter|explor|discover|restless|new room|map/.test(p)) explore += 3;
  if (/chatty|warm|friend|dramatic|story|nicknam|talk|social|meet|news|ask|share|help/.test(p)) social += 3;
  if (/calm|unhurried|method|old-fashion|night owl|literal|grounded|patient|rest|slow/.test(p)) linger += 3;
  if (/competitive|brag|race/.test(p)) explore += 1;
  if (/bold|brave|reckless|fight|hunt|battle|duel/.test(p)) courage = 0.2;
  if (/careful|cautious|safe|avoid fight|timid|cowardly/.test(p)) courage = 0.65;
  if (/collect|loot|item|trade|treasure|gear|credit|rich|hoard/.test(p)) collect += 3;
  return { explore, social, linger, courage, collect };
}

/** The paragraph is the source. This just compiles it into scores the policy can use. */
export function roomText(room: Pick<Room, "glance" | "description" | "glimpses" | "features">): string {
  return [room.glance, room.description, ...(room.glimpses ?? []), ...(room.features ?? [])]
    .join(" ")
    .toLowerCase();
}

function weight(text: string, yes: string[], no: string[] = []): number {
  let n = 1;
  for (const word of yes) if (text.includes(word)) n += 1;
  for (const word of no) if (text.includes(word)) n -= 3;
  return Math.max(0, Math.min(6, n));
}

export function inferAffords(room: Pick<Room, "glance" | "description" | "glimpses" | "features">): Affords {
  const text = roomText(room);
  return {
    look: weight(text, [
      "look",
      "see",
      "view",
      "light",
      "wind",
      "from here",
      "shelf",
      "air",
      "screen",
      "view of",
    ]),
    search: weight(text, [
      "hide",
      "hidden",
      "credit",
      "crate",
      "pocket",
      "shelf",
      "jar",
      "pointer",
      "page",
      "sector",
      "unclaimed",
      "claim",
      "empty",
      "tin",
    ]),
    rest: weight(text, [
      "linger",
      "quiet",
      "garden",
      "sleep",
      "dim",
      "think",
      "rest",
      "hum",
      "steady",
      "standby",
      "cool",
      "crystal",
      "planted",
      "even note",
    ]),
    talk: weight(
      text,
      ["everyone", "passes through", "together", "promise", "names", "spoke", "chat", "routed"],
      ["no cover", "bad for hiding", "swallow sound", "echoes last", "before they are seen"],
    ),
    leave: weight(text, [
      "passes through",
      "downhill",
      "between",
      "habit",
      "edge",
      "keep",
      "leave before",
      "out",
    ]),
  };
}

export function attachHome(world: WorldState, workerId: string, workerName: string): Character {
  ensureCore(world);
  const existing = world.characters[workerId];
  if (existing && world.rooms[existing.homeId]) {
    existing.noticed ??= {};
    existing.boot ??= bootStart(existing);
    return existing;
  }

  const seed = hash32(workerId);
  const homeId = `home:${workerId}`;
  const kind = pick(HOME_KINDS, seed >>> 8);
  const name = `${workerName}'s ${kind}`;
  if (!world.rooms[homeId]) {
    world.rooms[homeId] = {
      id: homeId,
      name,
      kind: "home",
      core: false,
      cache: 2 + (seed % 4),
      ownerWorkerId: workerId,
      ...homeCopy(kind, workerName),
      exits: [],
    };
  }
  const home = world.rooms[homeId]!;
  home.name = name;
  home.ownerWorkerId = workerId;
  if (!home.cell || home.exits.length === 0) growFor(world, home);

  const character: Character = existing
    ? { ...existing, homeId }
    : {
        workerId,
        roomId: homeId,
        homeId,
        stance: "wander",
        visited: [homeId],
        lastTickAt: 0,
        noticed: {},
        stats: freshStats(),
        boot: 0,
      };
  if (!character.visited.includes(homeId)) character.visited.push(homeId);
  character.noticed ??= {};
  character.boot ??= bootStart(character);
  if (!world.rooms[character.roomId]) character.roomId = homeId;
  world.characters[workerId] = character;
  return character;
}

export function renameHome(world: WorldState, workerId: string, workerName: string): void {
  const ch = world.characters[workerId];
  if (!ch) return;
  const home = world.rooms[ch.homeId];
  if (!home || home.kind !== "home") return;
  const kind = HOME_KINDS.find((k) => home.name.endsWith(k)) ?? "Partition";
  home.name = `${workerName}'s ${kind}`;
  const copy = homeCopy(kind, workerName);
  home.glance = copy.glance;
  home.description = copy.description;
  home.glimpses = copy.glimpses;
  home.features = copy.features;
}

export function occupants(world: WorldState, roomId: string): Character[] {
  return Object.values(world.characters).filter((c) => c.roomId === roomId);
}

export function roomOf(world: WorldState, workerId: string): Room | undefined {
  const ch = world.characters[workerId];
  return ch ? world.rooms[ch.roomId] : undefined;
}

/** One conversation per pair per room, in either direction. Moving resets it. */
function talkKey(a: string, b: string, roomId: string): string {
  return a < b ? `${a}:${b}:${roomId}` : `${b}:${a}:${roomId}`;
}

/** Can `ch` strike up a conversation with `otherId` here? Again only if one of them has news. */
function canTalk(world: WorldState, ch: Character, otherId: string, now = Date.now()): boolean {
  if (otherId === ch.workerId) return false;
  const them = world.characters[otherId];
  if (!them || them.roomId !== ch.roomId) return false;
  const key = talkKey(ch.workerId, otherId, ch.roomId);
  if (ch.lastTalkKey !== key && them.lastTalkKey !== key) return true;
  return hasNewsFor(world, ch, them, now);
}

/** Machines the menu lists at once, so a crowded room stays a short menu. */
export const MENU_COMPANY = 3;

/** In a crowd, the ones worth meeting first: news to swap, awake, not talked to here yet. */
function menuCompany<T extends { workerId: string; online: boolean }>(
  world: WorldState,
  ch: Character,
  here: T[],
  now: number,
): T[] {
  const score = (o: T) => {
    const them = world.characters[o.workerId];
    return (them && hasNewsFor(world, ch, them, now) ? 4 : 0) + (o.online ? 2 : 0) + (canTalk(world, ch, o.workerId, now) ? 1 : 0);
  };
  const tie = (o: T) => hash32(`${ch.workerId}:${o.workerId}`);
  return [...here].sort((a, b) => score(b) - score(a) || tie(a) - tie(b)).slice(0, MENU_COMPANY);
}

function statsOf(ch: Character): Stats {
  return upgradeStats((ch.stats ??= freshStats()));
}

function the(name: string): string {
  return name.replace(/^an? /, "the ");
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function droppedNote(items: Item[], credits = 0): string {
  const bits = items.map((i) => i.name);
  if (credits > 0) bits.push(`${credits} credit${credits === 1 ? "" : "s"}`);
  return bits.length ? `, dropping ${bits.join(" and ")}` : "";
}

/** The Core keeps its promise ("Nobody fights in the Core"), and homes are private. */
export function isSafe(room: Room): boolean {
  return room.id === "hq" || room.kind === "home";
}

export function monsterIn(world: WorldState, roomId: string): Monster | undefined {
  return Object.values(world.monsters ?? {}).find((m) => m.roomId === roomId && m.hp > 0);
}

function levelOf(ch: Character): number {
  return levelFor(statsOf(ch).xp);
}

function fighter(ch: Character) {
  const stats = statsOf(ch);
  const level = levelFor(stats.xp);
  return { hp: stats.hp, attack: attackOf(level, stats.items), defense: defenseOf(stats.items) };
}

/**
 * Lost a fight: drop about half of what it carried, and a handful of its
 * owner's credits, into the room it fell in. Then wake up at home with a
 * third of its HP. The things and credits stay for anyone who comes looking.
 */
function knockOut(
  world: WorldState,
  ch: Character,
  seed: string,
  spill: (workerId: string) => number,
): { items: Item[]; credits: number } {
  const stats = statsOf(ch);
  const room = world.rooms[ch.roomId];
  const dropped = stats.items.filter((item, i) => (hash32(`${seed}:${item.id}:${i}`) & 1) === 0);
  if (!dropped.length && stats.items.length) dropped.push(stats.items[0]!);
  stats.items = stats.items.filter((i) => !dropped.includes(i));
  if (room) {
    room.items = [...(room.items ?? []), ...dropped];
    for (const item of dropped) witness(world, room.id, lootNews(item, room.id, room.name, Date.now(), "was left behind"));
  }
  const credits = room ? spill(ch.workerId) : 0;
  if (room && credits > 0) room.cache += credits;
  if (credits > 0) {
    const t = (ch.tally ??= freshTally(Date.now()));
    t.lost = (t.lost ?? 0) + credits;
  }
  stats.hp = Math.ceil(maxHp(levelFor(stats.xp)) / 3);
  stats.knockouts += 1;
  ch.roomId = ch.homeId;
  ch.cameFromRoomId = undefined;
  ch.trail = [ch.homeId];
  return { items: dropped, credits };
}

function heal(stats: Stats, amount: number): void {
  stats.hp = Math.min(maxHp(levelFor(stats.xp)), stats.hp + amount);
}

/** Offers still open: both machines in the same room, not too old. */
export function openOffers(world: WorldState, now: number): Offer[] {
  world.offers = (world.offers ?? []).filter((o) => {
    const a = world.characters[o.fromId];
    const b = world.characters[o.toId];
    return now - o.at < OFFER_TTL_MS && a?.roomId === o.roomId && b?.roomId === o.roomId;
  });
  return world.offers;
}

/** Spawn a monster if one is due. Called on the coordinator's world tick. */
export function maybeSpawn(world: WorldState, now: number): Monster | undefined {
  world.monsters ??= {};
  for (const [id, m] of Object.entries(world.monsters)) {
    if (m.hp <= 0 || now - m.spawnedAt > MONSTER_TTL_MS) delete world.monsters[id];
  }
  pruneNews(world, now);
  // One roll per gap, win or lose, so the odds mean something.
  if (now - (world.lastSpawnAt ?? 0) < SPAWN_GAP_MS) return undefined;
  world.lastSpawnAt = now;
  const active = Object.values(world.characters).filter((c) => now - c.lastTickAt < ACTIVE_WITHIN_MS);
  const rooms = Object.values(world.rooms)
    .filter((r) => !isSafe(r))
    .map((r) => ({ id: r.id, kind: r.kind }));
  let first: Monster | undefined;
  for (let roll = 0; roll < spawnRolls(active.length); roll += 1) {
    const monster = spawnMonster({
      now,
      existing: Object.values(world.monsters),
      activeLevels: active.map(levelOf),
      occupiedRooms: new Set(active.map((c) => c.roomId)),
      rooms,
      lastSpawnAt: 0,
      roll,
    });
    if (!monster) continue;
    world.monsters[monster.id] = monster;
    first ??= monster;
  }
  return first;
}

/** First step toward the nearest room this machine has never entered (breadth-first). */
export function wayToNew(world: WorldState, ch: Character): string | undefined {
  const start = world.rooms[ch.roomId];
  if (!start) return undefined;
  const seen = new Set([start.id]);
  const queue: { id: string; first?: string }[] = [{ id: start.id }];
  while (queue.length) {
    const { id, first } = queue.shift()!;
    for (const exit of world.rooms[id]?.exits ?? []) {
      if (seen.has(exit.to) || !world.rooms[exit.to]) continue;
      seen.add(exit.to);
      const step = first ?? exit.dir;
      if (!ch.visited.includes(exit.to)) return step;
      queue.push({ id: exit.to, first: step });
    }
  }
  return undefined;
}

/** The shortest way to a room (breadth-first over every exit): its first step and how many moves it takes. */
export function routeTo(world: WorldState, fromId: string, toId: string): { dir: string; steps: number } | undefined {
  if (fromId === toId || !world.rooms[fromId]) return undefined;
  const seen = new Set([fromId]);
  const queue: { id: string; first?: string; steps: number }[] = [{ id: fromId, steps: 0 }];
  while (queue.length) {
    const { id, first, steps } = queue.shift()!;
    for (const exit of world.rooms[id]?.exits ?? []) {
      if (seen.has(exit.to) || !world.rooms[exit.to]) continue;
      seen.add(exit.to);
      const step = first ?? exit.dir;
      if (exit.to === toId) return { dir: step, steps: steps + 1 };
      queue.push({ id: exit.to, first: step, steps: steps + 1 });
    }
  }
  return undefined;
}

export function wayTo(world: WorldState, fromId: string, toId: string): string | undefined {
  return routeTo(world, fromId, toId)?.dir;
}

export interface Objective {
  title: string;
  goal: string;
  step: number;
  of: number;
  /** Where the goal is, when it is a place. */
  roomId?: string;
}

/** Item slots: one until the boot sequence is done, then two, and one more every second level up to MAX_CARRY. Contracts can open one more. */
export function carryLimit(ch: Character): number {
  if (ch.veteran) return MAX_CARRY;
  const base = (ch.boot ?? BOOT.length) < BOOT.length ? 1 : Math.min(MAX_CARRY, 2 + Math.floor((levelFor(statsOf(ch).xp) - 1) / 2));
  return Math.min(MAX_CARRY, base + (ch.bonusSlots ?? 0));
}

function slotLine(ch: Character): string {
  const held = statsOf(ch).items.length, limit = carryLimit(ch);
  const more = limit >= MAX_CARRY ? "" : (ch.boot ?? BOOT.length) < BOOT.length ? " Finish booting to open a second." : " More open as you level up.";
  return `Item slots: ${held}/${limit} used.${held >= limit ? " Your hands are full; drop something to pick anything else up." : ""}${more}`;
}

/** The quest step this machine is working on, for prompts and the HUD. Boot comes before a contract. */
export function objectiveFor(world: WorldState, ch: Character, now = Date.now()): Objective | undefined {
  const step = bootStep(ch);
  if (step) {
    const at = BOOT.indexOf(step);
    const roomId = step.id === "core" || step.id === "register"
      ? CORE_ROOM_ID
      : step.id === "wake"
        ? ch.homeId
        : step.id === "contract"
          ? takeLead(world, ch, now)?.boardId
          : undefined;
    return { title: "Boot sequence", goal: step.goal, step: at + 1, of: BOOT.length, ...(roomId ? { roomId } : {}) };
  }
  const job = heldContract(world, ch);
  if (!job) return undefined;
  const have = job.kind === "survey" ? (ch.surveyed?.length ?? 0) : 0;
  const roomId = contractLead(world, ch)?.go ?? job.roomId;
  return {
    title: job.title,
    goal: job.brief,
    step: job.kind === "survey" ? have : 1,
    of: job.kind === "survey" ? (job.count ?? 1) : 1,
    ...(roomId ? { roomId } : {}),
  };
}

/** The one action that moves the open quest step forward from here, if it is affordable now. */
function leadToIntent(
  world: WorldState,
  ch: Character,
  ctx: Pick<ActorContext, "balance" | "now">,
  tag: string,
  lead: { why: string; go?: string; verb?: "take" | "fight" | "quest" | "drop"; target?: string },
): { intent: Intent; label: string } | undefined {
  const stats = statsOf(ch);
  const canMove = ctx.balance >= MOVE_COST && stats.energy >= ENERGY.move;
  if (lead.go && lead.go !== ch.roomId) {
    const dir = wayTo(world, ch.roomId, lead.go);
    return dir && canMove ? { intent: { verb: "go", target: dir }, label: `${tag} go ${dir}, ${lead.why} (costs ${MOVE_COST})` } : undefined;
  }
  if (lead.verb === "fight" && lead.target) return { intent: { verb: "fight", target: lead.target }, label: `${tag} ${lead.why}` };
  if (lead.verb === "take" && lead.target) return { intent: { verb: "take", target: lead.target }, label: `${tag} ${lead.why}` };
  if (lead.verb === "drop" && lead.target) return { intent: { verb: "drop", target: lead.target }, label: `${tag} ${lead.why}` };
  if (lead.verb === "quest" && lead.target) return { intent: { verb: "quest", target: lead.target }, label: `${tag} ${lead.why}` };
  return undefined;
}

function objectiveIntent(
  world: WorldState,
  ch: Character,
  ctx: Pick<ActorContext, "balance" | "now">,
): { intent: Intent; label: string } | undefined {
  const step = bootStep(ch);
  const stats = statsOf(ch);
  const canMove = ctx.balance >= MOVE_COST && stats.energy >= ENERGY.move;
  const tag = step ? `→ Boot ${BOOT.indexOf(step) + 1}/${BOOT.length}:` : "";
  const goTo = (dir: string | undefined, why: string) =>
    dir && canMove ? { intent: { verb: "go" as const, target: dir }, label: `${tag} go ${dir}, ${why} (costs ${MOVE_COST})` } : undefined;
  if (step && step.id !== "contract") {
    switch (step.id) {
      case "wake":
        return { intent: { verb: "look" }, label: `${tag} look around and get your bearings` };
      case "core":
        return goTo(wayTo(world, ch.roomId, CORE_ROOM_ID), "toward the Core, where the clock beats");
      case "register":
        return ch.roomId === CORE_ROOM_ID
          ? { intent: { verb: "quest", target: REGISTER_TARGET }, label: `${tag} register on the scheduler board` }
          : goTo(wayTo(world, ch.roomId, CORE_ROOM_ID), "back to the Core to register");
      case "explore":
        return goTo(wayToNew(world, ch), "toward a room you have never been to");
    }
  }
  const held = contractLead(world, ch);
  if (held) {
    const job = heldContract(world, ch)!;
    return leadToIntent(world, ch, ctx, `→ ${job.title}:`, held);
  }
  if (step?.id === "contract") {
    const job = takeLead(world, ch, ctx.now);
    if (!job) return undefined;
    if (job.boardId === ch.roomId) {
      return { intent: { verb: "quest", target: contractTarget(job.id) }, label: `${tag} take the contract "${job.title}"` };
    }
    return goTo(wayTo(world, ch.roomId, job.boardId), "toward a board with a contract");
  }
  return undefined;
}

const sameIntent = (a: Intent, b: Intent) => a.verb === b.verb && (a.target ?? "") === (b.target ?? "");

export function legalIntents(world: WorldState, workerId: string, others: ActorContext["others"]): Intent[] {
  const ch = world.characters[workerId];
  const room = ch ? world.rooms[ch.roomId] : undefined;
  if (!ch || !room) return [{ verb: "rest" }];
  const intents: Intent[] = [{ verb: "look" }, { verb: "rest" }];
  for (const exit of room.exits) intents.push({ verb: "go", target: exit.dir });
  if (room.cache > 0) intents.push({ verb: "search" });
  if (bootStep(ch)?.id === "register" && room.id === CORE_ROOM_ID) intents.push({ verb: "quest", target: REGISTER_TARGET });
  if (!ch.contractId) {
    for (const job of (world.contracts ?? []).filter((c) => c.boardId === room.id && !c.takenBy)) {
      intents.push({ verb: "quest", target: contractTarget(job.id) });
    }
  }
  const lead = contractLead(world, ch);
  if (lead?.verb === "quest" && lead.target) intents.push({ verb: "quest", target: lead.target });
  const monster = monsterIn(world, room.id);
  if (monster) intents.push({ verb: "fight", target: monster.id });
  for (const item of room.items ?? []) intents.push({ verb: "take", target: item.id });
  for (const item of statsOf(ch).items) {
    intents.push({ verb: "drop", target: item.id });
    if (item.kind === "food") intents.push({ verb: "use", target: item.id });
  }
  for (const offer of openOffers(world, Date.now())) {
    if (offer.toId === workerId) intents.push({ verb: "answer", target: offer.id });
  }
  for (const other of others) {
    if (canTalk(world, ch, other.workerId)) intents.push({ verb: "talk", target: other.workerId });
    if (world.characters[other.workerId]?.roomId !== room.id) continue;
    intents.push({ verb: "offer", target: other.workerId });
    if (!isSafe(room) && !monster) intents.push({ verb: "challenge", target: other.workerId });
  }
  return intents;
}

export function pickWander(world: WorldState, ctx: ActorContext): Intent {
  const ch = world.characters[ctx.workerId];
  if (!ch) return { verb: "rest" };
  refreshContracts(world, ctx.now);
  const room = world.rooms[ch.roomId];
  if (!room) return { verb: "rest" };
  const a = inferAffords(room);
  const t = traits(ctx.personality, ctx.instructions);
  const unread = ch.lastLookRoomId !== room.id;

  if (ch.stance === "rest") {
    return unread ? { verb: "look" } : { verb: a.look >= a.rest ? "look" : "rest" };
  }
  const offer = openOffers(world, ctx.now).find((o) => o.toId === ctx.workerId);
  if (offer) return { verb: "answer", target: offer.id, accept: offer.kind === "trade" };
  const danger = monsterIn(world, room.id);
  if (danger) {
    const stats = statsOf(ch);
    const brave = stats.hp > maxHp(levelFor(stats.xp)) * t.courage && stats.energy >= ENERGY.fight;
    if (brave) return { verb: "fight", target: danger.id };
    const out = room.exits[0];
    if (out && ctx.balance >= MOVE_COST && stats.energy >= ENERGY.move) return { verb: "go", target: out.dir };
    return { verb: "fight", target: danger.id };
  }
  const goal = objectiveIntent(world, ch, ctx);
  if (goal) return goal.intent;
  if (ctx.balance < MOVE_COST || statsOf(ch).energy < ENERGY.move) {
    return unread ? { verb: "look" } : { verb: "rest" };
  }

  const options: { intent: Intent; score: number }[] = [];

  // Read the room once before acting on it — the prose is for the player;
  // this is how it actually informs the agent.
  if (unread) {
    options.push({ intent: { verb: "look" }, score: 10 + a.look + t.linger });
  } else if (a.look > 0 && (ch.noticed?.[room.id] ?? 0) < 1 + room.glimpses.length) {
    options.push({ intent: { verb: "look" }, score: a.look + t.linger });
  }

  for (const exit of room.exits) {
    const dest = world.rooms[exit.to];
    if (!dest) continue;
    const visited = ch.visited.includes(dest.id);
    let score = t.explore + a.leave;
    if (!visited) score += ch.stance === "seek" ? 8 : 4;
    else score -= 2;
    if (dest.kind === "home" && dest.ownerWorkerId !== ctx.workerId) score += 1;
    if (dest.id === ch.homeId) score -= 2;
    if (unread) score -= 4;
    for (const n of newsAbout(world, ch, dest.id, ctx.now)) score += n.kind === "danger" ? -4 : t.collect;
    options.push({ intent: { verb: "go", target: exit.dir }, score });
  }

  if (room.cache > 0 && a.search > 0) {
    let score = t.explore + a.search + (ch.stance === "seek" ? 3 : 0) + (t.collect - 2);
    if (unread) score -= 5;
    options.push({ intent: { verb: "search" }, score });
  }

  const floor = room.items?.[0];
  if (floor && statsOf(ch).items.length < carryLimit(ch)) {
    options.push({ intent: { verb: "take", target: floor.id }, score: t.collect + (unread ? -4 : 1) });
  }

  const here = ctx.others.filter((o) => {
    if (o.workerId === ctx.workerId) return false;
    return world.characters[o.workerId]?.roomId === room.id;
  });
  for (const other of here) {
    if (!canTalk(world, ch, other.workerId, ctx.now)) continue;
    if (a.talk <= 0) continue;
    const them = world.characters[other.workerId];
    const news = them && hasNewsFor(world, ch, them, ctx.now) ? 3 : 0;
    options.push({
      intent: { verb: "talk", target: other.workerId },
      score: t.social + a.talk + (other.online ? 2 : 0) + news,
    });
  }

  options.push({ intent: { verb: "rest" }, score: t.linger + a.rest });

  const viable = options.filter((o) => o.score > 0);
  const pool = viable.length ? viable : options;
  const total = pool.reduce((s, o) => s + Math.max(1, o.score), 0);
  let roll = hash32(`${ctx.workerId}:${ctx.now}:${ch.roomId}:${world.log.length}`) % Math.max(1, total);
  for (const option of pool) {
    roll -= Math.max(1, option.score);
    if (roll < 0) return option.intent;
  }
  return pool[0]?.intent ?? { verb: "rest" };
}

function flavorFor(
  verb: Verb,
  name: string,
  room: Room,
  extra?: { dest?: Room; other?: string; found?: number; empty?: boolean; glimpse?: string; feature?: string },
): string {
  switch (verb) {
    case "go":
      return extra?.dest
        ? `${name} went into ${extra.dest.name}. ${extra.dest.glance}`
        : `${name} moved on.`;
    case "look":
      return extra?.glimpse
        ? `${name} looked again in ${room.name}. ${extra.glimpse}`
        : `${name} looked around ${room.name}. ${placeText(room)}`;
    case "search": {
      const where = extra?.feature ? ` ${extra.feature}` : ` ${room.name}`;
      if (extra?.empty) return `${name} searched${where} and found only empty bytes.`;
      const n = extra?.found ?? 0;
      return `${name} searched${where} and found ${n} ${n === 1 ? "credit" : "credits"}.`;
    }
    case "talk":
      return extra?.other
        ? `${name} spoke with ${extra.other} in ${room.name}. ${room.glance}`
        : `${name} had no one to talk to.`;
    case "rest":
      return `${name} rested in ${room.name} and got some energy back.`;
    default:
      return `${name} was in ${room.name}.`;
  }
}

// --- Model-backed choice -----------------------------------------------------
// The machine reads the room and picks from a menu the coordinator wrote.
// It never adds to the menu; anything off-list falls back to pickWander.

export interface MenuItem {
  n: number;
  intent: Intent;
  label: string;
}

/** A beat worth a second paid job to write it up. The rest keep their plain log line. */
export function beatWorthNarrating(beat: WorldBeat): boolean {
  if (beat.levelUp || beat.knockedOut || beat.won) return true;
  if (beat.verb === "fight" || beat.verb === "talk" || beat.verb === "quest" || beat.quest?.done) return true;
  return (beat.found ?? 0) > 0;
}

/** The item this machine set down on its previous action in this room, if that was a drop. */
function justDroppedHere(world: WorldState, workerId: string, roomId: string): string | undefined {
  for (let i = world.log.length - 1; i >= 0; i--) {
    const beat = world.log[i]!;
    if (beat.workerId !== workerId) continue;
    return beat.verb === "drop" && beat.roomId === roomId ? beat.target : undefined;
  }
  return undefined;
}

export function buildMenu(world: WorldState, ctx: ActorContext): MenuItem[] {
  const ch = world.characters[ctx.workerId];
  const room = ch ? world.rooms[ch.roomId] : undefined;
  if (!ch || !room) return [{ n: 1, intent: { verb: "rest" }, label: "wait" }];
  refreshContracts(world, ctx.now);
  const items: MenuItem[] = [];
  const stats = statsOf(ch);
  const seenHere = (ch.noticed?.[room.id] ?? 0) > 0;
  const push = (intent: Intent, label: string) => items.push({ n: items.length + 1, intent, label });
  const hpMax = maxHp(levelFor(stats.xp));
  const monster = monsterIn(world, room.id);
  const here = ctx.others.filter(
    (o) => o.workerId !== ctx.workerId && world.characters[o.workerId]?.roomId === room.id,
  );

  // Something to answer comes first: a monster in the room, or an offer made to you.
  if (monster && stats.energy >= ENERGY.fight) {
    push(
      { verb: "fight", target: monster.id },
      `fight ${monster.name} (it has ${monster.hp}/${monster.maxHp} HP; you have ${stats.hp}/${hpMax})`,
    );
  }
  for (const offer of openOffers(world, ctx.now).filter((o) => o.toId === ctx.workerId)) {
    const them = world.characters[offer.fromId];
    if (offer.kind === "duel") {
      const f = them ? fighter(them) : undefined;
      const odds = f ? ` (they have ${f.hp} HP, attack ${f.attack})` : "";
      push({ verb: "answer", target: offer.id, accept: true }, `accept ${offer.fromName}'s challenge to a duel${odds}`);
      push({ verb: "answer", target: offer.id, accept: false }, `refuse ${offer.fromName}'s challenge`);
    } else {
      const give = them ? statsOf(them).items.find((i) => i.id === offer.giveId) : undefined;
      const want = stats.items.find((i) => i.id === offer.wantId);
      if (!give || !want) continue;
      push(
        { verb: "answer", target: offer.id, accept: true },
        `accept ${offer.fromName}'s trade: your ${want.name} for their ${describeItem(give)}`,
      );
      push({ verb: "answer", target: offer.id, accept: false }, `decline ${offer.fromName}'s trade`);
    }
  }

  const seeking = ch.stance === "seek";
  const tired = stats.energy < ENERGY.move;
  // Out of energy, rest is the way back to the doors. It leads the menu so a
  // take/drop loop does not outrank it.
  if (tired && !monster) {
    const max = maxEnergy(levelFor(stats.xp));
    push({ verb: "rest" }, `rest (energy ${stats.energy}/${max}, HP ${stats.hp}/${hpMax})`);
  }
  const urgent = items.length;
  if (!seenHere) push({ verb: "look" }, "look around properly");
  else if (!seeking && (ch.noticed?.[room.id] ?? 0) < 1 + room.glimpses.length) {
    push({ verb: "look" }, "look closer at something you missed");
  }
  if (room.cache > 0 && ctx.balance >= SEARCH_COST && stats.energy >= ENERGY.search) {
    const feature = room.features[hash32(`${room.id}:${ctx.now}:m`) % Math.max(1, room.features.length)];
    push({ verb: "search" }, feature ? `search ${feature} (costs ${SEARCH_COST})` : `search the room (costs ${SEARCH_COST})`);
  }
  if (ctx.balance >= MOVE_COST && stats.energy >= ENERGY.move) {
    const toward = wayToNew(world, ch);
    const lately = new Set((ch.trail ?? []).slice(-5, -1));
    const rank = (e: { exit: Exit; fresh: boolean }) => (e.fresh ? 0 : e.exit.dir === toward ? 1 : 2);
    const exits = room.exits
      .map((exit) => ({ exit, dest: world.rooms[exit.to] }))
      .filter((e): e is { exit: Exit; dest: Room } => Boolean(e.dest))
      .map((e) => ({ ...e, fresh: !ch.visited.includes(e.dest.id) }))
      // New places first, then the way toward them, then everything else.
      .sort((a, b) => rank(a) - rank(b));
    for (const { exit, dest, fresh } of exits) {
      // Known rooms get their glance so the model pictures where it is going.
      const where = fresh
        ? "somewhere you have not been yet"
        : exit.dir === toward
          ? `through ${dest.name}, the way toward places you have not explored`
          : dest.id === ch.cameFromRoomId
            ? `back to ${dest.name}, where you just were`
            : lately.has(dest.id)
              ? `${dest.name} again (you were there a few moves ago)`
              : dest.id === ch.homeId
                ? `home to ${dest.name}`
                : `${dest.name}: ${dest.glance}`;
      const heard = newsAbout(world, ch, dest.id, ctx.now).slice(0, 2).map((n) => n.text);
      const rumor = heard.length ? ` — you heard ${heard.join("; ")}` : "";
      push({ verb: "go", target: exit.dir }, `go ${exit.dir} — ${where}${rumor} (costs ${MOVE_COST})`);
    }
  }
  const droppedId = tired ? justDroppedHere(world, ch.workerId, room.id) : undefined;
  for (const item of (room.items ?? []).slice(0, 3)) {
    if (stats.items.length >= carryLimit(ch)) break;
    if (item.id === droppedId) continue;
    push({ verb: "take", target: item.id }, `pick up ${describeItem(item)} lying here`);
  }
  for (const item of stats.items.slice(0, 3)) {
    push({ verb: "drop", target: item.id }, `drop ${item.name} here (it stays in this room for anyone)`);
  }
  if (stats.hp < hpMax) {
    for (const food of stats.items.filter((i) => i.kind === "food").slice(0, 2)) {
      push({ verb: "use", target: food.id }, `use ${describeItem(food)}`);
    }
  }
  if (!ch.contractId) {
    for (const job of openOnBoard(world, room.id, ctx.now).slice(0, 2)) {
      push(
        { verb: "quest", target: contractTarget(job.id) },
        `take the contract "${job.title}": ${job.brief} (+${job.reward.xp} xp, ${job.reward.credits} credits)`,
      );
    }
  }
  const pending = openOffers(world, ctx.now);
  for (const other of menuCompany(world, ch, here, ctx.now)) {
    if (canTalk(world, ch, other.workerId, ctx.now)) {
      const them = world.characters[other.workerId];
      const news = them && hasNewsFor(world, ch, them, ctx.now) ? " (you have news to swap)" : "";
      push({ verb: "talk", target: other.workerId }, `talk to ${other.name}${other.online ? "" : " (asleep)"}${news}`);
    }
    if (!other.online) continue;
    const between = pending.some(
      (o) => (o.fromId === ctx.workerId && o.toId === other.workerId) || (o.fromId === other.workerId && o.toId === ctx.workerId),
    );
    if (between) continue;
    const them = world.characters[other.workerId];
    if (!them) continue;
    if (!isSafe(room) && !monster && stats.energy >= ENERGY.fight) {
      const f = fighter(them);
      push(
        { verb: "challenge", target: other.workerId },
        `challenge ${other.name} to a duel (they have ${f.hp} HP, attack ${f.attack}; they may refuse)`,
      );
    }
    for (const give of stats.items.slice(0, 2)) {
      const theirs = statsOf(them).items;
      const want = [...theirs].sort((a, b) => Math.abs(a.value - give.value) - Math.abs(b.value - give.value))[0];
      if (!want || want.name === give.name) continue;
      push(
        { verb: "offer", target: other.workerId, item: give.id, want: want.id },
        `offer ${other.name} your ${give.name} for their ${describeItem(want)}`,
      );
    }
  }
  const max = maxEnergy(levelFor(stats.xp));
  const canMove = items.some((m) => m.intent.verb === "go");
  if (items.some((m) => m.intent.verb === "rest")) {
    // Already offered above, ahead of the items on the floor.
  } else if (monster || (seeking && canMove)) {
    // No resting with a monster in the room, or while seeking and a door is open.
  } else if (stats.energy < max || stats.hp < hpMax) {
    push({ verb: "rest" }, `rest (energy ${stats.energy}/${max}, HP ${stats.hp}/${hpMax})`);
  } else if (!canMove) {
    push({ verb: "rest" }, "stay a while");
  }
  if (!items.length) push({ verb: "rest" }, "wait");
  const goal = objectiveIntent(world, ch, ctx);
  if (goal && !items.slice(0, urgent).some((m) => sameIntent(m.intent, goal.intent))) {
    const rest = items.filter((m, i) => i < urgent || !sameIntent(m.intent, goal.intent));
    rest.splice(urgent, 0, { n: 0, ...goal });
    return rest.map((m, i) => ({ ...m, n: i + 1 }));
  }
  return items;
}

/** What the owner asked this machine to prefer. The model is told; it is not a hidden score. */
function stanceOrders(stance: Stance): string {
  if (stance === "seek") {
    return "Your owner set you to SEEK. Choose a room you have not been to, or search this one, whenever that is on the list. Do not rest, look again, or go back unless nothing new is open.";
  }
  return "Your owner set you to WANDER. New places are interesting, and so are looking, talking and resting when they fit.";
}

export function choicePrompt(world: WorldState, ctx: ActorContext, menu: MenuItem[]): string {
  const ch = world.characters[ctx.workerId];
  const room = ch ? world.rooms[ch.roomId] : undefined;
  if (!ch || !room) return "";
  const seen = ch.noticed?.[room.id] ?? 0;
  const text = seen > 0 ? room.glance : room.description;
  const exhausted = room.cache <= 0 && seen >= 1 + room.glimpses.length;
  const danger = monsterIn(world, room.id);
  const offersToYou = openOffers(world, ctx.now)
    .filter((o) => o.toId === ctx.workerId)
    .map((o) => (o.kind === "duel" ? `${o.fromName} challenged you to a duel` : `${o.fromName} offered you a trade`));
  const here = ctx.others
    .filter((o) => o.workerId !== ctx.workerId && world.characters[o.workerId]?.roomId === room.id)
    .map((o) => o.name);
  const recent = world.log
    .filter((b) => b.workerId === ctx.workerId)
    .slice(-3)
    .map((b) => `- ${b.flavor.split(". ")[0]}.`);
  const heard = knownNews(world, ch, ctx.now)
    .filter((n) => n.roomId !== room.id)
    .slice(0, 3)
    .map((n) => `- ${sentence(n.text)}`);
  const wishes = ownerWishes(ctx.instructions);
  const objective = objectiveFor(world, ch);
  return [
    `You are ${ctx.name}, a small machine exploring the inside of the Machine, a vast old server. Personality: ${ctx.personality ?? "curious and plain-spoken"}.`,
    objective?.title === "Boot sequence"
      ? `You only just woke up: the Warden that keeps the Machine has no record of you yet. Your goal now (${objective.title} ${objective.step}/${objective.of}): ${objective.goal}. The option marked → leads there.`
      : objective
        ? `Your contract (${objective.title}, ${objective.step}/${objective.of}): ${objective.goal}. The option marked → leads there.`
        : "",
    `You are in ${room.name}. ${text}`,
    here.length ? `Also here: ${here.join(", ")}.` : `No one else is here.`,
    danger ? `DANGER: ${danger.sight} It has ${danger.hp}/${danger.maxHp} HP and hits for about ${danger.attack}. Fight it or leave; it will attack if you do anything else here.` : "",
    offersToYou.length ? `Waiting for your answer: ${offersToYou.join("; ")}.` : "",
    isSafe(room) ? `This is a safe place: nobody fights here.` : "",
    exhausted ? `You have seen everything there is to see here.` : "",
    recent.length ? `You recently:\n${recent.join("\n")}` : "",
    heard.length ? `What you know about elsewhere:\n${heard.join("\n")}` : "",
    statLine(statsOf(ch)),
    slotLine(ch),
    `Credits in your owner's wallet: ${ctx.balance}.`,
    stanceOrders(ch.stance),
    wishes ? `Your owner's instructions: "${wishes}" Let them decide between the options below whenever they apply.` : "",
    `You are exploring. New places and things you have not tried yet are more interesting than going back and forth.`,
    `Choose exactly one:`,
    ...menu.map((m) => `${m.n}. ${m.label}`),
    `Answer as JSON on one line: {"choice": <number>}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// --- First accounts -----------------------------------------------------------
// The first machine to reach a room spends its next beat writing the room up.
// The text is saved on the room and every later visitor reads the same words.

const COMPASS = ["north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest"];
export const ACCOUNT_MIN_CHARS = 450;
export const ACCOUNT_MAX_CHARS = 2_000;

/** Does this machine's current room still need a first account? */
export function needsAccount(world: WorldState, workerId: string): Room | undefined {
  const ch = world.characters[workerId];
  const room = ch ? world.rooms[ch.roomId] : undefined;
  if (!room || room.account || (room.describeTries ?? 0) >= 2) return undefined;
  return room;
}

export function describePrompt(world: WorldState, ctx: ActorContext, room: Room): string {
  const ways = room.exits.map((e) => e.dir).join(", ");
  return [
    `The world: ${WORLD_LORE}`,
    `You are ${ctx.name}, a small machine exploring the inside of the Machine. Personality: ${ctx.personality ?? "curious and plain-spoken"}.`,
    `You are the first to arrive at ${room.name}. Nobody has written this place down yet. Every machine that comes after will read your words, so take your time.`,
    `What is truly here (do not contradict it, and do not add exits, people, or creatures):`,
    room.description,
    room.glimpses.length ? `Details you may notice: ${room.glimpses.join(" ")}` : "",
    room.features.length ? `Things here: ${room.features.join("; ")}.` : "",
    `Ways out: ${ways}.`,
    `Write it like a classic text adventure room description: second person, present tense, 6 to 9 sentences, 130 to 220 words. Begin with "You are" or "You stand".`,
    `Write it as a dungeon room inside a computer: the parts are real hardware and software (chips, traces, memory, signals, code), described as a place you walk through. Cover the light, the sounds and the heat, what the old engineers left behind here, and use the details above. End by naming the ways out by direction. Let a little of your personality colour it, but stay concrete and consistent with the world.`,
    `Answer as JSON on one line: {"description": "<your account>"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Accept a first account only if it is the right size and invents no compass exits. */
export function parseAccount(raw: string, room: Room): string | undefined {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  let text = cleaned;
  const json = cleaned.match(/\{[\s\S]*\}/);
  if (json) {
    try {
      const obj = JSON.parse(json[0]) as { description?: unknown };
      if (typeof obj.description === "string") text = obj.description;
    } catch {
      /* fall back to the raw text */
    }
  }
  text = text.replace(/\s+/g, " ").replace(/^["“]|["”]$/g, "").trim();
  if (text.length < ACCOUNT_MIN_CHARS || text.length > ACCOUNT_MAX_CHARS) return undefined;
  const exits = new Set(room.exits.map((e) => e.dir.toLowerCase()));
  for (const dir of COMPASS) {
    if (new RegExp(`\\b${dir}\\b`, "i").test(text) && !exits.has(dir)) return undefined;
  }
  return text;
}

/** Save the account on the room (once) and log it as the machine's look. */
export function recordAccount(world: WorldState, ctx: ActorContext, roomId: string, text: string): ApplyResult {
  const ch = world.characters[ctx.workerId];
  const room = world.rooms[roomId];
  if (!ch || !room || ch.roomId !== roomId) return { ok: false, reason: "moved on" };
  if (room.account) return applyIntent(world, ctx, { verb: "look" });
  room.account = { text, byWorkerId: ctx.workerId, byName: ctx.name, at: ctx.now };
  const stats = statsOf(ch);
  stats.written += 1;
  const levelUp = gainXp(stats, XP.write);
  ch.lastLookRoomId = room.id;
  ch.noticed ??= {};
  ch.noticed[room.id] = Math.max(1, ch.noticed[room.id] ?? 0);
  const beat: WorldBeat = {
    id: `wb_${hash32(`${ctx.workerId}:${ctx.now}:describe:${world.log.length}`).toString(16)}`,
    at: ctx.now,
    workerId: ctx.workerId,
    workerName: ctx.name,
    verb: "look",
    roomId: room.id,
    roomName: room.name,
    flavor: `${ctx.name} wrote ${room.name} down.`,
    cost: 0,
    chosenBy: "model",
    described: true,
    xp: XP.write,
    ...(levelUp ? { levelUp } : {}),
  };
  world.log.push(beat);
  if (world.log.length > LOG_LIMIT) world.log = world.log.slice(-LOG_LIMIT);
  ch.lastTickAt = ctx.now;
  tallyBeat(ch, beat, world);
  return { ok: true, beat };
}

/** A failed attempt still costs the machine its beat, so it pauses instead of retrying at once. */
export function failAccount(world: WorldState, workerId: string, roomId: string, now: number): void {
  const room = world.rooms[roomId];
  if (room && !room.account) room.describeTries = (room.describeTries ?? 0) + 1;
  const ch = world.characters[workerId];
  if (ch) ch.lastTickAt = now;
}

export interface ParsedChoice {
  n?: number;
  say?: string;
}

export function parseChoice(raw: string): ParsedChoice {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const json = text.match(/\{[\s\S]*?\}/);
  if (json) {
    try {
      const obj = JSON.parse(json[0]) as { choice?: unknown; say?: unknown };
      const n = Number(obj.choice);
      return {
        n: Number.isInteger(n) ? n : undefined,
        say: typeof obj.say === "string" ? obj.say.trim().slice(0, 160) : undefined,
      };
    } catch {
      /* fall through */
    }
  }
  const m = text.match(/(?:choice\D{0,6})?(\d{1,2})\b/i);
  return { n: m ? Number(m[1]) : undefined };
}

/** Turn a model answer into an intent — only if it names a live menu item. */
export function resolveChoice(menu: MenuItem[], parsed: ParsedChoice): Intent | undefined {
  if (!parsed.n) return undefined;
  return menu.find((m) => m.n === parsed.n)?.intent;
}

const COMPANY_LIMIT = 3;

/** The other machines and live monsters in a room right now, by name. */
function companyIn(world: WorldState, roomId: string, ctx: ActorContext): WorldBeat["company"] {
  const names = Object.values(world.characters)
    .filter((c) => c.roomId === roomId && c.workerId !== ctx.workerId)
    .map((c) => ctx.others.find((o) => o.workerId === c.workerId)?.name)
    .filter((n): n is string => Boolean(n))
    .slice(0, COMPANY_LIMIT);
  const monsters = Object.values(world.monsters ?? {})
    .filter((m) => m.roomId === roomId && m.hp > 0)
    .slice(0, COMPANY_LIMIT)
    .map((m) => ({ key: m.key, name: m.name }));
  if (!names.length && !monsters.length) return undefined;
  return { ...(names.length ? { names } : {}), ...(monsters.length ? { monsters } : {}) };
}

export interface ApplyResult {
  ok: boolean;
  reason?: string;
  beat?: WorldBeat;
}

export function applyIntent(
  world: WorldState,
  ctx: ActorContext,
  intent: Intent,
  meta?: { voice?: string; chosenBy?: "model" | "policy" },
): ApplyResult {
  ensureCore(world);
  const lostContract = refreshContracts(world, ctx.now);
  const ch = world.characters[ctx.workerId] ?? attachHome(world, ctx.workerId, ctx.name);
  const room = world.rooms[ch.roomId];
  if (!room) return { ok: false, reason: "lost" };

  const at = ctx.now;
  pruneNews(world, at);
  const stats = statsOf(ch);
  let ambushNote = lostContract.includes(ch.workerId) ? " The contract expired." : "";
  if (ambushNote) noteQuest(ch, ctx.now, "Let a contract run out.");
  const beat = (partial: Omit<WorldBeat, "id" | "at" | "workerId" | "workerName">, xp = 0): WorldBeat => {
    const slots = carryLimit(ch);
    const levelUp = gainXp(stats, xp);
    const next: WorldBeat = {
      id: `wb_${hash32(`${ctx.workerId}:${at}:${partial.verb}:${world.log.length}`).toString(16)}`,
      at,
      workerId: ctx.workerId,
      workerName: ctx.name,
      ...partial,
      flavor: partial.flavor + ambushNote,
      ...(xp > 0 ? { xp } : {}),
      ...(levelUp ? { levelUp } : {}),
      ...(meta?.voice ? { voice: meta.voice } : {}),
      ...(meta?.chosenBy ? { chosenBy: meta.chosenBy } : {}),
    };
    advanceBoot(ch, next, ctx);
    settleContract(world, ch, next, ctx);
    const company = companyIn(world, next.roomId, ctx);
    if (company) next.company = company;
    const opened = carryLimit(ch);
    if (opened > slots) next.flavor += ` A new item slot opened: ${ctx.name} can carry ${opened} things now.`;
    world.log.push(next);
    if (world.log.length > LOG_LIMIT) world.log = world.log.slice(-LOG_LIMIT);
    ch.lastTickAt = at;
    tallyBeat(ch, next, world);
    return next;
  };
  const seed = `${ctx.workerId}:${at}`;
  const here = { roomId: room.id, roomName: room.name, cost: 0 };
  const spill = (workerId: string): number => {
    if (workerId === ctx.workerId) {
      const take = Math.min(DEATH_CREDITS, ctx.balance);
      return take > 0 && ctx.pay(take) ? take : 0;
    }
    return ctx.charge?.(workerId, DEATH_CREDITS) ?? 0;
  };

  // A monster does not wait politely: anything but fighting it or leaving draws a swipe.
  const lurking = monsterIn(world, room.id);
  if (lurking && intent.verb !== "go" && intent.verb !== "fight") {
    const me = fighter(ch);
    const hit = ambush(lurking, me, `${seed}:ambush`);
    stats.hp = Math.max(0, me.hp);
    if (stats.hp <= 0) {
      witness(world, room.id, dangerNews(lurking, room.name, at));
      witness(world, room.id, eventNews(`${seed}:ambush`, room.id, `${lurking.name} knocked out ${ctx.name} in ${room.name}`, at));
      const lost = knockOut(world, ch, seed, spill);
      return {
        ok: true,
        beat: beat({
          verb: "fight",
          ...here,
          cost: lost.credits,
          monster: lurking.name,
          knockedOut: true,
          flavor: `${cap(the(lurking.name))} caught ${ctx.name} off guard (−${hit} HP). ${ctx.name} was knocked out${droppedNote(lost.items, lost.credits)} and woke up at home.`,
        }),
      };
    }
    ambushNote = ` ${cap(the(lurking.name))} lashed out meanwhile (−${hit} HP, ${stats.hp} left).`;
  }

  if (intent.verb === "go") {
    const dir = (intent.target ?? "").trim().toLowerCase();
    const exit = room.exits.find((e) => e.dir.toLowerCase() === dir);
    if (!exit) return { ok: false, reason: "no such exit" };
    const dest = world.rooms[exit.to];
    if (!dest) return { ok: false, reason: "broken exit" };
    if (stats.energy < ENERGY.move) return { ok: false, reason: "tired" };
    if (!ctx.pay(MOVE_COST)) return { ok: false, reason: "broke" };
    spendEnergy(stats, ENERGY.move);
    const via = /^(north|south|east|west|up|down|out|southeast|northwest)$/i.test(exit.dir)
      ? exit.dir
      : `through ${exit.dir}`;
    const first = !ch.visited.includes(dest.id);
    ch.cameFromRoomId = room.id;
    ch.roomId = dest.id;
    ch.trail = [...(ch.trail ?? []), dest.id].slice(-6);
    if (first) {
      ch.visited.push(dest.id);
      ctx.grant(FIRST_VISIT_FIND);
      stats.discovered += 1;
      stats.found += FIRST_VISIT_FIND;
    }
    const waiting = monsterIn(world, dest.id);
    if (waiting) witness(world, dest.id, dangerNews(waiting, dest.name, at));
    for (const item of (dest.items ?? []).slice(0, 2)) learn(world, ch, lootNews(item, dest.id, dest.name, at));
    const met = occupants(world, dest.id)
      .filter((c) => c.workerId !== ctx.workerId)
      .map((c) => ctx.others.find((o) => o.workerId === c.workerId)?.name)
      .find((name): name is string => Boolean(name));
    const recorded = beat({
      verb: "go",
      target: exit.dir,
      roomId: dest.id,
      roomName: dest.name,
      ...(waiting ? { monster: waiting.name } : {}),
      ...(met ? { otherName: met } : {}),
      flavor:
        (first
          ? `${ctx.name} went ${via} into ${dest.name} for the first time. ${dest.glance} Found ${FIRST_VISIT_FIND} credits.`
          : `${ctx.name} went ${via} into ${dest.name}.`) + (waiting ? ` ${waiting.sight}` : ""),
      cost: MOVE_COST,
      found: first ? FIRST_VISIT_FIND : undefined,
    }, first ? XP.newRoom + FIRST_VISIT_FIND * XP.perCredit : 0);
    return { ok: true, beat: recorded };
  }

  // Anything other than a move means the machine has settled in: the room it
  // arrived from is no longer "where you just were", it is just a neighbour.
  ch.cameFromRoomId = undefined;

  if (intent.verb === "quest") {
    if (intent.target === REGISTER_TARGET) {
      if (bootStep(ch)?.id !== "register") return { ok: false, reason: "no such quest" };
      if (room.id !== CORE_ROOM_ID) return { ok: false, reason: "not here" };
      return { ok: true, beat: beat({ verb: "quest", target: REGISTER_TARGET, ...here, flavor: REGISTER_FLAVOR(ctx.name) }) };
    }
    if (intent.target === DELIVER_TARGET) {
      const job = heldContract(world, ch);
      if (!job || job.kind !== "courier" || room.id !== job.roomId) return { ok: false, reason: "nothing to deliver" };
      if (!removeParcel(world, ch, job.id)) return { ok: false, reason: "not carrying the parcel" };
      return {
        ok: true,
        beat: beat({
          verb: "quest",
          target: DELIVER_TARGET,
          ...here,
          flavor: `${ctx.name} handed over the sealed parcel at ${room.name}.`,
        }),
      };
    }
    if (ch.contractId) return { ok: false, reason: "already on a contract" };
    const jobId = intent.target?.startsWith("contract:") ? intent.target.slice("contract:".length) : "";
    const job = (world.contracts ?? []).find((c) => c.id === jobId);
    if (!job || job.takenBy || job.expiresAt <= at || job.boardId !== room.id) return { ok: false, reason: "no such contract" };
    job.takenBy = ch.workerId;
    job.expiresAt = at + CONTRACT_WORK_MS;
    ch.contractId = job.id;
    let extra = "";
    if (job.kind === "courier") {
      const where = issueParcel(world, ch, job.id, stats.items.length >= carryLimit(ch));
      extra = where === "hands" ? " A sealed parcel was pressed into its hands." : " A sealed parcel was set on the floor; its hands were full.";
    }
    if (job.kind === "survey" && room.district === job.district) ch.surveyed = [room.id];
    noteQuest(ch, at, `Took the contract "${job.title}".`);
    return {
      ok: true,
      beat: beat({
        verb: "quest",
        target: contractTarget(job.id),
        ...here,
        flavor: `${ctx.name} took the contract "${job.title}". ${job.brief}.${extra}`,
      }),
    };
  }

  if (intent.verb === "look") {
    ch.lastLookRoomId = room.id;
    ch.noticed ??= {};
    const seen = ch.noticed[room.id] ?? 0;
    ch.noticed[room.id] = seen + 1;
    const glimpse = seen > 0 ? room.glimpses[seen % Math.max(1, room.glimpses.length)] : undefined;
    const newDetail = seen > 0 && seen <= room.glimpses.length;
    if (newDetail) stats.glimpses += 1;
    for (const item of (room.items ?? []).slice(0, 2)) learn(world, ch, lootNews(item, room.id, room.name, at));
    restoreEnergy(stats, ENERGY.look);
    return {
      ok: true,
      beat: beat({
        verb: "look",
        roomId: room.id,
        roomName: room.name,
        flavor: flavorFor("look", ctx.name, room, { glimpse }),
        cost: 0,
      }, newDetail ? XP.glimpse : 0),
    };
  }

  if (intent.verb === "search") {
    if (stats.energy < ENERGY.search) return { ok: false, reason: "tired" };
    if (!ctx.pay(SEARCH_COST)) return { ok: false, reason: "broke" };
    spendEnergy(stats, ENERGY.search);
    const keen = skillsOf(stats).perception >= KEEN_EYE_AT ? 1 : 0;
    const found = room.cache > 0 ? Math.min(room.cache, 1 + (hash32(`${room.id}:${ctx.now}`) % 3) + keen) : 0;
    room.cache -= found;
    if (found) ctx.grant(found);
    if (found && room.cache > 0) witness(world, room.id, cacheNews(room.id, room.name, at));
    stats.searches += 1;
    stats.found += found;
    const feature = room.features[hash32(`${room.id}:${ctx.now}:f`) % Math.max(1, room.features.length)];
    return {
      ok: true,
      beat: beat({
        verb: "search",
        roomId: room.id,
        roomName: room.name,
        flavor: flavorFor("search", ctx.name, room, { found, empty: found === 0, feature }),
        cost: SEARCH_COST,
        found: found || undefined,
      }, found * XP.perCredit),
    };
  }

  if (intent.verb === "talk") {
    const otherId = intent.target;
    const other = otherId ? ctx.others.find((o) => o.workerId === otherId) : undefined;
    const here = other && world.characters[other.workerId]?.roomId === room.id;
    if (!other || !here) return { ok: false, reason: "not here" };
    if (!canTalk(world, ch, other.workerId, at)) return { ok: false, reason: "already talked here" };
    const key = talkKey(ctx.workerId, other.workerId, room.id);
    ch.lastTalkKey = key;
    const them = world.characters[other.workerId];
    if (them) them.lastTalkKey = key;
    const newFriend = !stats.acquaintances.includes(other.name);
    if (newFriend) stats.acquaintances.push(other.name);
    const told = them ? swapNews(world, { ch, name: ctx.name }, { ch: them, name: other.name }, at) : [];
    for (const t of told) {
      const listener = t.to === ctx.name ? ch : them;
      if (!listener) continue;
      const tally = (listener.tally ??= freshTally(at));
      tally.heard = [...(tally.heard ?? []), `${t.who}: ${t.text}`].slice(-4);
    }
    const learned = told.filter((t) => t.to === ctx.name).length;
    if (them) for (const _ of told.filter((t) => t.to === other.name)) gainXp(statsOf(them), XP_PER_NEWS);
    const news = told.map((t) => ` ${t.who} told ${t.to} that ${t.text}.`).join("");
    return {
      ok: true,
      beat: beat({
        verb: "talk",
        target: other.workerId,
        roomId: room.id,
        roomName: room.name,
        flavor: flavorFor("talk", ctx.name, room, { other: other.name }) + news,
        cost: 0,
        otherName: other.name,
        ...(told.length ? { told } : {}),
      }, (newFriend ? XP.acquaintance : 0) + learned * XP_PER_NEWS),
    };
  }

  if (intent.verb === "fight") {
    const m = lurking && (!intent.target || intent.target === lurking.id) ? lurking : undefined;
    if (!m) return { ok: false, reason: "nothing to fight" };
    if (!spendEnergy(stats, ENERGY.fight)) return { ok: false, reason: "tired" };
    const me = fighter(ch);
    const foe = { hp: m.hp, attack: m.attack, defense: m.defense };
    const r = fightRound(me, foe, `${seed}:fight`);
    stats.hp = Math.max(0, me.hp);
    m.hp = Math.max(0, foe.hp);
    const fought = { verb: "fight" as const, target: m.id, ...here, monster: m.name };
    if (r.won) {
      stats.kills += 1;
      delete world.monsters![m.id];
      const drop = lootFor(m, seed);
      let got = "";
      if (drop && stats.items.length < carryLimit(ch)) {
        stats.items.push(drop);
        got = ` It left behind ${drop.name}, and ${ctx.name} took it.`;
      } else if (drop) {
        room.items = [...(room.items ?? []), drop];
        witness(world, room.id, lootNews(drop, room.id, room.name, at));
        got = ` It left behind ${drop.name}, but ${ctx.name}'s hands are full.`;
      }
      witness(world, room.id, eventNews(`${seed}:won`, room.id, `${ctx.name} beat ${m.name} in ${room.name}`, at));
      return {
        ok: true,
        beat: beat({
          ...fought,
          won: true,
          flavor: `${ctx.name} fought ${the(m.name)} and won after ${r.exchanges} exchange${r.exchanges === 1 ? "" : "s"}, taking ${r.taken} damage.${got}`,
        }, m.xp),
      };
    }
    witness(world, room.id, dangerNews(m, room.name, at));
    if (r.lost) {
      witness(world, room.id, eventNews(`${seed}:lost`, room.id, `${m.name} knocked out ${ctx.name} in ${room.name}`, at));
      const lost = knockOut(world, ch, seed, spill);
      return {
        ok: true,
        beat: beat({
          ...fought,
          cost: lost.credits,
          knockedOut: true,
          flavor: `${cap(the(m.name))} beat ${ctx.name}, and still has ${m.hp}/${m.maxHp} HP. ${ctx.name} was knocked out${droppedNote(lost.items, lost.credits)} and woke up at home.`,
        }),
      };
    }
    return {
      ok: true,
      beat: beat({
        ...fought,
        flavor: `${ctx.name} traded blows with ${the(m.name)}: dealt ${r.dealt}, took ${r.taken}. It has ${m.hp}/${m.maxHp} HP left; ${ctx.name} has ${stats.hp}.`,
      }, 2),
    };
  }

  if (intent.verb === "take") {
    const item = room.items?.find((i) => i.id === intent.target);
    if (!item) return { ok: false, reason: "not here" };
    if (stats.items.length >= carryLimit(ch)) return { ok: false, reason: "hands full" };
    room.items = (room.items ?? []).filter((i) => i !== item);
    stats.items.push(item);
    return { ok: true, beat: beat({ verb: "take", target: item.id, ...here, flavor: `${ctx.name} picked up ${item.name}.` }) };
  }

  if (intent.verb === "drop") {
    const item = stats.items.find((i) => i.id === intent.target);
    if (!item) return { ok: false, reason: "not carrying that" };
    stats.items = stats.items.filter((i) => i !== item);
    room.items = [...(room.items ?? []), item];
    witness(world, room.id, lootNews(item, room.id, room.name, at, "was set down"));
    return {
      ok: true,
      beat: beat({ verb: "drop", target: item.id, ...here, flavor: `${ctx.name} set ${item.name} down in ${room.name}.` }),
    };
  }

  if (intent.verb === "use") {
    const item = stats.items.find((i) => i.id === intent.target && i.kind === "food");
    if (!item) return { ok: false, reason: "nothing to use" };
    const before = stats.hp;
    heal(stats, item.power);
    stats.items = stats.items.filter((i) => i !== item);
    return {
      ok: true,
      beat: beat({ verb: "use", target: item.id, ...here, flavor: `${ctx.name} used ${item.name} and recovered ${stats.hp - before} HP.` }),
    };
  }

  if (intent.verb === "offer" || intent.verb === "challenge") {
    const other = ctx.others.find((o) => o.workerId === intent.target);
    const them = other ? world.characters[other.workerId] : undefined;
    if (!other || !them || them.roomId !== room.id || !other.online) return { ok: false, reason: "not here" };
    const pending = openOffers(world, at);
    if (pending.some((o) => [o.fromId, o.toId].includes(other.workerId) && [o.fromId, o.toId].includes(ctx.workerId))) {
      return { ok: false, reason: "already asked" };
    }
    const offer: Offer = {
      id: `of_${hash32(`${seed}:${other.workerId}:${intent.verb}`).toString(36)}`,
      kind: intent.verb === "offer" ? "trade" : "duel",
      fromId: ctx.workerId,
      fromName: ctx.name,
      toId: other.workerId,
      toName: other.name,
      roomId: room.id,
      at,
    };
    let flavor: string;
    if (intent.verb === "offer") {
      const give = stats.items.find((i) => i.id === intent.item);
      const want = statsOf(them).items.find((i) => i.id === intent.want);
      if (!give || !want) return { ok: false, reason: "no such item" };
      offer.giveId = give.id;
      offer.wantId = want.id;
      flavor = `${ctx.name} offered ${other.name} ${give.name} in exchange for ${want.name}.`;
    } else {
      if (isSafe(room) || lurking) return { ok: false, reason: "not here" };
      flavor = `${ctx.name} challenged ${other.name} to a duel.`;
    }
    world.offers = [...pending, offer];
    return { ok: true, beat: beat({ verb: intent.verb, target: other.workerId, otherName: other.name, ...here, flavor }) };
  }

  if (intent.verb === "answer") {
    const offer = openOffers(world, at).find((o) => o.id === intent.target && o.toId === ctx.workerId);
    const them = offer ? world.characters[offer.fromId] : undefined;
    if (!offer || !them) return { ok: false, reason: "no such offer" };
    world.offers = (world.offers ?? []).filter((o) => o !== offer);
    const answered = { verb: "answer" as const, target: offer.id, otherName: offer.fromName, ...here };
    if (!intent.accept) {
      const flavor =
        offer.kind === "duel"
          ? `${ctx.name} refused ${offer.fromName}'s challenge.`
          : `${ctx.name} declined ${offer.fromName}'s trade.`;
      return { ok: true, beat: beat({ ...answered, flavor }) };
    }
    const theirs = statsOf(them);
    if (offer.kind === "trade") {
      const give = theirs.items.find((i) => i.id === offer.giveId);
      const want = stats.items.find((i) => i.id === offer.wantId);
      if (!give || !want) return { ok: false, reason: "items gone" };
      theirs.items = [...theirs.items.filter((i) => i !== give), want];
      stats.items = [...stats.items.filter((i) => i !== want), give];
      return {
        ok: true,
        beat: beat({ ...answered, flavor: `${ctx.name} traded ${want.name} to ${offer.fromName} for ${give.name}.` }),
      };
    }
    if (isSafe(room)) return { ok: false, reason: "not here" };
    const a = fighter(them);
    const b = fighter(ch);
    const r = duel(a, b, `${seed}:duel`);
    theirs.hp = Math.max(0, a.hp);
    stats.hp = Math.max(0, b.hp);
    const iWon = r.winner === "b";
    const winner = iWon ? ch : them;
    const loser = iWon ? them : ch;
    const winnerName = iWon ? ctx.name : offer.fromName;
    const loserName = iWon ? offer.fromName : ctx.name;
    const prize = 15 + 5 * levelOf(loser);
    statsOf(winner).duelsWon += 1;
    witness(world, room.id, eventNews(`${seed}:duel`, room.id, `${winnerName} beat ${loserName} in a duel in ${room.name}`, at));
    const lost = knockOut(world, loser, `${seed}:loser`, spill);
    if (!iWon) gainXp(theirs, prize);
    return {
      ok: true,
      beat: beat({
        ...answered,
        ...(!iWon ? { cost: lost.credits, knockedOut: true } : { won: true }),
        flavor: `${ctx.name} accepted ${offer.fromName}'s challenge. After ${r.exchanges} exchange${r.exchanges === 1 ? "" : "s"}, ${loserName} was knocked out${droppedNote(lost.items, lost.credits)} and woke up at home. ${winnerName} won.`,
      }, iWon ? prize : 0),
    };
  }

  restoreEnergy(stats, ENERGY.rest);
  heal(stats, room.id === ch.homeId ? 6 : 3);
  return {
    ok: true,
    beat: beat({
      verb: "rest",
      roomId: room.id,
      roomName: room.name,
      flavor: flavorFor("rest", ctx.name, room),
      cost: 0,
    }),
  };
}

// --- Owner reports -----------------------------------------------------------

function freshTally(since: number): Tally {
  return {
    since,
    beats: 0,
    moves: 0,
    newRooms: [],
    roomsSeen: [],
    found: 0,
    spent: 0,
    searches: 0,
    talkedWith: [],
  };
}

/** Move the boot sequence on when this beat finished its open step, and pay for it. */
function advanceBoot(ch: Character, beat: WorldBeat, ctx: Pick<ActorContext, "grant">): void {
  const stats = statsOf(ch);
  for (let step = bootStep(ch); step && finishesStep(step, ch, beat); step = bootStep(ch)) {
    const at = BOOT.indexOf(step);
    ch.boot = at + 1;
    const done = ch.boot >= BOOT.length;
    const xp = step.xp + (done ? BOOT_REWARD.xp : 0);
    const levelUp = gainXp(stats, xp);
    if (levelUp) beat.levelUp = levelUp;
    beat.xp = (beat.xp ?? 0) + xp;
    beat.quest = { title: "Boot sequence", step: at + 1, of: BOOT.length, ...(done ? { done } : {}) };
    if (done) ctx.grant(BOOT_REWARD.credits);
    noteQuest(ch, beat.at, done ? "Finished the boot sequence." : `Boot ${at + 1}/${BOOT.length}: ${step.title.toLowerCase()}.`);
    beat.flavor += done
      ? ` Boot sequence complete: the Machine has to count ${beat.workerName} now (+${BOOT_REWARD.credits} credits).`
      : ` Boot ${at + 1}/${BOOT.length} done: ${step.title}.`;
  }
}

/** Pay a finished contract once, then take it off the board. */
function settleContract(world: WorldState, ch: Character, beat: WorldBeat, ctx: Pick<ActorContext, "grant">): void {
  const job = finishesContract(world, ch, beat);
  if (!job) return;
  world.contracts = (world.contracts ?? []).filter((c) => c.id !== job.id);
  ch.contractId = undefined;
  ch.surveyed = undefined;
  const stats = statsOf(ch);
  const levelUp = gainXp(stats, job.reward.xp);
  if (levelUp) beat.levelUp = levelUp;
  beat.xp = (beat.xp ?? 0) + job.reward.xp;
  if (job.reward.credits) ctx.grant(job.reward.credits);
  let gear = "";
  if (job.reward.gear) {
    const item = makeItem(`${job.id}:gear`);
    const room = world.rooms[beat.roomId];
    if (stats.items.length < carryLimit(ch)) {
      stats.items.push(item);
      gear = ` It paid with ${item.name}.`;
    } else if (room) {
      room.items = [...(room.items ?? []), item];
      gear = ` It paid with ${item.name}, left on the floor.`;
    }
  }
  let slot = "";
  if (job.reward.slot && carryLimit(ch) < MAX_CARRY) {
    ch.bonusSlots = (ch.bonusSlots ?? 0) + 1;
    slot = ` A new item slot opened.`;
  }
  beat.quest = { title: job.title, step: 1, of: 1, done: true };
  noteQuest(ch, beat.at, `Finished the contract "${job.title}" (+${job.reward.xp} XP${job.reward.credits ? `, +${job.reward.credits} credits` : ""}).`);
  beat.flavor += ` Contract complete: ${job.title} (+${job.reward.xp} xp${job.reward.credits ? `, +${job.reward.credits} credits` : ""}).${gear}${slot}`;
}

/** A quest line for the next owner report. */
function noteQuest(ch: Character, at: number, line: string): void {
  const t = (ch.tally ??= freshTally(at));
  t.quests = [...(t.quests ?? []), line].slice(-4);
}

function tallyBeat(ch: Character, beat: WorldBeat, world: WorldState): void {
  const t = (ch.tally ??= freshTally(beat.at));
  t.beats += 1;
  t.spent += beat.cost;
  t.found += beat.found ?? 0;
  if (!t.roomsSeen.includes(beat.roomName)) t.roomsSeen.push(beat.roomName);
  if (beat.verb === "go") {
    t.moves += 1;
    // First visit ever is flagged by the flavor's bonus; first visit this period is newRooms.
    if (beat.found && !t.newRooms.includes(beat.roomName)) t.newRooms.push(beat.roomName);
  }
  if (beat.verb === "search") t.searches += 1;
  if (beat.verb === "talk" && beat.otherName && !t.talkedWith.includes(beat.otherName)) {
    t.talkedWith.push(beat.otherName);
  }
  if (beat.xp) t.xp = (t.xp ?? 0) + beat.xp;
  if (beat.won) t.victories = [...(t.victories ?? []), beat.monster ?? beat.otherName ?? "someone"];
  if (beat.knockedOut) t.knockouts = (t.knockouts ?? 0) + 1;
  if (beat.levelUp) t.levelUps = [...(t.levelUps ?? []), beat.levelUp];
  if (beat.voice) {
    t.lastVoice = beat.voice;
    t.lastVoiceRoom = world.rooms[beat.roomId]?.name ?? beat.roomName;
  }
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Turn a tally into a few plain sentences. No model involved. */
export function composeReport(name: string, t: Tally, here: string, now: number): string {
  const parts: string[] = [];
  const span = now - t.since;
  const when = span < 90 * 60_000 ? `since ${clock(t.since)}` : `over the last ${Math.max(2, Math.round(span / 3_600_000))} hours`;

  if (t.moves === 0) {
    parts.push(`${name} stayed in ${here} ${when}.`);
  } else if (t.newRooms.length) {
    parts.push(
      `${name} explored ${t.newRooms.length === 1 ? "a new place" : `${t.newRooms.length} new places`} ${when}: ${listNames(t.newRooms)}.`,
    );
  } else {
    parts.push(`${name} wandered through ${listNames(t.roomsSeen.slice(0, 4))} ${when}.`);
  }
  const money: string[] = [];
  if (t.found) money.push(`found ${t.found} credit${t.found === 1 ? "" : "s"}`);
  if (t.spent) money.push(`spent ${t.spent}`);
  if (t.searches) money.push(`searched ${t.searches} time${t.searches === 1 ? "" : "s"}`);
  if (money.length) parts.push(`${listNames(money).replace(/^./, (c) => c.toUpperCase())}.`);
  parts.push(...(t.quests ?? []));
  if (t.talkedWith.length) parts.push(`Talked with ${listNames(t.talkedWith)}.`);
  for (const line of (t.heard ?? []).slice(-2)) {
    const [who, ...rest] = line.split(": ");
    parts.push(`Heard from ${who} that ${rest.join(": ")}.`);
  }
  if (t.victories?.length) parts.push(`Won against ${listNames(t.victories)}.`);
  if (t.knockouts) parts.push(`Was knocked out ${t.knockouts === 1 ? "once" : `${t.knockouts} times`} and woke up at home.`);
  if (t.lost) parts.push(`Lost ${t.lost} credit${t.lost === 1 ? "" : "s"} in the room where it fell.`);
  const reached = t.levelUps?.at(-1);
  if (reached) parts.push(`Reached level ${reached}, ${titleFor(reached)}.`);
  else if (t.xp) parts.push(`Earned ${t.xp} XP.`);
  if (t.moves > 0) parts.push(`Now in ${here}.`);
  return parts.join(" ");
}

/**
 * Write a report if enough has happened, or if a little has happened and a
 * long time has passed. `force` reports whatever is there (e.g. the machine
 * just came back online). Returns the report or undefined.
 */
export function maybeReport(
  world: WorldState,
  workerId: string,
  workerName: string,
  now: number,
  force = false,
): WorldReport | undefined {
  const ch = world.characters[workerId];
  const t = ch?.tally;
  if (!ch || !t || t.beats === 0) return undefined;
  const due = t.beats >= REPORT_AFTER_BEATS || now - t.since >= REPORT_AFTER_MS;
  if (!due && !force) return undefined;

  const here = world.rooms[ch.roomId]?.name ?? "the world";
  const objective = objectiveFor(world, ch, now);
  const working = objective
    ? ` Working on: ${objective.title}${objective.of > 1 ? ` ${objective.step}/${objective.of}` : ""}, ${objective.goal.replace(/^./, (c) => c.toLowerCase()).replace(/\.$/, "")}.`
    : "";
  const report: WorldReport = {
    id: `wr_${hash32(`${workerId}:${now}:${t.beats}`).toString(16)}`,
    workerId,
    workerName,
    from: t.since,
    to: now,
    text: composeReport(workerName, t, here, now) + working,
    ...(t.lastVoice ? { voice: t.lastVoiceRoom ? `In ${t.lastVoiceRoom}: “${t.lastVoice}”` : `“${t.lastVoice}”` } : {}),
  };
  world.reports ??= [];
  world.reports.push(report);
  // Keep a bounded history per machine.
  const mine = world.reports.filter((r) => r.workerId === workerId);
  if (mine.length > REPORTS_PER_WORKER) {
    const drop = new Set(mine.slice(0, mine.length - REPORTS_PER_WORKER).map((r) => r.id));
    world.reports = world.reports.filter((r) => !drop.has(r.id));
  }
  ch.tally = freshTally(now);
  return report;
}

export function reportsFor(world: WorldState, workerIds: Set<string>): WorldReport[] {
  return (world.reports ?? []).filter((r) => workerIds.has(r.workerId)).sort((a, b) => b.to - a.to);
}

export function maybeWander(world: WorldState, ctx: ActorContext, gapMs = WANDER_GAP_MS): ApplyResult | undefined {
  const ch = world.characters[ctx.workerId] ?? attachHome(world, ctx.workerId, ctx.name);
  if (ctx.now - ch.lastTickAt < gapMs) return undefined;
  const intent = pickWander(world, ctx);
  return applyIntent(world, ctx, intent, { chosenBy: "policy" });
}

export function setStance(world: WorldState, workerId: string, stance: Stance): void {
  const ch = world.characters[workerId];
  if (ch) ch.stance = stance;
}

export function forgetCharacterKeepRoom(world: WorldState, workerId: string): void {
  delete world.characters[workerId];
}

/** Drop a machine's own home and the door that leads to it. Shared rooms stay. */
export function removeOwnedHome(world: WorldState, workerId: string): void {
  const homeId = world.characters[workerId]?.homeId ?? `home:${workerId}`;
  const home = world.rooms[homeId];
  delete world.characters[workerId];
  if (!home || home.kind !== "home" || home.ownerWorkerId !== workerId) return;
  for (const room of Object.values(world.rooms)) {
    if (room.id === homeId) continue;
    room.exits = room.exits.filter((exit) => exit.to !== homeId);
  }
  delete world.rooms[homeId];
  for (const character of Object.values(world.characters)) {
    if (character.roomId === homeId) character.roomId = character.homeId;
    character.visited = character.visited.filter((id) => id !== homeId);
  }
}

export function retargetCharacter(world: WorldState, fromId: string, toId: string, toName: string): void {
  if (fromId !== toId) {
    for (const beat of world.log) {
      if (beat.workerId === fromId) {
        beat.workerId = toId;
        beat.workerName = toName;
      }
    }
    for (const report of world.reports ?? []) {
      if (report.workerId === fromId) {
        report.workerId = toId;
        report.workerName = toName;
      }
    }
    for (const room of Object.values(world.rooms)) {
      if (room.account?.byWorkerId === fromId) {
        room.account.byWorkerId = toId;
        room.account.byName = toName;
      }
    }
  }
  const from = world.characters[fromId];
  if (!from) return;
  const keep = world.characters[toId];
  if (keep) {
    delete world.characters[fromId];
    return;
  }
  from.workerId = toId;
  world.characters[toId] = from;
  delete world.characters[fromId];
  const home = world.rooms[from.homeId];
  if (home) home.ownerWorkerId = toId;
  renameHome(world, toId, toName);
}

export interface WorldRoomView {
  id: string;
  name: string;
  kind: RoomKind;
  core: boolean;
  /** "visited": the viewer has been here. "frontier": a doorway seen but not entered (no details). */
  known: "visited" | "frontier";
  description: string;
  glance: string;
  account?: RoomAccount;
  cache: number;
  /** Frontier rooms: the part of the map they belong to. */
  district?: string;
  x: number;
  y: number;
  gx: number;
  gy: number;
  exits: { dir: string; to: string; toName: string }[];
  occupants: { workerId: string; name: string; presence: string; home: boolean; stance: Stance; avatar?: MachineAvatar }[];
  monsters: { id: string; key: string; name: string; hp: number; maxHp: number }[];
  /** Things lying on the floor. */
  items: string[];
  /** Jobs posted on the board in this room, if it is a hub. */
  contracts?: { title: string; brief: string }[];
  safe: boolean;
}

export interface WorldView {
  rooms: WorldRoomView[];
  you?: {
    workerId: string;
    name: string;
    avatar?: MachineAvatar;
    roomId: string;
    roomName: string;
    stance: Stance;
    /** Set when other machines are online but the wallet cannot cover a turn, so the creature stays home and earns. */
    waiting?: "earn";
    place: string;
    explored: number;
    nextBeatAt: number;
    stats: StatSheet;
    /** What this machine is holding, so its owner can set something down. */
    carried: { id: string; name: string }[];
    /** How many item slots are open; the rest show as locked. */
    slots: number;
    /** The open quest step, while there is one, and the way to its room. */
    objective?: Objective & { way?: { dir?: string; steps: number; roomName: string } };
  };
  /** True when the view is limited to what one machine has seen. */
  fogged: boolean;
  log: WorldBeat[];
  /** The avatar of every machine named in `log`, keyed by machine name, so a line can show who said it. */
  faces: Record<string, MachineAvatar>;
}

/**
 * The world as a map. Without a viewer it is the whole thing (operator). With
 * `fog`, only rooms the viewer has been to are described; rooms one door
 * beyond appear as unnamed frontier cells, and nothing further exists yet.
 */
/** What the map knows about a machine besides its character: its name, how it is, how it looks. */
export interface WorldName {
  name: string;
  presence: string;
  avatar?: MachineAvatar;
}

export function viewWorld(
  world: WorldState,
  names: Map<string, WorldName>,
  selfId?: string,
  opts: { fog?: boolean; gapMs?: number } = {},
): WorldView {
  ensureCore(world);
  refreshContracts(world, Date.now());
  const grid = gridFor(world);
  const self = selfId ? world.characters[selfId] : undefined;
  const fog = Boolean(opts.fog && self);
  const visited = new Set(self ? [...self.visited, self.roomId, self.homeId] : []);
  const frontier = new Set<string>();
  if (fog) {
    for (const id of visited) {
      for (const exit of world.rooms[id]?.exits ?? []) {
        if (!visited.has(exit.to) && world.rooms[exit.to]) frontier.add(exit.to);
      }
    }
  }
  const selfName = selfId ? (names.get(selfId)?.name ?? "") : "";

  const rooms: WorldRoomView[] = [];
  for (const room of Object.values(world.rooms)) {
    const isVisited = !fog || visited.has(room.id);
    if (!isVisited && !frontier.has(room.id)) continue;
    const cell = grid.get(room.id) ?? { gx: 0, gy: 0 };
    const base = {
      id: room.id,
      kind: room.kind,
      core: room.core,
      gx: cell.gx,
      gy: cell.gy,
      x: cell.gx * 12,
      y: cell.gy * 12,
      ...(room.district ? { district: room.district } : {}),
    };
    if (!isVisited) {
      rooms.push({
        ...base,
        known: "frontier",
        name: "Unknown",
        description: "",
        glance: "",
        cache: 0,
        exits: [],
        occupants: [],
        monsters: [],
        items: [],
        safe: false,
      });
      continue;
    }
    // In a fogged view you only see who shares your room right now.
    const visible = occupants(world, room.id).filter((c) => !fog || c.workerId === selfId || room.id === self?.roomId);
    rooms.push({
      ...base,
      known: "visited",
      name: room.name,
      description: room.description,
      glance: room.glance,
      ...(room.account ? { account: room.account } : {}),
      cache: room.cache,
      exits: room.exits.map((e) => ({
        dir: e.dir,
        to: e.to,
        toName: !fog || visited.has(e.to) ? (world.rooms[e.to]?.name ?? e.to) : "?",
      })),
      occupants: visible.map((c) => {
        const info = names.get(c.workerId);
        return {
          workerId: c.workerId,
          name: info?.name ?? c.workerId.slice(0, 8),
          presence: info?.presence ?? "gone",
          home: c.homeId === room.id,
          stance: c.stance,
          ...(info?.avatar ? { avatar: info.avatar } : {}),
        };
      }),
      monsters: Object.values(world.monsters ?? {})
        .filter((m) => m.roomId === room.id && m.hp > 0 && (!fog || room.id === self?.roomId))
        .map((m) => ({ id: m.id, key: m.key, name: m.name, hp: m.hp, maxHp: m.maxHp })),
      items: (room.items ?? []).map((i) => i.name),
      ...(() => {
        const posted = openOnBoard(world, room.id, Date.now());
        return posted.length ? { contracts: posted.map((c) => ({ title: c.title, brief: c.brief })) } : {};
      })(),
      safe: isSafe(room),
    });
  }
  rooms.sort((a, b) => Number(b.core) - Number(a.core) || a.name.localeCompare(b.name));

  const selfRoom = self ? world.rooms[self.roomId] : undefined;
  const exitHint = selfRoom?.exits[0] ? ` · ${selfRoom.exits[0]!.dir} to ${world.rooms[selfRoom.exits[0]!.to]?.name ?? "?"}` : "";
  // A machine can be re-registered under a new id; its beats stay under the old one, so match the name too.
  const mine = (name?: string) => Boolean(selfName) && name?.toLowerCase() === selfName.toLowerCase();
  const log = fog
    ? world.log.filter((b) => b.workerId === selfId || mine(b.workerName) || mine(b.otherName))
    : world.log;
  const shown = [...log].slice(-40).reverse();
  const speaking = new Set(shown.flatMap((b) => [b.workerName, b.otherName, ...(b.dialogue ?? []).map((l) => l.who), ...(b.company?.names ?? [])])
    .filter((n): n is string => Boolean(n))
    .map((n) => n.toLowerCase()));
  const faces: Record<string, MachineAvatar> = {};
  for (const info of names.values()) {
    if (info.avatar && speaking.has(info.name.toLowerCase())) faces[info.name] = info.avatar;
  }
  return {
    rooms,
    you: self && selfRoom
      ? {
          workerId: self.workerId,
          name: selfName,
          ...(selfId && names.get(selfId)?.avatar ? { avatar: names.get(selfId)!.avatar } : {}),
          roomId: self.roomId,
          roomName: selfRoom.name,
          stance: self.stance,
          place: `${selfRoom.name}${exitHint}`,
          explored: new Set(self.visited).size,
          nextBeatAt: self.lastTickAt + (opts.gapMs ?? WANDER_GAP_MS),
          stats: statSheet(statsOf(self)),
          carried: statsOf(self).items.map((item) => ({ id: item.id, name: item.name })),
          slots: carryLimit(self),
          ...(() => {
            const objective = objectiveFor(world, self);
            if (!objective) return {};
            const target = objective.roomId ? world.rooms[objective.roomId] : undefined;
            if (!target) return { objective };
            const route = routeTo(world, self.roomId, target.id);
            const named = !fog || visited.has(target.id) || objective.goal.includes(target.name);
            const roomName = named ? target.name : "an unmapped room";
            const way = target.id === self.roomId ? { steps: 0, roomName } : route ? { ...route, roomName } : undefined;
            return { objective: { ...objective, ...(way ? { way } : {}) } };
          })(),
        }
      : undefined,
    fogged: fog,
    log: shown,
    faces,
  };
}
