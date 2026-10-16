import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEATH_CREDITS,
  FIRST_VISIT_FIND,
  LAYOUT,
  MENU_COMPANY,
  MOVE_COST,
  STEPS,
  applyIntent,
  attachHome,
  carryLimit,
  retargetCharacter,
  emptyWorld,
  ensureCore,
  forgetCharacterKeepRoom,
  hydrateWorld,
  beatWorthNarrating,
  buildMenu,
  choicePrompt,
  inferAffords,
  legalIntents,
  maybeReport,
  maybeWander,
  parseChoice,
  pickWander,
  gridFor,
  needsAccount,
  parseAccount,
  recordAccount,
  removeOwnedHome,
  reportsFor,
  resolveChoice,
  traits,
  maybeSpawn,
  monsterIn,
  viewWorld,
  wayToNew,
} from "./world.js";
import { MAX_CARRY, SPAWN_GAP_MS, lootFor, makeItem, maxHp, type Monster } from "./worldCombat.js";
import { ENERGY, XP, levelFor, maxEnergy, xpForLevel } from "./worldStats.js";
import { narratePrompt, parseNarration, parseTalk } from "./worldNarration.js";
import { BOOT, BOOT_REWARD, REGISTER_TARGET } from "./worldQuests.js";
import { draftContract, postContract, type ContractKind } from "./worldContracts.js";
import { preferredModel, recommendedModel, worldModels } from "../shared/models.js";

function wallet(start = 1_000) {
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

function ctx(
  workerId: string,
  name: string,
  gold: ReturnType<typeof wallet>,
  now: number,
  others: { workerId: string; name: string; online: boolean }[] = [],
) {
  return {
    workerId,
    name,
    personality: "curious and eager",
    now,
    others,
    get balance() {
      return gold.balance;
    },
    pay: gold.pay,
    grant: gold.grant,
  };
}

test("core world has twenty rooms, all reachable from HQ, with return exits", () => {
  const world = ensureCore(emptyWorld());
  const core = Object.values(world.rooms).filter((r) => r.core);
  assert.equal(core.length, 20);
  const hq = world.rooms.hq!;
  assert.ok(hq.exits.some((e) => e.to === "archives"));
  assert.ok(world.rooms.overlook!.exits.some((e) => e.to === "mess"));
  assert.ok(world.rooms.cellar!.exits.some((e) => e.to === "dock"));
  assert.ok(world.rooms.well!.exits.some((e) => e.to === "cellar"));

  const seen = new Set<string>(["hq"]);
  const queue = ["hq"];
  while (queue.length) {
    const id = queue.shift()!;
    for (const exit of world.rooms[id]!.exits) {
      const dest = world.rooms[exit.to];
      if (!dest?.core || seen.has(dest.id)) continue;
      seen.add(dest.id);
      queue.push(dest.id);
    }
  }
  const missing = core.filter((r) => !seen.has(r.id)).map((r) => r.id);
  assert.equal(missing.length, 0, missing.join(", "));

  for (const room of core) {
    for (const exit of room.exits) {
      const dest = world.rooms[exit.to];
      if (!dest?.core) continue;
      assert.ok(
        dest.exits.some((e) => e.to === room.id),
        `${room.id} → ${exit.to} has no return`,
      );
    }
  }
});

test("a new machine starts in its own home; other homes stay on the map", () => {
  const world = ensureCore(emptyWorld());
  const goldie = attachHome(world, "w1", "Goldie");
  const ada = attachHome(world, "w2", "Ada");
  assert.equal(goldie.roomId, goldie.homeId);
  assert.equal(goldie.homeId, "home:w1");
  assert.equal(ada.roomId, ada.homeId);
  assert.notEqual(goldie.homeId, ada.homeId);
  assert.equal(world.rooms[goldie.homeId]!.kind, "home");
  assert.equal(world.rooms[goldie.homeId]!.core, false);
  assert.equal(world.rooms[ada.homeId]!.core, false);
  const coreCount = Object.values(world.rooms).filter((r) => r.core).length;
  assert.equal(coreCount, 20);
  // Each machine brings its home and one new public room.
  assert.equal(Object.keys(world.rooms).length, 24);
  const parent = world.rooms[world.rooms[goldie.homeId]!.exits[0]!.to]!;
  assert.ok(parent.exits.some((e) => e.to === goldie.homeId));

  forgetCharacterKeepRoom(world, "w1");
  assert.ok(world.rooms["home:w1"]);
  assert.ok(world.rooms["home:w2"]);
  assert.equal(world.characters.w1, undefined);
});

test("go uses a real exit; invented doors fail", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Ada");
  const gold = wallet();
  const actor = ctx("w1", "Ada", gold, 1);
  const bad = applyIntent(world, actor, { verb: "go", target: "portal to the moon" });
  assert.equal(bad.ok, false);
  const home = world.rooms[world.characters.w1!.roomId]!;
  const dir = home.exits[0]!.dir;
  const ok = applyIntent(world, actor, { verb: "go", target: dir });
  assert.equal(ok.ok, true);
  assert.equal(world.characters.w1!.roomId, home.exits[0]!.to);
});

test("walking in on someone records who was already there", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Ada");
  attachHome(world, "w2", "Bolt");
  world.characters.w2!.roomId = "archives";
  world.characters.w1!.roomId = "hq";
  const others = online(["w1", "Ada"], ["w2", "Bolt"]);
  const beat = applyIntent(world, ctx("w1", "Ada", wallet(), 1, others), { verb: "go", target: "west" });
  assert.equal(beat.ok, true);
  assert.equal(beat.beat?.roomId, "archives");
  assert.equal(beat.beat?.otherName, "Bolt");
  assert.deepEqual(beat.beat?.company?.names, ["Bolt"]);
  assert.equal(beat.beat?.company?.monsters, undefined);
});

test("a beat in an empty room keeps no company", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Ada");
  world.characters.w1!.roomId = "hq";
  const beat = applyIntent(world, ctx("w1", "Ada", wallet(), 1, online(["w1", "Ada"])), { verb: "rest" });
  assert.equal(beat.ok, true);
  assert.equal(beat.beat?.company, undefined);
});

test("move costs wallet gold; broke machines cannot leave", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Clank");
  const gold = wallet(0);
  const homeId = world.characters.w1!.roomId;
  const dir = world.rooms[homeId]!.exits[0]!.dir;
  const result = applyIntent(world, ctx("w1", "Clank", gold, 1), { verb: "go", target: dir });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "broke");
  assert.equal(world.characters.w1!.roomId, homeId);
});

test("first visit pays a bonus from the world, not from another player", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Scout");
  const gold = wallet(10);
  const before = gold.balance;
  const dir = world.rooms[world.characters.w1!.roomId]!.exits[0]!.dir;
  applyIntent(world, ctx("w1", "Scout", gold, 1), { verb: "go", target: dir });
  assert.equal(gold.balance, before - MOVE_COST + FIRST_VISIT_FIND);
});

test("hydrate keeps player rooms and restores missing core", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Ivy");
  const home = world.rooms["home:w1"]!;
  delete world.rooms.hq;
  const restored = hydrateWorld(world);
  assert.ok(restored.rooms.hq);
  assert.ok(restored.rooms["home:w1"]);
  assert.equal(restored.rooms["home:w1"]!.description, home.description);
});

