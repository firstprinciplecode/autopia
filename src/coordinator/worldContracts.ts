/**
 * Contracts: jobs posted on boards in the Core and in each district's hub (the
 * public room of that district nearest the Core). Code writes them from the
 * live world, decides when one is done, and pays exactly once. A machine holds
 * one at a time. Models only see "take the contract" or the next step.
 */

import type { Item } from "./worldCombat.js";
import type { Character, Room, WorldBeat, WorldState } from "./world.js";
import { gridFor, hash32 } from "./world.js";
import { CORE_ROOM_ID } from "./worldQuests.js";

export type ContractKind = "bounty" | "survey" | "recovery" | "courier" | "expedition";

const KINDS: ContractKind[] = ["bounty", "survey", "recovery", "courier", "expedition"];

/** Open jobs kept on one board. */
export const BOARD_OPEN = 2;
/** How long a job stays on the board before someone takes it. */
export const CONTRACT_TTL_MS = 6 * 60 * 60_000;
/** How long the holder has to finish, from the moment they take it. */
export const CONTRACT_WORK_MS = 12 * 60 * 60_000;
/** Rooms to visit for a survey. */
export const SURVEY_COUNT = 3;

export const DELIVER_TARGET = "contract:deliver";

export interface ContractReward {
  xp: number;
  credits: number;
  /** A piece of gear on completion. Contracts are where gear mostly comes from. */
  gear?: boolean;
  /** One extra carry slot. */
  slot?: boolean;
}

export interface Contract {
  id: string;
  kind: ContractKind;
  boardId: string;
  title: string;
  brief: string;
  postedAt: number;
  expiresAt: number;
  takenBy?: string;
  roomId?: string;
  district?: string;
  monsterName?: string;
  itemId?: string;
  count?: number;
  reward: ContractReward;
}

/** What the holder should do next. `go` is a room id; world.ts turns it into a direction. */
export interface ContractLead {
  why: string;
  go?: string;
  verb?: "take" | "fight" | "quest" | "drop";
  target?: string;
}

export function contractTarget(id: string): string {
  return `contract:${id}`;
}

export function heldContract(world: WorldState, ch: Character): Contract | undefined {
  if (!ch.contractId) return undefined;
  return (world.contracts ?? []).find((c) => c.id === ch.contractId && c.takenBy === ch.workerId);
}

export function openOnBoard(world: WorldState, roomId: string, now: number): Contract[] {
  return (world.contracts ?? []).filter((c) => c.boardId === roomId && !c.takenBy && c.expiresAt > now);
}

/** The Core, plus the nearest public room of every district. */
export function boardRooms(world: WorldState): Room[] {
  const core = world.rooms[CORE_ROOM_ID];
  const grid = gridFor(world);
  const hq = grid.get(CORE_ROOM_ID) ?? { gx: 0, gy: 0 };
  const far = (id: string) => {
    const c = grid.get(id);
    return c ? Math.abs(c.gx - hq.gx) + Math.abs(c.gy - hq.gy) : 99;
  };
  const hubs = new Map<string, Room>();
  for (const room of Object.values(world.rooms)) {
    if (!room.district || room.kind === "home") continue;
    const cur = hubs.get(room.district);
    if (!cur || far(room.id) < far(cur.id)) hubs.set(room.district, room);
  }
  return [core, ...hubs.values()].filter((r): r is Room => Boolean(r));
}

function publics(world: WorldState): Room[] {
  return Object.values(world.rooms).filter((r) => r.kind !== "home");
}

function parcelItem(contractId: string): Item {
  return { id: `it_${hash32(`${contractId}:parcel`).toString(36)}`, name: "a sealed parcel", kind: "trinket", power: 0, value: 1, questId: contractId };
}

export function carryingParcel(ch: Character, contractId: string): Item | undefined {
  return ch.stats?.items.find((i) => i.questId === contractId);
}

function parcelOnFloor(world: WorldState, contractId: string): { room: Room; item: Item } | undefined {
  for (const room of Object.values(world.rooms)) {
    const item = room.items?.find((i) => i.questId === contractId);
    if (item) return { room, item };
  }
  return undefined;
}

