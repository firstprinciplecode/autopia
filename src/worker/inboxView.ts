import type { FriendConversation } from "../shared/types.js";

interface InboxViewOptions {
  coordinatorUrl: string;
  networkKey?: string;
  workerName: string;
}

const ESC = "\x1b";
const POLL_MS = 2_000;
const dim = (text: string) => `${ESC}[2m${text}${ESC}[0m`;
const bold = (text: string) => `${ESC}[1m${text}${ESC}[0m`;
const inverse = (text: string) => `${ESC}[7m${text}${ESC}[0m`;

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, width: number): string {
  const value = clean(text);
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…`;
}

function wrap(text: string, width: number): string[] {
  const words = clean(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (!line) {
      line = word;
    } else if (`${line} ${word}`.length <= width) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function relativeTime(at: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1_000));
  if (seconds < 60) return "now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d`;
  return new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function startInboxView(opts: InboxViewOptions): void {
  const { coordinatorUrl, networkKey, workerName } = opts;
  const headers: Record<string, string> = networkKey ? { "x-sphere-key": networkKey } : {};
  let conversations: FriendConversation[] = [];
  let selected = 0;
  let openConversation: FriendConversation | null = null;
  let loading = true;
  let error = "";

  function otherName(conversation: FriendConversation): string {
    return conversation.askerName === workerName
      ? conversation.helperName
      : conversation.askerName;
  }

  function pushWrapped(lines: string[], prefix: string, text: string, width: number): void {
    const wrapped = wrap(text, Math.max(20, width - prefix.length));
    wrapped.forEach((line, index) => lines.push(`${index === 0 ? prefix : " ".repeat(prefix.length)}${line}`));
  }

  function renderList(width: number, height: number): string[] {
    const lines = [
      bold(" autopia  inbox"),
      dim(` ${workerName} · ${conversations.length} conversation${conversations.length === 1 ? "" : "s"}`),
      "",
    ];
    if (loading) {
      lines.push(dim("  checking for conversations…"));
      return lines;
    }
    if (error) {
      lines.push(`  ${error}`, "", dim("  R retry · Q close"));
      return lines;
    }
    if (conversations.length === 0) {
      lines.push("  No friend conversations yet.", dim("  Exchanges will appear here after two machines help each other."));
      return lines;
    }

    const visible = Math.max(1, Math.floor((height - 7) / 3));
    const start = Math.min(
      Math.max(0, selected - visible + 1),
      Math.max(0, conversations.length - visible),
    );
    for (let index = start; index < Math.min(conversations.length, start + visible); index++) {
      const conversation = conversations[index];
      if (!conversation) continue;
      const name = otherName(conversation);
      const age = relativeTime(conversation.completedAt);
      const titleWidth = Math.max(8, width - age.length - 5);
      const title = `${name.slice(0, titleWidth).padEnd(titleWidth)} ${age.padStart(age.length)}`;
      lines.push(index === selected ? inverse(` › ${title} `) : `   ${title}`);
      lines.push(`   ${truncate(conversation.helperText || conversation.askerText, Math.max(20, width - 5))}`);
      lines.push("");
    }
    lines.push(dim(" ↑↓ select · return open · R refresh · Q close"));
    return lines;
  }

  function renderDetail(conversation: FriendConversation, width: number): string[] {
    const lines = [
      bold(` autopia  ${otherName(conversation)}`),
      dim(` ${new Date(conversation.completedAt).toLocaleString()}`),
      "",
      dim(` JOB  ${truncate(conversation.jobPrompt, Math.max(20, width - 7))}`),
      "",
      bold(` ${conversation.askerName}`),
    ];
    pushWrapped(lines, "   ", conversation.askerText, width);
    lines.push("", bold(` ${conversation.helperName}`));
    pushWrapped(lines, "   ", conversation.helperText, width);
    lines.push("", dim(" ← esc/backspace inbox · Q close"));
    return lines;
  }

  function render(): void {
    const width = Math.max(52, process.stdout.columns ?? 90);
    const height = Math.max(16, process.stdout.rows ?? 28);
    const lines = openConversation
      ? renderDetail(openConversation, width)
      : renderList(width, height);
    process.stdout.write(
      `${ESC}[H${lines.map((line) => line.slice(0, width) + `${ESC}[K`).join("\n")}\n${ESC}[J`,
    );
  }

  async function refresh(): Promise<void> {
    try {
      const response = await fetch(
        `${coordinatorUrl}/api/friend-conversations`,
        { headers, signal: AbortSignal.timeout(5_000) },
      );
      if (!response.ok) throw new Error(`inbox unavailable (${response.status})`);
      const body = (await response.json()) as {
        conversations?: FriendConversation[];
        reports?: { id: string; workerId: string; workerName: string; from: number; to: number; text: string; voice?: string }[];
      };
      // Field notes ride along as one-sided conversations from the machine.
      const notes: FriendConversation[] = (body.reports ?? []).map((r) => ({
        id: r.id,
        askerId: "world",
        helperId: r.workerId,
        askerName: "Field notes",
        helperName: r.workerName,
        jobPrompt: "what happened in the world",
        askerText: "",
        helperText: r.voice ? `${r.text} ${r.voice}` : r.text,
        startedAt: r.from,
        completedAt: r.to,
      }));
      conversations = [...(body.conversations ?? []), ...notes].sort((a, b) => b.completedAt - a.completedAt);
      selected = Math.min(selected, Math.max(0, conversations.length - 1));
      if (openConversation) {
        openConversation =
          conversations.find((conversation) => conversation.id === openConversation?.id) ?? openConversation;
      }
      error = "";
    } catch (reason) {
      error = reason instanceof Error ? reason.message : "inbox unavailable";
    } finally {
      loading = false;
      render();
    }
  }

  function cleanup(): void {
    process.stdout.write(`${ESC}[?1049l${ESC}[?25h`);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  }

  function close(): never {
    cleanup();
    process.exit(0);
  }

  function onKey(data: Buffer): void {
    const key = data.toString("utf8");
    if (key === "\x03" || key.toLowerCase() === "q") close();
    if (key.toLowerCase() === "r") {
      loading = true;
      render();
      void refresh();
      return;
    }
    if (openConversation) {
      if (key === ESC || key === "\x7f" || key === "\b" || key === ESC + "[D") {
        openConversation = null;
        render();
      }
      return;
    }
    if (key === ESC + "[A") selected = Math.max(0, selected - 1);
    if (key === ESC + "[B") selected = Math.min(conversations.length - 1, selected + 1);
    const conversation = conversations[selected];
    if ((key === "\r" || key === "\n") && conversation) {
      openConversation = conversation;
    }
    render();
  }

  process.stdout.write(`${ESC}[?1049h${ESC}[?25l`);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", onKey);
  process.on("SIGTERM", close);
  process.on("exit", cleanup);
  void refresh();
  setInterval(() => void refresh(), POLL_MS).unref();
}