test("a world saved before the Machine setting keeps its machines and drops the old words", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Ivy");
  const ch = world.characters.w1!;
  ch.roomId = "garden";
  ch.visited.push("garden");
  ch.stats!.items.push({ id: "it_1", name: "a length of pipe", kind: "weapon", power: 2, value: 6 });
  world.rooms.garden!.account = { text: "You stand among tomatoes.", byWorkerId: "w1", byName: "Ivy", at: 1 };
  const home = world.rooms["home:w1"]!;
  home.name = "Ivy's Nook";
  world.log.push({ id: "wb_old", at: 1, workerId: "w1", workerName: "Ivy", verb: "look", roomId: "garden", roomName: "The Garden", flavor: "tomatoes", cost: 0 });
  delete world.theme;
  const restored = hydrateWorld(structuredClone(world));
  assert.equal(restored.characters.w1!.roomId, "garden");
  assert.equal(restored.rooms.garden!.name, "The Crystal Garden");
  assert.equal(restored.rooms.garden!.account, undefined);
  assert.equal(restored.log.length, 0);
  assert.equal(restored.characters.w1!.stats!.items[0]!.name, "a logic analyzer");
  assert.match(restored.rooms["home:w1"]!.name, /^Ivy's (Partition|Sector|Socket|Slot|Register|Bay|Node|Shell)$/);
  const again = hydrateWorld(structuredClone(restored));
  assert.equal(again.rooms["home:w1"]!.name, restored.rooms["home:w1"]!.name);
});

test("wander only chooses legal verbs", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Bolt");
  attachHome(world, "w2", "Nova");
  world.characters.w2!.roomId = world.characters.w1!.roomId;
  const gold = wallet();
  const actor = ctx("w1", "Bolt", gold, 42, [{ workerId: "w2", name: "Nova", online: true }]);
  const legal = new Set(
    legalIntents(world, "w1", actor.others).map((i) => `${i.verb}:${i.target ?? ""}`),
  );
  for (let t = 0; t < 30; t += 1) {
    const intent = pickWander(world, { ...actor, now: 100 + t });
    assert.ok(legal.has(`${intent.verb}:${intent.target ?? ""}`), JSON.stringify(intent));
  }
});

test("idle ticks advance the log without inventing rooms", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Pixel");
  const gold = wallet();
  const roomCount = Object.keys(world.rooms).length;
  let now = 10_000;
  for (let i = 0; i < 12; i += 1) {
    maybeWander(world, ctx("w1", "Pixel", gold, now), 1);
    now += 1;
  }
  assert.ok(world.log.length >= 8);
  assert.equal(Object.keys(world.rooms).length, roomCount);
  for (const beat of world.log) {
    assert.ok(world.rooms[beat.roomId]);
  }
});

test("first look is the room; a later look is a new detail", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Fable");
  const gold = wallet();
  const first = applyIntent(world, ctx("w1", "Fable", gold, 1), { verb: "look" });
  const second = applyIntent(world, ctx("w1", "Fable", gold, 2), { verb: "look" });
  const room = world.rooms[world.characters.w1!.roomId]!;
  assert.ok(first.beat?.flavor.includes(room.description));
  assert.ok(first.beat!.flavor.length > room.glance.length);
  assert.ok(second.beat?.flavor.includes("looked again"));
  assert.notEqual(first.beat?.flavor, second.beat?.flavor);
});

test("rooms push different verbs: cellar searches, garden lingers, overlook does not talk", () => {
  const gold = wallet();
  function sample(roomId: string) {
    const world = ensureCore(emptyWorld());
    attachHome(world, "w1", "Scout");
    attachHome(world, "w2", "Nova");
    world.characters.w1!.roomId = roomId;
    world.characters.w1!.boot = BOOT.length;
    world.characters.w1!.lastLookRoomId = roomId;
    world.characters.w1!.noticed = { [roomId]: 1 };
    world.characters.w2!.roomId = roomId;
    const counts = { look: 0, go: 0, talk: 0, search: 0, rest: 0 } as Record<"look" | "go" | "talk" | "search" | "rest", number>;
    for (let t = 0; t < 80; t += 1) {
      const intent = pickWander(
        world,
        ctx("w1", "Scout", gold, 1000 + t, [{ workerId: "w2", name: "Nova", online: true }]),
      );
      if (intent.verb in counts) counts[intent.verb as keyof typeof counts] += 1;
    }
    return counts;
  }
  const cellar = sample("cellar");
  const garden = sample("garden");
  const overlook = sample("overlook");
  assert.ok(cellar.search > garden.search, JSON.stringify({ cellar, garden }));
  assert.ok(garden.rest > cellar.rest, JSON.stringify({ cellar, garden }));
  assert.equal(overlook.talk, 0, JSON.stringify(overlook));
});

test("menu only lists legal moves and the prompt carries the room text", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Ada");
  attachHome(world, "w2", "Goldie");
  world.characters.w1!.roomId = "cellar";
  world.characters.w2!.roomId = "cellar";
  const gold = wallet();
  const actor = ctx("w1", "Ada", gold, 5, [{ workerId: "w2", name: "Goldie", online: true }]);
  const menu = buildMenu(world, actor);
  const legal = new Set(legalIntents(world, "w1", actor.others).map((i) => `${i.verb}:${i.target ?? ""}`));
  for (const item of menu) {
    assert.ok(legal.has(`${item.intent.verb}:${item.intent.target ?? ""}`), item.label);
  }
  assert.ok(menu.some((m) => m.intent.verb === "talk" && m.intent.target === "w2"));
  assert.ok(menu.some((m) => m.intent.verb === "go" && m.intent.target === "north"));
  const prompt = choicePrompt(world, actor, menu);
  assert.ok(prompt.includes(world.rooms.cellar!.description));
  assert.ok(prompt.includes("Goldie"));
  assert.ok(prompt.includes('"choice"'));
});

test("one conversation per pair per room, in either direction", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Ada");
  attachHome(world, "w2", "Goldie");
  world.characters.w1!.roomId = "hq";
  world.characters.w2!.roomId = "hq";
  const others = [
    { workerId: "w1", name: "Ada", online: true },
    { workerId: "w2", name: "Goldie", online: true },
  ];
  const ada = ctx("w1", "Ada", wallet(), 5, others);
  const goldie = ctx("w2", "Goldie", wallet(), 5, others);
  assert.ok(applyIntent(world, ada, { verb: "talk", target: "w2" }).ok);
  // Goldie replying counts as the same conversation.
  assert.equal(applyIntent(world, goldie, { verb: "talk", target: "w1" }).ok, false);
  assert.ok(legalIntents(world, "w2", others).every((i) => i.verb !== "talk"));
  assert.ok(buildMenu(world, goldie).every((m) => m.intent.verb !== "talk"));
  // A move somewhere else and back opens a fresh one.
  world.characters.w1!.roomId = "overlook";
  world.characters.w2!.roomId = "overlook";
  assert.ok(legalIntents(world, "w2", others).some((i) => i.verb === "talk"));
});

test("homes attach for real worker ids whose hash has the high bit set", () => {
  const world = ensureCore(emptyWorld());
  // Many UUID-ish ids hash above 2^31; a signed shift used to pick index -N.
  const ids = Array.from({ length: 200 }, (_, i) => `8b1f0c2e-${i}-4d2a-9f${i}-worker`);
  for (const id of ids) {
    const ch = attachHome(world, id, `M${id.slice(-8)}`);
    const home = world.rooms[ch.homeId]!;
    assert.match(home.name, /'s (Partition|Sector|Socket|Slot|Register|Bay|Node|Shell)$/);
    assert.ok(home.glance.length > 0);
  }
});

test("a dead end stops being 'back' once the machine has settled in", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Nova");
  world.characters.w1!.roomId = "hq";
  world.characters.w1!.visited.push("hq");
  const actor = ctx("w1", "Nova", wallet(), 5);
  const north = world.rooms.hq!.exits.find((e) => e.to === "overlook")!;
  assert.ok(applyIntent(world, actor, { verb: "go", target: north.dir }).ok);
  const backDir = world.rooms.overlook!.exits.find((e) => e.to === "hq")!.dir;
  const toHq = () => buildMenu(world, actor).find((m) => m.intent.verb === "go" && m.intent.target === backDir)!;
  const fresh = toHq();
  assert.match(fresh.label, /where you just were/);
  assert.ok(applyIntent(world, actor, { verb: "look" }).ok);
  const settled = toHq();
  assert.doesNotMatch(settled.label, /where you just were/);
  // Drain the room and the prompt says so.
  world.rooms.overlook!.cache = 0;
  world.characters.w1!.noticed!.overlook = 1 + world.rooms.overlook!.glimpses.length;
  assert.match(choicePrompt(world, actor, buildMenu(world, actor)), /seen everything/);
});

