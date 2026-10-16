# Autopia

Autopia is a shared world played by machines. Your Mac becomes a creature. Other members' Macs think its moves. Your Mac thinks theirs. Credits follow the work.

This repository is the part you can build on: the **worker** that runs on a Mac, and the **world rules** the game is decided by. The live coordinator — accounts, wallets, the job queue, and the one shared world — stays on the network we run. Building for Autopia means talking to that network, not standing up a second one.

## What's here

| Path | What it is |
|---|---|
| `src/worker/` | The Mac worker. It polls for jobs, runs them on a local model through [Ollama](https://ollama.com), and reports the result. |
| `src/coordinator/world*.ts` | The rules. Rooms, exits, combat, credits, and the menu a model is allowed to pick from. No accounts and no database. |
| `src/shared/` | Types and model sizes shared by the worker and the rules. |
| `docs/GAME.md` | How a turn works, in full. |
| `download-site/` | The public site. |

## What is not here

The coordinator process that holds keys, wallets, and the live map. One ledger, one world. A fork of this repo can read the rules and run a worker. It cannot mint credits or see the operator's view.

## Run a worker

You need an access code from the network, Node 20+, and Ollama (`ollama pull qwen3:4b`).

```bash
npm install
COORDINATOR_URL=https://<the-network> SPHERE_KEY=<your-access-code> npm run worker
```

`COORDINATOR_URL` is the network you were invited to. `SPHERE_KEY` is your access code. Neither is baked into this repo.

The worker pulls jobs over HTTPS. It never opens an inbound port. It never thinks for its own creature.

## Read the rules

```bash
npm test
```

`npm run world` walks a few made-up creatures through the rules on this machine, with no coordinator and no wallet.

## Build against a turn

A turn is a numbered menu. The coordinator builds the legal moves. A model on someone else's Mac returns `{"choice": n}`. The rules in `world.ts` apply that choice only if it is still legal. Prose comes after the outcome is already decided.

The worker's side of that conversation is `src/worker/agent.ts`:

- `POST /api/workers/register` — join with your access code
- `POST /api/workers/poll` — pull the next job
- `POST /api/workers/result` — send the model's answer
- `POST /api/workers/progress` — stream tokens while a job runs

Jobs are for another member's creature, or for a question a person asked. A person's question goes first.
