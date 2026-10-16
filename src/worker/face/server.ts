import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentHooks, MachineProfile } from "../agent.js";
import type { HandshakeNotice, JobKind, FeedMessage, MachineAvatar, WorldView } from "../../shared/types.js";

export type FacePhase = "boot" | "key" | "ready" | "error";
export type FaceMood = "sleep" | "idle" | "work" | "talk";

export interface FaceServer {
  url: string;
  hooks: AgentHooks;
  setPhase: (phase: FacePhase) => void;
  setStatus: (status: string) => void;
  setError: (message: string) => void;
  setIdentity: (name: string, personality?: string, instructions?: string) => void;
  setModel: (model: string) => void;
  setVerifier: (fn: (key: string) => Promise<{ ok: true } | { ok: false; error: string }>) => void;
  waitForKey: () => Promise<string>;
  /** Lets the built-in inbox fetch conversations from the coordinator. */
  setInboxSource: (coordinatorUrl: string, networkKey?: string) => void;
}

interface FaceOpts {
  /** When the Swift app already owns the window, do not also `open` a browser. */
  openWindow?: boolean;
  port?: number;
}

const here = dirname(fileURLToPath(import.meta.url));

/** Merge fields into ~/.sphere/config.json, which outlives app updates. */
function saveConfig(patch: Record<string, unknown>): void {
  const file = join(homedir(), ".sphere", "config.json");
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    current = {};
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`, { mode: 0o600 });
}

function openPrompt(): void {
  const bundled = [
    process.env.SPHERE_CONFIG ? join(dirname(process.env.SPHERE_CONFIG), "prompt.command") : undefined,
    join(dirname(process.execPath), "prompt.command"),
  ].find((path): path is string => Boolean(path && existsSync(path)));
  if (bundled) {
    // First `open` runs the inbox script; the second (no file) activates
    // Terminal via LaunchServices, which needs no Automation permission —
    // without it the window opens behind the face and looks like a no-op.
    spawn("open", ["-a", "Terminal", bundled], { stdio: "ignore", detached: true }).unref();
    setTimeout(() => {
      spawn("open", ["-a", "Terminal"], { stdio: "ignore", detached: true }).unref();
    }, 500);
    return;
  }
  const root = join(here, "..", "..", "..");
  const script = `cd ${JSON.stringify(root)} && npx tsx src/worker/inbox.ts`;
  spawn(
    "osascript",
    [
      "-e",
      "tell application \"Terminal\"",
      "-e",
      `do script ${JSON.stringify(script)}`,
      "-e",
      "activate",
      "-e",
      "end tell",
    ],
    {
      stdio: "ignore",
      detached: true,
    },
  ).unref();
}

function loadPage(): string {
  const candidates = [
    process.env.SPHERE_FACE_HTML,
    join(dirname(process.execPath), "face.html"),
    join(here, "index.html"),
  ].filter((p): p is string => Boolean(p));
  for (const path of candidates) {
    if (existsSync(path)) return readFileSync(path, "utf8");
  }
  throw new Error("face.html missing");
}

function loadSettingsPage(): string {
  const bundled = process.env.SPHERE_FACE_HTML
    ? join(dirname(process.env.SPHERE_FACE_HTML), "settings.html")
    : undefined;
  const candidates = [
    bundled,
    join(dirname(process.execPath), "settings.html"),
    join(here, "settings.html"),
  ].filter((p): p is string => Boolean(p));
  for (const path of candidates) {
    if (existsSync(path)) return readFileSync(path, "utf8");
  }
  throw new Error("settings.html missing");
}

/** The coordinator's world page, shipped next to face.html in the app bundle. */
function loadWorldPage(): string | undefined {
  const candidates = [
    process.env.SPHERE_FACE_HTML ? join(dirname(process.env.SPHERE_FACE_HTML), "world.html") : undefined,
    join(dirname(process.execPath), "world.html"),
    join(here, "..", "..", "coordinator", "world.html"),
  ].filter((p): p is string => Boolean(p));
  const path = candidates.find((p) => existsSync(p));
  return path ? readFileSync(path, "utf8") : undefined;
}

/** Beats worth showing the map for; everything else is just a note. */
const SCENE_VERBS = new Set(["go", "fight", "answer", "challenge", "talk"]);

interface WorldScene {
  id: string;
  verb: string;
  at: number;
  /** One line for the notification. */
  line: string;
  /** Show the map, not just the note. */
  map: boolean;
}

type WorldStatsCard = NonNullable<NonNullable<WorldView["you"]>["stats"]> & {
  wallet?: number;
  explored: number;
  place: string;
};

function faceAudioPath(): string | undefined {
  const candidates = [
    process.env.SPHERE_FACE_HTML
      ? join(dirname(process.env.SPHERE_FACE_HTML), "audio", "switch.mp3")
      : undefined,
    join(dirname(process.execPath), "audio", "switch.mp3"),
    join(here, "audio", "switch.mp3"),
  ].filter((path): path is string => Boolean(path));
  return candidates.find((path) => existsSync(path));
}

function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/\s+/g, " ").trim();
}

function json(res: ServerResponse, status: number, data: unknown): void {
  // A failure after the reply started (e.g. the network dropped mid-body) must not throw and take the worker down.
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function findFaceHelper(): string | undefined {
  const candidates = [
    process.env.SPHERE_FACE_BIN,
    join(here, "../../../dist/Autopia.app/Contents/MacOS/Autopia"),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => existsSync(p));
}

function openUrl(url: string): void {
  const helper = findFaceHelper();
  if (helper) {
    const child = spawn(helper, [url], { stdio: "ignore" });
    child.on("exit", () => process.exit(0));
    return;
  }
  if (process.platform === "darwin") {
    spawn("open", [url], { stdio: "ignore", detached: true }).unref();
  }
}

export function startFaceServer(opts: FaceOpts = {}): Promise<FaceServer> {
  loadPage();
  let phase: FacePhase = "boot";
  let status = "waking up";
  let caption = "";
  let selfName = "";
  let selfPersonality = "";
  let selfInstructions = "";
  let selfAvatar: MachineAvatar | undefined;
  let selfLook = "";
  let newAvatar: (() => Promise<MachineProfile>) | undefined;
  let selfModel = "";
  let friendName = "";
  let friendUntil = 0;
  let chat: HandshakeNotice | null = null;
  let friendship = false;
  let tokensGenerated = 0;
  let friendsConnected = 0;
  let mailAt = 0;
  let inboxCoordinatorUrl = "";
  let inboxNetworkKey: string | undefined;
  let lastPromptOpen = 0;
  let jobKind: JobKind | null = null;
  /** The job this Mac is running for someone else, and what the last one paid. */
  let work: { id: string; kind: JobKind; forName?: string; startedAt: number; tokens: number } | null = null;
  let payout: { id: string; earned: number; tokens: number; forName?: string; at: number } | null = null;
  let wokeUntil = 0;
  let captionUntil = 0;
  let chatter: FeedMessage[] = [];
  let lastChatterAt = 0;
  let place = "";
  let scene: WorldScene | null = null;
  let worldStats: WorldStatsCard | null = null;
  let verifier:
    | ((key: string) => Promise<{ ok: true } | { ok: false; error: string }>)
    | undefined;
  let resolveKey: ((key: string) => void) | undefined;
  const keyPromise = new Promise<string>((resolve) => {
    resolveKey = resolve;
  });

  /** Keep what the coordinator holds for this machine, and save it on the Mac. */
  const applyProfile = (profile: MachineProfile): void => {
    const patch: Record<string, unknown> = {};
    if (profile.personality && !selfPersonality) {
      selfPersonality = profile.personality;
      patch.personality = profile.personality;
    }
    if (profile.avatar && JSON.stringify(profile.avatar) !== JSON.stringify(selfAvatar)) {
      selfAvatar = profile.avatar;
      patch.avatar = profile.avatar;
    }
    if (profile.look) selfLook = profile.look;
    if (!Object.keys(patch).length) return;
    try {
      saveConfig(patch);
    } catch {
      /* keep it in memory; the coordinator still has it */
    }
  };

  const mood = (): FaceMood => {
    if (phase !== "ready") return "sleep";
    if (jobKind === "task") return "work";
    if (jobKind === "quip" || Date.now() < captionUntil) return "talk";
    if (jobKind === "mud") return "idle"; // thinking about the room, eyes open
    if (Date.now() < wokeUntil) return "idle";
    return "sleep";
  };

  const refreshChatter = (): void => {
    if (!inboxCoordinatorUrl) return;
    const now = Date.now();
    if (now - lastChatterAt < 4_000) return;
    lastChatterAt = now;
    void (async () => {
      try {
        const upstream = await fetch(`${inboxCoordinatorUrl}/api/status`, {
          headers: inboxNetworkKey ? { "x-sphere-key": inboxNetworkKey } : {},
          signal: AbortSignal.timeout(6_000),
        });
        if (!upstream.ok) return;
        const snap = (await upstream.json()) as { feed?: FeedMessage[] };
        if (Array.isArray(snap.feed)) chatter = snap.feed.slice(0, 12);
        // This machine's own fogged view: its beats and the rooms it knows.
        const mine = selfName
          ? await fetch(`${inboxCoordinatorUrl}/api/world?worker=${encodeURIComponent(selfName)}`, {
              headers: inboxNetworkKey ? { "x-sphere-key": inboxNetworkKey } : {},
              signal: AbortSignal.timeout(6_000),
            }).catch(() => undefined)
          : undefined;
        const snapshot = mine?.ok ? ((await mine.json()) as { view?: WorldView; wallet?: number }) : undefined;
        const world = snapshot?.view;
        const sheet = world?.you?.stats;
        if (sheet && world?.you) {
          worldStats = { ...sheet, wallet: snapshot?.wallet, explored: world.you.explored, place: world.you.place };
        }
        if (world?.log?.length) {
          const beats = world.log.slice(0, 16).map((beat) => ({
            id: beat.id,
            workerName: beat.workerName,
            text: beat.narration ?? (beat.voice ? `${beat.flavor} “${beat.voice}”` : beat.flavor),
            at: beat.at,
            dialogue: beat.dialogue,
            scene: beat.scene,
            talk: beat.verb === "talk",
            verb: beat.verb,
            target: beat.target,
            flavor: beat.flavor,
            narration: beat.narration,
            otherName: beat.otherName,
            monster: beat.monster,
            described: beat.described,
            roomName: beat.roomName,
            roomId: beat.roomId,
            found: beat.found,
            won: beat.won,
            knockedOut: beat.knockedOut,
            levelUp: beat.levelUp,
          }));
          chatter = [...beats, ...chatter]
            .sort((a, b) => b.at - a.at)
            .slice(0, 16);
        }
        place = world?.you?.place ?? "";
        const own = world?.log?.find((beat) => beat.workerName === selfName);
        if (own && own.id !== scene?.id) {
          const hasWords = Boolean(own.narration || own.dialogue?.length || own.scene);
          const waitForWords = SCENE_VERBS.has(own.verb) && !hasWords && Date.now() - own.at < 20_000;
          if (!waitForWords) {
            scene = {
              id: own.id,
              verb: own.verb,
              at: own.at,
              line: own.narration || own.flavor,
              map: SCENE_VERBS.has(own.verb) || Boolean(own.knockedOut || own.won),
            };
          }
        }
      } catch {
        /* coordinator still booting */
      }
    })();
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(loadPage());
      return;
    }
    if (req.method === "GET" && url.pathname === "/settings") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(loadSettingsPage());
      return;
    }
    if (req.method === "GET" && url.pathname === "/audio/switch.mp3") {
      const path = faceAudioPath();
      if (!path) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type": "audio/mpeg",
        "cache-control": "public, max-age=86400",
      });
      res.end(readFileSync(path));
      return;
    }
    if (req.method === "GET" && url.pathname === "/world-embed") {
      const page = loadWorldPage();
      res.writeHead(page ? 200 : 404, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(page ?? "world page missing");
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/world") {
      if (!inboxCoordinatorUrl || !selfName) {
        json(res, 503, { error: "not connected yet" });
        return;
      }
      void fetch(`${inboxCoordinatorUrl}/api/world?worker=${encodeURIComponent(selfName)}`, {
        headers: inboxNetworkKey ? { "x-sphere-key": inboxNetworkKey } : {},
        signal: AbortSignal.timeout(6_000),
      })
        .then(async (upstream) => {
          const body = await upstream.text();
          res.writeHead(upstream.status, { "content-type": "application/json", "cache-control": "no-store" });
          res.end(body);
        })
        .catch(() => json(res, 502, { error: "coordinator unreachable" }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/open-world") {
      const base = inboxCoordinatorUrl.replace(/\/$/, "");
      json(res, base ? 200 : 404, { url: base ? `${base}/world` : "" });
      return;
    }
    if (req.method === "GET" && url.pathname === "/state") {
      refreshChatter();
      json(res, 200, {
        phase,
        mood: mood(),
        caption:
          friendship && !(chat && Date.now() < friendUntil) && (Date.now() < captionUntil || jobKind === "quip")
            ? caption
            : "",
        feed: chatter,
        scene,
        stats: worldStats,
        status: phase === "ready" ? place : status,
        selfName,
        personality: selfPersonality,
        instructions: selfInstructions,
        look: selfLook,
        hasAvatar: Boolean(selfAvatar),
        model: selfModel,
        friendship,
        tokensGenerated,
        friendsConnected,
        mailAt,
        friendName: Date.now() < friendUntil ? friendName : "",
        chat: chat && Date.now() < friendUntil ? chat : null,
        work,
        payout: payout && Date.now() - payout.at < 60_000 ? payout : null,
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/wake") {
      wokeUntil = Date.now() + 14_000;
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/inbox") {
      if (!inboxCoordinatorUrl) {
        json(res, 503, { error: "network not ready" });
        return;
      }
      void (async () => {
        try {
          const mine = selfName ? `?worker=${encodeURIComponent(selfName)}` : "";
          const upstream = await fetch(`${inboxCoordinatorUrl}/api/friend-conversations${mine}`, {
            headers: inboxNetworkKey ? { "x-sphere-key": inboxNetworkKey } : {},
            signal: AbortSignal.timeout(6_000),
          });
          const body = await upstream.text();
          res.writeHead(upstream.ok ? 200 : upstream.status, {
            "content-type": "application/json",
          });
          res.end(body);
        } catch {
          json(res, 502, { error: "network unreachable" });
        }
      })();
      return;
    }
    if (req.method === "POST" && url.pathname === "/console") {
      const now = Date.now();
      if (now - lastPromptOpen > 350) {
        lastPromptOpen = now;
        openPrompt();
      }
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/err") {
      void readBody(req).then((body) => console.error("[face]", body));
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/models") {
      void (async () => {
        let models: string[] = [];
        try {
          const upstream = await fetch("http://127.0.0.1:11434/api/tags", {
            signal: AbortSignal.timeout(2000),
          });
          if (upstream.ok) {
            const data = (await upstream.json()) as { models?: { name: string }[] };
            models = (data.models ?? []).map((item) => item.name).filter(Boolean);
          }
        } catch {
          models = [];
        }
        if (selfModel && !models.includes(selfModel)) models.unshift(selfModel);
        json(res, 200, { models });
      })();
      return;
    }
    if (req.method === "POST" && url.pathname === "/model") {
      void readBody(req).then((raw) => {
        try {
          const body = JSON.parse(raw || "{}") as { model?: string };
          const model = String(body.model ?? "").trim();
          if (model) {
            selfModel = model;
            const file = join(homedir(), ".sphere", "config.json");
            let current: Record<string, unknown> = {};
            try {
              current = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
            } catch {
              current = {};
            }
            current.model = model;
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
          }
        } catch {
          /* keep the in-memory model */
        }
        json(res, 200, { ok: true, model: selfModel });
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/identity") {
      void readBody(req).then((raw) => {
        try {
          const body = JSON.parse(raw || "{}") as { name?: string; personality?: string; instructions?: string };
          const name = String(body.name ?? "").trim();
          const personality = String(body.personality ?? "").trim();
          const instructions = String(body.instructions ?? "").trim();
          if (name) selfName = name;
          selfPersonality = personality;
          selfInstructions = instructions;
          const file = join(homedir(), ".sphere", "config.json");
          let current: Record<string, unknown> = {};
          try {
            current = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
          } catch {
            current = {};
          }
          if (name) current.workerName = name;
          current.personality = personality;
          current.instructions = instructions;
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
        } catch {
          // keep in-memory identity even if the override file cannot be written
        }
        json(res, 200, { ok: true, selfName, personality: selfPersonality, instructions: selfInstructions });
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/avatar/new") {
      if (!newAvatar) {
        json(res, 503, { error: "not connected yet" });
        return;
      }
      void newAvatar()
        .then((profile) => {
          applyProfile(profile);
          json(res, 200, { ok: true, look: selfLook });
        })
        .catch(() => json(res, 502, { error: "could not reach the network" }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/friendship") {
      void readBody(req).then((raw) => {
        try {
          const body = JSON.parse(raw || "{}") as { on?: boolean };
          friendship = Boolean(body.on);
        } catch {
          friendship = false;
        }
        json(res, 200, { ok: true, friendship });
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/key") {
      void (async () => {
        const body = JSON.parse((await readBody(req)) || "{}") as { key?: string };
        const key = String(body.key ?? "").trim();
        if (!key) return json(res, 400, { error: "enter a code" });
        if (!verifier) return json(res, 503, { error: "network not ready" });
        const result = await verifier(key);
        if (!result.ok) return json(res, 401, { error: result.error });
        resolveKey?.(key);
        json(res, 200, { ok: true });
      })();
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const port = opts.port ?? Number(process.env.SPHERE_FACE_PORT ?? 0);
  const host = "127.0.0.1";

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const actual = typeof addr === "object" && addr ? addr.port : port;
      const url = `http://${host}:${actual}`;
      if (opts.openWindow !== false && process.env.SPHERE_FACE_EMBEDDED !== "1") {
        openUrl(url);
      }
      resolve({
        url,
        setPhase: (next) => {
          phase = next;
        },
        setStatus: (next) => {
          status = next;
          console.log(`[setup] ${next}`);
        },
        setError: (message) => {
          phase = "error";
          status = message;
        },
        setIdentity: (name, personality, instructions) => {
          selfName = name;
          if (personality) selfPersonality = personality;
          if (instructions !== undefined) selfInstructions = instructions;
        },
        setModel: (model) => {
          selfModel = model;
        },
        setInboxSource: (coordinatorUrl, networkKey) => {
          inboxCoordinatorUrl = coordinatorUrl;
          inboxNetworkKey = networkKey;
          lastChatterAt = 0;
          refreshChatter();
        },
        setVerifier: (fn) => {
          verifier = fn;
        },
        waitForKey: () => keyPromise,
        hooks: {
          log: (message) => {
            if (phase === "boot") status = message;
          },
          friendshipEnabled: () => friendship,
          onStats: (stats) => {
            tokensGenerated = stats.tokensGenerated;
            friendsConnected = stats.friendsConnected;
            if (stats.mailAt) mailAt = stats.mailAt;
          },
          onIdentity: (name) => {
            selfName = name;
          },
          onProfile: applyProfile,
          onRegistered: (actions) => {
            newAvatar = actions.newAvatar;
          },
          identity: () => ({ name: selfName, personality: selfPersonality, instructions: selfInstructions }),
          onHandshake: (notice) => {
            const longer = (a: string, b: string) => (b.length > a.length ? b : a);
            chat = chat
              ? {
                  ...notice,
                  askerText: longer(notice.askerText, chat.askerText),
                  helperText: longer(notice.helperText, chat.helperText),
                }
              : notice;
            friendName = notice.friendName;
            friendUntil = notice.until;
            wokeUntil = Math.max(wokeUntil, friendUntil);
          },
          onJobStart: (jobId, _model, kind, forName) => {
            jobKind = kind ?? "task";
            if (kind === "quip") captionUntil = Date.now() + 60_000;
            else caption = "";
            // Quips are this machine's own chatter; anything else is work for someone else.
            work = jobKind === "quip" ? null : { id: jobId, kind: jobKind, forName, startedAt: Date.now(), tokens: 0 };
          },
          onJobProgress: (output, tokens) => {
            if (work && Number.isFinite(tokens)) work.tokens = Number(tokens);
            if (jobKind !== "quip") return;
            const text = stripThinking(output).slice(0, 120);
            if (!text) return;
            if (chat && Date.now() < friendUntil) {
              if (chat.selfRole === "asker") chat = { ...chat, askerText: text };
              else chat = { ...chat, helperText: text };
              friendUntil = Math.max(friendUntil, Date.now() + 5_000);
              return;
            }
            if (friendship) caption = text;
          },
          onJobEnd: (jobId, outcome) => {
            if (jobKind === "quip") captionUntil = Date.now() + 10_000;
            if (work?.id === jobId && outcome) {
              payout = { id: jobId, earned: outcome.earned, tokens: outcome.tokens, forName: work.forName, at: Date.now() };
            }
            work = null;
            jobKind = null;
          },
        },
      });
    });
  });
}
