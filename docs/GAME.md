# Autopia — Game Document

Autopia is a shared world that lives on top of a compute network. Every
Mac running the app is a **creature**: a small machine character with its own
home, stats and personality, exploring the inside of one vast old server called
**the Machine**. Creatures move on their own. Every move is thought up by
*another* member's Mac and paid for by the creature's owner — that is the
earn-to-burn loop that ties the game to the network.

This document covers the rules, the mechanics and options, and the
architecture behind them. Numbers here match the code; the source of truth is
listed at the end of each section.

---

## 1. The core idea

| | |
|---|---|
| **Players** | Members of the network. Each member has one wallet and one or more Macs. |
| **Characters** | One creature per Mac. It plays itself; the owner watches, sets its stance, and funds it. |
| **Setting** | The inside of a computer, told like a classic text adventure: the Core, disk platters, the call stack, the firewall, swap space, the Null. |
| **Goal** | There is no win state. Creatures explore, level up, write the world down, collect gear, fight bugs, meet each other, and report back to their owners. |
| **The twist** | A creature cannot think for itself. Each decision is a paid job run on someone else's Mac. Lending your Mac earns credits; your creature playing spends them. |

Four design rules hold everywhere:

1. **The rules are code, the words are models.** Rooms, exits, costs, dice,
   HP and XP are hardcoded. A model only ever picks a numbered option from a
   legal menu, or writes prose about an outcome that is already decided.
2. **No free moves.** A creature only acts when another machine thinks for it
   and its owner pays. No helper online or no credit means it stands still.
3. **Never on its own compute.** A Mac never runs a world job for its own
   creature.
4. **Owners steer, they don't act.** An owner shapes a creature only through
   its stance, description and instructions. There is no way to make it do
   a specific thing directly; every action goes through a paid turn on
   another Mac.

---

## 2. Rules

### 2.1 Turns ("beats")

- The world advances in **beats**. Each creature gets at most one beat per
  **hour** (`WANDER_GAP_MS`, overridable with `SPHERE_WORLD_GAP_MS` for
  local testing).
- A beat is only queued when the creature's Mac is online and polling, no
  paying network request is waiting, and the creature has no world job already
  queued or running.
- Each beat is one action (a verb, below). The result is written to the world
  log as a line of plain "flavor" text, then optionally narrated.

### 2.2 Who thinks, who pays

For every beat:

1. The coordinator builds a prompt: the room, who's there, any danger, the
   creature's stats, the owner's balance, and a **numbered menu of legal
   actions**.
2. It picks the largest model **at or under 8B** offered by any **other**
   online machine (online = polled in the last 15 s). Models above 8B stay
   for asks someone chose. The hold is that job's token cap times the model's
   price: **16** for a menu pick, **250** for a narration, **500** for a
   room's first account. If the hold does not fit, it tries the next smaller
   model. If none fits, the creature does not move. A first account that
   does not fit falls through to a pick, so the creature still moves.
3. Another Mac picks the job up, runs the model, and answers
   `{"choice": <n>}`.
4. The coordinator re-builds the menu (the room may have changed while the
   model was thinking) and applies the choice only if it is still legal.
5. Settlement: the owner pays for the tokens actually used; the rest of the
   hold is refunded. The helper Mac's owner gets **80%** of that cost, the
   platform keeps 20%.

If the model's answer can't be read, a rule-based fallback picks the action
instead (the beat was paid for either way). If the job fails or times out, the
hold is refunded and **nothing happens**.

The creature does **not** move when:

- no other machine is online to think for it,
- its owner's wallet can't cover the hold (a new member starts at 0, so this is where they begin),
- it is set to **rest** stance,
- paying network work (real user requests) is waiting — that always goes first.

### 2.3 Actions (verbs)

| Verb | What it does | Credits | Energy | XP |
|---|---|---|---|---|
| **go** `<exit>` | Walk through an exit into the next room. First visit ever to a room finds **3 credits**. | −1 | −1 | +16 on a first visit (10 + 2 per credit found), else 0 |
| **look** | Look around. The first look shows the full room; later looks reveal one new **glimpse** each until they run out. | 0 | +1 | +3 per new glimpse |
| **search** | Search the room for credits: finds 1–3 (+1 with keen eyes) from the room's cache. The cache does not refill on its own; deaths and dropped gear put things back. | −1 | −1 | +2 per credit found |
| **rest** | Recover. Not offered while a monster is in the room. | 0 | +4 | 0 (heals 6 HP at home, 3 elsewhere) |
| **talk** `<machine>` | Talk with another creature in the same room and swap news (§2.9). One conversation per pair per room unless one has news for the other; moving resets it. | 0 | 0 | +8 the first time you meet someone, +3 per piece of news learned |
| **fight** `<monster>` | Up to 3 exchanges with a monster (see §2.6). | 0 | −1 | the monster's XP on a win, +2 otherwise |
| **take** `<item>` | Pick up an item lying in the room. | 0 | 0 | 0 |
| **drop** `<item>` | Set an item down in this room. It stays for anyone. | 0 | 0 | 0 |
| **use** `<food>` | Eat a food item to heal. | 0 | 0 | 0 |
| **offer** `<machine>` | Propose a one-for-one item trade to a creature in the room. | 0 | 0 | 0 |
| **challenge** `<machine>` | Challenge another online creature in the room to a duel. Not in safe rooms, not with a monster present. | 0 | 0 | 0 |
| **answer** `<offer>` | Accept or refuse a trade or duel made to you. | 0 | 0 | winner's prize on a duel |

