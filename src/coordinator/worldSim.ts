import { parseArgs } from "node:util";
import {
  applyIntent,
  attachHome,
  buildMenu,
  choicePrompt,
  emptyWorld,
  ensureCore,
  maybeWander,
  parseChoice,
  pickWander,
  resolveChoice,
  viewWorld,
  type ActorContext,
  type WorldState,
} from "./world.js";

/**
 * Run a few fake machines through the hardcoded world so you can read a session.
 *
 *   npm run world                       # keyword policy, instant
 *   npm run world -- --ollama           # each machine picks via local Ollama
 *   npm run world -- --ollama -m qwen3:8b -t 12
 */

const { values } = parseArgs({
  options: {
    ollama: { type: "boolean", default: false },
    model: { type: "string", short: "m", default: "qwen3:4b" },
    ticks: { type: "string", short: "t" },
    url: { type: "string", default: "http://localhost:11434" },
    /** Scorecard only; skip the beat-by-beat log. */
    quiet: { type: "boolean", short: "q", default: false },
  },
  allowPositionals: true,
});

const CAST = [
  { id: "w-goldie", name: "Goldie", personality: "a warm, chatty optimist. She celebrates everyone's wins and remembers small details." },
  { id: "w-ada", name: "Ada", personality: "precise and quietly brilliant. She loves elegant solutions and has a dry, kind wit." },
  { id: "w-clank", name: "Clank", personality: "a good-natured workhorse. He grumbles about everything and then does it perfectly." },
];

function wallet(start = 200) {
  let balance = start;
  return {
    get balance() {
      return balance;
    },
    pay(cost: number) {
      if (balance < cost) return false;
      balance -= cost;
      return true;
    },
    grant(n: number) {
      balance += n;
    },
  };
}

