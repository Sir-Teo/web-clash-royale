import { describe, expect, it, vi } from "vitest";
import { Battle } from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { defensiveThreats } from "../src/game/defensive-threats";
function setup() {
  const b = new Battle({
    seed: 8,
    ai: false,
    enemyDeck: [
      "knight",
      "musketeer",
      "giant",
      "hog-rider",
      "mini-pekka",
      "baby-dragon",
      "cannon",
      "tesla",
    ],
  });
  const unit = (card: CardId, x: number, y: number) => {
    (b as any).spawn(card, "blue", x, y);
    const e = b.entities.at(-1)!;
    Object.assign(e, { deploy: 0, active: false });
    return e;
  };
  const swarm = Array.from({ length: 6 }, (_, i) =>
    unit(
      "minion-horde",
      4 + Math.cos(i * 2.39996) * Math.sqrt(i) * 0.43,
      8 + Math.sin(i * 2.39996) * Math.sqrt(i) * 0.43,
    ),
  );
  const hog = unit("hog-rider", 14, 8);
  expect(swarm).toContain(defensiveThreats("red", b.entities)[0]);
  return { b, swarm, hog, unit };
}
const think = (b: Battle) => (b as any).think();
describe("AI responses to supported defensive targets", () => {
  it("does not treat a counter beyond the gameplay elixir tolerance as affordable", () => {
    const { b } = setup();
    b.players.red.hand = ["knight", "musketeer", "giant", "hog-rider"];
    b.players.red.elixir = 4 - 1.1e-6;
    think(b);
    expect(b.actions[0]?.card).toBe("knight");
    expect(b.actions[0]?.x).toBeGreaterThan(13);
  });
  it("keeps a legal Balloon lure ahead of a lower-priority ground response", () => {
    const { b, swarm, hog, unit } = setup();
    hog.y = 14.1;
    const balloon = unit("balloon", 14, 12.3);
    expect(
      defensiveThreats("red", b.entities).find((e) => !swarm.includes(e)),
    ).toBe(balloon);
    b.players.red.hand = ["cannon", "knight", "giant", "hog-rider"];
    b.players.red.elixir = 3;
    think(b);
    expect(b.actions[0]?.card).toBe("cannon");
    expect(b.actions[0]?.y).toBe(10);
  });
  it("holds building-seekers when no affordable card can answer either push", () => {
    const { b } = setup();
    b.players.red.hand = ["giant", "hog-rider", "balloon", "rocket"];
    b.players.red.elixir = 5;
    think(b);
    expect(b.actions).toHaveLength(0);
    expect(b.players.red.elixir).toBe(5);
  });
  it("keeps the ordinary affordable-card and placement RNG draws during fallback", () => {
    const { b } = setup();
    b.players.red.hand = ["knight", "musketeer", "giant", "hog-rider"];
    b.players.red.elixir = 3;
    const before = structuredClone(b.entities.filter((e) => e.team === "blue"));
    const rng = vi.spyOn(b, "random");
    think(b);
    expect(rng).toHaveBeenCalledTimes(2);
    rng.mockRestore();
    expect(b.entities.filter((e) => e.team === "blue")).toEqual(before);
    expect(b.actions[0]?.x).toBeGreaterThan(13);
  });
  it.each([8, 42, 729])(
    "replays accepted AI decisions exactly in a legal seeded battle (%s)",
    (seed) => {
      const b = new Battle({
        seed,
        ai: true,
        deck: [
          "minion-horde",
          "hog-rider",
          "knight",
          "goblins",
          "archers",
          "arrows",
          "fireball",
          "giant",
        ],
        enemyDeck: [
          "knight",
          "musketeer",
          "giant",
          "hog-rider",
          "mini-pekka",
          "baby-dragon",
          "cannon",
          "tesla",
        ],
      });
      for (let tick = 0; tick < 2400 && !b.winner; tick++) {
        if (tick % 75 === 0) {
          const index = b.players.blue.hand.findIndex(
            (id) => CARD_MAP[id].cost <= b.players.blue.elixir,
          );
          if (index >= 0) {
            const card = CARD_MAP[b.players.blue.hand[index]];
            b.play(
              "blue",
              index,
              tick % 150 === 0 ? 4 : 14,
              card.kind === "spell" ? 10 : 22,
            );
          }
        }
        b.step();
      }
      expect(b.actions.filter((a) => a.team === "red").length).toBeGreaterThan(
        3,
      );
      const record = b.exportReplay(),
        rebuilt = new Battle({ replay: record });
      while (rebuilt.tick < record.duration && !rebuilt.winner) rebuilt.step();
      expect(rebuilt.entities).toEqual(b.entities);
      expect(rebuilt.projectiles).toEqual(b.projectiles);
      expect(rebuilt.players).toEqual(b.players);
      expect(rebuilt.audioEvents).toEqual(b.audioEvents);
      expect(rebuilt.actions).toEqual(b.actions);
      expect(rebuilt.winner).toBe(b.winner);
    },
  );

  it("keeps a useful spell on the dominant air swarm rather than replacing it with a ground response", () => {
    const { b } = setup();
    b.players.red.hand = ["arrows", "knight", "giant", "hog-rider"];
    b.players.red.elixir = 3;
    think(b);
    expect(b.actions[0]?.card).toBe("arrows");
    expect(b.actions[0]?.x).toBeLessThan(7);
  });

  it.each(["missing", "unaffordable"])(
    "defends the other lane when the top air threat's counter is %s",
    (unavailable) => {
      const { b, hog } = setup();
      b.players.red.hand =
        unavailable === "missing"
          ? ["knight", "mini-pekka", "giant", "hog-rider"]
          : ["knight", "musketeer", "giant", "hog-rider"];
      b.players.red.elixir = 3;
      think(b);
      expect(b.actions).toHaveLength(1);
      expect(b.actions[0]).toMatchObject({
        card: "knight",
        team: "red",
        y: 9.3,
      });
      expect(b.actions[0].x).toBeGreaterThan(13);
      for (let i = 0; i < 150 && hog.hp === hog.maxHp; i++) b.step();
      expect(hog.hp).toBeLessThan(hog.maxHp);
    },
  );
  it.each([4, 4 - 1e-7, 4 - 1e-6])(
    "uses the gameplay affordability tolerance for an air counter with %s elixir",
    (elixir) => {
      const { b } = setup();
      b.players.red.hand = ["knight", "musketeer", "giant", "hog-rider"];
      b.players.red.elixir = elixir;
      think(b);
      expect(b.actions[0]).toMatchObject({
        card: "musketeer",
        team: "red",
        y: expect.any(Number),
      });
      expect(b.actions[0].x).toBeLessThan(7);
      expect(b.players.red.elixir).toBeCloseTo(0, 5);
    },
  );
});
