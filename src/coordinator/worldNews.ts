/**
 * News: what machines know about the world beyond the room they stand in.
 *
 * Every piece of news is a plain sentence written by code at the moment
 * something happens, and it is only kept while it is still true. Machines
 * in the room when it happens learn it; the rest hear it when they talk.
 * A model never makes news up, it only gets to say it. The one exception is
 * lore: the dungeon master's rumor about a room it rewrote, which is true of
 * the new text and forgotten the moment that rewrite is undone.
 */

import type { Character, WorldState } from "./world.js";
import type { Item, Monster } from "./worldCombat.js";

export type NewsKind = "danger" | "loot" | "cache" | "event" | "lore";

export interface News {
  id: string;
  kind: NewsKind;
  roomId: string;
  text: string;
  at: number;
  /** danger: the monster it is about. */
  monsterId?: string;
  /** loot: the item lying there. */
  itemId?: string;
  /** lore: the dungeon master's rewrite it describes. */
  loreId?: string;
}

/** A machine only remembers this many things at once; the oldest fall out. */
export const KNOWS_LIMIT = 12;
const WORLD_NEWS_LIMIT = 150;
/** Events (who beat whom) are worth repeating for this long. */
const EVENT_TTL_MS = 6 * 60 * 60_000;
/** A rumor about a changed room goes stale after two days, even if the change stands. */
export const LORE_TTL_MS = 48 * 60 * 60_000;
export const XP_PER_NEWS = 3;

const WORTH: Record<NewsKind, number> = { danger: 3, loot: 2, cache: 2, lore: 2, event: 1 };

export function dangerNews(monster: Monster, roomName: string, at: number): News {
  return {
    id: `danger:${monster.id}`,
    kind: "danger",
    roomId: monster.roomId,
    text: `${monster.name} is lurking in ${roomName}`,
    at,
    monsterId: monster.id,
  };
}

export function lootNews(item: Item, roomId: string, roomName: string, at: number, how = "is lying"): News {
  return { id: `loot:${item.id}`, kind: "loot", roomId, text: `${item.name} ${how} in ${roomName}`, at, itemId: item.id };
}

export function cacheNews(roomId: string, roomName: string, at: number): News {
  return { id: `cache:${roomId}`, kind: "cache", roomId, text: `there are still credits to find in ${roomName}`, at };
}

export function eventNews(key: string, roomId: string, text: string, at: number): News {
  return { id: `event:${key}`, kind: "event", roomId, text, at };
}

export function loreNews(loreId: string, roomId: string, text: string, at: number): News {
  return { id: `lore:${loreId}`, kind: "lore", roomId, text, at, loreId };
}

/** Is this still so? News that stops being true is forgotten by everyone. */
export function stillTrue(world: WorldState, news: News, now: number): boolean {
  switch (news.kind) {
    case "danger": {
      const m = news.monsterId ? world.monsters?.[news.monsterId] : undefined;
      return Boolean(m && m.hp > 0 && m.roomId === news.roomId);
    }
    case "loot":
      return Boolean(world.rooms[news.roomId]?.items?.some((i) => i.id === news.itemId));
    case "cache":
      return (world.rooms[news.roomId]?.cache ?? 0) > 0;
    case "event":
      return now - news.at < EVENT_TTL_MS;
    case "lore":
      return world.rooms[news.roomId]?.lore?.id === news.loreId && now - news.at < LORE_TTL_MS;
  }
}

/** Write it down and let `ch` know it. */
export function learn(world: WorldState, ch: Character, news: News): boolean {
  world.news ??= {};
  world.news[news.id] ??= news;
  const knows = (ch.knows ??= []);
  if (knows.includes(news.id)) return false;
  knows.push(news.id);
  if (knows.length > KNOWS_LIMIT) knows.splice(0, knows.length - KNOWS_LIMIT);
  return true;
}

/** Everyone standing in the room sees it happen. */
export function witness(world: WorldState, roomId: string, news: News): void {
  for (const ch of Object.values(world.characters)) {
    if (ch.roomId === roomId) learn(world, ch, news);
  }
}

/** Forget whatever is no longer true, everywhere. */
export function pruneNews(world: WorldState, now: number): void {
  if (!world.news) return;
  for (const [id, n] of Object.entries(world.news)) {
    if (!stillTrue(world, n, now)) delete world.news[id];
  }
  const ids = Object.keys(world.news);
  if (ids.length > WORLD_NEWS_LIMIT) {
    const oldest = ids.sort((a, b) => world.news![a]!.at - world.news![b]!.at).slice(0, ids.length - WORLD_NEWS_LIMIT);
    for (const id of oldest) delete world.news[id];
  }
  for (const ch of Object.values(world.characters)) {
    if (ch.knows) ch.knows = ch.knows.filter((id) => world.news![id]);
  }
}

/** What `ch` knows that is still true, most useful and newest first. */
export function knownNews(world: WorldState, ch: Character, now: number): News[] {
  return (ch.knows ?? [])
    .map((id) => world.news?.[id])
    .filter((n): n is News => Boolean(n) && stillTrue(world, n!, now))
    .sort((a, b) => WORTH[b.kind] - WORTH[a.kind] || b.at - a.at);
}

/** What `ch` has heard about one room, for exit labels and the fallback picker. */
export function newsAbout(world: WorldState, ch: Character, roomId: string, now: number): News[] {
  return knownNews(world, ch, now).filter((n) => n.roomId === roomId && n.kind !== "event");
}

/**
 * Something worth telling: the best thing `from` knows that `to` does not.
 * News about the room they are both standing in is not news.
 */
function bestToTell(world: WorldState, from: Character, to: Character, now: number): News | undefined {
  const theirs = new Set(to.knows ?? []);
  return knownNews(world, from, now).find((n) => !theirs.has(n.id) && (n.kind === "event" || n.roomId !== from.roomId));
}

export interface Told {
  who: string;
  to: string;
  text: string;
}

/** A conversation: each side passes on one thing the other did not know. */
export function swapNews(
  world: WorldState,
  a: { ch: Character; name: string },
  b: { ch: Character; name: string },
  now: number,
): Told[] {
  const fromA = bestToTell(world, a.ch, b.ch, now);
  const fromB = bestToTell(world, b.ch, a.ch, now);
  const told: Told[] = [];
  if (fromA && learn(world, b.ch, fromA)) told.push({ who: a.name, to: b.name, text: fromA.text });
  if (fromB && learn(world, a.ch, fromB)) told.push({ who: b.name, to: a.name, text: fromB.text });
  return told;
}

/** Does either of them have something new to say to the other? */
export function hasNewsFor(world: WorldState, a: Character, b: Character, now: number): boolean {
  return Boolean(bestToTell(world, a, b, now) || bestToTell(world, b, a, now));
}

export function sentence(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}
