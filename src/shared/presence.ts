export const ONLINE_WITHIN_MS = 15_000;
export const ASLEEP_WITHIN_MS = 24 * 60 * 60 * 1000;

export type WorkerPresence = "online" | "busy" | "asleep" | "gone";

export interface PresenceInfo {
  online: boolean;
  presence: WorkerPresence;
  /** "online" | "working" | "asleep 14m" | "last seen 3d ago" */
  label: string;
}

const RANK: Record<WorkerPresence, number> = {
  busy: 0,
  online: 1,
  asleep: 2,
  gone: 3,
};

export function presenceRank(p: WorkerPresence): number {
  return RANK[p];
}

export function describePresence(lastSeenAt: number, busy: boolean, now = Date.now()): PresenceInfo {
  const ago = Math.max(0, now - lastSeenAt);
  if (ago < ONLINE_WITHIN_MS) {
    if (busy) return { online: true, presence: "busy", label: "working" };
    return { online: true, presence: "online", label: "online" };
  }
  if (ago < ASLEEP_WITHIN_MS) {
    return { online: false, presence: "asleep", label: `asleep ${formatAgo(ago)}` };
  }
  return { online: false, presence: "gone", label: `last seen ${formatAgo(ago)} ago` };
}

export function formatAgo(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return "<1m";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
