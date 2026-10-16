import { chmodSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execSync, spawn } from "node:child_process";
import os from "node:os";
import { join } from "node:path";

const OLLAMA_DOWNLOAD_URL =
  "https://github.com/ollama/ollama/releases/latest/download/ollama-darwin.tgz";

async function ollamaAlive(ollamaUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${ollamaUrl}/api/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function findOllamaBinary(): string | null {
  const candidates = [
    "/opt/homebrew/bin/ollama",
    "/usr/local/bin/ollama",
    "/Applications/Ollama.app/Contents/Resources/ollama",
    join(os.homedir(), ".sphere/bin/ollama"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

type LogFn = (message: string) => void;

async function downloadOllama(log: LogFn): Promise<string> {
  const dir = join(os.homedir(), ".sphere/bin");
  mkdirSync(dir, { recursive: true });
  const tgzPath = join(dir, "ollama-darwin.tgz");

  log("Ollama not found — downloading it (one-time, ~30 MB)…");
  const res = await fetch(OLLAMA_DOWNLOAD_URL, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(
      `download failed (${res.status}). Install Ollama manually from https://ollama.com/download and reopen this app.`,
    );
  }
  writeFileSync(tgzPath, Buffer.from(await res.arrayBuffer()));
  execSync(`tar -xzf "${tgzPath}" -C "${dir}"`);
  rmSync(tgzPath);

  const bin = join(dir, "ollama");
  if (!existsSync(bin)) throw new Error("ollama binary missing after extraction");
  chmodSync(bin, 0o755);
  log(`installed Ollama to ${bin}`);
  return bin;
}

const defaultLog: LogFn = (message) => console.log(`[setup] ${message}`);

/** Make sure an Ollama server is reachable, installing and starting one if needed. */
export async function ensureOllama(ollamaUrl: string, log: LogFn = defaultLog): Promise<void> {
  if (await ollamaAlive(ollamaUrl)) {
    log("Ollama is already running");
    return;
  }

  const bin = findOllamaBinary() ?? (await downloadOllama(log));
  log(`starting Ollama server (${bin})…`);
  const child = spawn(bin, ["serve"], { detached: true, stdio: "ignore" });
  child.unref();

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await ollamaAlive(ollamaUrl)) {
      log("Ollama server is up");
      return;
    }
  }
  throw new Error("Ollama did not start within 30 seconds");
}

/** Make sure the given model is available locally, pulling it if needed. */
export async function ensureModel(ollamaUrl: string, model: string, log: LogFn = defaultLog): Promise<void> {
  const tags = (await (await fetch(`${ollamaUrl}/api/tags`)).json()) as {
    models?: { name: string }[];
  };
  if ((tags.models ?? []).some((m) => m.name === model)) {
    log(`model ${model} is already downloaded`);
    return;
  }

  log(`downloading model ${model} (one-time, ~1.4 GB)…`);
  const res = await fetch(`${ollamaUrl}/api/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`model pull failed: ${res.status}`);

  // The pull endpoint streams NDJSON progress events; report every 10%.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastPercent = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as {
        status?: string;
        error?: string;
        completed?: number;
        total?: number;
      };
      if (event.error) throw new Error(`model pull failed: ${event.error}`);
      if (event.completed && event.total) {
        const percent = Math.floor((event.completed / event.total) * 10) * 10;
        if (percent > lastPercent) {
          lastPercent = percent;
          log(`${percent}% of ${(event.total / 1e9).toFixed(1)} GB`);
        }
      }
    }
  }
  log(`model ${model} ready`);
}
