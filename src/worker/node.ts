import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import os from "node:os";
import { createInterface } from "node:readline/promises";
import { ensureOllama, ensureModel } from "./bootstrap.js";
import { runAgent } from "./agent.js";
import { startFaceServer } from "./face/server.js";
import { startInboxView } from "./inboxView.js";
import { startStatusView } from "./statusView.js";
import { recommendedModel } from "../shared/models.js";
import type { MachineAvatar } from "../shared/types.js";

// Entry point for the packaged Autopia app. It self-configures:
// finds/installs Ollama, pulls the model, then joins the network.

interface NodeConfig {
  coordinatorUrl?: string;
  /**
   * Candidate coordinator addresses in preference order (e.g. LAN first,
   * public tunnel second). The first one that responds wins, so a single
   * build works both inside and outside the operator's network.
   */
  coordinatorUrls?: string[];
  model?: string;
  /** Friendly name shown on the dashboard instead of the Mac's hostname. */
  workerName?: string;
  /** This machine's voice in the network chatter feed. */
  personality?: string;
  /** Machine-level instruction set, prepended to every job this machine runs. */
  instructions?: string;
  /** This machine's figure, kept here so it survives a new key or a renamed host. */
  avatar?: MachineAvatar;
  /** Access key (baked in for private builds; public builds prompt instead). */
  networkKey?: string;
}