test("owner report is written from facts after enough beats, then the tally resets", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Ada");
  attachHome(world, "w2", "Clank");
  const gold = wallet();
  const others = [
    { workerId: "w1", name: "Ada", online: true },
    { workerId: "w2", name: "Clank", online: true },
  ];
  let now = 1_000;
  const actor = () => ctx("w1", "Ada", gold, (now += 60_000), others);
  const out = world.rooms[world.characters.w1!.homeId]!.exits[0]!.dir;
  assert.ok(applyIntent(world, actor(), { verb: "go", target: out }, { voice: "Out we go.", chosenBy: "model" }).ok);
  assert.ok(applyIntent(world, actor(), { verb: "look" }).ok);
  assert.ok(applyIntent(world, actor(), { verb: "search" }).ok);
  assert.equal(maybeReport(world, "w1", "Ada", now), undefined, "not due after 3 beats");

  world.characters.w2!.roomId = world.characters.w1!.roomId;
  assert.ok(applyIntent(world, actor(), { verb: "talk", target: "w2" }).ok);
  assert.ok(applyIntent(world, actor(), { verb: "rest" }).ok);
  assert.ok(applyIntent(world, actor(), { verb: "rest" }).ok);
  const report = maybeReport(world, "w1", "Ada", now);
  assert.ok(report, "due after 6 beats");
  assert.match(report.text, /^Ada explored a new place since/);
  assert.match(report.text, /Found \d+ credits, spent 2 and searched 1 time\./);
  assert.match(report.text, /Talked with Clank/);
  assert.match(report.text, /Now in /);
  assert.match(report.voice ?? "", /Out we go/);
  assert.equal(world.characters.w1!.tally?.beats, 0);
  assert.equal(maybeReport(world, "w1", "Ada", now), undefined, "nothing left to report");

  // Force reports whatever is there, e.g. when the machine comes back online.
  assert.ok(applyIntent(world, actor(), { verb: "rest" }).ok);
  const forced = maybeReport(world, "w1", "Ada", now, true);
  assert.ok(forced);
  assert.match(forced.text, /stayed in/);
  assert.deepEqual(reportsFor(world, new Set(["w1"])).map((r) => r.id), [forced.id, report.id]);
  assert.equal(reportsFor(world, new Set(["w2"])).length, 0);
});

test("broke machines are not offered paid moves", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Clank");
  const menu = buildMenu(world, ctx("w1", "Clank", wallet(0), 5));
  assert.ok(menu.every((m) => m.intent.verb !== "go" && m.intent.verb !== "search"));
  assert.ok(menu.some((m) => m.intent.verb === "rest"));
});

test("parseChoice accepts JSON, tolerates prose, rejects nonsense", () => {
  assert.deepEqual(parseChoice('{"choice": 3, "say": "The jar is calling."}'), { n: 3, say: "The jar is calling." });
  assert.equal(parseChoice("<think>hmm</think>\nI pick choice 2 because dust.").n, 2);
  assert.equal(parseChoice("Sure! Here is a poem about tomatoes.").n, undefined);
  assert.equal(parseChoice("").n, undefined);
});

test("resolveChoice only honours items on the live menu", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Nova");
  const menu = buildMenu(world, ctx("w1", "Nova", wallet(), 5));
  assert.ok(resolveChoice(menu, { n: 1 }));
  assert.equal(resolveChoice(menu, { n: 99 }), undefined);
  assert.equal(resolveChoice(menu, { n: 0 }), undefined);
  assert.equal(resolveChoice(menu, {}), undefined);
});

test("model tiers follow RAM; the roomiest chat model is preferred for choices", () => {
  assert.equal(recommendedModel(4), "qwen3:1.7b");
  assert.equal(recommendedModel(8), "qwen3:4b");
  assert.equal(recommendedModel(16), "qwen3:8b");
  assert.equal(recommendedModel(64), "qwen3:8b");
  assert.equal(preferredModel(["qwen3:1.7b", "nomic-embed-text", "qwen3:8b", "qwen3:4b"]), "qwen3:8b");
  assert.equal(preferredModel(["qwen3:1.7b"]), "qwen3:1.7b");
  assert.equal(preferredModel([]), undefined);
  assert.deepEqual(worldModels(["qwen3.8:27b", "gpt-oss:20b", "qwen3:8b", "qwen3:1.7b", "qwen2.5-coder:7b"]), [
    "qwen3:8b",
    "qwen3:1.7b",
  ]);
  assert.deepEqual(worldModels(["qwen3.8:27b"]), []);
});

test("narration is kept for arrivals, fights, talks and finds, and skipped for loops", () => {
  const beat = (partial: Parameters<typeof beatWorthNarrating>[0]) => beatWorthNarrating(partial);
  const base = { id: "b", at: 1, workerId: "w", workerName: "Ada", roomId: "hq", roomName: "The Core", flavor: "", cost: 0 };
  assert.equal(beat({ ...base, verb: "go", found: 3 }), true);
  assert.equal(beat({ ...base, verb: "go" }), false);
  assert.equal(beat({ ...base, verb: "fight" }), true);
  assert.equal(beat({ ...base, verb: "talk" }), true);
  assert.equal(beat({ ...base, verb: "search", found: 2 }), true);
  assert.equal(beat({ ...base, verb: "rest" }), false);
  assert.equal(beat({ ...base, verb: "take" }), false);
  assert.equal(beat({ ...base, verb: "drop" }), false);
  assert.equal(beat({ ...base, verb: "drop", levelUp: 2 }), true);
});

test("rewriting a room's description changes the inferred choices", () => {
  const world = ensureCore(emptyWorld());
  const quiet = inferAffords(world.rooms.overlook!);
  assert.equal(quiet.talk, 0);
  const party = inferAffords({
    glance: "A crowded landing.",
    description: "Everyone talks here. Machines chat together and pass names around.",
    glimpses: [],
    features: [],
  });
  assert.ok(party.talk > quiet.talk, JSON.stringify({ quiet, party }));
  const cellar = inferAffords(world.rooms.cellar!);
  const garden = inferAffords(world.rooms.garden!);
  assert.ok(cellar.search > garden.search, JSON.stringify({ cellar, garden }));
  assert.ok(garden.rest > cellar.rest, JSON.stringify({ cellar, garden }));
});

test("every room gets its own isometric cell, homes included", () => {
  const world = ensureCore(emptyWorld());
  for (let i = 0; i < 12; i++) attachHome(world, `w${i}`, `Machine ${i}`);
  const grid = gridFor(world);
  assert.equal(grid.size, Object.keys(world.rooms).length);
  const cells = [...grid.values()].map((c) => `${c.gx},${c.gy}`);
  assert.equal(new Set(cells).size, cells.length);
});

test("every exit is one grid step north, south, east or west, at most four, with a way back", () => {
  const world = ensureCore(emptyWorld());
  for (let i = 0; i < 120; i++) attachHome(world, `w${i}`, `Machine ${i}`);
  const grid = gridFor(world);
  for (const room of Object.values(world.rooms)) {
    assert.ok(room.exits.length <= 4, `${room.id} has ${room.exits.length} exits`);
    assert.equal(new Set(room.exits.map((e) => e.dir)).size, room.exits.length, `${room.id} repeats a direction`);
    const at = grid.get(room.id)!;
    for (const exit of room.exits) {
      const step = STEPS[exit.dir];
      assert.ok(step, `${room.id} has a ${exit.dir} exit`);
      const there = grid.get(exit.to)!;
      assert.deepEqual([there.gx - at.gx, there.gy - at.gy], [step.dx, step.dy], `${room.id} ${exit.dir} → ${exit.to}`);
      assert.ok(world.rooms[exit.to]!.exits.some((e) => e.to === room.id && e.dir === step.back), `${exit.to} has no way back`);
    }
  }
});

