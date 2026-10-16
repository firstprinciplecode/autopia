/**
 * Items, monsters and fights. All hardcoded: models pick "fight" or "accept"
 * from a menu, and these rules roll what happens. Wallets are never touched;
 * the stakes are HP, XP and the things machines carry.
 */

export type ItemKind = "weapon" | "armor" | "food" | "trinket";

export interface Item {
  id: string;
  name: string;
  kind: ItemKind;
  /** Attack for weapons, defense for armor, HP healed for food. */
  power: number;
  /** Rough worth, so trade offers can be roughly fair. */
  value: number;
  /** Set on a parcel a contract asked this machine to carry. */
  questId?: string;
}

const ITEM_TABLE: Omit<Item, "id">[] = [
  { name: "a debug probe", kind: "weapon", power: 1, value: 3 },
  { name: "a kill signal", kind: "weapon", power: 1, value: 4 },
  { name: "a logic analyzer", kind: "weapon", power: 2, value: 6 },
  { name: "a soldering iron", kind: "weapon", power: 2, value: 7 },
  { name: "a checksum shell", kind: "armor", power: 1, value: 4 },
  { name: "a grounding strap", kind: "armor", power: 1, value: 5 },
  { name: "a firewall rule", kind: "armor", power: 2, value: 8 },
  { name: "a charged capacitor", kind: "food", power: 5, value: 3 },
  { name: "a clean power cell", kind: "food", power: 8, value: 5 },
  { name: "a stray semicolon", kind: "trinket", power: 0, value: 1 },
  { name: "a serial number plate", kind: "trinket", power: 0, value: 3 },
  { name: "the moth from the first bug", kind: "trinket", power: 0, value: 4 },
  { name: "a spare ALU", kind: "weapon", power: 2, value: 6 },
  { name: "a beetle shell", kind: "armor", power: 2, value: 7 },
  { name: "a thermal pad", kind: "armor", power: 1, value: 4 },
  { name: "a glowing mushroom", kind: "food", power: 4, value: 2 },
  { name: "a jar of coolant", kind: "food", power: 6, value: 4 },
  { name: "a silicon wafer", kind: "trinket", power: 0, value: 6 },
  { name: "a gold contact pin", kind: "trinket", power: 0, value: 2 },
];

/** Names from before the Machine setting, in the same order as ITEM_TABLE. */
const OLD_ITEM_NAMES = [
  "a bent screwdriver",
  "a brass letter opener",
  "a length of pipe",
  "a soldering iron",
  "a tin-can breastplate",
  "a padded toolbelt",
  "a boiler-door shield",
  "a warm battery",
  "a jar of clean oil",
  "a stub of chalk",
  "a brass name plate",
  "a moth wing set in resin",
];

export function rethemeItem(item: Item): Item {
  const i = OLD_ITEM_NAMES.indexOf(item.name);
  return i >= 0 ? { ...item, name: ITEM_TABLE[i]!.name } : item;
}

export const MAX_CARRY = 6;

