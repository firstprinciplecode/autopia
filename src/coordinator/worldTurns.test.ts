import { test } from "node:test";
import assert from "node:assert/strict";
import { healthText, PROMPT_VERSION, worldHealth, type WorldTurn } from "./worldTurns.js";

let seq = 0;
const turn = (over: Partial<WorldTurn>): WorldTurn => ({
  id: `t${seq++}`,
  at: 1_000 + seq,
  kind: "pick",
  promptVersion: PROMPT_VERSION,
  workerId: "w1",
  workerName: "KingJames",
  helperName: "Wondergirl",
  model: "qwen3:8b",
  prompt: "",
  output: '{"choice": 1}',
  tokens: 8,
  durationMs: 400,
  costCredits: 16,
  parsed: true,
  chosenBy: "model",
  ...over,
});

const loop = ["Power Room 21", "Build Bay 19", "Patch Bench 14", "The GPU Hall"];

test("a machine walking the same few known rooms is flagged as circling and as skipping the way out", () => {
  const turns = Array.from({ length: 18 }, (_, i) =>
    turn({ verb: "go", roomName: loop[i % loop.length], towardOffered: true, tookToward: i % 6 === 0 }),
  );
  const [m] = worldHealth(turns, 0, 1e9).machines;
  assert.ok(m);
  assert.equal(m.moves, 18);
  assert.equal(m.newRooms, 0);
  assert.equal(m.revisitShare, 1);
  assert.deepEqual(m.circling?.rooms.sort(), [...loop].sort());
  assert.ok(m.flags.some((f) => /circling 4 known rooms/.test(f)));
  assert.ok(m.flags.some((f) => /turned away from the way to unexplored rooms 15 of 18/.test(f)));
});

test("a machine that keeps finding new rooms is not circling", () => {
  const turns = Array.from({ length: 18 }, (_, i) =>
    turn({ verb: "go", roomName: loop[i % loop.length], firstVisit: i % 5 === 0, newDoorOffered: i % 5 === 0, tookNew: i % 5 === 0 }),
  );
  const [m] = worldHealth(turns, 0, 1e9).machines;
  assert.equal(m?.circling, undefined);
  assert.equal(m?.newDoorSkipped, 0);
  assert.equal(m?.flags.length, 0);
});

test("fallback picks, rejected write-ups and repeated conversations are flagged; models are summed", () => {
  const talk = "Did you see the cooling array today? The fans were humming louder than ever before.";
  const turns = [
    ...Array.from({ length: 6 }, (_, i) => turn({ verb: "rest", chosenBy: i < 3 ? "policy" : "model", parsed: i >= 3 })),
    turn({ kind: "account", accepted: false }),
    turn({ kind: "account", accepted: false }),
    turn({ kind: "account", accepted: true }),
    turn({ kind: "talk", accepted: true, otherName: "Headquest", output: talk }),
    turn({ kind: "talk", accepted: true, otherName: "Headquest", output: `${talk} Again.` }),
    turn({ kind: "pick", error: "ollama timed out", model: "qwen3:1.7b" }),
  ];
  const report = worldHealth(turns, 0, 1e9);
  const [m] = report.machines;
  assert.ok(m);
  assert.equal(m.policyPicks, 3);
  assert.equal(m.accountsKept, 1);
  assert.ok(m.talkRepeat! > 0.9);
  assert.ok(m.flags.some((f) => /fell back to the policy/.test(f)));
  assert.ok(m.flags.some((f) => /only 1 of 3 room write-ups/.test(f)));
  assert.ok(m.flags.some((f) => /conversations repeat themselves/.test(f)));
  assert.ok(m.flags.some((f) => /rested 6 of 6/.test(f)));
  const big = report.models.find((x) => x.model === "qwen3:8b");
  assert.equal(big?.unparsed, 3);
  assert.equal(report.models.find((x) => x.model === "qwen3:1.7b")?.failed, 1);
  assert.match(healthText(report), /KingJames {2}⚠/);
});

test("turns outside the window are left out", () => {
  const report = worldHealth([turn({ at: 10 }), turn({ at: 5_000 })], 1_000, 9_000);
  assert.equal(report.turns, 1);
  assert.match(healthText(worldHealth([], 0, 3_600_000)), /Nothing recorded yet/);
});
