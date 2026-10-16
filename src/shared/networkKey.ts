import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve the network key for local clients (TUI/CLI): SPHERE_KEY env wins,
 * otherwise fall back to the operator's key file so everything on this
 * machine just works without exporting anything.
 */
export function loadNetworkKey(): string | undefined {
  if (process.env.SPHERE_KEY) return process.env.SPHERE_KEY;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return readFileSync(join(here, "../../data/network-key.txt"), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

export function authHeaders(): Record<string, string> {
  const key = loadNetworkKey();
  return key ? { "x-sphere-key": key } : {};
}

/**
 * Resolve the coordinator address for local clients: COORDINATOR_URL env wins,
 * then data/coordinator-url.txt (written when the coordinator moved to
 * hosting), then localhost for pure-local dev.
 */
export function loadCoordinatorUrl(): string {
  if (process.env.COORDINATOR_URL) return process.env.COORDINATOR_URL;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const url = readFileSync(join(here, "../../data/coordinator-url.txt"), "utf8").trim();
    if (url) return url;
  } catch {
    // fall through
  }
  return "http://localhost:4100";
}
