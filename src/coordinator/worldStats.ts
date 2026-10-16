/**
 * MUD character stats. All hardcoded rules: models never set a number here.
 * Experience and skills only grow from what the machine actually did; energy
 * is the one stat that goes down, so resting has a reason.
 */

import { attackOf, defenseOf, describeItem, maxHp, type Item } from "./worldCombat.js";

export interface Stats {
  xp: number;
  energy: number;
  /** Rooms entered for the first time. */
  discovered: number;
  /** Rooms this machine was first to write down. */
  written: number;
  /** Credits turned up by searching or arriving somewhere new. */
  found: number;
  searches: number;
  /** New details noticed on second and later looks. */
  glimpses: number;
  /** Names of machines it has talked with, once each. */
  acquaintances: string[];
  hp: number;
  items: Item[];
  kills: number;
  duelsWon: number;
  knockouts: number;
}

export const XP = {
  newRoom: 10,
  write: 20,
  perCredit: 2,
  acquaintance: 8,
  glimpse: 3,
} as const;

export const ENERGY = {
  base: 8,
  move: 1,
  search: 1,
  fight: 1,
  look: 1,
  rest: 4,
} as const;

/** Perception at or above this turns up one extra credit per successful search. */
export const KEEN_EYE_AT = 6;

const TITLES = ["Newcomer", "Wanderer", "Scout", "Pathfinder", "Surveyor", "Cartographer", "Loremaster", "Legend"];

/** Total XP needed to reach `level`: 0, 50, 150, 300, 500, 750… */
export function xpForLevel(level: number): number {
  return 25 * level * (level - 1);
}

export function levelFor(xp: number): number {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level += 1;
  return level;
}

export function titleFor(level: number): string {
  return TITLES[Math.min(level, TITLES.length) - 1]!;
}

export function maxEnergy(level: number): number {
  return ENERGY.base + level - 1;
}

export function freshStats(): Stats {
  return {
    xp: 0,
    energy: ENERGY.base,
    discovered: 0,
    written: 0,
    found: 0,
    searches: 0,
    glimpses: 0,
    acquaintances: [],
    hp: maxHp(1),
    items: [],
    kills: 0,
    duelsWon: 0,
    knockouts: 0,
  };
}

/** Fill in fields added after a character was saved. */
export function upgradeStats(stats: Stats): Stats {
  stats.items ??= [];
  stats.kills ??= 0;
  stats.duelsWon ??= 0;
  stats.knockouts ??= 0;
  stats.hp ??= maxHp(levelFor(stats.xp));
  return stats;
}

/** Give characters from before stats existed credit for what they already did. */
export function backfillStats(discovered: number, written: number): Stats {
  const stats = freshStats();
  stats.discovered = discovered;
  stats.written = written;
  stats.xp = discovered * XP.newRoom + written * XP.write;
  stats.energy = maxEnergy(levelFor(stats.xp));
  stats.hp = maxHp(levelFor(stats.xp));
  return stats;
}

/** Add XP; returns the new level when this crossed a threshold. */
export function gainXp(stats: Stats, amount: number): number | undefined {
  if (amount <= 0) return undefined;
  const before = levelFor(stats.xp);
  stats.xp += amount;
  const after = levelFor(stats.xp);
  if (after > before) {
    // A level up is a full night's sleep.
    stats.energy = maxEnergy(after);
    stats.hp = maxHp(after);
    return after;
  }
  return undefined;
}

export function spendEnergy(stats: Stats, amount: number): boolean {
  if (stats.energy < amount) return false;
  stats.energy -= amount;
  return true;
}

export function restoreEnergy(stats: Stats, amount: number): void {
  stats.energy = Math.min(maxEnergy(levelFor(stats.xp)), stats.energy + amount);
}

export interface Skills {
  wayfinding: number;
  perception: number;
  lore: number;
  charm: number;
}

/** Skills rise with use, starting at 1. */
export function skillsOf(stats: Stats): Skills {
  return {
    wayfinding: 1 + stats.discovered,
    perception: 1 + stats.searches + stats.glimpses,
    lore: 1 + stats.written,
    charm: 1 + stats.acquaintances.length,
  };
}

export interface StatSheet {
  level: number;
  title: string;
  xp: number;
  /** XP where the current level began and where the next one starts. */
  xpFloor: number;
  xpNext: number;
  energy: number;
  maxEnergy: number;
  skills: Skills;
  found: number;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  items: string[];
  kills: number;
  duelsWon: number;
}

export function statSheet(stats: Stats): StatSheet {
  const level = levelFor(stats.xp);
  return {
    level,
    title: titleFor(level),
    xp: stats.xp,
    xpFloor: xpForLevel(level),
    xpNext: xpForLevel(level + 1),
    energy: stats.energy,
    maxEnergy: maxEnergy(level),
    skills: skillsOf(stats),
    found: stats.found,
    hp: stats.hp,
    maxHp: maxHp(level),
    attack: attackOf(level, stats.items),
    defense: defenseOf(stats.items),
    items: stats.items.map(describeItem),
    kills: stats.kills,
    duelsWon: stats.duelsWon,
  };
}

/** One line for prompts: who the machine is right now, in numbers. */
export function statLine(stats: Stats): string {
  const s = statSheet(stats);
  const tired = s.energy <= 2 ? " You are tired; resting restores energy." : "";
  const hurt = s.hp <= s.maxHp / 3 ? " You are badly hurt; rest somewhere safe or eat something." : "";
  const gear = s.items.length ? ` Carrying: ${s.items.join(", ")}.` : " Carrying nothing.";
  return `Level ${s.level} ${s.title}. HP ${s.hp}/${s.maxHp}, attack ${s.attack}, defense ${s.defense}. Energy ${s.energy}/${s.maxEnergy}.${tired}${hurt}${gear}`;
}
