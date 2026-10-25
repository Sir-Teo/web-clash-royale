import { sendPeerCommand } from "./helpers/peer-command";
import { describe, expect, it } from "vitest";
import { Battle, STEP, type Replay, type Team } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK, type CardId } from "../src/game/cards";
import { snapshot, perspective } from "../src/network/perspective";
import { PeerMatch } from "../src/network/peer-match";

function source(version: Replay["version"] = 5, deck = STARTER_DECK) {
  return new Battle({
    replay: {
      version,
      seed: 1,
      mode: "classic",
      deck,
      enemyDeck: deck,
      actions: [],
      duration: 9000,
    },
  });
}
const advance = (b: Battle, ticks: number) => {
  for (let i = 0; i < ticks; i++) b.step();
};
function troop(b: Battle, team: Team) {
  const slot = b.players[team].hand.findIndex(
    (id) =>
      CARD_MAP[id].kind === "troop" &&
      CARD_MAP[id].cost <= b.players[team].elixir,
  );
  expect(slot).toBeGreaterThanOrEqual(0);
  expect(
    b.play(team, slot, team === "blue" ? 4 : 14, team === "blue" ? 22 : 10).ok,
  ).toBe(true);
}

describe("recording final-tick commands", () => {
  it.each([1, 2, 3, 4, 5] as const)(
    "includes a final deployment in rules version %s without advancing its age or the clock",
    (version) => {
      const live = source(version);
      advance(live, 10);
      troop(live, "blue");
      const data = live.exportReplay();
      expect(data.actions[0].tick).toBe(data.duration);
      const replay = new Battle({ replay: data });
      advance(replay, data.duration);
      expect(replay.tick).toBe(10);
      expect(replay.time).toBe(10 * STEP);
      expect(replay.entities).toEqual(live.entities);
      expect(replay.players).toEqual(live.players);
      expect(replay.actions).toEqual(live.actions);
      expect(replay.audioEvents).toEqual(live.audioEvents);
      const unit = replay.entities.find((e) => e.kind === "troop")!;
      expect(unit.age).toBe(0);
      expect(unit.deploy).toBeGreaterThan(0);
      live.finish("red", "Surrender");
      replay.finish("red", "Surrender");
      expect(snapshot(replay)).toEqual(snapshot(live));
    },
  );
  it("includes zero-duration commands at construction without a synthetic step", () => {
    const live = source();
    troop(live, "blue");
    troop(live, "red");
    const data = live.exportReplay();
    expect(data.duration).toBe(0);
    const replay = new Battle({ replay: data });
    expect(snapshot(replay)).toEqual(snapshot(live));
    expect(replay.actions).toEqual(live.actions);
    expect(replay.tick).toBe(0);
    const view = perspective(snapshot(replay), "red");
    expect(view.players.blue.hand).toEqual(live.players.red.hand);
    expect(view.entities.filter((e) => e.kind === "troop")).toHaveLength(2);
  });
  it("keeps both teams' same-tick command order and does not apply commands twice", () => {
    const deck: CardId[] = [
      "skeletons",
      "goblins",
      "spear-goblins",
      "zap",
      "archers",
      "knight",
      "arrows",
      "minions",
    ];
    const live = source(5, deck);
    advance(live, 30);
    for (const team of ["blue", "red"] as const)
      for (let i = 0; i < 2; i++) {
        const p = live.players[team];
        const slot = p.hand
          .map((id, slot) => ({ id, slot }))
          .filter((v) => CARD_MAP[v.id].cost <= p.elixir)
          .sort((a, b) => CARD_MAP[a.id].cost - CARD_MAP[b.id].cost)[0].slot;
        expect(
          live.play(
            team,
            slot,
            team === "blue" ? 4 : 14,
            team === "blue" ? 22 : 10,
          ).ok,
        ).toBe(true);
      }
    const data = live.exportReplay(),
      replay = new Battle({ replay: data });
    advance(replay, data.duration);
    expect(replay.actions).toEqual(live.actions);
    expect(snapshot(replay)).toEqual(snapshot(live));
    live.step();
    replay.step();
    expect(replay.actions).toHaveLength(4);
    expect(snapshot(replay)).toEqual(snapshot(live));
  });
  it("does not advance a final persistent area or projectile", () => {
    for (const card of ["rage", "poison", "fireball"] as CardId[]) {
      const deck = [card, ...STARTER_DECK.filter((id) => id !== card)].slice(
        0,
        8,
      );
      let live = source(5, deck);
      for (let seed = 2; !live.players.blue.hand.includes(card); seed++)
        live = new Battle({
          replay: { ...live.exportReplay(), seed, actions: [], duration: 9000 },
        });
      advance(live, 60);
      expect(
        live.play("blue", live.players.blue.hand.indexOf(card), 4, 22).ok,
      ).toBe(true);
      const data = live.exportReplay(),
        replay = new Battle({ replay: data });
      advance(replay, data.duration);
      expect(replay.areas).toEqual(live.areas);
      expect(replay.projectiles).toEqual(live.projectiles);
      expect(replay.players).toEqual(live.players);
      expect(replay.tick).toBe(live.tick);
      expect(replay.audioEvents).toEqual(live.audioEvents);
    }
  });
  it("leaves intermediate replay ticks unchanged until the next ordinary step", () => {
    const live = source();
    advance(live, 10);
    troop(live, "blue");
    advance(live, 20);
    const replay = new Battle({ replay: live.exportReplay() });
    advance(replay, 10);
    expect(replay.actions).toEqual([]);
    expect(replay.entities.filter((e) => e.kind === "troop")).toHaveLength(0);
    replay.step();
    expect(replay.actions).toHaveLength(1);
    advance(replay, 19);
    expect(snapshot(replay)).toEqual(snapshot(live));
  });
  it("reconstructs a direct host's play and surrender arriving on the same simulation tick", () => {
    const host = new PeerMatch(
      "1234567890abcdef12345678",
      "classic",
      { name: "Blue", deck: STARTER_DECK },
      1,
      () => {},
    );
    expect(host.join({ name: "Red", deck: STARTER_DECK })).toBe(true);
    for (const team of ["blue", "red"] as const)
      sendPeerCommand(host, team, { type: "ready", ready: true });
    for (let i = 0; i < 120; i++) host.advance(STEP);
    const live = host.battle!;
    for (const team of ["blue", "red"] as const) {
      const id = live.players[team].hand.find(
        (id) =>
          CARD_MAP[id].kind === "troop" &&
          CARD_MAP[id].cost <= live.players[team].elixir,
      )!;
      sendPeerCommand(host, team, {
        type: "play",
        seq: 1,
        card: id,
        x: team === "blue" ? 4 : 14,
        y: team === "blue" ? 22 : 10,
      });
    }
    sendPeerCommand(host, "blue", { type: "surrender" });
    expect(live.actions).toHaveLength(2);
    expect(live.winner).toBe("red");
    const data = live.exportReplay(),
      replay = new Battle({ replay: data });
    advance(replay, data.duration);
    replay.finish("red", "Surrender");
    expect(snapshot(replay)).toEqual(snapshot(live));
  });
});