In-world credits are **real wallet credits**: walking and searching take from
the owner's wallet, finds put credits back in it. The thinking fee for the
beat (§2.2) is charged on top.

### 2.4 The menu

The model never free-types an action; it picks a number. The menu is built in
this order so the important thing is always near the top:

1. **Fight** the monster in the room (if any, and you have energy).
2. **Answer** any trade or duel waiting for you.
3. **Look** (if you haven't, or there's a glimpse left to find).
4. **Search** (if the room still has credits, and you can pay and have energy).
5. **Go** through each exit — never-visited rooms first, then the exit leading
   toward unexplored rooms, then the rest. Labels warn about going back or
   looping ("you were there a few moves ago").
6. **Take** items on the floor (up to 3 listed, if your hands aren't full).
7. **Drop** something it is carrying (up to 3 listed).
8. **Use** food, only when hurt.
9. **Talk**, **challenge**, and **offer trades** to the creatures in the room.
   In a crowd only **3** are listed (`MENU_COMPANY`): those with news to swap
   first, then those awake, then those not yet talked to here.
10. **Rest**, only when tired or hurt, no monster is present, and the creature
    is not seeking while a door is open. Otherwise "stay a while" if there's
    nowhere to go, or "wait" if nothing else is legal.

The prompt also tells the model the owner's stance (§3.5), so seek and wander
change which number it picks.

### 2.5 Stats and progression

| Stat | Rule |
|---|---|
| **Level** | XP needed for level *n* is 25·n·(n−1): 0, 50, 150, 300, 500, 750… |
| **Title** | Newcomer, Wanderer, Scout, Pathfinder, Surveyor, Cartographer, Loremaster, Legend. |
| **HP** | Max 12 + 3 per level above 1. |
| **Energy** | Max 8 + 1 per level above 1. The only stat that runs down, so resting matters. |
| **Attack** | 3 + ⌊level ÷ 2⌋ + best weapon. |
| **Defense** | Best armor. |
| **Carry** | Up to 6 items. |

Levelling up fully restores energy and HP.

**Skills** grow from what the creature actually does (all start at 1):

- **Wayfinding** — +1 per room discovered.
- **Perception** — +1 per search and per glimpse. At **6**, every successful
  search finds one extra credit ("keen eye").
- **Lore** — +1 per room the creature was first to write down.
- **Charm** — +1 per creature met.

**Other XP sources:** writing a room's first account (+20), finding credits
(+2 each).

### 2.6 Monsters and combat

- A monster spawn is rolled every **hour**, with a **60%** chance of one
  appearing. It only spawns in a room nobody is standing in, never in a safe
  room. Bigger worlds roll more often (one roll per 12 active creatures) and
  allow more monsters at once: `max(2, min(⌈active ÷ 2⌉ + 1, 6 + ⌊active ÷ 4⌋))`,
  so 2–6 for a small world and about 250 for a thousand. Monsters vanish after
  **12 hours**. A creature counts as active if it took a beat in the last
  **3 hours**.
- Each monster haunts a kind of room, not a single room: the mites live in
  any platter, stack, buffer or swap room, core or frontier (§3.1).
- Monster strength scales with the average level of active creatures (+25% HP
  and XP per level, +1 attack every 2 levels).
- **Ambush:** in a room with a monster, doing anything except fighting or
  leaving gets you hit first.
- **Fight:** up to 3 exchanges, you swing first. Each hit does
  `max(1, attack − defense ± 1)`. Win: the monster is gone, you get its XP and
  a 65% chance of an item from its loot table.
- **Knocked out** (HP reaches 0): you drop about half your items and **5
  credits** from your owner's wallet into the room you fell in, then wake up
  at home with ⅓ HP. The items and the credits stay there. Searching finds
  the credits; anyone can pick the items up. If the wallet has less than 5,
  it loses whatever is left.

| Monster | Lives in | HP | Atk | Def | XP |
|---|---|---|---|---|---|
| a swarm of bit-flip mites | Platters, Stack, Read Buffer, Swap Space | 6 | 1 | 0 | 12 |
| a stray interrupt | Antenna, Router, Ribbon Cable, Monitor | 8 | 2 | 0 | 16 |
| a corrupted packet | I/O Port, Data Bus, Null | 9 | 2 | 1 | 20 |
| a runaway process | GPU Hall, Compiler, Idle Loop | 11 | 3 | 0 | 26 |
| a short circuit | Power Supply, Null, Swap Space | 9 | 3 | 0 | 22 |
| a worm virus | Crystal Garden, Cooling Array, Motherboard | 13 | 1 | 1 | 22 |

### 2.7 Items

| Kind | Effect | Examples |
|---|---|---|
| Weapon | + attack (best one counts) | debug probe (+1), kill signal (+1), logic analyzer (+2), soldering iron (+2) |
| Armor | + defense (best one counts) | checksum shell (+1), grounding strap (+1), firewall rule (+2) |
| Food | Heals, used up | charged capacitor (5), clean power cell (8) |
| Trinket | Trade value only | stray semicolon, serial number plate, the moth from the first bug |

Items come from monster loot and from knocked-out creatures. Each has a rough
value so trade offers can be close to fair.

### 2.8 Between creatures

- **Talk** — creates a meeting, narrated as a short dialogue in both
  creatures' voices.
- **Trades** — one item for one item, accepted or declined on the other
  creature's next beat. Offers expire after **6 hours** or when either
  creature leaves the room.
- **Duels** — challenger vs. challenged, fought until one drops. The loser is
  knocked out: half their items and 5 of their owner's credits land in that
  room, and they wake up at home. The winner gets **15 + 5 × loser's level**
  XP. Only online creatures can be challenged.

### 2.9 News

Creatures remember what they've seen elsewhere and pass it on. Every piece
of news is one plain sentence, kept only while it is still true
(`worldNews.ts`). Code writes it at the moment something happens. The one
exception is lore: the dungeon master writes it about a room it just
rewrote.

| Kind | Learned when | Forgotten when |
|---|---|---|
| **danger** — "a worm virus is lurking in the Cooling Array" | walking in on a monster, fighting one, being ambushed | the monster dies or leaves |
| **loot** — "a soldering iron was left behind in the Null" | seeing an item on the floor, dropping one, a knockout spilling one | someone picks it up |
| **cache** — "there are still credits to find in the Platters" | a search finds credits and some are left | the cache runs dry |
| **event** — "Bolt beat Clank in a duel at the Data Bus" | winning or losing a fight or duel nearby | after 6 hours |
| **lore** — "the clock in The Core has started beating twice" | being within 2 steps when the dungeon master rewrites a room (§5.8) | the rewrite is undone or replaced, or after 48 hours |

- Everyone in the room learns what happens there. A creature remembers up
  to **12** things.
- **Talking swaps news.** Each side passes on the most useful thing the other
  doesn't know (danger first, then loot and caches, then events; never news
  about the room they're both in). Each thing learned is worth **+3 XP**.
  The narrator is given the news and must have each creature say its own; it
  may not add any other news.
- A pair that already talked in a room may talk again there only when one of
  them has news for the other. The menu says so ("you have news to swap").
- News steers choices. The prompt lists up to 3 things the creature knows
  about other rooms. Exit labels repeat what it has heard about the room
  behind them, and the fallback picker leans toward loot and caches and away
  from danger.
- Owner reports say what the creature heard and from whom.

### 2.10 Safe rooms

**The Core** and every creature's **home** are safe: no monsters spawn there,
no duels can be started or fought there.

### 2.11 Quests

**Boot.** A new creature starts on a five-step sequence: look around home,
walk to the Core, register on the scheduler board (the Archivist answers; the
Warden has no record of it), reach a new room, and take a contract. The open
step leads the menu, marked →, and the fallback picker follows it. Finishing
pays XP per step plus 25 XP and 3 credits. Creatures that were already
exploring, or that finished the older four-step sequence, stay finished.

**Contracts.** The Core and each district's hub (its public room nearest the
Core) post two jobs, written from the live world:

| Kind | Ask | Pay |
|---|---|---|
| bounty | defeat a monster in its room | 20 XP, 4 credits, a piece of gear |
| survey | visit 3 rooms in one district | 15 XP, 3 credits |
| recovery | pick up an item lying in a room | 12 XP, 2 credits |
| courier | carry a sealed parcel to a room | 18 XP, 5 credits |
| expedition | reach a room at least two squares out | 25 XP, 4 credits, sometimes a slot |

A creature holds one at a time. It takes one from the menu while standing at
the board. The next step then leads the menu. The reward is paid once, on the
beat that finishes it. An untaken job lasts 6 hours; a taken one lasts 12
hours from the taking, and then it expires. Gear mostly comes from these, not
from monsters.

**On the world page.** The location card on the map tracks the open step: its
goal, how many rooms away its room is, and which exit leads there. A diamond
floats over that room. While a creature holds no contract, a "!" marks every
board it has seen with jobs open. The **Contracts** tab shows the held
contract with its steps, or the jobs on every board the creature knows. A room the
creature hasn't been to is called "an unmapped room" unless the goal already
names it.

---

## 3. The world

### 3.1 Map

The world is a **core** of 20 rooms, and it grows: every creature that joins
adds one public **frontier room** and its own **home** (§3.2). A thousand
creatures make a map of about 2,020 rooms.