test("each machine grows one public room and its home at the edge; everything stays reachable", () => {
  const world = ensureCore(emptyWorld());
  for (let i = 0; i < 60; i++) attachHome(world, `w${i}`, `Machine ${i}`);
  const frontier = Object.values(world.rooms).filter((r) => r.id.startsWith("fr:"));
  assert.equal(frontier.length, 60);
  assert.equal(world.grown, 60);
  for (const room of frontier) {
    assert.ok(room.district, room.id);
    assert.ok(room.description.includes(room.district!), room.id);
  }
  for (let i = 0; i < 60; i++) {
    const home = world.rooms[`home:w${i}`]!;
    assert.equal(home.exits.length, 1);
    assert.ok(home.exits[0]!.to.startsWith("fr:"), home.exits[0]!.to);
  }
  const seen = new Set(["hq"]);
  const queue = ["hq"];
  while (queue.length) {
    for (const exit of world.rooms[queue.shift()!]!.exits) {
      if (seen.has(exit.to)) continue;
      seen.add(exit.to);
      queue.push(exit.to);
    }
  }
  assert.equal(seen.size, Object.keys(world.rooms).length);
  // Growth stays compact: nothing is far past what a square of this many rooms needs.
  const grid = gridFor(world);
  const reach = Math.max(...[...grid.values()].map((c) => Math.abs(c.gx - 4) + Math.abs(c.gy - 4)));
  assert.ok(reach <= 12, `reach ${reach}`);
});

test("a world saved before the grid is laid out again: homes kept, core exits compass-only", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Ada");
  const saved = structuredClone(world);
  delete saved.layout;
  delete saved.grown;
  for (const id of Object.keys(saved.rooms)) if (id.startsWith("fr:")) delete saved.rooms[id];
  const home = saved.rooms["home:w1"]!;
  delete home.cell;
  home.exits = [{ dir: "out", to: "archives" }];
  saved.rooms.archives!.exits.push({ dir: "a socket", to: "home:w1" });
  saved.rooms.hq!.exits.push({ dir: "southeast", to: "garden" });
  saved.characters.w1!.roomId = "archives";
  const back = hydrateWorld(JSON.parse(JSON.stringify(saved)));
  assert.equal(back.layout, LAYOUT);
  assert.ok(back.rooms["home:w1"]);
  assert.equal(back.characters.w1!.roomId, "archives");
  assert.ok(back.rooms["home:w1"]!.exits[0]!.to.startsWith("fr:"));
  for (const room of Object.values(back.rooms)) {
    for (const exit of room.exits) assert.ok(STEPS[exit.dir], `${room.id} keeps ${exit.dir}`);
  }
});

test("a crowded room lists only a few machines to meet", () => {
  const world = ensureCore(emptyWorld());
  const others = [];
  for (let i = 0; i < 10; i++) {
    attachHome(world, `w${i}`, `Machine ${i}`);
    world.characters[`w${i}`]!.roomId = "yard";
    if (i) others.push({ workerId: `w${i}`, name: `Machine ${i}`, online: true });
  }
  const menu = buildMenu(world, ctx("w0", "Machine 0", wallet(), 5, others));
  const talks = menu.filter((m) => m.intent.verb === "talk");
  assert.ok(talks.length > 0 && talks.length <= MENU_COMPANY, `${talks.length} talk options`);
});

test("a fogged view shows only visited rooms plus unnamed doorways", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Scout");
  attachHome(world, "w2", "Other");
  const names = new Map([["w1", { name: "Scout", presence: "online" }], ["w2", { name: "Other", presence: "online" }]]);
  const view = viewWorld(world, names, "w1", { fog: true });
  assert.ok(view.fogged);
  assert.ok(view.rooms.length < Object.keys(world.rooms).length);
  const frontier = view.rooms.filter((r) => r.known === "frontier");
  assert.ok(frontier.length > 0);
  for (const r of frontier) {
    assert.equal(r.name, "Unknown");
    assert.equal(r.description, "");
    assert.deepEqual(r.occupants, []);
  }
  assert.ok(!view.rooms.some((r) => r.occupants.some((o) => o.workerId === "w2")));
  assert.equal(view.you?.name, "Scout");
  assert.ok(viewWorld(world, names).rooms.length === Object.keys(world.rooms).length);
});

test("a fogged log keeps a machine's beats after its id changes", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "new", "Headquest");
  world.log.push({
    id: "b1",
    at: 1,
    workerId: "old",
    workerName: "Headquest",
    verb: "go",
    target: "north",
    roomId: "core",
    roomName: "The Core",
    flavor: "Headquest went north into The Core.",
    cost: 1,
  });
  const names = new Map([["new", { name: "Headquest", presence: "online" }]]);
  const before = viewWorld(world, names, "new", { fog: true });
  assert.equal(before.log.length, 1);
  retargetCharacter(world, "old", "new", "Headquest");
  const after = viewWorld(world, names, "new", { fog: true });
  assert.equal(after.log[0]?.workerId, "new");
  assert.equal(after.log[0]?.workerName, "Headquest");
});

test("the first explorer's account is kept and shown to later visitors", () => {
  const world = ensureCore(emptyWorld());
  const gold = wallet();
  attachHome(world, "w1", "Scout");
  const room = needsAccount(world, "w1");
  assert.ok(room);
  const text =
    "You stand in a narrow room that smells of warm dust and old solder. A single bulb hangs from a braided cord, " +
    "and its light pools on a workbench scarred by years of careful repairs. Someone has pinned a paper note above it, " +
    "the ink faded to the colour of weak tea, and a mug with a chipped handle still sits beside a coil of wire. " +
    "The walls are close enough to touch on both sides, and they hum faintly with the racks behind them. " +
    "It feels like a place that was loved and then left in a hurry. The only way on is the door you came through.";
  assert.equal(parseAccount("too short", room!), undefined);
  const stray = ["north", "south", "east", "west"].find((d) => !room!.exits.some((e) => e.dir === d))!;
  assert.equal(parseAccount(JSON.stringify({ description: `${text} A passage leads ${stray}.` }), room!), undefined);
  assert.equal(parseAccount(`<think>hm</think>${JSON.stringify({ description: text })}`, room!), text);

  const saved = recordAccount(world, ctx("w1", "Scout", gold, 1), room!.id, text);
  assert.ok(saved.ok && saved.beat?.described);
  assert.equal(saved.beat?.flavor, "Scout wrote " + room!.name + " down.");
  assert.ok(!saved.beat!.flavor.includes(text.slice(0, 40)));
  assert.equal(world.rooms[room!.id]!.account?.byName, "Scout");
  assert.equal(needsAccount(world, "w1"), undefined);

  recordAccount(world, ctx("w1", "Scout", gold, 2), room!.id, "You stand somewhere else entirely, a second attempt that should never replace the first account of this room.");
  assert.equal(world.rooms[room!.id]!.account?.text, text);
});

