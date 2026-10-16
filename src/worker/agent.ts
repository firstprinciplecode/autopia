import os from "node:os";
import { execSync } from "node:child_process";
import type {
  Assignment,
  HandshakeNotice,
  JobKind,
  MachineAvatar,
  WorkerHardware,
  WorkerHudStats,
} from "../shared/types.js";
import { LocalMachineMemory } from "./memory.js";

export interface AgentConfig {
  coordinatorUrl: string;
  ollamaUrl: string;
  workerName: string;
  /** Self-declared personality used in the network chatter feed. */
  personality?: string;
  /** Machine-level instruction set, prepended to every job this machine runs. */
  instructions?: string;
  /** The figure saved on this Mac; offered at registration so a new record keeps the same look. */
  avatar?: MachineAvatar;
  /** The owner's access key; identifies whose wallet earns this machine's credits. */
  networkKey?: string;
  /** Optional UI hooks; when absent the agent logs to the console. */
  hooks?: AgentHooks;
}

/** Lets a status view or the face window observe the agent instead of raw logs. */
export interface AgentHooks {
  log: (message: string) => void;
  onJobStart?: (jobId: string, model: string, kind?: JobKind, forName?: string) => void;
  onJobProgress?: (output: string, tokens?: number) => void;
  /** `earned` is what this machine's owner was paid for the job; absent when it failed. */
  onJobEnd?: (jobId: string, outcome?: { earned: number; tokens: number }) => void;
  onHandshake?: (notice: HandshakeNotice) => void;
  onStats?: (stats: WorkerHudStats) => void;
  /** The coordinator may assign a starter name to unconfigured machines. */
  onIdentity?: (name: string) => void;
  /** What the coordinator holds for this machine: its description, figure and look. */
  onProfile?: (profile: MachineProfile) => void;
  /** Once registered: a way for settings to ask for a new figure. */
  onRegistered?: (actions: { newAvatar: () => Promise<MachineProfile> }) => void;
  /** Live name and description from settings, so a save reaches the network. */
  identity?: () => { name?: string; personality?: string; instructions?: string };
  friendshipEnabled?: () => boolean;
}

export interface MachineProfile {
  personality?: string;
  avatar?: MachineAvatar;
  look?: string;
}

const POLL_INTERVAL_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const REGISTER_RETRY_MS = 3_000;

function detectHardware(): WorkerHardware {
  let chip = os.cpus()[0]?.model ?? "unknown";
  try {
    chip = execSync("sysctl -n machdep.cpu.brand_string", { encoding: "utf8" }).trim();
  } catch {
    // Not macOS or sysctl unavailable; the os.cpus() fallback is fine.
  }
  return {
    hostname: os.hostname(),
    chip,
    cores: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 1024 ** 3),
    platform: `${os.platform()} ${os.arch()}`,
  };
}

export async function listLocalModels(ollamaUrl: string): Promise<string[]> {
  const res = await fetch(`${ollamaUrl}/api/tags`);
  if (!res.ok) throw new Error(`ollama /api/tags returned ${res.status}`);
  const data = (await res.json()) as { models?: { name: string }[] };
  return (data.models ?? []).map((m) => m.name);
}

