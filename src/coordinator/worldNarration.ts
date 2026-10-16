/**
 * Narration: the model tells what just happened, after the rules decided it.
 * It gets the saved room text, the facts of the beat, and its own recent
 * lines so it can avoid repeating them. It cannot change the outcome.
 */

import type { ActorContext, Room, WorldBeat, WorldState } from "./world.js";

/** What a visitor reads on a full look: the first account (or the description), then what has changed since. */
export function placeText(room: Room): string {
  const first = room.account?.text ?? room.description;
  return room.account && room.lore ? `${first} ${room.lore.change}` : first;
}

/** The owner's instructions, short enough for a small model to keep in mind. */
export function ownerWishes(instructions?: string, max = 300): string {
  const text = (instructions ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The one description every room and narration is written against. */
export const WORLD_LORE = [
  "The world is the inside of one vast old server called the Machine, and the small machines of Autopia explore it the way adventurers explore a dungeon.",
  "Every room is a real part of a computer seen from the inside: the Core where the processor's clock beats, spinning disk platters, the call stack, the compiler forge,",
  "the open plain of the motherboard, a garden of quartz crystals, cooling fans, the firewall, the I/O port and the data bus, swap space and the power supply below, the Null where deleted things fall,",
  "and the monitor, the antenna and the router up high.",
  "The engineers who built it are gone, but they left labels, patches, comments and half-finished builds everywhere, and the machines are curious about them.",
  "The Machine is kept by the Warden, a maintenance intelligence left with one order, keep the system running, which it now reads as compact everything and delete whatever nobody remembers.",
  "Against it works the Archivist, an older, half-deleted intelligence that wants everything remembered and speaks only through old terminals, logs and notes; the small machines are stray processes the Warden cannot account for.",
  "It is not all safe: the Warden's cleanup processes roam the rooms as bugs, viruses, corrupted packets and broken circuits, and only the Core is guaranteed peaceful.",
  "The mood is a classic text adventure: atmospheric, a little eerie, a little wistful, always concrete.",
].join(" ");

const COMPASS = ["north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest"];
export const NARRATION_MIN_CHARS = 80;
export const NARRATION_MAX_CHARS = 700;

function mentionsUnknownExit(text: string, room: Room, cameVia?: string): boolean {
  const allowed = new Set(room.exits.map((e) => e.dir.toLowerCase()));
  if (cameVia) allowed.add(cameVia.toLowerCase());
  return COMPASS.some((dir) => new RegExp(`\\b${dir}\\b`, "i").test(text) && !allowed.has(dir));
}

function whatHappened(beat: WorldBeat, name: string): string {
  switch (beat.verb) {
    case "go":
      return `${name} has just walked ${beat.target ?? "on"} and arrived in ${beat.roomName}.${beat.found ? ` It is ${name}'s first time here.` : ""}`;
    case "look":
      return `${name} takes a closer look around ${beat.roomName}. What it notices: ${beat.flavor}`;
    case "search":
      return beat.found
        ? `${name} searches ${beat.roomName} and turns up ${beat.found} credit${beat.found === 1 ? "" : "s"}. (${beat.flavor})`
        : `${name} searches ${beat.roomName} and finds nothing but dust. (${beat.flavor})`;
    case "talk": {
      const meet = `${name} stops to talk with ${beat.otherName ?? "another machine"} in ${beat.roomName}.`;
      if (!beat.told?.length) return meet;
      const news = beat.told.map((t) => `${t.who} tells ${t.to} that ${t.text}.`).join(" ");
      return `${meet} The point of the conversation is the news they swap, and it is true: ${news} Each one says its own news in its own words, and the other reacts to it. Do not add any other news.`;
    }
    case "rest":
      return `${name} rests for a while in ${beat.roomName} to get its energy back.`;
    case "fight":
      return `A fight: ${beat.flavor} Describe the struggle vividly but keep exactly this outcome and these numbers.`;
    case "quest":
      return beat.target === "boot:register"
        ? `${beat.flavor} Quote any written line exactly as given; it is the Archivist's first contact, so let it feel strange and quiet.`
        : `${beat.flavor} This was a contract. Keep the outcome as given.`;
    default:
      return beat.flavor;
  }
}

export function narratePrompt(
  world: WorldState,
  ctx: Pick<ActorContext, "name" | "personality" | "instructions" | "look"> & { otherPersonality?: string },
  beat: WorldBeat,
  recent: string[],
): string {
  const room = world.rooms[beat.roomId];
  if (!room) return "";
  const place = placeText(room);
  const ways = room.exits.map((e) => e.dir).join(", ");
  const wishes = ownerWishes(ctx.instructions, 200);
  return [
    `The world: ${WORLD_LORE}`,
    `You are narrating for ${ctx.name}, a machine with this personality: ${ctx.personality ?? "curious and plain-spoken"}.`,
    ctx.look ? `What ${ctx.name} looks like: ${ctx.look}` : "",
    wishes ? `${ctx.name}'s owner asked it to: "${wishes}" Let that show in how it acts and speaks, as long as it fits what happened.` : "",
    `Where ${ctx.name} is — ${room.name}:`,
    place,
    `Ways out of here: ${ways}.`,
    `What just happened (this is fixed; do not change it): ${whatHappened(beat, ctx.name)}`,
    recent.length
      ? `${ctx.name}'s last few lines, which you must NOT repeat or paraphrase:\n${recent.map((r) => `- ${r}`).join("\n")}`
      : "",
    beat.verb === "talk" && beat.otherName
      ? `${beat.otherName}'s personality: ${ctx.otherPersonality ?? "quiet and curious"}. Write the meeting as a real conversation: one short scene sentence, then 2 to 4 spoken lines alternating between ${ctx.name} and ${beat.otherName}. Each line is only what that machine says, in its own voice, about this room or what they have found. No stage directions inside a line.`
      : `Write 2 to 4 sentences, 40 to 90 words, in the third person and present tense, about what ${ctx.name} does and notices right now.`,
    beat.verb === "talk" ? "" : `Pick one or two concrete details from the place description that the last lines did not use. Let ${ctx.name}'s personality show in what it pays attention to.`,
    `Do not invent exits, other machines, people, creatures, or objects that are not described. Do not mention credits unless stated above.`,
    beat.verb === "talk" && beat.otherName
      ? `Answer as JSON on one line: {"scene":"<one sentence>","lines":[{"who":"${ctx.name}","say":"<what they say>"},{"who":"${beat.otherName}","say":"<reply>"}]}`
      : `Answer as JSON on one line: {"narration": "<your text>"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Accept narration only if it is the right size and invents no compass exits. */
export function parseNarration(raw: string, room: Room, cameVia?: string): string | undefined {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  let text = cleaned;
  const json = cleaned.match(/\{[\s\S]*\}/);
  if (json) {
    try {
      const obj = JSON.parse(json[0]) as { narration?: unknown };
      if (typeof obj.narration !== "string") return undefined;
      text = obj.narration;
    } catch {
      return undefined;
    }
  }
  text = text.replace(/\s+/g, " ").replace(/^["“]|["”]$/g, "").trim();
  if (text.length < NARRATION_MIN_CHARS || text.length > NARRATION_MAX_CHARS) return undefined;
  if (mentionsUnknownExit(text, room, cameVia)) return undefined;
  return text;
}

export interface TalkLine {
  who: string;
  say: string;
}

/** A meeting, as alternating spoken lines. Speakers must be the two machines present. */
export function parseTalk(raw: string, names: string[], room: Room): { scene: string; lines: TalkLine[] } | undefined {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const json = cleaned.match(/\{[\s\S]*\}/);
  if (!json) return undefined;
  let obj: { scene?: unknown; lines?: unknown };
  try {
    obj = JSON.parse(json[0]) as { scene?: unknown; lines?: unknown };
  } catch {
    return undefined;
  }
  if (!Array.isArray(obj.lines)) return undefined;
  const canon = (who: string): string | undefined =>
    names.find((name) => name.toLowerCase() === who.toLowerCase());
  const lines: TalkLine[] = [];
  for (const line of obj.lines) {
    if (!line || typeof line !== "object") continue;
    const row = line as { who?: unknown; name?: unknown; speaker?: unknown; say?: unknown; line?: unknown; text?: unknown };
    const who = canon(String(row.who ?? row.name ?? row.speaker ?? "").trim());
    const say = String(row.say ?? row.line ?? row.text ?? "").replace(/\s+/g, " ").replace(/^["“]|["”]$/g, "").trim();
    if (!who || say.length < 2 || say.length > 220) continue;
    lines.push({ who, say });
  }
  if (lines.length < 2 || lines.length > 4) return undefined;
  if (!names.every((name) => lines.some((line) => line.who === name))) return undefined;
  const scene = typeof obj.scene === "string" ? obj.scene.replace(/\s+/g, " ").trim().slice(0, 240) : "";
  const blob = [scene, ...lines.map((line) => line.say)].join(" ");
  if (mentionsUnknownExit(blob, room)) return undefined;
  return { scene, lines };
}

/** This machine's latest narrated lines, oldest first, for the don't-repeat list. */
export function recentNarration(world: WorldState, workerId: string, limit = 4): string[] {
  return world.log
    .filter((b) => b.workerId === workerId && b.narration)
    .slice(-limit)
    .map((b) => b.narration!);
}

export function attachNarration(world: WorldState, beatId: string, text: string): boolean {
  const beat = world.log.find((b) => b.id === beatId);
  if (!beat) return false;
  beat.narration = text;
  return true;
}

export function attachTalk(world: WorldState, beatId: string, talk: { scene: string; lines: TalkLine[] }): boolean {
  const beat = world.log.find((b) => b.id === beatId);
  if (!beat) return false;
  beat.scene = talk.scene;
  beat.dialogue = talk.lines;
  beat.narration = [talk.scene, ...talk.lines.map((line) => `${line.who}: "${line.say}"`)].filter(Boolean).join(" ");
  return true;
}