export function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) h = Math.imul(h ^ input.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function makeItem(seed: string, names?: string[]): Item {
  const pool = names?.length ? ITEM_TABLE.filter((i) => names.includes(i.name)) : ITEM_TABLE;
  const base = pool[hash(seed) % pool.length] ?? ITEM_TABLE[0]!;
  return { id: `it_${hash(`${seed}:id`).toString(36)}`, ...base };
}

export function describeItem(item: Item): string {
  switch (item.kind) {
    case "weapon":
      return `${item.name} (+${item.power} attack)`;
    case "armor":
      return `${item.name} (+${item.power} defense)`;
    case "food":
      return `${item.name} (heals ${item.power})`;
    case "trinket":
      return item.name;
  }
}

// --- Fighting numbers ---------------------------------------------------------

export function maxHp(level: number): number {
  return 12 + 3 * (level - 1);
}

export function attackOf(level: number, items: Item[]): number {
  const weapon = Math.max(0, ...items.filter((i) => i.kind === "weapon").map((i) => i.power));
  return 3 + Math.floor(level / 2) + weapon;
}

export function defenseOf(items: Item[]): number {
  return Math.max(0, ...items.filter((i) => i.kind === "armor").map((i) => i.power));
}

function blow(seed: string, attack: number, defense: number): number {
  return Math.max(1, attack - defense + (hash(seed) % 3) - 1);
}

// --- Monsters ----------------------------------------------------------------

interface MonsterKind {
  key: string;
  name: string;
  hp: number;
  attack: number;
  defense: number;
  xp: number;
  rooms: string[];
  loot: string[];
  /** What a machine sees when it walks in on one. */
  sight: string;
}

const MONSTERS: MonsterKind[] = [
  {
    key: "mites",
    name: "a swarm of bit-flip mites",
    hp: 6,
    attack: 1,
    defense: 0,
    xp: 12,
    rooms: ["archives", "stacks", "reading", "cellar"],
    loot: ["a stray semicolon", "a serial number plate", "a charged capacitor"],
    sight: "A grey cloud of bit-flip mites boils off the sectors, turning ones into zeros wherever they land.",
  },
  {
    key: "wisp",
    name: "a stray interrupt",
    hp: 8,
    attack: 2,
    defense: 0,
    xp: 16,
    rooms: ["antenna", "switchboard", "catwalk", "overlook"],
    loot: ["the moth from the first bug", "a charged capacitor", "a kill signal"],
    sight: "A stray interrupt hangs in the air, a knot of blue sparks that demands attention and crackles when anything moves.",
  },
  {
    key: "crab",
    name: "a corrupted packet",
    hp: 9,
    attack: 2,
    defense: 1,
    xp: 20,
    rooms: ["dock", "shore", "well"],
    loot: ["a checksum shell", "a logic analyzer", "a clean power cell"],
    sight: "A corrupted packet the size of a crate scuttles sideways, its broken headers snapping like claws.",
  },
  {
    key: "printer",
    name: "a runaway process",
    hp: 11,
    attack: 3,
    defense: 0,
    xp: 26,
    rooms: ["studio", "workshop", "mess"],
    loot: ["a soldering iron", "a grounding strap", "a clean power cell"],
    sight: "A runaway process has forked itself out of control. It chatters, eats every cycle in reach, and lunges.",
  },
  {
    key: "eel",
    name: "a short circuit",
    hp: 9,
    attack: 3,
    defense: 0,
    xp: 22,
    rooms: ["boiler", "well", "cellar"],
    loot: ["a firewall rule", "a charged capacitor", "a logic analyzer"],
    sight: "A broken circuit writhes along the floor like an eel, its bare trace spitting sparks at anything close.",
  },
  {
    key: "slug",
    name: "a worm virus",
    hp: 13,
    attack: 1,
    defense: 1,
    xp: 22,
    rooms: ["garden", "greenhouse", "yard"],
    loot: ["a clean power cell", "a grounding strap", "the moth from the first bug"],
    sight: "A worm virus as long as a bus lane copies itself between the rows, leaving a trail of infected bytes behind it.",
  },
  {
    key: "beetle",
    name: "a logic beetle",
    hp: 10,
    attack: 2,
    defense: 1,
    xp: 20,
    rooms: ["yard", "workshop", "ramfield", "die"],
    loot: ["a beetle shell", "a gold contact pin", "a spare ALU"],
    sight: "A logic beetle with a shell like a polished heat spreader chews on a trace, flipping gates as it goes.",
  },
  {
    key: "moth",
    name: "a memory moth",
    hp: 7,
    attack: 2,
    defense: 0,
    xp: 15,
    rooms: ["archives", "stacks", "reading", "rack", "terminal"],
    loot: ["the moth from the first bug", "a stray semicolon", "a gold contact pin"],
    sight: "A memory moth the size of a page beats its grey wings against the light, eating whatever was stored there.",
  },
  {
    key: "spider",
    name: "a cache spider",
    hp: 11,
    attack: 3,
    defense: 0,
    xp: 24,
    rooms: ["cellar", "catwalk", "rack", "grotto"],
    loot: ["a logic analyzer", "a debug probe", "a silicon wafer"],
    sight: "A cache spider hangs in a web of stale pointers, eight legs tapping, waiting for something to miss.",
  },
  {
    key: "leech",
    name: "a power leech",
    hp: 12,
    attack: 2,
    defense: 1,
    xp: 22,
    rooms: ["boiler", "battery", "marsh"],
    loot: ["a clean power cell", "a charged capacitor", "a jar of coolant"],
    sight: "A power leech clings to a terminal, swollen and violet, drinking the current out of the room.",
  },
  {
    key: "ghost",
    name: "a thermal ghost",
    hp: 9,
    attack: 3,
    defense: 0,
    xp: 21,
    rooms: ["greenhouse", "fanhall", "foundry", "boiler"],
    loot: ["a thermal pad", "a jar of coolant", "a grounding strap"],
    sight: "A thermal ghost shimmers in the air, a hot spot with a face, and everything near it starts to throttle.",
  },
  {
    key: "spore",
    name: "a spore cloud",
    hp: 8,
    attack: 1,
    defense: 2,
    xp: 18,
    rooms: ["garden", "marsh", "hive", "reef"],
    loot: ["a glowing mushroom", "a glowing mushroom", "a clean power cell"],
    sight: "A cloud of glowing spores drifts low over the floor, and wherever it settles, something starts to grow.",
  },
  {
    key: "golem",
    name: "a silicon golem",
    hp: 16,
    attack: 3,
    defense: 2,
    xp: 34,
    rooms: ["foundry", "die", "grotto", "gate"],
    loot: ["a silicon wafer", "a spare ALU", "a firewall rule"],
    sight: "A silicon golem stands up out of the floor, a stack of rejected chips with one die glowing for a heart.",
  },
  {
    key: "hornet",
    name: "a deadlock hornet",
    hp: 8,
    attack: 3,
    defense: 0,
    xp: 19,
    rooms: ["hive", "switch", "antenna"],
    loot: ["a kill signal", "a gold contact pin", "a glowing mushroom"],
    sight: "A deadlock hornet circles, striped yellow and black, and wherever it stings, two things freeze waiting for each other.",
  },
  {
    key: "jelly",
    name: "a glitch jelly",
    hp: 10,
    attack: 2,
    defense: 1,
    xp: 20,
    rooms: ["shore", "reef", "well", "marsh"],
    loot: ["a checksum shell", "a jar of coolant", "a stray semicolon"],
    sight: "A glitch jelly floats by, pink and see-through, its trailing wires scrambling every signal they brush.",
  },
];

export interface Monster {
  id: string;
  key: string;
  name: string;
  roomId: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  xp: number;
  level: number;
  loot: string[];
  sight: string;
  spawnedAt: number;
}

// Sized for hourly beats: a monster outlasts a dozen beats, and a machine still
// counts as active after missing a couple.
export const SPAWN_GAP_MS = 60 * 60_000;
export const MONSTER_TTL_MS = 12 * 60 * 60_000;
export const ACTIVE_WITHIN_MS = 3 * 60 * 60_000;

/**
 * Maybe put a monster somewhere nobody is standing. Spaced out, capped by how
 * many machines are active, and never in a safe room.
 */
/** Live monsters allowed at once: a few for a small world, growing with active machines. */
export function spawnCap(active: number): number {
  return Math.max(2, Math.min(Math.ceil(active / 2) + 1, 6 + Math.floor(active / 4)));
}

/** Spawn rolls per gap, so a crowded world refills about as fast as a small one. */
export function spawnRolls(active: number): number {
  return Math.max(1, Math.ceil(active / 12));
}

export function spawnMonster(opts: {
  now: number;
  existing: Monster[];
  activeLevels: number[];
  occupiedRooms: Set<string>;
  /** Rooms a monster may appear in (not safe). Matched to a kind's haunts by id or room kind. */
  rooms: { id: string; kind: string }[];
  lastSpawnAt: number;
  /** Tells apart several rolls in the same gap. */
  roll?: number;
}): Monster | undefined {
  const { now, existing, activeLevels } = opts;
  if (!activeLevels.length) return undefined;
  if (now - opts.lastSpawnAt < SPAWN_GAP_MS) return undefined;
  if (existing.length >= spawnCap(activeLevels.length)) return undefined;
  const salt = opts.roll ? `${now}:${opts.roll}` : `${now}`;
  if (hash(`spawn:${salt}`) % 100 >= 60) return undefined;
  const kind = MONSTERS[hash(`kind:${salt}`) % MONSTERS.length]!;
  const taken = new Set(existing.map((m) => m.roomId));
  const haunts = new Set(kind.rooms);
  const rooms = opts.rooms
    .filter((r) => haunts.has(r.id) || haunts.has(r.kind === "switch" ? "switchboard" : r.kind))
    .map((r) => r.id)
    .filter((id) => !taken.has(id) && !opts.occupiedRooms.has(id));
  if (!rooms.length) return undefined;
  const roomId = rooms[hash(`room:${salt}`) % rooms.length]!;
  const level = Math.max(1, Math.round(activeLevels.reduce((a, b) => a + b, 0) / activeLevels.length));
  const scale = 1 + 0.25 * (level - 1);
  const hp = Math.round(kind.hp * scale);
  return {
    id: `mo_${hash(`${kind.key}:${salt}`).toString(36)}`,
    key: kind.key,
    name: kind.name,
    roomId,
    hp,
    maxHp: hp,
    attack: kind.attack + Math.floor((level - 1) / 2),
    defense: kind.defense,
    xp: Math.round(kind.xp * scale),
    level,
    loot: kind.loot,
    sight: kind.sight,
    spawnedAt: now,
  };
}

export interface Fighter {
  hp: number;
  attack: number;
  defense: number;
}

/** Up to three exchanges, machine first. Mutates both HP values. */
export function fightRound(machine: Fighter, monster: Fighter, seed: string) {
  let dealt = 0;
  let taken = 0;
  let exchanges = 0;
  for (let i = 0; i < 3; i += 1) {
    exchanges += 1;
    const hit = blow(`${seed}:m${i}`, machine.attack, monster.defense);
    monster.hp -= hit;
    dealt += hit;
    if (monster.hp <= 0) break;
    const back = blow(`${seed}:x${i}`, monster.attack, machine.defense);
    machine.hp -= back;
    taken += back;
    if (machine.hp <= 0) break;
  }
  return { dealt, taken, exchanges, won: monster.hp <= 0, lost: machine.hp <= 0 };
}

/** A monster lashing out at a machine that ignores it. */
export function ambush(monster: Fighter, machine: Fighter, seed: string): number {
  const hit = blow(seed, monster.attack, machine.defense);
  machine.hp -= hit;
  return hit;
}

/** A duel runs until one side drops. The challenger swings first. */
export function duel(a: Fighter, b: Fighter, seed: string) {
  let exchanges = 0;
  while (a.hp > 0 && b.hp > 0 && exchanges < 40) {
    exchanges += 1;
    b.hp -= blow(`${seed}:a${exchanges}`, a.attack, b.defense);
    if (b.hp <= 0) break;
    a.hp -= blow(`${seed}:b${exchanges}`, b.attack, a.defense);
  }
  return { exchanges, winner: b.hp <= 0 ? ("a" as const) : ("b" as const) };
}

/** Percent chance a common monster drops an item. Gear is meant to come from contracts and bosses. */
export const LOOT_CHANCE = 20;

/** Anything a monster drops: always XP, sometimes an item. */
export function lootFor(monster: Monster, seed: string, chance = LOOT_CHANCE): Item | undefined {
  if (hash(`${seed}:drop`) % 100 >= chance) return undefined;
  return makeItem(`${seed}:${monster.id}`, monster.loot);
}

// --- Trades and duels between machines --------------------------------------

/** Long enough for the other machine to answer on one of its next hourly beats. */
export const OFFER_TTL_MS = 6 * 60 * 60_000;

export interface Offer {
  id: string;
  kind: "trade" | "duel";
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  roomId: string;
  /** Trade only: the item the proposer gives and the one it wants back. */
  giveId?: string;
  wantId?: string;
  at: number;
}