function readConfigFile(path: string): NodeConfig | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as NodeConfig;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[creatures inc.] ${path} is not valid JSON (${message})`);
    console.error("[creatures inc.] ignoring it — you can enter the access code in the window instead");
    return null;
  }
}

function loadConfig(): NodeConfig {
  const candidates = [
    process.env.SPHERE_CONFIG,
    join(dirname(process.execPath), "config.json"),
    join(process.cwd(), "config.json"),
  ].filter((p): p is string => Boolean(p));
  let config: NodeConfig = {};
  for (const path of candidates) {
    const parsed = readConfigFile(path);
    if (parsed) {
      config = parsed;
      break;
    }
  }
  // A properly signed app bundle is sealed: editing the config.json inside
  // it makes macOS refuse to launch the app as "damaged". Per-machine tweaks
  // (workerName, personality, instructions) therefore live outside the
  // bundle and override the baked-in defaults.
  const override = readConfigFile(join(os.homedir(), ".sphere", "config.json"));
  return override ? { ...config, ...override } : config;
}

// Public builds ship without a key; the code the user enters on first launch
// is saved here so they are never asked again (survives app updates too).
const SAVED_KEY_FILE = join(os.homedir(), ".sphere", "network-key");

function loadSavedKey(): string | undefined {
  try {
    return readFileSync(SAVED_KEY_FILE, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

function saveKey(key: string): void {
  mkdirSync(dirname(SAVED_KEY_FILE), { recursive: true });
  writeFileSync(SAVED_KEY_FILE, `${key}\n`, { mode: 0o600 });
}

type AuthStatus = "ok" | "unauthorized" | "unreachable";

async function checkAuth(url: string, key: string | undefined): Promise<AuthStatus> {
  try {
    const res = await fetch(`${url}/api/status`, {
      headers: key ? { "x-sphere-key": key } : {},
      signal: AbortSignal.timeout(5000),
    });
    return res.status === 401 ? "unauthorized" : "ok";
  } catch {
    return "unreachable";
  }
}

/**
 * Make sure we hold a key the coordinator accepts. Only prompts when the
 * coordinator explicitly rejects us — open networks never ask for anything.
 */
async function ensureNetworkKey(url: string, key: string | undefined): Promise<string | undefined> {
  if ((await checkAuth(url, key)) !== "unauthorized") return key;

  console.log("");
  console.log("  This network requires an access code.");
  console.log("  Ask the network operator for one, then enter it below.");
  console.log("");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const code = (await rl.question("  access code: ")).trim();
      if (!code) continue;
      const auth = await checkAuth(url, code);
      if (auth === "ok") {
        saveKey(code);
        console.log("  ✓ code accepted — saved, you won't be asked again");
        return code;
      }
      console.log(
        auth === "unauthorized"
          ? "  ✗ that code was not accepted, try again"
          : "  ✗ could not reach the network to verify, try again",
      );
    }
  } finally {
    rl.close();
  }
}

/** Any HTTP response (even 401) proves the coordinator is reachable there. */
async function isReachable(url: string, timeoutMs = 3000): Promise<boolean> {
  try {
    await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch {
    return false;
  }
}

async function pickCoordinator(candidates: string[]): Promise<string> {
  for (const url of candidates) {
    process.stdout.write(`  trying ${url} ... `);
    if (await isReachable(url)) {
      console.log("reachable");
      return url;
    }
    console.log("no answer");
  }
  // Nothing answered right now; fall back to the first candidate and let the
  // agent's retry loop keep knocking until the coordinator shows up.
  return candidates[0] ?? "http://localhost:4100";
}

const config = loadConfig();
const candidates = process.env.SPHERE_COORDINATOR
  ? [process.env.SPHERE_COORDINATOR]
  : (config.coordinatorUrls?.length
      ? config.coordinatorUrls
      : [config.coordinatorUrl ?? "http://localhost:4100"]);
// No configured model: pick a tier from RAM (4B on 8 GB, 8B on 16 GB+).
const model = config.model?.trim() || recommendedModel(Math.round(os.totalmem() / 1024 ** 3));
const ollamaUrl = "http://localhost:11434";
const useConsole = process.env.SPHERE_CONSOLE === "1";
const useTui = process.env.SPHERE_TUI === "1";
const usePlain = process.env.SPHERE_PLAIN === "1";

if (useConsole) {
  const coordinatorUrl = await pickCoordinator(candidates);
  const networkKey = process.env.SPHERE_KEY || config.networkKey || loadSavedKey();
  const auth = await checkAuth(coordinatorUrl, networkKey);
  if (auth === "unauthorized") {
    console.error("enter an access code in the Autopia window first, then press T again.");
    process.exit(1);
  }
  const workerName =
    process.env.WORKER_NAME || config.workerName || os.hostname().replace(/\.local$/, "");
  startInboxView({ coordinatorUrl, networkKey, workerName });
  await new Promise(() => {});
}

const appPid = Number(process.env.SPHERE_APP_PID);
if (Number.isInteger(appPid) && appPid > 1) {
  // If the app dies without a clean quit, caffeinate and this worker outlive it and keep the face
  // port, so the next copy of the app would show this (possibly older) worker's face.
  setInterval(() => {
    try {
      process.kill(appPid, 0);
    } catch {
      process.exit(0);
    }
  }, 5_000).unref();
}

const face = !useTui && !usePlain ? await startFaceServer({
  openWindow: process.env.SPHERE_FACE_EMBEDDED !== "1",
  port: Number(process.env.SPHERE_FACE_PORT ?? 4101),
}).catch((err: unknown) => {
  console.error("[creatures inc.] face window failed:", err);
  return undefined;
}) : undefined;

face?.setStatus("finding the network");
console.log("");
console.log("  autopia");
console.log(`  model: ${model}`);
const coordinatorUrl = await pickCoordinator(candidates);
console.log(`  coordinator: ${coordinatorUrl}`);
console.log("");

try {
  face?.setVerifier(async (key) => {
    const auth = await checkAuth(coordinatorUrl, key);
    if (auth === "ok") return { ok: true };
    return { ok: false, error: auth === "unauthorized" ? "not accepted" : "network unreachable" };
  });

  let networkKey = process.env.SPHERE_KEY || config.networkKey || loadSavedKey();
  const auth = await checkAuth(coordinatorUrl, networkKey);
  if (auth === "unauthorized") {
    if (face) {
      face.setPhase("key");
      face.setStatus("access code required");
      networkKey = await face.waitForKey();
      saveKey(networkKey);
    } else {
      networkKey = await ensureNetworkKey(coordinatorUrl, networkKey);
    }
  }

  face?.setPhase("boot");
  await ensureOllama(ollamaUrl, face ? (msg) => face.setStatus(msg) : undefined);
  await ensureModel(ollamaUrl, model, face ? (msg) => face.setStatus(msg) : undefined);
  const workerName =
    process.env.WORKER_NAME || config.workerName || os.hostname().replace(/\.local$/, "");
  const hooks = useTui
    ? startStatusView({ coordinatorUrl, networkKey, workerName, model })
    : face?.hooks;
  face?.setPhase("ready");
  face?.setStatus("");
  // No local description: the coordinator hands out one of its own and the face saves it.
  const personality = process.env.WORKER_PERSONALITY || config.personality || undefined;
  face?.setIdentity(
    workerName,
    personality,
    process.env.WORKER_INSTRUCTIONS || config.instructions || "",
  );
  face?.setModel(model);
  face?.setInboxSource(coordinatorUrl, networkKey);
  await runAgent({
    coordinatorUrl,
    ollamaUrl,
    workerName,
    personality,
    instructions: process.env.WORKER_INSTRUCTIONS || config.instructions || undefined,
    avatar: config.avatar,
    networkKey,
    hooks,
  });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n[creatures inc.] setup failed: ${message}`);
  console.error("[creatures inc.] fix the issue above and reopen the app.");
  face?.setError(message);
  await new Promise(() => {});
}