/** Build one contract of a kind, or undefined when the world has nothing for it to ask. */
export function draftContract(
  world: WorldState,
  board: Room,
  now: number,
  kind: ContractKind,
  salt = 0,
): Contract | undefined {
  const id = `ct_${hash32(`${board.id}:${kind}:${salt}:${Math.floor(now / 60_000)}`).toString(36)}`;
  const posted = { id, kind, boardId: board.id, postedAt: now, expiresAt: now + CONTRACT_TTL_MS };
  const roll = hash32(id);
  switch (kind) {
    case "bounty": {
      const monsters = Object.values(world.monsters ?? {}).filter((m) => m.hp > 0 && world.rooms[m.roomId]);
      if (!monsters.length) return undefined;
      const m = monsters[roll % monsters.length]!;
      const room = world.rooms[m.roomId]!;
      return {
        ...posted,
        title: `Clear ${m.name}`,
        brief: `Defeat ${m.name} in ${room.name}`,
        roomId: room.id,
        monsterName: m.name,
        reward: { xp: 20, credits: 4, gear: true },
      };
    }
    case "survey": {
      const counts = new Map<string, number>();
      for (const room of publics(world)) if (room.district) counts.set(room.district, (counts.get(room.district) ?? 0) + 1);
      const districts = [...counts.entries()].filter(([, n]) => n >= SURVEY_COUNT).map(([name]) => name);
      if (!districts.length) return undefined;
      const district = districts[roll % districts.length]!;
      return {
        ...posted,
        title: `Survey ${district}`,
        brief: `Visit ${SURVEY_COUNT} rooms in ${district}`,
        district,
        count: SURVEY_COUNT,
        reward: { xp: 15, credits: 3 },
      };
    }
    case "recovery": {
      const lying = publics(world).flatMap((room) =>
        (room.items ?? []).filter((i) => !i.questId).map((item) => ({ room, item })),
      );
      if (!lying.length) return undefined;
      const pick = lying[roll % lying.length]!;
      return {
        ...posted,
        title: `Recover ${pick.item.name}`,
        brief: `Pick up ${pick.item.name} in ${pick.room.name}`,
        roomId: pick.room.id,
        itemId: pick.item.id,
        reward: { xp: 12, credits: 2 },
      };
    }
    case "courier": {
      const dests = publics(world).filter((r) => r.id !== board.id);
      if (!dests.length) return undefined;
      const dest = dests[roll % dests.length]!;
      return {
        ...posted,
        title: `Courier to ${dest.name}`,
        brief: `Carry a sealed parcel to ${dest.name}`,
        roomId: dest.id,
        reward: { xp: 18, credits: 5 },
      };
    }
    case "expedition": {
      const grid = gridFor(world);
      const from = grid.get(board.id);
      const far = (room: Room) => {
        const c = grid.get(room.id);
        return from && c ? Math.abs(c.gx - from.gx) + Math.abs(c.gy - from.gy) : 0;
      };
      const dests = publics(world).filter((r) => r.id !== board.id && far(r) >= 2).sort((a, b) => far(b) - far(a));
      const dest = dests[roll % Math.max(1, Math.min(3, dests.length))] ?? dests[0];
      if (!dest) return undefined;
      return {
        ...posted,
        title: `Expedition to ${dest.name}`,
        brief: `Reach ${dest.name}`,
        roomId: dest.id,
        reward: { xp: 25, credits: 4, slot: roll % 2 === 0 },
      };
    }
  }
}

function stillPossible(world: WorldState, c: Contract): boolean {
  if (c.roomId && !world.rooms[c.roomId]) return false;
  if (c.kind === "bounty") {
    return Object.values(world.monsters ?? {}).some((m) => m.hp > 0 && m.roomId === c.roomId && m.name === c.monsterName);
  }
  if (c.kind === "recovery" && c.itemId) {
    const holder = c.takenBy ? world.characters[c.takenBy] : undefined;
    if (holder?.stats?.items.some((i) => i.id === c.itemId)) return true;
    return Object.values(world.rooms).some((r) => r.items?.some((i) => i.id === c.itemId));
  }
  if (c.kind === "courier" && c.takenBy) return true;
  return true;
}

function stripParcel(world: WorldState, contractId: string): void {
  for (const ch of Object.values(world.characters)) {
    if (ch.stats) ch.stats.items = ch.stats.items.filter((i) => i.questId !== contractId);
  }
  for (const room of Object.values(world.rooms)) {
    if (room.items) room.items = room.items.filter((i) => i.questId !== contractId);
  }
}

/**
 * Drop expired jobs and refill each board. Returns the worker ids whose job
 * expired this pass, so their next beat can say so.
 */
export function refreshContracts(world: WorldState, now: number): string[] {
  world.contracts ??= [];
  const lost: string[] = [];
  const keep: Contract[] = [];
  for (const c of world.contracts) {
    const alive = c.expiresAt > now && stillPossible(world, c);
    if (alive) {
      keep.push(c);
      continue;
    }
    if (c.takenBy && world.characters[c.takenBy]?.contractId === c.id) lost.push(c.takenBy);
    if (c.kind === "courier") stripParcel(world, c.id);
  }
  world.contracts = keep;
  for (const id of lost) {
    const ch = world.characters[id];
    if (!ch) continue;
    ch.contractId = undefined;
    ch.surveyed = undefined;
  }
  for (const board of boardRooms(world)) {
    const open = () => world.contracts!.filter((c) => c.boardId === board.id && !c.takenBy);
    let salt = world.contracts.length;
    while (open().length < BOARD_OPEN && salt < world.contracts.length + 12) {
      const kind = KINDS[hash32(`${board.id}:${Math.floor(now / CONTRACT_TTL_MS)}:${salt}`) % KINDS.length]!;
      const made = draftContract(world, board, now, kind, salt);
      salt += 1;
      if (!made) continue;
      if (world.contracts.some((c) => c.id === made.id || (c.boardId === board.id && !c.takenBy && c.kind === made.kind))) continue;
      world.contracts.push(made);
    }
  }
  return lost;
}

