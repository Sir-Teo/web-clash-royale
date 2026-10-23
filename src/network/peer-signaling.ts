import type { Mode } from "../game/engine";
export interface PeerSignal {
  version: 1;
  type: "offer" | "answer";
  id: string;
  mode: Mode;
  sdp: string;
}
const PREFIX = "CR1.";
export function encodeSignal(signal: PeerSignal) {
  return (
    PREFIX +
    btoa(JSON.stringify(signal))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
  );
}
export function decodeSignal(input: string): PeerSignal {
  let value = input.trim();
  if (value.startsWith("http://") || value.startsWith("https://"))
    value =
      new URLSearchParams(new URL(value).hash.slice(1)).get("battle") ?? "";
  if (!value.startsWith(PREFIX) || value.length > 24000)
    throw new Error("Paste the complete battle invite or reply.");
  try {
    const s = JSON.parse(
      atob(value.slice(PREFIX.length).replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (
      s.version !== 1 ||
      !["offer", "answer"].includes(s.type) ||
      !/^[a-f0-9]{24}$/.test(s.id) ||
      !["classic", "double"].includes(s.mode) ||
      typeof s.sdp !== "string" ||
      s.sdp.length > 16000 ||
      !s.sdp.startsWith("v=0\r\n") ||
      !s.sdp.includes("m=application ")
    )
      throw new Error();
    return s;
  } catch {
    throw new Error(
      "This invite is incomplete or from another game version. Ask for a new one.",
    );
  }
}
export function signalLink(signal: string) {
  const url = new URL(location.href);
  url.search = "";
  url.hash = new URLSearchParams({ battle: signal }).toString();
  return url.href;
}

/** Ordered, bounded chunks work with Safari's smaller data-channel message limit. */
export function peerChunks(value: unknown, id: number) {
  const json = JSON.stringify(value);
  if (json.length > 1_000_000) throw new Error("Battle update is too large");
  const total = Math.ceil(json.length / 12000);
  return Array.from({ length: total }, (_, index) =>
    JSON.stringify({
      id,
      index,
      total,
      text: json.slice(index * 12000, (index + 1) * 12000),
    }),
  );
}
export class PeerAssembler {
  private id = -1;
  private parts: string[] = [];
  private total = 0;
  private size = 0;
  receive(raw: unknown): unknown {
    if (typeof raw !== "string" || raw.length > 80000)
      throw new Error("Invalid battle update");
    const p = JSON.parse(raw);
    if (
      !Number.isSafeInteger(p.id) ||
      !Number.isInteger(p.index) ||
      !Number.isInteger(p.total) ||
      p.total < 1 ||
      p.total > 84 ||
      typeof p.text !== "string" ||
      p.text.length > 12000
    )
      throw new Error("Invalid battle update");
    if (p.index === 0) {
      this.id = p.id;
      this.parts = [];
      this.total = p.total;
      this.size = 0;
    }
    if (
      p.id !== this.id ||
      p.total !== this.total ||
      p.index !== this.parts.length
    )
      throw new Error("Incomplete battle update");
    this.size += p.text.length;
    if (this.size > 1_000_000) throw new Error("Battle update is too large");
    this.parts.push(p.text);
    if (this.parts.length !== this.total) return undefined;
    const value = JSON.parse(this.parts.join(""));
    this.parts = [];
    this.id = -1;
    return value;
  }
}