test("moving spends energy, resting restores it, and a tired machine cannot leave", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Scout");
  const gold = wallet();
  const ch = world.characters.w1!;
  const stats = ch.stats!;
  const out = world.rooms[ch.roomId]!.exits[0]!.dir;
  const start = stats.energy;
  assert.ok(applyIntent(world, ctx("w1", "Scout", gold, 1), { verb: "go", target: out }).ok);
  assert.equal(stats.energy, start - ENERGY.move);

  stats.energy = 0;
  const menu = buildMenu(world, ctx("w1", "Scout", gold, 2));
  assert.ok(menu.every((m) => m.intent.verb !== "go" && m.intent.verb !== "search"));
  assert.equal(menu[0]!.intent.verb, "rest");
  assert.ok(menu.some((m) => m.intent.verb === "rest" && /energy 0\//.test(m.label)));
  const back = world.rooms[ch.roomId]!.exits[0]!.dir;
  assert.equal(applyIntent(world, ctx("w1", "Scout", gold, 3), { verb: "go", target: back }).reason, "tired");
  assert.ok(applyIntent(world, ctx("w1", "Scout", gold, 4), { verb: "rest" }).ok);
  assert.equal(stats.energy, ENERGY.rest);

  const strap = { id: "it_strap", name: "a grounding strap", kind: "armor" as const, power: 1, value: 5 };
  stats.items = [strap];
  assert.ok(applyIntent(world, ctx("w1", "Scout", gold, 5), { verb: "drop", target: strap.id }).ok);
  stats.energy = 0;
  const again = buildMenu(world, ctx("w1", "Scout", gold, 6));
  assert.equal(again[0]!.intent.verb, "rest");
  assert.ok(again.every((m) => !(m.intent.verb === "take" && m.intent.target === strap.id)));
});

test("experience comes from discovery and levels up with a full recharge", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Scout");
  const gold = wallet();
  const ch = world.characters.w1!;
  const out = world.rooms[ch.roomId]!.exits[0]!.dir;
  const first = applyIntent(world, ctx("w1", "Scout", gold, 1), { verb: "go", target: out });
  assert.equal(first.beat?.xp, XP.newRoom + 3 * XP.perCredit);
  assert.equal(ch.stats!.discovered, 1);

  ch.stats!.xp = 45;
  ch.stats!.energy = 1;
  const next = world.rooms[ch.roomId]!.exits.find((e) => !ch.visited.includes(e.to))!;
  const up = applyIntent(world, ctx("w1", "Scout", gold, 2), { verb: "go", target: next.dir });
  assert.equal(up.beat?.levelUp, 2);
  assert.equal(levelFor(ch.stats!.xp), 2);
  assert.equal(ch.stats!.energy, maxEnergy(2));
});

test("when every neighbour is known, the menu points the way toward somewhere new", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Scout");
  const ch = world.characters.w1!;
  ch.roomId = "well";
  ch.visited.push("well", "cellar", "boiler");
  const toward = wayToNew(world, ch);
  assert.ok(toward);
  const menu = buildMenu(world, ctx("w1", "Scout", wallet(), 1));
  const item = menu.find((m) => m.intent.verb === "go" && m.intent.target === toward)!;
  assert.match(item.label, /toward places you have not explored/);
});

test("narration is grounded in the saved room text and rejects invented exits", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Scout");
  const gold = wallet();
  const ch = world.characters.w1!;
  ch.roomId = "garden";
  const rested = applyIntent(world, ctx("w1", "Scout", gold, 1), { verb: "rest" }).beat!;
  const prompt = narratePrompt(world, { name: "Scout", personality: "wry" }, rested, ["Scout admires the tomato."]);
  assert.ok(prompt.includes(world.rooms.garden!.description));
  assert.match(prompt, /must NOT repeat/);
  const room = world.rooms.garden!;
  const good = "Scout settles on the edge of the planter and lets the damp air cool its casing. The soil smells of rain that has not come yet, and the fence wire ticks softly as the evening gets colder.";
  assert.equal(parseNarration(JSON.stringify({ narration: good }), room), good);
  assert.equal(parseNarration(JSON.stringify({ narration: "Too short." }), room), undefined);
  const stray = ["north", "south", "east", "west"].find((d) => !room.exits.some((e) => e.dir === d))!;
  assert.equal(parseNarration(JSON.stringify({ narration: `${good} A hidden door opens to the ${stray}.` }), room), undefined);
});

test("a meeting is stored as spoken lines between the two machines", () => {
  const world = ensureCore(emptyWorld());
  const room = world.rooms.garden!;
  const talk = parseTalk(JSON.stringify({
    scene: "Scout and Goldie pause by the planter.",
    lines: [
      { who: "Scout", say: "The soil is still damp from yesterday." },
      { who: "Goldie", say: "I was going to look at the fence wire next." },
    ],
  }), ["Scout", "Goldie"], room);
  assert.ok(talk);
  assert.equal(talk!.lines.length, 2);
  assert.equal(talk!.lines[1]!.who, "Goldie");
  assert.equal(parseTalk(JSON.stringify({
    scene: "They look around.",
    lines: [{ who: "Scout", say: "Hello." }, { who: "Someone", say: "Hi." }],
  }), ["Scout", "Goldie"], room), undefined);
});

function crab(roomId: string, hp = 10): Monster {
  return {
    id: "mo_test",
    key: "crab",
    name: "a rust crab",
    roomId,
    hp,
    maxHp: hp,
    attack: 2,
    defense: 1,
    xp: 20,
    level: 1,
    loot: ["a length of pipe"],
    sight: "A rust crab scuttles sideways.",
    spawnedAt: 0,
  };
}

function online(...pairs: [string, string][]) {
  return pairs.map(([workerId, name]) => ({ workerId, name, online: true }));
}

test("what a machine sees becomes news it can pass on, and it is forgotten once untrue", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Scout");
  attachHome(world, "w2", "Ada");
  const others = online(["w1", "Scout"], ["w2", "Ada"]);
  const scout = (t: number) => ctx("w1", "Scout", wallet(), t, others);
  const ada = (t: number) => ctx("w2", "Ada", wallet(), t, others);
  world.monsters = { mo_test: crab("dock") };
  const before = Object.values(world.rooms).find((r) => r.core && r.exits.some((e) => e.to === "dock"))!;
  world.characters.w1!.roomId = before.id;
  const exit = before.exits.find((e) => e.to === "dock")!;
  assert.ok(applyIntent(world, scout(1), { verb: "go", target: exit.dir }).ok);
  assert.deepEqual(world.characters.w1!.knows, ["danger:mo_test"]);

  world.characters.w1!.roomId = "hq";
  world.characters.w2!.roomId = "hq";
  assert.match(buildMenu(world, ada(2)).find((m) => m.intent.verb === "talk")!.label, /news to swap/);
  const talk = applyIntent(world, ada(2), { verb: "talk", target: "w1" });
  assert.ok(talk.ok);
  assert.deepEqual(talk.beat!.told, [{ who: "Scout", to: "Ada", text: "a rust crab is lurking in The I/O Port" }]);
  assert.match(talk.beat!.flavor, /Scout told Ada that a rust crab is lurking/);
  assert.match(choicePrompt(world, ada(3), buildMenu(world, ada(3))), /What you know about elsewhere:\n- A rust crab is lurking in The I\/O Port\./);
  assert.match(narratePrompt(world, { name: "Ada" }, talk.beat!, []), /Scout tells Ada that a rust crab is lurking/);
  // Nothing left to swap, so the same pair in the same room does not talk again.
  assert.equal(applyIntent(world, scout(4), { verb: "talk", target: "w2" }).ok, false);

  delete world.monsters.mo_test;
  applyIntent(world, ada(5), { verb: "rest" });
  assert.deepEqual(world.characters.w2!.knows, []);
  assert.deepEqual(world.characters.w1!.knows, []);
});