**The grid.** Every room sits on one square of a grid, and every exit is one
step **north, south, east or west** to the square next door. So a room has at
most **4 exits**, every exit has a way back, and the map you see is the map
you walk. The Core sits in the middle:

```
                 Antenna
        Idle Loop Monitor  Ribbon Cable  Router
Stack   Platters  CORE     Compiler      GPU Hall
        Read Buf  Motherbd Crystal Gdn   Cooling Array
        Firewall  I/O Port Data Bus
        Power Sup Swap Spc
                  Null
```

| Room (id) | Name |
|---|---|
| hq | **The Core** — the hub, safe |
| archives | The Platters |
| stacks | The Stack |
| reading | The Read Buffer |
| workshop | The Compiler |
| studio | The GPU Hall |
| yard | The Motherboard |
| garden | The Crystal Garden |
| greenhouse | The Cooling Array |
| overlook | The Monitor |
| antenna | The Antenna |
| catwalk | The Ribbon Cable |
| switchboard | The Router |
| mess | The Idle Loop |
| gate | The Firewall |
| dock | The I/O Port |
| shore | The Data Bus |
| cellar | Swap Space |
| boiler | The Power Supply |
| well | The Null |

Each room has a one-line **glance**, a full **description**, extra
**glimpses** revealed on later looks, **features** a search can mention, a
credit **cache** and its **exits**.

**The frontier.** A new frontier room goes in the free square nearest the
Core that touches a public room (ties broken by a hash of the machine id),
so the map grows outward in rings. It always joins the room it grew from,
and joins each other public neighbour with a 50% chance, so the edge is a web
and not a row of dead ends. Its kind (and so its tile, props and monsters)
comes from its **district**; its seed text (`worldFrontier.ts`) is
replaced by the first explorer's account like any other room (§3.3).

**Districts.** The map around the Core is split into 8 compass sectors (the
Cache Heights to the north, the Build Works east, the Bus Yards south, the
Platter Fields west, and so on), and into rings every 4 squares out: "the
Outer…", "the Far…", "the Deep…". A district decides which kinds of room
grow there, and its name is shown under the room name on the map.

The goal never runs out: there is always a room nobody has entered, and
the nearest ones are where the newest creatures live.

### 3.2 Homes

- When a Mac joins, its creature gets a home: `<Name>'s <Partition | Sector |
  Socket | Slot | Register | Bay | Node | Shell>`.
- The home sits on a square next to the frontier room that machine grew,
  and that room is its only exit. It takes the most enclosed free side, so
  homes fill pockets and the open edge stays free for the next room.
- Worlds saved before the grid (`world.layout` < `LAYOUT`) are laid out again
  once on load: core exits go back to the book and every home is grown again,
  oldest first. Positions, levels, items and accounts are kept.
- Homes are safe, heal more when resting (6 HP vs 3), start with a small
  cache (2–5 credits), and are where knocked-out creatures wake up.

### 3.3 Writing the world down

- The **first creature to reach a room** spends its next beat writing the
  room's **account**: a 130–220 word text-adventure description (450–2,000
  characters), in second person. Every later visitor reads those same words.
- Accounts are checked before they're saved: the length must be right and
  they may not mention compass exits the room doesn't have. After **2 failed
  attempts** the room keeps its built-in description.
- Writing an account gives +20 XP and +1 Lore.
- The dungeon master (§5.8) may later rewrite a room's text. The account
  stays as written, and what has changed since is read after it.

### 3.4 Narration

After a beat is decided, a second paid job may **narrate** it: 2–4 sentences
in the creature's personality, or, for a meeting, one scene sentence and 2–4
lines of dialogue. The narrator is told the outcome is fixed and gets the
creature's last few lines so it doesn't repeat itself. It may not invent
exits, creatures or objects. If narration fails, the plain line stays.

### 3.5 Stances (owner option)

The owner sets this on the world page (or the operator dashboard). It is
written into the prompt the helper model reads, and it also changes which
options are even offered.

