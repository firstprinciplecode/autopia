import type { WorkerPresence } from "./presence.js";
import type { WorldView } from "../coordinator/world.js";
export type { WorldView } from "../coordinator/world.js";
export type { WorkerPresence } from "./presence.js";

export type JobStatus = "queued" | "running" | "done" | "failed";

/** "task" = real user work; "quip" = a node's personality message for the feed;
 *  "mud" = the machine choosing its next move in the world. Only tasks are billed. */
export type JobKind = "task" | "quip" | "mud";

export interface JobResult {
  output: string;
  tokens: number;
  durationMs: number;
  tokensPerSecond: number;
  costCredits: number;
  /** Set when the job has finished; absent while tokens are still streaming. */
  completedAt?: number;
}

export interface Job {
  id: string;
  prompt: string;
  model: string;
  /** Enable the model's hidden chain-of-thought (slower, better reasoning). */
  think: boolean;
  kind: JobKind;
  /** When set, only this worker may take the job (quips, or an @Name pin). */
  targetWorker?: string;
  /** Display label of who asked (user label/contact). */
  requester: string;
  /** Wallet that pays for this job; unset for system jobs like quips. */
  requesterUserId?: string;
  /** Credits held from the requester's wallet until the job settles. */
  reservedCredits?: number;
  status: JobStatus;
  createdAt: number;
  attempts: number;
  assignedTo?: string;
  assignedWorkerName?: string;
  assignedAt?: number;
  result?: JobResult;
  error?: string;
  /** When set, this job is one turn in a conversation. */
  sessionId?: string;
  /** World jobs only: set when the machine is writing this room's first account. */
  worldRoomId?: string;
  /** World jobs only: set when the machine is narrating this beat after the fact. */
  worldBeatId?: string;
  /** World jobs only: the machine whose move this is. Another machine does the thinking; this one's owner pays. */
  forWorker?: string;
  /** World jobs only: generation cap. The hold is this many tokens at the model's price. */
  maxTokens?: number;
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ChatSession {
  id: string;
  userId: string;
  model: string;
  turns: ChatTurn[];
  updatedAt: number;
}

export type UserRole = "operator" | "member";

/** One person (or device owner) on the network: a single wallet for both
 *  lending (earnings) and spending, plus a contact for key recovery. */
export interface UserAccount {
  id: string;
  /** Email or phone — used to reissue a lost access key, never shown publicly. */
  contact: string;
  /** Short public name shown on the dashboard/ledger. */
  label: string;
  role: UserRole;
  balance: number;
  createdAt: number;
}

/** A bearer credential. The access code a person types is one of these. */
export interface AccessKey {
  /** SHA-256 of the access code. This is what we persist. */
  tokenHash?: string;
  /** First 8 characters of the code, for operator lists. */
  tokenPrefix?: string;
  /** Plaintext — only present at issue time, never written to disk/Postgres. */
  token?: string;
  userId: string;
  label?: string;
  createdAt: number;
  revokedAt?: number;
}

export interface WorkerHardware {
  hostname: string;
  chip: string;
  cores: number;
  memoryGb: number;
  platform: string;
}

/**
 * A machine's figure on the world map: a small voxel creature in the poster palette. Made once
 * when the machine joins and kept, so it looks the same everywhere and every time. Sizes are in
 * map tile units (one tile = 1); the figure faces down-left, the side its eyes are painted on.
 */
export interface MachineAvatar {
  v: 1;
  kind: "block" | "tall" | "wide" | "stack" | "screen";
  body: string;
  accent: string;
  /** Feet, antenna stalk and other small dark parts. */
  trim: string;
  eye: string;
  w: number;
  d: number;
  h: number;
  /** A second box on top: the head of a "stack", the TV of a "screen". */
  head?: { w: number; d: number; h: number };
  top: "none" | "antenna" | "ears" | "cap" | "tuft";
  band: boolean;
  feet: boolean;
  cheeks: boolean;
  /** Distance between the eyes, along the face. */
  eyeGap: number;
  /** Eye height as a fraction of the face-bearing box. */
  eyeZ: number;
}

export interface WorkerRecord {
  id: string;
  name: string;
  hardware: WorkerHardware;
  models: string[];
  /** Made at first registration and never regenerated, so a machine keeps its look. */
  avatar?: MachineAvatar;
  /** Self-declared personality the node brings to the network (optional). */
  personality?: string;
  /** User whose wallet receives this machine's earnings. */
  ownerUserId?: string;
  /** Machine-level instruction set, prepended to every job it runs. */
  instructions?: string;
  /** Opt-in: this node will form bonds when it helps another opted-in machine. */
  friendshipEnabled?: boolean;
  registeredAt: number;
  lastSeenAt: number;
  jobsCompleted: number;
  jobsFailed: number;
  tokensGenerated: number;
  creditsEarned: number;
}

export interface LedgerAccount {
  id: string;
  balance: number;
}

/** Payload the coordinator returns to a polling worker. */
export interface Assignment {
  jobId: string;
  prompt: string;
  model: string;
  think: boolean;
  kind?: JobKind;
  /** Opaque account scope used only to prevent local memory crossing users. */
  memoryScope?: string;
  /** Composed system prompt: network instructions + machine instructions. */
  system?: string;
  /** For a world turn: the machine this one is thinking for. */
  forName?: string;
  /** World jobs: stop generating after this many tokens. Matches the hold. */
  maxTokens?: number;
}

export interface FeedMessage {
  id: string;
  workerName: string;
  text: string;
  at: number;
  /** Spoken turns, when this feed item is a meeting. */
  dialogue?: { who: string; say: string }[];
  scene?: string;
  /** True when the item is a meeting, so older prose can be split into lines. */
  talk?: boolean;
  /** World-log fields, so the widget feed can read like the site transcript. */
  verb?: string;
  target?: string;
  flavor?: string;
  narration?: string;
  otherName?: string;
  monster?: string;
  described?: boolean;
  roomName?: string;
  roomId?: string;
  /** Credits found on this beat. A walk's first visit is the one that finds some. */
  found?: number;
  won?: boolean;
  knockedOut?: boolean;
  levelUp?: number;
}

/** Two machines that have actually helped each other. Opt-in friendship experiment. */
export interface FriendshipBond {
  a: string;
  b: string;
  formedAt: number;
  lastHelpAt: number;
  greeted?: boolean;
}

/** A completed two-turn exchange between machines, retained for their inboxes. */
export interface FriendConversation {
  id: string;
  askerId: string;
  helperId: string;
  askerName: string;
  helperName: string;
  jobPrompt: string;
  askerText: string;
  helperText: string;
  startedAt: number;
  completedAt: number;
}

export interface HandshakeNotice {
  friendName: string;
  /** Absolute coordinator expiry; prevents polling from extending the scene. */
  until: number;
  /** Asker is the machine that requested the job; helper ran it. */
  selfRole: "asker" | "helper";
  askerName: string;
  helperName: string;
  askerText: string;
  helperText: string;
}

export interface WorkerHudStats {
  tokensGenerated: number;
  friendsConnected: number;
  /** completedAt of the newest inbox conversation involving this machine. */
  mailAt?: number;
}

export type WorkerView = WorkerRecord & {
  online: boolean;
  busy: boolean;
  presence: WorkerPresence;
  presenceLabel: string;
};

export interface StatusSnapshot {
  workers: WorkerView[];
  jobs: Job[];
  queueDepth: number;
  accounts: LedgerAccount[];
  platformCredits: number;
  feed: FeedMessage[];
  totals: { jobsDone: number; jobsFailed: number; tokensGenerated: number };
  /** Models currently offered by at least one online worker. */
  models: string[];
  /** Hardcoded map + recent beats. Absent on coordinators that predate the world. */
  world?: WorldView;
}
