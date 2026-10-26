import * as T from "three";
import { describe, expect, it, vi } from "vitest";
import { BlindSpotIndicator } from "../src/render/blind-spot";
import { cardDetails } from "../src/ui/card-details";
import { Battle } from "../src/game/engine";
import mortar from "../src/game/mortar-data.json";

describe("Mortar minimum-range guidance", () => {
  it("uses the source radius on the floor and reuses its bounded GPU resources", () => {
    const indicator = new BlindSpotIndicator();
    expect(indicator.radius).toBe(0);
    const meshes = indicator.object.children as T.Mesh<
      T.BufferGeometry,
      T.MeshBasicMaterial
    >[];
    expect(meshes).toHaveLength(2);
    const geometries = meshes.map((mesh) => mesh.geometry),
      materials = meshes.map((mesh) => mesh.material);
    indicator.show(mortar.minimumRange, true);
    expect(indicator.radius).toBe(mortar.minimumRange);
    expect(indicator.object.scale.toArray()).toEqual([4.5, 1, 4.5]);
    expect(
      meshes.every(
        (mesh) => mesh.rotation.x === -Math.PI / 2 && !mesh.material.depthWrite,
      ),
    ).toBe(true);
    const boundary = meshes[1].geometry as T.RingGeometry;
    expect(boundary.parameters.innerRadius * indicator.radius).toBeLessThan(
      mortar.minimumRange,
    );
    expect(boundary.parameters.outerRadius * indicator.radius).toBeGreaterThan(
      mortar.minimumRange,
    );
    indicator.show(mortar.minimumRange, false);
    expect(meshes[1].material.color.getHex()).toBe(0xff536a);
    indicator.show(0, true);
    expect(indicator.radius).toBe(0);
    indicator.show(mortar.minimumRange, true);
    expect(meshes.map((mesh) => mesh.geometry)).toEqual(geometries);
    expect(meshes.map((mesh) => mesh.material)).toEqual(materials);
    const release = [...geometries, ...materials].map((resource) =>
      vi.spyOn(resource, "dispose"),
    );
    indicator.dispose();
    expect(release.every((spy) => spy.mock.calls.length === 1)).toBe(true);
    expect(indicator.object.children).toHaveLength(0);
  });

  it("matches the displayed blind spot and deployment timer to actual targeting", () => {
    const battle = new Battle({ seed: 17, ai: false });
    battle.players.blue.hand[0] = "mortar";
    battle.players.blue.elixir = 10;
    expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
    const unit = battle.entities.find((entity) => entity.card === "mortar")!;
    const stats = Object.fromEntries(
      cardDetails("mortar").stats.map((row) => [row.label, row.value]),
    );
    expect(parseFloat(stats["Deploy time"])).toBe(unit.deploy);
    expect(parseFloat(stats.Range)).toBe(unit.range);
    const minimum = parseFloat(stats["Minimum range"]);
    battle.players.red.hand[0] = "knight";
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, 4, 10).ok).toBe(true);
    const target = battle.entities.find(
      (entity) => entity.team === "red" && entity.card === "knight",
    )!;
    target.x = unit.x;
    target.y = unit.y - minimum + 0.001;
    expect((battle as any).validTarget(unit, target)).toBe(false);
    target.y = unit.y - minimum;
    expect((battle as any).validTarget(unit, target)).toBe(true);
    expect(cardDetails("mortar").note).toContain("inside the minimum range");
  });
});