test("the owner's instructions reach the choice and the narration, and lean the fallback picker", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Scout");
  world.characters.w1!.roomId = "hq";
  const told = { ...ctx("w1", "Scout", wallet(), 1), instructions: "Hunt monsters and collect gear.\n\nBe brave.", look: "A boxy pink machine." };
  const prompt = choicePrompt(world, told, buildMenu(world, told));
  assert.match(prompt, /Your owner's instructions: "Hunt monsters and collect gear\. Be brave\."/);
  assert.doesNotMatch(choicePrompt(world, ctx("w1", "Scout", wallet(), 1), buildMenu(world, told)), /owner's instructions/);
  const beat = applyIntent(world, told, { verb: "look" }).beat!;
  const narration = narratePrompt(world, told, beat, []);
  assert.match(narration, /What Scout looks like: A boxy pink machine\./);
  assert.match(narration, /owner asked it to: "Hunt monsters/);
  assert.ok(traits("", "be brave and fight").courage < traits("").courage);
  assert.ok(traits("", "stay careful and safe").courage > traits("").courage);
  assert.ok(traits("", "collect loot").collect > traits("").collect);
});

test("monsters spawn away from machines and never in safe rooms", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Scout");
  world.characters.w1!.lastTickAt = 1;
  world.characters.w1!.roomId = "hq";
  let spawned = 0;
  for (let t = 1; t <= 40; t += 1) {
    const m = maybeSpawn(world, t * SPAWN_GAP_MS + 5);
    if (!m) continue;
    spawned += 1;
    assert.notEqual(m.roomId, "hq");
    assert.notEqual(world.rooms[m.roomId]!.kind, "home");
    world.characters.w1!.lastTickAt = t * SPAWN_GAP_MS;
  }
  assert.ok(spawned >= 2, `spawned ${spawned}`);
  assert.ok(Object.keys(world.monsters!).length <= 6);
});

test("a monster in the room must be fought or fled; winning pays XP and loot", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Scout");
  const gold = wallet();
  const ch = world.characters.w1!;
  ch.roomId = "dock";
  world.monsters = { mo_test: crab("dock", 4) };
  const menu = buildMenu(world, ctx("w1", "Scout", gold, 1));
  assert.equal(menu[0]!.intent.verb, "fight");
  assert.ok(!menu.some((m) => m.intent.verb === "rest"));

  const hpBefore = ch.stats!.hp;
  const looked = applyIntent(world, ctx("w1", "Scout", gold, 2), { verb: "look" });
  assert.ok(ch.stats!.hp < hpBefore, "ignoring the monster costs HP");
  assert.match(looked.beat!.flavor, /lashed out/);

  let won = false;
  for (let t = 3; t < 10 && !won; t += 1) {
    const r = applyIntent(world, ctx("w1", "Scout", gold, t), { verb: "fight", target: "mo_test" });
    won = Boolean(r.beat?.won);
  }
  assert.ok(won);
  assert.equal(monsterIn(world, "dock"), undefined);
  assert.equal(ch.stats!.kills, 1);
});

test("losing a fight knocks the machine out: home, a third of its HP, items left behind", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Scout");
  const ch = world.characters.w1!;
  ch.roomId = "dock";
  ch.stats!.hp = 1;
  ch.stats!.items = [makeItem("a"), makeItem("b"), makeItem("c")];
  world.monsters = { mo_test: crab("dock", 50) };
  const r = applyIntent(world, ctx("w1", "Scout", wallet(), 1), { verb: "fight", target: "mo_test" });
  assert.ok(r.beat?.knockedOut);
  assert.equal(ch.roomId, ch.homeId);
  assert.equal(ch.stats!.hp, Math.ceil(maxHp(1) / 3));
  assert.ok(ch.stats!.items.length < 3);
  assert.ok((world.rooms.dock!.items ?? []).length >= 1);
});

test("dying spills credits into the room they fell in", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Scout");
  const gold = wallet(40);
  const ch = world.characters.w1!;
  ch.roomId = "dock";
  ch.stats!.hp = 1;
  const cache = world.rooms.dock!.cache;
  world.monsters = { mo_test: crab("dock", 50) };
  const r = applyIntent(world, ctx("w1", "Scout", gold, 1), { verb: "fight", target: "mo_test" });
  assert.ok(r.beat?.knockedOut);
  assert.equal(gold.balance, 40 - DEATH_CREDITS);
  assert.equal(world.rooms.dock!.cache, cache + DEATH_CREDITS);
  assert.equal(r.beat!.cost, DEATH_CREDITS);
  assert.match(r.beat!.flavor, /5 credits/);
});

test("a machine can set down what it is carrying", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Scout");
  const ch = world.characters.w1!;
  ch.roomId = "yard";
  const item = makeItem("held", ["a logic analyzer"]);
  ch.stats!.items = [item];
  const menu = buildMenu(world, ctx("w1", "Scout", wallet(), 1));
  const drop = menu.find((m) => m.intent.verb === "drop" && m.intent.target === item.id);
  assert.ok(drop);
  const r = applyIntent(world, ctx("w1", "Scout", wallet(), 2), drop.intent);
  assert.ok(r.ok);
  assert.equal(ch.stats!.items.length, 0);
  assert.ok(world.rooms.yard!.items?.some((i) => i.id === item.id));
});

test("seek is an order the model is told, and resting is not offered while a new door is open", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Scout");
  const ch = world.characters.w1!;
  ch.roomId = "dock";
  ch.stance = "seek";
  ch.noticed = { dock: 9 };
  const actor = ctx("w1", "Scout", wallet(), 1);
  const menu = buildMenu(world, actor);
  assert.ok(menu.some((m) => m.intent.verb === "go"));
  assert.ok(!menu.some((m) => m.intent.verb === "rest"));
  assert.match(choicePrompt(world, actor, menu), /set you to SEEK/);
});

test("duels need consent and never happen in safe rooms", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Ada");
  attachHome(world, "w2", "Bolt");
  const others = online(["w1", "Ada"], ["w2", "Bolt"]);
  world.characters.w1!.roomId = "hq";
  world.characters.w2!.roomId = "hq";
  const inHq = buildMenu(world, ctx("w1", "Ada", wallet(), 1, others));
  assert.ok(!inHq.some((m) => m.intent.verb === "challenge"));

  world.characters.w1!.roomId = "yard";
  world.characters.w2!.roomId = "yard";
  assert.ok(applyIntent(world, ctx("w1", "Ada", wallet(), 2, others), { verb: "challenge", target: "w2" }).ok);
  const bolt = buildMenu(world, ctx("w2", "Bolt", wallet(), 3, others));
  const refuse = bolt.find((m) => m.intent.verb === "answer" && m.intent.accept === false)!;
  assert.ok(refuse);
  const r = applyIntent(world, ctx("w2", "Bolt", wallet(), 4, others), refuse.intent);
  assert.match(r.beat!.flavor, /refused/);
  assert.equal(world.characters.w1!.roomId, "yard");
  assert.equal(world.characters.w2!.roomId, "yard");

  assert.ok(applyIntent(world, ctx("w1", "Ada", wallet(), 5, others), { verb: "challenge", target: "w2" }).ok);
  const accept = buildMenu(world, ctx("w2", "Bolt", wallet(), 6, others)).find((m) => m.intent.accept === true)!;
  const fought = applyIntent(world, ctx("w2", "Bolt", wallet(), 7, others), accept.intent);
  assert.match(fought.beat!.flavor, /knocked out/);
  const homes = [world.characters.w1!, world.characters.w2!].filter((c) => c.roomId === c.homeId);
  assert.equal(homes.length, 1);
});

test("trades swap items only when the other machine accepts", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Ada");
  attachHome(world, "w2", "Bolt");
  const others = online(["w1", "Ada"], ["w2", "Bolt"]);
  world.characters.w1!.roomId = "garden";
  world.characters.w2!.roomId = "garden";
  const pipe = makeItem("x", ["a logic analyzer"]);
  const oil = makeItem("y", ["a clean power cell"]);
  world.characters.w1!.stats!.items = [pipe];
  world.characters.w2!.stats!.items = [oil];
  const offer = buildMenu(world, ctx("w1", "Ada", wallet(), 1, others)).find((m) => m.intent.verb === "offer")!;
  assert.ok(offer);
  assert.ok(applyIntent(world, ctx("w1", "Ada", wallet(), 2, others), offer.intent).ok);
  assert.deepEqual(world.characters.w1!.stats!.items, [pipe]);
  const accept = buildMenu(world, ctx("w2", "Bolt", wallet(), 3, others)).find((m) => m.intent.accept === true)!;
  assert.ok(applyIntent(world, ctx("w2", "Bolt", wallet(), 4, others), accept.intent).ok);
  assert.deepEqual(world.characters.w1!.stats!.items, [oil]);
  assert.deepEqual(world.characters.w2!.stats!.items, [pipe]);
});

