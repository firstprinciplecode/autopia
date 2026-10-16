export const DEFAULT_DOWNLOAD_URL =
  "https://app_3b6a7a61-8424-4972-b215-54c6f0532e9d.host.uplink.spot/";

export function looksLikeEmail(contact: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.trim());
}

export function inviteDownloadUrl(): string {
  return (process.env.INVITE_DOWNLOAD_URL ?? DEFAULT_DOWNLOAD_URL).replace(/\/?$/, "/");
}

export function inviteMessage(opts: {
  label: string;
  accessKey: string;
  downloadUrl?: string;
  reissue?: boolean;
}): { subject: string; body: string } {
  const name = opts.label.trim() || "there";
  const download = opts.downloadUrl ?? inviteDownloadUrl();
  const subject = opts.reissue
    ? "Your new Autopia access code"
    : "You're invited to Autopia";
  const intro = opts.reissue
    ? `Hi ${name},\n\nHere's a new access code for Autopia. The previous one can be revoked separately.`
    : `Hi ${name},\n\nYou're invited to Autopia, a small shared-compute network of personal Macs.`;
  const body = [
    intro,
    "",
    `Access code:  ${opts.accessKey}`,
    `Download:     ${download}`,
    "",
    "Unzip Autopia, open it (right-click → Open if macOS says damaged). Click Paste then Join for the access code. The app saves it.",
    "",
    "— Autopia",
    "",
  ].join("\n");
  return { subject, body };
}