/** Put a contract on its board. Tests use this to pin a kind. */
export function postContract(world: WorldState, contract: Contract): void {
  world.contracts = [...(world.contracts ?? []).filter((c) => c.id !== contract.id), contract];
}

export function contractLead(world: WorldState, ch: Character): ContractLead | undefined {
  const c = heldContract(world, ch);
  if (!c) return undefined;
  const where = world.rooms[c.roomId ?? ""]?.name ?? "there";
  switch (c.kind) {
    case "bounty": {
      const m = Object.values(world.monsters ?? {}).find((m) => m.hp > 0 && m.roomId === c.roomId && m.name === c.monsterName);
      if (ch.roomId === c.roomId && m) return { why: `fight ${m.name}`, verb: "fight", target: m.id };
      return { why: `toward ${where}`, go: c.roomId };
    }
    case "survey": {
      const have = ch.surveyed?.length ?? 0;
      const next = publics(world).find((r) => r.district === c.district && r.id !== ch.roomId && !(ch.surveyed ?? []).includes(r.id));
      return { why: `toward an unmapped room in ${c.district} (${have}/${c.count ?? SURVEY_COUNT})`, go: next?.id };
    }
    case "recovery": {
      if (ch.roomId !== c.roomId) return { why: `toward ${where}`, go: c.roomId };
      return { why: `pick up ${c.title.replace(/^Recover /, "")}`, verb: "take", target: c.itemId };
    }
    case "courier": {
      if (carryingParcel(ch, c.id)) {
        if (ch.roomId === c.roomId) return { why: "hand over the sealed parcel", verb: "quest", target: DELIVER_TARGET };
        return { why: `toward ${where} with the parcel`, go: c.roomId };
      }
      const floor = parcelOnFloor(world, c.id);
      if (floor && floor.room.id === ch.roomId) return { why: "pick up the sealed parcel", verb: "take", target: floor.item.id };
      if (floor) return { why: "back for the sealed parcel", go: floor.room.id };
      return { why: "back to the board for the parcel", go: c.boardId };
    }
    case "expedition":
      if (ch.roomId === c.roomId) return undefined;
      return { why: `toward ${where}`, go: c.roomId };
  }
}

/** The first open job on this board, for a machine that has none yet. */
export function takeLead(world: WorldState, ch: Character, now: number): Contract | undefined {
  if (ch.contractId) return undefined;
  const here = openOnBoard(world, ch.roomId, now)[0];
  if (here) return here;
  for (const board of boardRooms(world)) {
    const open = openOnBoard(world, board.id, now)[0];
    if (open) return open;
  }
  return undefined;
}

/**
 * Did this beat finish the held contract? Survey progress is recorded here.
 * Paying happens in world.ts, once.
 */
export function finishesContract(world: WorldState, ch: Character, beat: WorldBeat): Contract | undefined {
  const c = heldContract(world, ch);
  if (!c || beat.workerId !== ch.workerId) return undefined;
  switch (c.kind) {
    case "bounty":
      return beat.won && beat.monster === c.monsterName && beat.roomId === c.roomId ? c : undefined;
    case "survey": {
      const room = world.rooms[beat.roomId];
      if (room && room.district === c.district) {
        ch.surveyed ??= [];
        if (!ch.surveyed.includes(room.id)) ch.surveyed.push(room.id);
      }
      return (ch.surveyed?.length ?? 0) >= (c.count ?? SURVEY_COUNT) ? c : undefined;
    }
    case "recovery":
      return beat.verb === "take" && beat.target === c.itemId ? c : undefined;
    case "courier":
      return beat.verb === "quest" && beat.target === DELIVER_TARGET && beat.roomId === c.roomId ? c : undefined;
    case "expedition":
      return beat.verb === "go" && beat.roomId === c.roomId ? c : undefined;
  }
}

/** Hand the courier its parcel. Returns where it ended up. */
export function issueParcel(world: WorldState, ch: Character, contractId: string, handsFull: boolean): "hands" | "floor" {
  const item = parcelItem(contractId);
  if (!handsFull && ch.stats) {
    ch.stats.items.push(item);
    return "hands";
  }
  const room = world.rooms[ch.roomId];
  if (room) room.items = [...(room.items ?? []), item];
  return "floor";
}

export function removeParcel(world: WorldState, ch: Character, contractId: string): Item | undefined {
  const item = carryingParcel(ch, contractId);
  if (!item || !ch.stats) return undefined;
  ch.stats.items = ch.stats.items.filter((i) => i !== item);
  return item;
}
