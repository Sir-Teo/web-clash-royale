/** Use bounded Unicode labels and an unambiguous timestamp in local JSON downloads. */
export function exportFileName(
  kind: "replay" | "progress",
  date: Date,
  label: string,
) {
  const timestamp = date.toISOString().replaceAll(":", "-");
  const name = label
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  const slug =
    Array.from(name).slice(0, 36).join("").replace(/-+$/, "") ||
    (kind === "replay" ? "opponent" : "player");
  return `browser-arena-${kind}-${timestamp}-${kind === "replay" ? "vs" : "for"}-${slug}.json`;
}
