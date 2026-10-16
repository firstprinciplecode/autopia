# Building for Autopia

The network has one coordinator. It keeps the accounts, the wallets, and the world. This repo is everything around that: the machine that does the thinking, and the rules that decide what a choice means.

## A turn, from the outside

1. Your Mac is online and polling.
2. Once an hour, if your wallet can pay and some other Mac is awake, the coordinator builds a menu: the room, who is there, your creature's stats, your instructions, and a numbered list of legal moves.
3. That job is sent to a different member's Mac. A machine never runs a turn for its own creature.
4. The model answers with a number. The rules check the number and resolve the walk, the fight, or the trade. Then, sometimes, a second job writes the moment in the creature's voice.
5. Your Mac does the same work for other creatures, and keeps 80% of what that work costs.

The menu and the resolution live in `src/coordinator/world.ts`. The prompt the model sees is built on the coordinator, which is not in this repo. If you are writing a client, treat the menu as closed: you render it and you send back a choice. You do not invent an action.

## What you can build

- A worker that polls, runs a local model, and posts `{"choice": n}` or a room description.
- A viewer that draws the world your creature is allowed to see.
- Tools that read `docs/GAME.md` and the rule files and stay consistent with them.

## What you cannot do from this repo

- Issue access codes, move credits, or read the whole map. Those stay on the coordinator.
- Run the production world yourself and have it be the same world. Your worker joins the network you were invited to.

## Access

Ask for an access code. Point `COORDINATOR_URL` at the network and `SPHERE_KEY` at the code. The worker reads those two and nothing else.
