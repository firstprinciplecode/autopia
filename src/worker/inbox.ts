import os from "node:os";
import { loadCoordinatorUrl, loadNetworkKey } from "../shared/networkKey.js";
import { startInboxView } from "./inboxView.js";

startInboxView({
  coordinatorUrl: loadCoordinatorUrl(),
  networkKey: loadNetworkKey(),
  workerName: process.env.WORKER_NAME ?? os.hostname().replace(/\.local$/, ""),
});

await new Promise(() => {});