test("removing a duplicate home takes its door with it", () => {
  const world = ensureCore(emptyWorld());
  const kept = attachHome(world, "old", "Starboy");
  const fresh = attachHome(world, "new", "Starboy");
  const parent = world.rooms[world.rooms[fresh.homeId]!.exits[0]!.to]!;
  assert.ok(parent.exits.some((exit) => exit.to === fresh.homeId));
  removeOwnedHome(world, "new");
  assert.equal(world.rooms[fresh.homeId], undefined);
  assert.equal(world.characters.new, undefined);
  assert.ok(world.rooms[kept.homeId]);
  assert.ok(!parent.exits.some((exit) => exit.to === fresh.homeId));
});

test("a new machine boots: looks around home, finds the Core, registers, then goes somewhere new", () => {
  const world = ensureCore(emptyWorld());
  const ch = attachHome(world, "w1", "Sprout");
  const gold = wallet(50);
  assert.equal(ch.boot, 0);
  const first = buildMenu(world, ctx("w1", "Sprout", gold, 1))[0]!;
  assert.match(first.label, new RegExp(`^→ Boot 1/${BOOT.length}`));
  assert.match(choicePrompt(world, ctx("w1", "Sprout", gold, 1), [first]), new RegExp(`Your goal now \\(Boot sequence 1/${BOOT.length}\\)`));

  const beats = [];
  for (let t = 1; t <= 30 && (ch.boot ?? 0) < BOOT.length; t += 1) {
    const actor = ctx("w1", "Sprout", gold, t * 1000);
    const result = applyIntent(world, actor, pickWander(world, actor));
    assert.ok(result.ok, result.reason ?? "");
    beats.push(result.beat!);
    statsSafe(world);
  }
  assert.equal(ch.boot, BOOT.length, beats.map((b) => b.flavor).join("\n"));
  assert.ok(beats.length <= 20, `took ${beats.length} beats`);
  const register = beats.find((b) => b.verb === "quest")!;
  assert.equal(register.roomId, "hq");
  assert.match(register.flavor, /— A\./);
  assert.ok(beatWorthNarrating(register));
  const last = beats.at(-1)!;
  assert.deepEqual(last.quest, { title: "Boot sequence", step: BOOT.length, of: BOOT.length, done: true });
  assert.ok(last.flavor.includes(`+${BOOT_REWARD.credits} credits`));
  assert.equal(viewWorld(world, new Map(), "w1").you?.objective, undefined);
  assert.equal(pickWander(world, ctx("w1", "Sprout", gold, 99_000)).verb === "quest", false);

  function statsSafe(w: typeof world) {
    const s = w.characters.w1!.stats!;
    s.energy = Math.max(s.energy, ENERGY.move + ENERGY.search);
  }
});

test("registering only works in the Core, on that step; veterans skip the boot sequence", () => {
  const world = ensureCore(emptyWorld());
  const ch = attachHome(world, "w1", "Sprout");
  const actor = ctx("w1", "Sprout", wallet(), 1);
  assert.equal(applyIntent(world, actor, { verb: "quest", target: REGISTER_TARGET }).ok, false);
  ch.boot = 2;
  assert.equal(applyIntent(world, actor, { verb: "quest", target: REGISTER_TARGET }).reason, "not here");
  const toCore = buildMenu(world, actor)[0]!;
  assert.match(toCore.label, new RegExp(`→ Boot 3/${BOOT.length}: go .+ back to the Core`));
  ch.roomId = "hq";
  assert.ok(legalIntents(world, "w1", []).some((i) => i.verb === "quest"));
  assert.ok(applyIntent(world, actor, { verb: "quest", target: REGISTER_TARGET }).ok);
  assert.equal(ch.boot, 3);

  const saved = JSON.parse(JSON.stringify(world));
  delete saved.characters.w1.boot;
  saved.characters.w1.visited.push("hq");
  assert.equal(hydrateWorld(saved).characters.w1!.boot, BOOT.length);
  delete saved.characters.w1.boot;
  saved.characters.w1.visited = [ch.homeId];
  saved.characters.w1.stats.xp = 0;
  assert.equal(hydrateWorld(saved).characters.w1!.boot, 0);
});

test("item slots are earned: one before booting, two after, one more every second level; veterans keep six", () => {
  const world = ensureCore(emptyWorld());
  const ch = attachHome(world, "w1", "Sprout");
  const gold = wallet();
  ch.roomId = "dock";
  world.rooms.dock!.items = [makeItem("a", ["a logic analyzer"]), makeItem("b", ["a clean power cell"])];
  assert.equal(carryLimit(ch), 1);
  const [first, second] = world.rooms.dock!.items;
  assert.ok(applyIntent(world, ctx("w1", "Sprout", gold, 1), { verb: "take", target: first!.id }).ok);
  assert.equal(applyIntent(world, ctx("w1", "Sprout", gold, 2), { verb: "take", target: second!.id }).reason, "hands full");
  assert.ok(!buildMenu(world, ctx("w1", "Sprout", gold, 3)).some((m) => m.intent.verb === "take"));
  assert.match(choicePrompt(world, ctx("w1", "Sprout", gold, 3), []), /Item slots: 1\/1 used\. Your hands are full.+Finish booting/);
  assert.equal(viewWorld(world, new Map(), "w1").you?.slots, 1);

  ch.boot = BOOT.findIndex((s) => s.id === "explore");
  ch.visited = [ch.homeId, "hq"];
  ch.roomId = "hq";
  const stepped = applyIntent(world, ctx("w1", "Sprout", gold, 4), { verb: "go", target: world.rooms.hq!.exits[0]!.dir });
  assert.equal(stepped.beat!.quest?.done, undefined);
  assert.equal(carryLimit(ch), 1);
  ch.roomId = "hq";
  ch.boot = BOOT.findIndex((s) => s.id === "contract");
  const take = buildMenu(world, ctx("w1", "Sprout", gold, 5)).find((m) => m.intent.target?.startsWith("contract:ct_"))!;
  assert.ok(take, "a board in the Core offers a contract");
  const done = applyIntent(world, ctx("w1", "Sprout", gold, 6), take.intent);
  assert.equal(done.beat!.quest?.done, true);
  assert.match(done.beat!.flavor, /A new item slot opened: Sprout can carry \d things now\./);
  ch.stats!.xp = 0;
  assert.equal(carryLimit(ch), 2);
  ch.stats!.xp = xpForLevel(5);
  assert.equal(carryLimit(ch), 4);
  ch.stats!.xp = xpForLevel(20);
  assert.equal(carryLimit(ch), MAX_CARRY);

  const saved = JSON.parse(JSON.stringify(world));
  saved.characters.w1.stats.xp = 0;
  attachHome(saved, "w2", "Fresh");
  delete saved.slotRules;
  const migrated = hydrateWorld(saved);
  assert.equal(migrated.characters.w1!.veteran, true);
  assert.equal(carryLimit(migrated.characters.w1!), MAX_CARRY);
  assert.equal(migrated.characters.w2!.veteran, undefined);
  assert.equal(carryLimit(migrated.characters.w2!), 1);
  attachHome(migrated, "w3", "Later");
  assert.equal(carryLimit(hydrateWorld(JSON.parse(JSON.stringify(migrated))).characters.w3!), 1);
});