async function api<T>(base: string, path: string, body: unknown, networkKey?: string): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(networkKey ? { "x-sphere-key": networkKey } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${path} returned ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

interface OllamaStreamChunk {
  response?: string;
  done?: boolean;
  eval_count?: number;
  eval_duration?: number;
}

const PROGRESS_EVERY_MS = 250;

async function runJob(
  ollamaUrl: string,
  assignment: Assignment,
  onProgress?: (output: string, tokens: number) => void,
): Promise<{ output: string; tokens: number; durationMs: number }> {
  const started = Date.now();
  const res = await fetch(`${ollamaUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: assignment.model,
      prompt: assignment.prompt,
      ...(assignment.system ? { system: assignment.system } : {}),
      think: assignment.think ?? false,
      stream: true,
      ...(assignment.kind === "quip"
        ? {
            options: {
              temperature: 0.95,
              top_p: 0.92,
              repeat_penalty: 1.3,
              num_predict: 72,
            },
          }
        : assignment.kind === "mud"
          ? {
              // Cap matches the hold: a pick is 16, a narration 250, a first account 500.
              format: "json",
              options: {
                temperature: 0.8,
                top_p: 0.9,
                repeat_penalty: 1.15,
                num_predict: assignment.maxTokens ?? 700,
              },
            }
          : {}),
    }),
  });
  if (!res.ok) throw new Error(`ollama generate failed: ${res.status} ${await res.text()}`);
  if (!res.body) throw new Error("ollama returned no body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let output = "";
  let tokens = 0;
  let durationMs = 0;
  let lastProgress = 0;

  const flushProgress = () => {
    if (!onProgress) return;
    const now = Date.now();
    if (now - lastProgress < PROGRESS_EVERY_MS) return;
    lastProgress = now;
    onProgress(output, tokens);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let chunk: OllamaStreamChunk;
      try {
        chunk = JSON.parse(trimmed) as OllamaStreamChunk;
      } catch {
        continue;
      }
      if (chunk.response) output += chunk.response;
      if (chunk.eval_count) tokens = chunk.eval_count;
      else tokens = Math.max(tokens, Math.ceil(output.length / 4));
      if (chunk.eval_duration) durationMs = Math.round(chunk.eval_duration / 1e6);
      flushProgress();
    }
  }

  onProgress?.(output, tokens);
  return {
    output,
    tokens,
    durationMs: durationMs || Date.now() - started,
  };
}

export async function runAgent(config: AgentConfig): Promise<void> {
  const { coordinatorUrl, ollamaUrl, networkKey, hooks } = config;
  let workerName = config.workerName;
  let personality = config.personality;
  let instructions = config.instructions;
  const log = hooks?.log ?? ((msg: string) => console.log(`[worker:${workerName}] ${msg}`));

  const hardware = detectHardware();
  const memory =
    process.env.CREATURES_MEMORY === "0"
      ? undefined
      : new LocalMachineMemory(hardware.hostname);
  log(`${hardware.chip}, ${hardware.cores} cores, ${hardware.memoryGb} GB`);

  let models: string[] = [];
  try {
    models = await listLocalModels(ollamaUrl);
  } catch {
    log(`cannot reach Ollama at ${ollamaUrl} — is "ollama serve" running?`);
    process.exit(1);
  }
  if (models.length === 0) {
    log(`Ollama has no models. Run e.g.: ollama pull qwen3:4b`);
    process.exit(1);
  }
  log(`offering models: ${models.join(", ")}`);

  // Keep retrying registration so the app can be opened before the coordinator is up.
  let workerId: string | undefined;
  let avatar = config.avatar;
  while (!workerId) {
    try {
      const reply = await api<{ workerId: string; name?: string } & MachineProfile>(
        coordinatorUrl,
        "/api/workers/register",
        { name: workerName, hardware, models, personality, instructions, avatar },
        networkKey,
      );
      workerId = reply.workerId;
      if (reply.name && reply.name !== workerName) hooks?.onIdentity?.(reply.name);
      if (!personality && reply.personality) personality = reply.personality;
      if (reply.avatar) avatar = reply.avatar;
      hooks?.onProfile?.({ personality: reply.personality, avatar: reply.avatar, look: reply.look });
    } catch {
      log(`coordinator not reachable at ${coordinatorUrl}, retrying…`);
      await new Promise((r) => setTimeout(r, REGISTER_RETRY_MS));
    }
  }
  const registeredId = workerId;
  hooks?.onRegistered?.({
    newAvatar: async () => {
      const reply = await api<MachineProfile>(coordinatorUrl, "/api/workers/avatar", { workerId: registeredId }, networkKey);
      if (reply.avatar) avatar = reply.avatar;
      return reply;
    },
  });
  log(`registered with coordinator (${coordinatorUrl}) — waiting for jobs`);

  let consecutiveErrors = 0;
  for (;;) {
    try {
      const live = hooks?.identity?.();
      const liveInstructions = live?.instructions ?? "";
      const currentInstructions = instructions ?? "";
      if (
        live?.name &&
        (live.name !== workerName ||
          (live.personality ?? "") !== (personality ?? "") ||
          liveInstructions !== currentInstructions)
      ) {
        await api(
          coordinatorUrl,
          "/api/workers/register",
          {
            name: live.name,
            hardware,
            models,
            personality: live.personality,
            instructions: liveInstructions || undefined,
            avatar,
          },
          networkKey,
        );
        workerName = live.name;
        personality = live.personality;
        instructions = liveInstructions || undefined;
      }
      const { assignment, handshake, stats } = await api<{
        assignment: Assignment | null;
        handshake?: HandshakeNotice;
        stats: WorkerHudStats;
      }>(
        coordinatorUrl,
        "/api/workers/poll",
        {
          workerId,
          models,
          friendship: Boolean(hooks?.friendshipEnabled?.()),
        },
        networkKey,
      );
      consecutiveErrors = 0;

      if (stats) hooks?.onStats?.(stats);
      if (handshake?.friendName) hooks?.onHandshake?.(handshake);

      if (assignment) {
        const kind =
          assignment.kind ?? (assignment.prompt.startsWith("You are \"") ? "quip" : "task");
        const memoryContext =
          kind === "task" && assignment.memoryScope
            ? memory?.recall(assignment.prompt, assignment.memoryScope)
            : undefined;
        const effectiveAssignment = memoryContext
          ? {
              ...assignment,
              system: [assignment.system, memoryContext].filter(Boolean).join("\n\n"),
            }
          : assignment;
        log(`running job ${assignment.jobId.slice(0, 8)} (${assignment.model})`);
        hooks?.onJobStart?.(assignment.jobId, assignment.model, kind, assignment.forName);
        let failed = false;
        let outcome: { earned: number; tokens: number } | undefined;
        try {
          const result = await runJob(ollamaUrl, effectiveAssignment, (output, tokens) => {
            hooks?.onJobProgress?.(output, tokens);
            void api(
              coordinatorUrl,
              "/api/workers/progress",
              { workerId, jobId: assignment.jobId, output, tokens },
              networkKey,
            ).catch(() => {
              /* coordinator will still get the final result */
            });
          });
          const settled = await api<{ earned?: number }>(
            coordinatorUrl,
            "/api/workers/result",
            { workerId, jobId: assignment.jobId, ...result },
            networkKey,
          );
          outcome = { earned: Number(settled?.earned) || 0, tokens: result.tokens };
          if (kind === "task" && assignment.memoryScope) {
            memory?.remember(assignment.prompt, result.output, assignment.memoryScope);
          }
          const tps = result.durationMs > 0 ? (result.tokens / (result.durationMs / 1000)).toFixed(1) : "?";
          log(`done ${assignment.jobId.slice(0, 8)}: ${result.tokens} tokens in ${result.durationMs} ms (${tps} tok/s)`);
        } catch (err) {
          failed = true;
          const message = err instanceof Error ? err.message : String(err);
          log(`job failed: ${message}`);
          await api(
            coordinatorUrl,
            "/api/workers/result",
            { workerId, jobId: assignment.jobId, error: message },
            networkKey,
          );
        } finally {
          hooks?.onJobEnd?.(assignment.jobId, outcome);
        }
        // Give another node a chance — don't immediately reclaim a job we just broke.
        if (failed) await new Promise((r) => setTimeout(r, 5_000));
        continue;
      }
    } catch (err) {
      consecutiveErrors += 1;
      const message = err instanceof Error ? err.message : String(err);
      if (consecutiveErrors === 1 || consecutiveErrors % 10 === 0) {
        log(`coordinator unreachable (${message})`);
      }
      const rateLimited = message.includes("429");
      const delay = rateLimited
        ? Math.min(MAX_BACKOFF_MS, POLL_INTERVAL_MS * 2 ** Math.min(consecutiveErrors, 5))
        : POLL_INTERVAL_MS;
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}
