import { CARD_MAP } from "./legacy-local-cards";

/** Cards understood by the historical local rules family. */
export const LOCAL_REPLAY_CARDS: ReadonlySet<string> = new Set(
  Object.keys(CARD_MAP),
);

/** Only the local branch wrote these portable wrappers or record metadata.
 * Bare engine recordings have no reliable provenance and keep the origin default.
 */
export function migrateLocalRecord(value: unknown, portable = false): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const replay = record.replay;
  if (!replay || typeof replay !== "object" || Array.isArray(replay))
    return value;
  const r = replay as Record<string, unknown>;
  if (
    r.rulesFamily !== undefined ||
    !Number.isInteger(r.version) ||
    (r.version as number) < 1 ||
    (r.version as number) > 5 ||
    (!portable &&
      record.playerName === undefined &&
      record.opponentType === undefined)
  )
    return value;
  return { ...record, replay: { ...r, rulesFamily: "local" } };
}