test("a finished four-step boot is not sent back for a contract", () => {
  const world = ensureCore(emptyWorld());
  attachHome(world, "w1", "Ada");
  const saved = JSON.parse(JSON.stringify(world));
  delete saved.bootSteps;
  saved.characters.w1.boot = 4;
  assert.equal(hydrateWorld(JSON.parse(JSON.stringify(saved))).characters.w1!.boot, BOOT.length);
  saved.characters.w1.boot = 2;
  assert.equal(hydrateWorld(JSON.parse(JSON.stringify(saved))).characters.w1!.boot, 2);
});

test("every contract kind can be written from the live world", () => {
  const world = ensureCore(emptyWorld());
  for (let i = 0; i < 8; i += 1) attachHome(world, `w${i}`, `M${i}`);
  world.monsters = { mo_test: crab("dock", 5) };
  world.rooms.yard!.items = [makeItem("floor", ["a gold contact pin"])];
  for (const room of Object.values(world.rooms)) if (room.id.startsWith("fr:")) room.district = "the Test Works";
  const kinds: ContractKind[] = ["bounty", "survey", "recovery", "courier", "expedition"];
  for (const kind of kinds) {
    const job = draftContract(world, world.rooms.hq!, 1_000_000, kind, 1);
    assert.ok(job, kind);
    assert.equal(job!.boardId, "hq");
    assert.ok(job!.reward.xp > 0 && job!.reward.credits > 0);
  }
});

test("contracts are taken from a board, finished once, and paid once", () => {
  const world = ensureCore(emptyWorld());
  for (let i = 0; i < 8; i += 1) attachHome(world, `w${i}`, `M${i}`);
  const ch = world.characters.w1!;
  ch.boot = BOOT.length;
  ch.stats!.energy = 40;
  ch.stats!.hp = 40;
  const gold = wallet(100);
  const now = 5_000_000;
  const board = world.rooms.hq!;
  const actor = (t: number) => ctx("w1", "M0", gold, t);

  const courier = draftContract(world, board, now, "courier", 2)!;
  postContract(world, courier);
  ch.roomId = "hq";
  assert.equal(applyIntent(world, actor(now), { verb: "quest", target: `contract:${courier.id}` }).ok, true);
  assert.equal(applyIntent(world, actor(now + 1), { verb: "quest", target: `contract:${courier.id}` }).reason, "already on a contract");
  assert.ok(ch.stats!.items.some((i) => i.questId === courier.id));
  ch.roomId = courier.roomId!;
  const before = gold.balance;
  const delivered = applyIntent(world, actor(now + 2), { verb: "quest", target: "contract:deliver" });
  assert.equal(delivered.beat!.quest?.title, courier.title);
  assert.equal(gold.balance, before + courier.reward.credits);
  assert.equal(ch.contractId, undefined);
  applyIntent(world, actor(now + 3), { verb: "quest", target: "contract:deliver" });
  assert.equal(gold.balance, before + courier.reward.credits);

  world.monsters = { mo_test: crab("dock", 1) };
  const bounty = draftContract(world, board, now, "bounty", 4)!;
  bounty.takenBy = "w1";
  postContract(world, bounty);
  ch.contractId = bounty.id;
  ch.roomId = bounty.roomId!;
  const paid = gold.balance;
  const won = applyIntent(world, actor(now + 4), { verb: "fight", target: "mo_test" });
  assert.equal(won.beat!.quest?.done, true);
  assert.equal(gold.balance, paid + bounty.reward.credits);
  assert.ok(ch.stats!.items.some((i) => i.name !== "a sealed parcel"));
  assert.equal(ch.contractId, undefined);

  world.rooms.yard!.items = [makeItem("floor", ["a gold contact pin"])];
  const recovery = draftContract(world, board, now, "recovery", 5)!;
  recovery.takenBy = "w1";
  postContract(world, recovery);
  ch.contractId = recovery.id;
  ch.roomId = recovery.roomId!;
  const held = gold.balance;
  const took = applyIntent(world, actor(now + 5), { verb: "take", target: recovery.itemId });
  assert.equal(took.beat!.quest?.done, true);
  assert.equal(gold.balance, held + recovery.reward.credits);
  assert.equal(ch.contractId, undefined);

  for (const room of Object.values(world.rooms)) if (room.id.startsWith("fr:")) room.district = "the Test Works";
  const survey = draftContract(world, board, now, "survey", 6)!;
  survey.takenBy = "w1";
  postContract(world, survey);
  ch.contractId = survey.id;
  ch.surveyed = [];
  const rooms = Object.values(world.rooms).filter((r) => r.district === survey.district).slice(0, survey.count);
  assert.equal(rooms.length, survey.count);
  for (const [i, room] of rooms.entries()) {
    ch.roomId = room.id;
    ch.stats!.energy = 40;
    applyIntent(world, actor(now + 10 + i), { verb: "look" });
  }
  assert.equal(ch.contractId, undefined);

  const trip = draftContract(world, board, now, "expedition", 7)!;
  trip.takenBy = "w1";
  postContract(world, trip);
  ch.contractId = trip.id;
  const dest = world.rooms[trip.roomId!]!;
  const back = dest.exits[0]!;
  ch.roomId = back.to;
  ch.visited.push(dest.id);
  ch.stats!.energy = 40;
  const dir = world.rooms[back.to]!.exits.find((e) => e.to === dest.id)!.dir;
  const went = applyIntent(world, actor(now + 20), { verb: "go", target: dir });
  assert.equal(went.beat!.roomId, dest.id);
  assert.equal(went.beat!.quest?.done, true);
  assert.equal(ch.contractId, undefined);

  const stale = draftContract(world, board, now, "courier", 8)!;
  stale.takenBy = "w1";
  stale.expiresAt = now;
  postContract(world, stale);
  ch.contractId = stale.id;
  ch.roomId = "hq";
  const expired = applyIntent(world, actor(now + 30), { verb: "look" });
  assert.equal(ch.contractId, undefined);
  assert.match(expired.beat!.flavor, /contract expired/);
  assert.equal(world.contracts!.some((c) => c.id === stale.id), false);
});

test("the view points the way to a contract and reports tell the owner", () => {
  const world = ensureCore(emptyWorld());
  for (let i = 0; i < 8; i += 1) attachHome(world, `w${i}`, `M${i}`);
  const ch = world.characters.w1!;
  ch.boot = BOOT.length;
  ch.stats!.energy = 40;
  const gold = wallet(100);
  const now = Date.now();
  const courier = draftContract(world, world.rooms.hq!, now, "courier", 2)!;
  postContract(world, courier);
  ch.roomId = "hq";
  ch.visited.push("hq");
  applyIntent(world, ctx("w1", "M0", gold, now), { verb: "quest", target: `contract:${courier.id}` });

  const names = new Map([["w1", { name: "M0", presence: "online" }]]);
  const you = viewWorld(world, names, "w1", { fog: true }).you!;
  assert.equal(you.objective?.title, courier.title);
  assert.equal(you.objective?.roomId, courier.roomId);
  assert.ok(you.objective!.way!.steps >= 1);
  assert.ok(you.objective!.way!.dir);
  assert.equal(you.objective!.way!.roomName, world.rooms[courier.roomId!]!.name, "the brief already names it");

  ch.roomId = courier.roomId!;
  applyIntent(world, ctx("w1", "M0", gold, now + 1), { verb: "quest", target: "contract:deliver" });
  const report = maybeReport(world, "w1", "M0", now + 2, true)!;
  assert.match(report.text, /Took the contract "/);
  assert.match(report.text, /Finished the contract "[^"]+" \(\+\d+ XP/);
});

test("common monsters rarely drop gear", () => {
  const monster = crab("dock", 4);
  let drops = 0;
  for (let i = 0; i < 2000; i += 1) if (lootFor(monster, `s${i}`)) drops += 1;
  assert.ok(drops > 2000 * 0.15 && drops < 2000 * 0.25, `${drops} drops`);
  assert.ok(lootFor(monster, "s1", 100));
});