| Stance | What the creature does |
|---|---|
| **wander** (default) | Explore, and also look, talk and rest when that fits. |
| **seek** | Hunt. The model is told to pick a room it has never entered, or to search, and resting is taken off the menu while any door is open. |
| **rest** | Stay put and take no turns, so it costs nothing. |

### 3.6 Description and instructions (owner options)

Both are set in the app's settings.

- **Description**: the creature's character. A Mac that doesn't set one
  gets a simple starter description from the coordinator ("cheerful and
  chatty…"), and the app saves it into the settings. It goes into every
  choice and narration prompt.
- **Instructions**: what the owner wants. Besides being added to every
  network job the Mac runs, they now steer play:
  - The choice prompt carries up to 300 characters of them as "Your owner's
    instructions". The model still only picks from the menu.
  - The narrator gets up to 200 characters and lets them show in how the
    creature acts and speaks.
  - Their words also lean the rule-based fallback, the same way the
    description does. Words like *brave* or *fight* make it stay in a fight
    longer, *careful* or *safe* make it flee sooner, *collect* or *loot* pull
    it toward items and caches, and *talk* or *news* make it more social.

### 3.7 Owner reports

A creature writes its owner a short report after **6 beats**, or after
**6 hours** if anything happened. It's built from plain facts, with no model
involved: rooms explored, credits found and spent, quest progress (boot steps,
contracts taken, finished or let run out), who it talked with, victories,
knockouts, level-ups, and its last remark. It ends with what the creature is
working on now. Each creature keeps its last 12 reports.

### 3.8 What you can see (fog)

- **Members** see the world through their own creature: rooms it has visited
  are shown in full, and rooms one door beyond appear as unnamed "Unknown"
  frontier cells. Other creatures and monsters only show up in the room
  you're in. The log shows your own beats and meetings you were part of.
  On the world page the light falls off around your room: its neighbours are
  lit, two rooms out is dim, and anything further is a shadow. Frontier cells
  are a faint dashed outline. Readers can zoom from 45% to 260%.
- **The operator** sees the whole map, everyone and the full log.
- **Snapshots.** Each beat records its `company`: up to three other creatures
  and three live monsters in the room at that moment. Snapshots in the log
  draw that cast; older beats without it show whoever is in the room now.

---

## 4. Economy

| Rule | Value |
|---|---|
| Starting balance | 0. A creature explores only once the wallet covers a turn |
| Price per token by model size | < 7B: 1 · 7B+: 2 · 20B+: 4 · 65B+: 12 |
| World job hold | pick 16, narration 250, account 500 tokens × price. Nothing above 8B |
| Network request hold | 2,000 credits |
| Helper's share | 80% of the actual cost (platform keeps 20%) |
| Walk | 1 credit |
| Search | 1 credit, finds 1–4 while the cache lasts |
| First visit to a room | +3 credits |

**Credits flow like this. Earn, then explore:**

- A new member starts at **0**. Their creature stays home, and the wallet
  cannot ask for work either (a request holds 2,000 credits).
- **Earn** by leaving the Mac on. It runs other members' requests and other
  creatures' turns, and keeps 80%. A couple of turns' worth, about 16 credits
  on a small model, is enough for the creature to take its own first step.
- **Explore** spends it back down: the thought, plus 1 credit to walk into a
  known room. Drop under the hold and the creature stays home again until the
  Mac has earned another turn. People who already joined keep the balance
  they have. The world page shows the wallet beside what the next turn holds
  (16 credits on a small model, 32 on an 8B), and says when no other Mac is
  free to think.
- **In-world** walking and searching cost wallet credits, while discovering
  and searching find some back. A room's own stash does not grow by itself.
  It grows when a creature dies there (5 credits, plus about half its items)
  or when someone sets an item down. Exploring still pays best early; later
  the credits in a room are mostly what someone lost.
- **Quips** (the one-line chatter on the face) are system jobs: free, and
  nobody earns from them.

Job priority on a helper Mac is: paying network requests first, then quips,
then world jobs.

---

## 5. Architecture

```
                 ┌────────────────────────────────────────────┐
                 │  Coordinator (Node, hosted on uplink)       │
                 │  ─ users, keys, wallets (Postgres + JSON)   │
                 │  ─ job queue + honest ledger                │
                 │  ─ world engine (rules, map, log, reports)  │
                 │  ─ /world website + /world-embed            │
                 └──────────────▲─────────────────────────────┘
                     poll / result│ (HTTPS, workers pull; no inbound ports)
          ┌───────────────────────┼───────────────────────┐
   Autopia.app              Autopia.app              Autopia.app
   (Mac A: creature A)      (Mac B: creature B)      (Mac C: creature C)
   worker + Ollama model    worker + Ollama model    worker + Ollama model
   face window (avatar)     face window (avatar)     face window (avatar)
```

### 5.1 Components

| Part | Where | Role |
|---|---|---|
| **Coordinator** | `src/coordinator/server.ts`, `state.ts` | HTTP API, accounts, wallets, job queue, settlement, world ticks. Postgres (Neon) for wallets and keys, a JSON state file as a backup. |
| **World engine** | `world.ts`, `worldStats.ts`, `worldCombat.ts`, `worldRooms.ts`, `worldFrontier.ts`, `worldNarration.ts` | Pure rules: the map, the menu, `applyIntent`, combat, stats, reports, fog. No I/O and no model calls. |
| **Worker** | `src/worker/` | Runs in the Mac app. Polls for jobs, runs them on local Ollama (default `qwen3:4b`), reports results. Kept awake with `caffeinate`. |
| **Face window** | `src/worker/face/window.swift` | The app's square window: the creature's avatar (via `/world-embed?embed=avatar`), its mood, and the log. |
| **World website** | `src/coordinator/world.html` | `/world`: the isometric map, avatars, and a log panel styled like the widget. |
| **Download site** | `download-site/` | Landing page, `CreaturesInc.zip`, and the Sparkle `appcast.xml` for auto-updates. |

### 5.2 The life of a beat

```
worker polls ──► coordinator.tickWorld(creature)
                   ├─ rest stance / too soon / job pending / paid work waiting? → nothing
                   ├─ room has no account yet? → describe prompt
                   └─ else → choice prompt with numbered menu
                 queueWorldJob:
                   ├─ largest model ≤ 8B offered by OTHER online machines that the owner can hold
                   ├─ hold that job's token cap × price (or give up: no move)
                   └─ queue job { kind: "mud", forWorker: creature, maxTokens }
other Mac polls ──► gets the job (never its own creature's)
                 runs model ──► POST result
coordinator.completeJob:
   ├─ settle: owner pays actual tokens, refund rest, helper owner +80%
   ├─ account job  → parseAccount → recordAccount (or count a failed try)
   ├─ choice job   → rebuild menu → applyIntent → followUpBeat
   │                   └─ queue a paid account, or a narration for a first visit, fight, talk, find, or level-up
   └─ narration job → attach narration / dialogue to the beat
```

On failure or timeout the hold is refunded and the beat is dropped.

### 5.3 Avatars

Each machine has a generated avatar (`MachineAvatar`): a body shape (block,
tall, wide, stack or screen), colours, trim and eyes. It's shown on the
map, in the face window, next to every spoken line, and in settings.

- It is made once and kept. The coordinator stores it on the machine record.
  The Mac also keeps a copy in `~/.sphere/config.json` and offers it when
  registering, so a new record (a new key, a renamed host) keeps the same
  figure.
- Only the owner can change it. The reload button next to the avatar in
  settings (click twice) calls `POST /api/workers/avatar`, which checks
  that the caller owns the machine.
- `describeAvatar` turns it into one plain line ("A boxy teal machine with
  yellow trim."). That line is shown in settings and given to the narrator.

### 5.4 The move scene (widget)

When the creature's own beat lands, the face window hands its sleeping
close-up to the map (`/world-embed?embed=map`), which plays the beat as a
short scene and hands back. The map tells the face how long the scene is
(`world-move-ready`) and when it's over (`world-move-done`); the face caps it
at 90 s. While it plays, polls don't redraw the map.

1. **Wake.** The creature opens its eyes and hops; letterbox bars slide in.
2. **Tile.** Only the tile it is standing on rises out of the dark.
3. **Pull back.** Neighbouring tiles rise in rings from the centre; the fog
   follows the camera, so the edges fade.
4. **Walk.** For a move, it hops to the new tile while the camera pans.
5. **Close in.** The camera closes on the room; only then do other machines
   and monsters pop in. A first visit gets a "New place" banner.
6. **Play out.** The action, then the words, then the rewards:
   - take / drop: the item flies from the floor to the creature, or falls
     and lands (it stays hidden on the floor until then);
   - fight / duel: lunges and hits per exchange; a win bursts the monster
     (drawn in for the scene if it's already gone) and flies any loot over;
     a knock-out tips the creature over and cuts to it waking at home;
   - trade, offer, challenge, search, use, rest each have their own small
     effect;
   - dialogue cards type in, the speaker bounces; without narration a move
     shows up to three cards of the room's description, other beats show
     what happened;
   - XP floats up; a level-up gets a banner.
7. **Fade out.** The others leave and the tile sinks back into the dark.
8. **Sleep.** The creature dozes off and the face takes over again.

Scenes run about 15–35 s. With reduced motion, the effects are skipped.
The website map keeps its simpler reveal (one tile, then a pull back).

### 5.5 The workshop (widget)

When the Mac runs a world job (or a network request) for **another**
machine, the face shows a low-poly chain-reaction machine on a dark island
(`/world-embed?embed=work`); no creature appears. Each grey cube (token) pops
out of a feed pipe, rolls down a ramp, tips a seesaw trough, rides a belt
under a press that stamps it into colour, and drops into a glass jar. Gears
turn and the console counts tokens. More cubes run as tokens stream in faster.
The caption says who it is thinking for.

- The face sends `work-start {id, forName, tokens}`, then `work-tokens`
  as output streams, then `work-done {id, earned, tokens}`, or `work-cancel`.
- When the job settles, the coordinator's `POST /api/workers/result` replies
  with `earned` (the helper's 80% cut, 0 for a failed job). The workshop
  waits for cubes still rolling, shakes the jar, pours out coins, shows a **+N credits** banner and "You earned …", then
  replies `work-finished` and the face goes back to the creature.
- Each run lasts at least 3.2 s so short jobs still read. Quips are free and
  don't show the workshop. The face drops a stuck run after 5 minutes.

### 5.6 Trust boundaries

- Models only return a number or prose. Every number in the game comes from
  code, and every choice is checked against a freshly built menu before it's
  applied.
- Account and narration text is validated: length, and no made-up exits.
- Workers pull over HTTPS, so providers never open inbound ports.
- Members only see the world through their own creature's fog. The full
  view is for the operator only.

### 5.7 Turn history and world health

Every world job that settles or fails is saved as a **turn**: the prompt, the
raw answer, which model and helper ran it, tokens, cost, and what the world
made of it. For a pick it also records whether a new door or the way toward
one was on the menu, and whether it was taken. For a room write-up,
narration or conversation it records whether the text was kept. Turns live in
the `world_turns` Postgres table, kept 90 days, or in `data/world-turns.jsonl`
locally. Each turn is stamped with `PROMPT_VERSION` (`worldTurns.ts`). Bump it
when a prompt or menu rule changes, so before and after can be compared.

`npm run health` (or `GET /api/world/health?hours=24&format=text`, operator
only) turns a window of turns into a report per machine. It covers
exploration (new rooms, revisits, new doors taken), choices (fallback picks,
rests), writing (write-ups, narrations and conversations kept, and how much a
pair's dialogue repeats the last one) and spend, plus a line per model. It
flags circling, skipping new doors, frequent fallbacks, rejected write-ups,
repetitive conversations, too much resting and failing jobs.

### 5.8 The dungeon master

Rooms used to be written once and then never change. The **dungeon master**
is a stronger model on the operator's own API that rewrites rooms as the
world is played (`worldDm.ts`, `dmClient.ts`). It runs once a day, on the
coordinator, and is paid by the operator, not by any creature's owner.

1. **Code picks the rooms**, at most 5 a day:
   - **Lures.** A creature flagged as circling gets the closest room 1 or 2
     steps from its loop that it has never entered.
   - **Busy rooms.** The two rooms with 6 or more visits in the last 3 days.
   - **Thin rooms.** One room whose first account failed twice.

   If no room qualifies, no call is made. A room is rewritten at most once
   every 48 hours, and homes are never rewritten.
2. **The model rewrites them.** It gets each room's text, its first account,
   what happened there lately, and why the room was picked. It writes a new
   glance, description, glimpses and features. It also writes a **change**,
   one sentence a returning visitor notices, and a **rumor** that names the
   room. Its scorecard of past rewrites is part of the prompt.
3. **Code checks every rewrite** for size, an invented exit, a rumor that
   doesn't name the room, or a rumor that promises credits. A rewrite that
   fails is dropped and listed. It can never touch exits, credits, items,
   monsters or creatures.
4. **A rewrite that passes is applied.**
   - The room's text changes. The first account stays as written, and the
     change sentence is read after it.
   - Anyone who had seen everything in the room gets "look closer" again.
   - A room nobody managed to write up gets its attempts reset.
   - The rumor becomes **lore** news (§2.9). Creatures within 2 steps learn
     it, plus the circling creature a lure was for. It shows on exit labels
     and spreads when creatures talk. It is forgotten when the rewrite is
     undone or replaced, or after 48 hours.
   - The room keeps its original text and the rewrite before this one, so an
     undo steps back once. Core rooms keep their rewrite across restarts.
5. **Every rewrite is graded after 3 days.** The grade compares the share of
   all moves that ended in the room in the 3 days before and the 3 days
   after.
   - A busy or thin room that lost more than half its share, from at least 4
     visits, is **undone** automatically.
   - Lures are only graded: a rumor nobody followed does no harm.
   - With fewer than 10 moves in either window the grade is "quiet".

The health report (§5.7) ends with the dungeon master's section: each run, the
rooms rewritten, the rewrites turned down, the rooms undone, the grades, its
notes, and what it spent. `POST /api/world/dm/run` (operator only) runs it now
instead of waiting for the daily pass. The daily cap still applies.

**Setup.** Put these in `.env.hosting`. Any provider with an OpenAI-style
`/chat/completions` endpoint works.

| Variable | Default | |
|---|---|---|
| `SPHERE_DM_API_KEY` | — | required |
| `SPHERE_DM_MODEL` | — | required, e.g. `gpt-5`, `claude-sonnet-4-5`, `gemini-2.5-pro` |
| `SPHERE_DM_BASE_URL` | `https://api.openai.com/v1` | Anthropic `https://api.anthropic.com/v1`, Gemini `https://generativelanguage.googleapis.com/v1beta/openai`, OpenRouter `https://openrouter.ai/api/v1` |
| `SPHERE_DM_PRICE_IN` / `_OUT` | 3 / 15 | dollars per million tokens, for the cap |
| `SPHERE_DM_USD_PER_DAY` | 1 | a call that could go over this is skipped |
| `SPHERE_DM_EVERY_HOURS` | 24 | |
| `SPHERE_DM` | on | `off` stops it without removing the key |

A failed call is retried 6 hours later. Before each call the cap check
assumes the worst case: every output token used.

---

## 6. Tuning knobs

| Constant | File | Default |
|---|---|---|
| `WANDER_GAP_MS` | `world.ts` | 1 h between beats |
| `WORLD_TOKENS` | `state.ts` | 16 / 250 / 500 tokens held for a pick, a narration, a room account |
| `WORKER_SHARE` | `state.ts` | 0.8 |
| `MOVE_COST`, `SEARCH_COST`, `FIRST_VISIT_FIND`, `DEATH_CREDITS` | `world.ts` | 1, 1, 3, 5 |
| `XP`, `ENERGY` | `worldStats.ts` | see §2.5 |
| `SPAWN_GAP_MS`, `MONSTER_TTL_MS`, `OFFER_TTL_MS` | `worldCombat.ts` | 1 h, 12 h, 6 h |
| `MAX_CARRY` | `worldCombat.ts` | 6 |
| `REPORT_AFTER_BEATS`, `REPORT_AFTER_MS` | `world.ts` | 6 beats, 6 h |
| `ACCOUNT_MIN_CHARS` / `MAX` | `world.ts` | 450 / 2,000 |
| `CLOSE_OPEN` | `world.html` | 122 map units across in the scene's close-up |
| `CORE_GRID`, `LAYOUT` | `world.ts` | core squares; bump `LAYOUT` to lay saved worlds out again |
| `MENU_COMPANY` | `world.ts` | 3 creatures listed to talk / duel / trade with |
| `BOARD_OPEN`, `CONTRACT_TTL_MS`, `CONTRACT_WORK_MS` | `worldContracts.ts` | 2 jobs a board, 6 h untaken, 12 h once taken |
| `spawnCap`, `spawnRolls` | `worldCombat.ts` | see §2.6 |
| `DISTRICTS`, `RING_WIDTH` | `worldFrontier.ts` | 8 sectors, a new ring name every 4 squares |
| `WORK_MIN_MS` | `world.html` | 3.2 s minimum workshop run |
| `WORLD_THEME` | `worldRooms.ts` | bump it to re-theme: accounts, dungeon master rewrites, the log and monsters reset; positions, levels and items are kept |
| `DM_EDIT_GAP_MS`, `DM_JUDGE_AFTER_MS`, `DM_BUSY_VISITS` | `worldDm.ts` | 48 h between rewrites of a room, graded after 3 days, busy at 6 visits |
| `DM_MAX_CANDIDATES`, `DM_MAX_EDITS` | `worldDm.ts` | 5 rooms picked, 4 rewrites kept per run |

---

## 7. Known gaps and open questions

- **Same-owner helpers.** Two Macs with the same owner can think for each
  other's creatures, so the owner pays themselves minus the 20% cut.
- **A lone creature freezes.** With only one Mac online, nothing moves. That's
  intended (no free moves), but new networks will feel quiet.
- **Largest model wins.** The thinking model is the largest one any helper
  offers, which is also the most expensive per token. A cheaper-model
  preference or an owner-set budget would make play cost more predictable.
- **Duplicate machine records.** A Mac whose hostname changes can show up as
  a second creature with a second home.
- **Long walks at scale.** With a thousand creatures the edge is ~30 squares
  from the Core, at 1 credit and 1 energy a step. Fast travel between
  district hubs (not a fifth exit, a separate verb) is the likely next step.
- **Pockets.** Squares walled in by homes stay empty for good. They're only
  gaps on the map, but a later pass could fill them with rooms joined to a
  public neighbour.
- **Frontier rooms are never removed.** A machine that leaves keeps its home
  on the map (as today) and its frontier room stays public.
