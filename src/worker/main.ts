import os from "node:os";
import { loadCoordinatorUrl, loadNetworkKey } from "../shared/networkKey.js";
import { runAgent } from "./agent.js";
import { startFaceServer } from "./face/server.js";

// Dev entry point: `npm run worker`. Coordinator URL and access key resolve
// from env vars first, then the files in data/, so no exports are needed.
const face =
  process.env.SPHERE_PLAIN === "1"
    ? undefined
    : await startFaceServer({
        openWindow: true,
        port: Number(process.env.SPHERE_FACE_PORT ?? 0),
      }).catch((err: unknown) => {
        console.error("[creatures inc.] face window failed:", err);
        return undefined;
      });

face?.setPhase("ready");
face?.setStatus("");
face?.setIdentity(process.env.WORKER_NAME ?? os.hostname().replace(/\.local$/, ""));
face?.setInboxSource(loadCoordinatorUrl(), loadNetworkKey());

await runAgent({
  coordinatorUrl: loadCoordinatorUrl(),
  ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",
  workerName: process.env.WORKER_NAME ?? os.hostname(),
  personality: process.env.WORKER_PERSONALITY || undefined,
  instructions: process.env.WORKER_INSTRUCTIONS || undefined,
  networkKey: loadNetworkKey(),
  hooks: face?.hooks,
});
