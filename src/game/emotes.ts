import phrases from "./quick-chat.json" with { type: "json" };
export const EMOTES = ["laugh", "thumbs", "cry", "angry"] as const;
export type EmoteKind = (typeof EMOTES)[number];
export const QUICK_CHAT_LABELS = phrases;
export type QuickChatKind = keyof typeof phrases;
export const QUICK_CHATS = Object.keys(phrases) as QuickChatKind[];
export type ReactionKind = EmoteKind | QuickChatKind;
export const EMOTE_COOLDOWN = 2.5;
export const EMOTE_LABELS: Record<EmoteKind, string> = {
  laugh: "King laugh",
  thumbs: "King thumbs up",
  cry: "King cry",
  angry: "King angry",
};
export const isEmote = (value: unknown): value is EmoteKind =>
  typeof value === "string" && (EMOTES as readonly string[]).includes(value);
export const isQuickChat = (value: unknown): value is QuickChatKind =>
  typeof value === "string" && Object.hasOwn(phrases, value);
export const reactionLabel = (kind: ReactionKind) =>
  isEmote(kind) ? EMOTE_LABELS[kind] : phrases[kind];