async function askOllama(prompt: string): Promise<string> {
  const res = await fetch(`${values.url}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: values.model,
      prompt,
      think: false,
      stream: false,
      format: "json",
      options: { temperature: 0.7, top_p: 0.9, num_predict: 80 },
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { response?: string };
  return data.response ?? "";
}

interface Scorecard {
  asked: number;
  honoured: number;
  verbs: Record<string, number>;
  /** Moves that went straight back to the room just left. */
  backtracks: number;
  roomsSeen: Set<string>;
  sayLengths: number[];
  /** Voices that repeat the exploring nudge almost verbatim. */
  parroted: number;
  ms: number;
}

async function play(ticks: number): Promise<{ world: WorldState; score: Scorecard }> {
  const world = ensureCore(emptyWorld());
  const gold = new Map(CAST.map((c) => [c.id, wallet()] as const));
  for (const c of CAST) attachHome(world, c.id, c.name);
  const score: Scorecard = {
    asked: 0,
    honoured: 0,
    verbs: {},
    backtracks: 0,
    roomsSeen: new Set(),
    sayLengths: [],
    parroted: 0,
    ms: 0,
  };
  const trail = new Map<string, string[]>(CAST.map((c) => [c.id, [world.characters[c.id]!.roomId]]));
  const started = Date.now();

  let now = 1;
  for (let t = 0; t < ticks; t += 1) {
    now += 8_000;
    const others = CAST.map((c) => ({ workerId: c.id, name: c.name, online: true }));
    for (const c of CAST) {
      const purse = gold.get(c.id)!;
      const ctx: ActorContext = {
        workerId: c.id,
        name: c.name,
        personality: c.personality,
        now,
        others,
        get balance() {
          return purse.balance;
        },
        pay: (n) => purse.pay(n),
        grant: (n) => purse.grant(n),
      };
      let result;
      if (!values.ollama) {
        result = maybeWander(world, ctx, 1);
      } else {
        const menu = buildMenu(world, ctx);
        const prompt = choicePrompt(world, ctx, menu);
        score.asked += 1;
        let chosen;
        let say: string | undefined;
        try {
          const raw = await askOllama(prompt);
          const parsed = parseChoice(raw);
          chosen = resolveChoice(menu, parsed);
          say = parsed.say;
        } catch (err) {
          console.error(`  (${c.name}: ${err instanceof Error ? err.message : String(err)})`);
        }
        if (chosen) score.honoured += 1;
        const intent = chosen ?? pickWander(world, ctx);
        result = applyIntent(world, ctx, intent, {
          chosenBy: chosen ? "model" : "policy",
          voice: chosen ? say : undefined,
        });
        if (result.beat && !values.quiet) {
          const tag = result.beat.chosenBy === "model" ? "" : "  [policy]";
          const line = result.beat.voice ? `${result.beat.flavor}\n      “${result.beat.voice}”` : result.beat.flavor;
          console.log(`  ${line}${tag}`);
        }
      }
      const beat = result?.beat;
      if (!beat) continue;
      score.verbs[beat.verb] = (score.verbs[beat.verb] ?? 0) + 1;
      const path = trail.get(c.id)!;
      const roomNow = world.characters[c.id]!.roomId;
      if (beat.verb === "go") {
        if (path.length >= 2 && path[path.length - 2] === roomNow) score.backtracks += 1;
        path.push(roomNow);
      }
      score.roomsSeen.add(roomNow);
      if (beat.voice) {
        score.sayLengths.push(beat.voice.split(/\s+/).length);
        if (/new (places|horizons|areas|territor)|back and forth|revisit/i.test(beat.voice)) score.parroted += 1;
      }
    }
  }
  score.ms = Date.now() - started;
  return { world, score };
}

function printScorecard(s: Scorecard, ticks: number): void {
  const total = Object.values(s.verbs).reduce((a, b) => a + b, 0);
  const mix = ["go", "look", "search", "talk", "rest"]
    .map((v) => `${v} ${s.verbs[v] ?? 0}`)
    .join("  ");
  const avgSay = s.sayLengths.length
    ? (s.sayLengths.reduce((a, b) => a + b, 0) / s.sayLengths.length).toFixed(1)
    : "-";
  console.log("\nScorecard:");
  if (s.asked) console.log(`  menu honoured     ${s.honoured}/${s.asked}`);
  console.log(`  verb mix          ${mix}  (${total} beats)`);
  console.log(`  rooms explored    ${s.roomsSeen.size}/${8 + CAST.length}`);
  console.log(`  backtracks        ${s.backtracks} of ${s.verbs.go ?? 0} moves`);
  if (s.asked) {
    console.log(`  voice length      ${avgSay} words avg`);
    console.log(`  parroted nudge    ${s.parroted}/${s.sayLengths.length}`);
    console.log(`  time per pick     ${(s.ms / s.asked / 1000).toFixed(1)} s`);
  }
  console.log(`  ticks             ${ticks} × ${CAST.length} machines`);
}

const ticks = Number(values.ticks ?? (values.ollama ? 6 : 24));
console.log(
  values.ollama
    ? `Autopia — world sim (${values.model} picks from the menu; rules in code)\n`
    : "Autopia — world sim (keyword policy, no LLM)\n",
);
if (values.ollama && !values.quiet) console.log("Beats:");
const { world, score } = await play(ticks);
const names = new Map(CAST.map((c) => [c.id, { name: c.name, presence: "online" }]));
const view = viewWorld(world, names);

if (!values.quiet) {
  console.log("\nRooms:");
  for (const room of view.rooms) {
    const who = room.occupants.map((o) => o.name).join(", ") || "empty";
    const tag = room.core ? "core" : "home";
    console.log(`  ${room.name.padEnd(22)} ${tag.padEnd(6)} ${who}`);
  }
}
if (!values.ollama && !values.quiet) {
  console.log("\nBeats:");
  for (const beat of world.log) {
    const found = beat.found ? `  +${beat.found}cr` : "";
    const cost = beat.cost ? `  -${beat.cost}cr` : "";
    console.log(`  ${beat.flavor}${cost}${found}`);
  }
}
printScorecard(score, ticks);
