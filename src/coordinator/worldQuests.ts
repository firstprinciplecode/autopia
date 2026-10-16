/**
 * Quests: goals the rules track for a machine, so a beat can count toward something bigger than
 * the next room. Code decides when a step is done and what it pays; models only ever see the goal
 * as the top line of their menu, and narrate the outcome.
 *
 * The first quest is the boot sequence every new machine runs: wake up at home, find the Core,
 * register on the Warden's scheduler board (which does not know it), step somewhere new, and
 * take a contract.
 */
import type { Character, WorldBeat } from "./world.js";

export interface BootStep {
  id: "wake" | "core" | "register" | "explore" | "contract";
  title: string;
  /** The goal as a player reads it in the tracker. */
  goal: string;
  /** XP paid when the step is done. */
  xp: number;
}

export const BOOT: BootStep[] = [
  { id: "wake", title: "Wake up", goal: "Look around your home", xp: 5 },
  { id: "core", title: "Find the Core", goal: "Walk to the Core, where the clock beats", xp: 10 },
  { id: "register", title: "Register", goal: "Register on the scheduler board in the Core", xp: 10 },
  { id: "explore", title: "Leave a mark", goal: "Reach a room you have never been to", xp: 15 },
  { id: "contract", title: "Take a contract", goal: "Take a contract from a board", xp: 10 },
];

/** Paid once the whole boot sequence is done, on top of the last step's XP. */
export const BOOT_REWARD = { xp: 25, credits: 3 };

export const CORE_ROOM_ID = "hq";
export const REGISTER_TARGET = "boot:register";

export const REGISTER_FLAVOR = (name: string) =>
  `${name} pressed its id against the scheduler board. The Warden's list flickered and found no such process. ` +
  `Then, in a font older than the rest, a line wrote itself underneath: "I see you. Keep writing things down. — A."`;

/** The step a machine is on, or undefined once it has booted. */
export function bootStep(ch: Character): BootStep | undefined {
  return BOOT[ch.boot ?? BOOT.length];
}

export function booted(ch: Character): boolean {
  return (ch.boot ?? BOOT.length) >= BOOT.length;
}

/**
 * Machines that were already exploring before quests existed have nothing to boot.
 * Anyone who has left home or earned XP counts as booted.
 */
export function bootStart(ch: Character): number {
  const left = new Set(ch.visited).size > 1;
  return left || (ch.stats?.xp ?? 0) > 0 ? BOOT.length : 0;
}

/** Did this beat (or where it left the machine) finish the step? */
export function finishesStep(step: BootStep, ch: Character, beat: WorldBeat): boolean {
  switch (step.id) {
    case "wake":
      return beat.verb === "look";
    case "core":
      return ch.roomId === CORE_ROOM_ID;
    case "register":
      return beat.verb === "quest" && beat.target === REGISTER_TARGET;
    case "explore":
      return beat.verb === "go" && (beat.found ?? 0) > 0 && beat.roomId !== CORE_ROOM_ID && beat.roomId !== ch.homeId;
    case "contract":
      return beat.verb === "quest" && /^contract:ct_/.test(beat.target ?? "");
  }
}
