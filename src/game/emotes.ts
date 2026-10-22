export const EMOTES = ["laugh", "thumbs", "cry", "angry"] as const;
export type EmoteKind = (typeof EMOTES)[number];
export const EMOTE_COOLDOWN = 2.5;
export const EMOTE_LABELS: Record<EmoteKind, string> = {
  laugh: "King laugh",
  thumbs: "King thumbs up",
  cry: "King cry",
  angry: "King angry",
};
export const isEmote = (value: unknown): value is EmoteKind =>
  typeof value === "string" && (EMOTES as readonly string[]).includes(value);
