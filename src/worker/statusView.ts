import type { AgentHooks } from "./agent.js";
import type { Job, StatusSnapshot, WorldView } from "../shared/types.js";

// The node's built-in TUI: what a member sees when they open Autopia.
// Deliberately dependency-free (plain ANSI) so it survives `bun --compile`.
// It shows this machine's status, the owner's wallet, the fleet, the chatter
// feed, and an ask bar — the coordinator scopes /api/status so members only
// ever receive their own jobs and balance.

interface ViewOptions {
  coordinatorUrl: string;
  networkKey?: string;
  workerName: string;
  model: string;
}

interface MeInfo {
  label: string;
  role: string;
  balance: number;
}

const POLL_MS = 2_000;
const LOG_TAIL = 3;

const ESC = "\x1b";
const stripThinking = (text: string) =>
  text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
const stripMarkdown = (text: string) =>
  text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");

function wrap(text: string, width: number, maxLines: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    let line = raw;
    do {
      out.push(line.slice(0, width));
      line = line.slice(width);
    } while (line.length > 0 && out.length < maxLines);
    if (out.length >= maxLines) break;
  }
  return out.slice(0, maxLines);
}

export function startStatusView(opts: ViewOptions): AgentHooks {
  const { coordinatorUrl, networkKey, workerName, model } = opts;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(networkKey ? { "x-sphere-key": networkKey } : {}),
  };

  let snap: StatusSnapshot | null = null;
  let me: MeInfo | null = null;
  let unreachable = false;
  let busyJob: string | null = null;
  const logTail: string[] = [];
  let input = "";
  let answer: { prompt: string; text: string } | null = null;
  let sessionId: string | null = null;
  let world: WorldView | undefined;

  const dim = (s: string) => `${ESC}[2m${s}${ESC}[0m`;
  const bold = (s: string) => `${ESC}[1m${s}${ESC}[0m`;

  function render(): void {
    const width = Math.max(60, process.stdout.columns ?? 100);
    const lines: string[] = [];
    const push = (s = "") => lines.push(s.slice(0, width));

    push(bold(" autopia") + (unreachable ? dim("  ·  network unreachable, retrying…") : ""));
    if (me) {
      push(` you: ${me.label} · ${me.balance.toLocaleString()} credits`);
    }
    const mine = snap?.workers.find((w) => w.name === workerName);
    const working = Boolean(busyJob) || Boolean(mine?.busy);
    push(
      ` this machine: ${workerName} — ${working ? `working${busyJob ? ` on job ${busyJob.slice(0, 8)}` : ""}` : mine?.online === false ? "connecting…" : "idle, listening for jobs"}`,
    );
    if (world?.you) {
      const st = world.you.stats;
      const where = world.you.waiting === "earn" ? "earning, creature stays home" : "wandering";
      push(` ${where}: ${world.you.place} · lv ${st.level} ${st.title} · energy ${st.energy}/${st.maxEnergy}`);
    }
    if (snap) {
      const online = snap.workers.filter((w) => w.online);
      const asleep = snap.workers.filter((w) => w.presence === "asleep");
      const names = online.map((w) => w.name).join(", ");
      const rest = asleep.length ? ` · ${asleep.length} asleep` : "";
      push(
        ` network: ${online.length}/${snap.workers.length} online (${names || "none"})${rest} · ${snap.queueDepth} queued · ${snap.totals.jobsDone} jobs done`,
      );
    }
    push();

    if (answer) {
      push(bold(" LATEST ANSWER ") + dim(`— ${answer.prompt.slice(0, width - 20)}`));
      for (const l of wrap(answer.text, width - 3, 10)) push(`  ${l}`);
      push();
    }

    const jobs = (snap?.jobs ?? []).filter((j) => j.kind === "task").slice(0, 5);
    if (jobs.length > 0) {
      push(bold(" NETWORK JOBS ") + dim("— other members' requests are private"));
      for (const j of jobs) {
        const cost = j.result ? `${j.result.costCredits} cr` : "";
        const who = (j.requester ?? "?").slice(0, 12);
        push(
          `  ${j.status.padEnd(7)} ${who.padEnd(13)} ${cost.padEnd(8)} ${j.prompt.replace(/\n/g, " ").slice(0, width - 36)}`,
        );
      }
      push();
    }

    const feed = (world?.log ?? []).slice(0, 4);
    if (feed.length > 0) {
      push(bold(" WORLD"));
      for (const m of feed) {
        const at = new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const line = m.narration ?? m.flavor;
        push(dim(`  ${at} `) + line.slice(0, width - 12));
      }
      push();
    }

    const chatter = (snap?.feed ?? []).slice(0, 4);
    if (chatter.length > 0) {
      push(bold(" NETWORK CHATTER"));
      for (const m of chatter) {
        const at = new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        push(dim(`  ${at} ${m.workerName.padEnd(10)} `) + m.text.slice(0, width - 25));
      }
      push();
    }

    for (const l of logTail) push(dim(`  ${l.slice(0, width - 3)}`));
    push();
    push(dim(" type a question · @HQ pins a machine · /new starts a fresh conversation · ctrl+c to quit"));
    push(` ask> ${input}`);

    // Home the cursor, rewrite every line, clear the remainder of the screen.
    process.stdout.write(`${ESC}[H` + lines.map((l) => l + `${ESC}[K`).join("\n") + `\n${ESC}[J`);
  }

  async function poll(): Promise<void> {
    try {
      const [statusRes, meRes, worldRes] = await Promise.all([
        fetch(`${coordinatorUrl}/api/status`, { headers, signal: AbortSignal.timeout(5000) }),
        fetch(`${coordinatorUrl}/api/me`, { headers, signal: AbortSignal.timeout(5000) }),
        fetch(`${coordinatorUrl}/api/world?worker=${encodeURIComponent(workerName)}`, {
          headers,
          signal: AbortSignal.timeout(5000),
        }),
      ]);
      if (statusRes.ok) snap = (await statusRes.json()) as StatusSnapshot;
      if (meRes.ok) me = (await meRes.json()) as MeInfo;
      if (worldRes.ok) world = ((await worldRes.json()) as { view?: WorldView }).view;
      unreachable = !statusRes.ok;
    } catch {
      unreachable = true;
    }
    render();
  }

  async function submit(prompt: string): Promise<void> {
    if (/^\/new$/i.test(prompt)) {
      sessionId = null;
      answer = { prompt, text: "new conversation" };
      render();
      return;
    }
    answer = { prompt, text: "thinking…" };
    render();
    try {
      if (!sessionId) {
        const started = await fetch(`${coordinatorUrl}/api/sessions`, {
          method: "POST",
          headers,
          body: JSON.stringify({ model }),
        });
        const startedData = (await started.json()) as { sessionId?: string; error?: string };
        sessionId = startedData.sessionId ?? null;
        if (!sessionId) {
          answer = { prompt, text: startedData.error ?? "could not start conversation" };
          return;
        }
      }
      const res = await fetch(`${coordinatorUrl}/api/jobs`, {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt, model, sessionId }),
      });
      const data = (await res.json()) as { jobId?: string; error?: string };
      if (!data.jobId) {
        answer = { prompt, text: data.error ?? "submission failed" };
        return;
      }
      for (;;) {
        await new Promise((r) => setTimeout(r, 400));
        const job = (await (
          await fetch(`${coordinatorUrl}/api/jobs/${data.jobId}`, { headers })
        ).json()) as Job;
        if (job.result?.output) {
          answer = { prompt, text: stripMarkdown(stripThinking(job.result.output)) + (job.status === "running" ? " ▍" : "") };
          render();
        }
        if (job.status === "done") {
          answer = { prompt, text: stripMarkdown(stripThinking(job.result?.output ?? "")) };
          return;
        }
        if (job.status === "failed") {
          answer = { prompt, text: `failed: ${job.error ?? "unknown error"}` };
          return;
        }
      }
    } catch (err) {
      answer = { prompt, text: `error: ${err instanceof Error ? err.message : err}` };
    } finally {
      render();
    }
  }

  function onKey(data: Buffer): void {
    const s = data.toString("utf8");
    if (s === "\x03") {
      cleanup();
      process.exit(0);
    }
    if (s === "\r" || s === "\n") {
      const prompt = input.trim();
      input = "";
      if (prompt) void submit(prompt);
      render();
      return;
    }
    if (s === "\x7f" || s === "\b") {
      input = input.slice(0, -1);
      render();
      return;
    }
    if (s.startsWith(ESC)) return; // swallow arrow keys etc.
    const printable = s.replace(/[^\x20-\x7e\u00a0-\uffff]/g, "");
    if (printable) {
      input += printable;
      render();
    }
  }

  function cleanup(): void {
    process.stdout.write(`${ESC}[?1049l${ESC}[?25h`); // leave alt screen, show cursor
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  }

  process.stdout.write(`${ESC}[?1049h${ESC}[?25l`); // alt screen, hide cursor
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", onKey);
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  void poll();
  setInterval(() => void poll(), POLL_MS).unref();

  return {
    log: (message: string) => {
      logTail.push(message);
      if (logTail.length > LOG_TAIL) logTail.shift();
      render();
    },
    onJobStart: (jobId) => {
      busyJob = jobId;
      render();
    },
    onJobEnd: () => {
      busyJob = null;
      render();
    },
  };
}
