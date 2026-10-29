import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Battle, type Replay, type Team } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import { snapshot, perspective, applySnapshot } from "../src/network/perspective";
import { projectTornadoWindup } from "../src/game/tornado-pull";
import { fatalKingWindups } from "./helpers/fatal-king-windups";
import { banditOrdinaryOpening } from "./fixtures/bandit-ordinary-setup";
import golden from "./fixtures/bandit-ordinary-rules54-golden.json";

const native = JSON.parse(readFileSync("reference/client/bandit-ordinary-native-trace.json", "utf8"));
const digest = (b: Battle) => createHash("sha256").update(JSON.stringify(Object.fromEntries(
  golden.stateFields.map((k) => [k, (b as any)[k]])))).digest("hex");
function controlled(version: Replay["version"] = 55, team: Team = "blue", direction = [1, 0]) {
  const b = new Battle({ replay: { ...new Battle({ seed: 2, ai: false }).exportReplay(), version } });
  for (const e of b.entities) Object.assign(e, { active: false, radius: 0 });
  (b as any).spawn("bandit", team, 8.25, 8.25, false, 0);
  const bandit = b.entities.at(-1)!;
  Object.assign(bandit, { speed: 0, cooldown: 0, radius: 0.6 });
  (b as any).spawn("knight", team === "blue" ? "red" : "blue",
    8.25 + 1.75 * direction[0], 8.25 + 1.75 * direction[1], false, 0);
  const target = b.entities.at(-1)!;
  Object.assign(target, { active: false, speed: 0, hp: 10000, maxHp: 10000, radius: 0.5 });
  bandit.target = target.id;
  (b as any).acquireTarget = () => target.hp > 0 && b.entities.includes(target) ? target : undefined;
  (b as any).separate = () => {};
  return { b, bandit, target };
}
it("preserves eight complete rules-54 games independently built from the saved historical engine", () => {
  expect(golden.sourceCommit).toBe("b16f95b");
  expect(golden.cases[5].followUp).toEqual({ firstLandingTick: 252, readyUpdates: 2, nextChargeTick: 253, nextLaunchTick: 282 });
  expect(golden.cases[4].startupZap.zapDamage).toBe(192);
  expect(golden.cases[3].dashPoison.duePulses).toBe(1);
  expect(golden.cases[6].ordinaryPull).toMatchObject({ landingTick: 249, castTick: 266, comparisonTick: 278, hitsAtComparison: 1 });
  expect(golden.cases[7].ordinaryOpening).toMatchObject({ preparingTick:216, dashed:false, hitTicks:[225,248,271,294,317,340] });
  for (const row of golden.cases) {
    const b = new Battle({ replay: row.replay as Replay });
    if (row.ai) Object.assign(b, { ai: true, replayActions: null });
    for (const checkpoint of row.checkpoints) {
      while (b.tick < checkpoint.tick && !b.winner) {
        if (row.ai) for (const a of row.replay.actions.filter((a) => a.team === "blue" && a.tick === b.tick))
          expect(b.play("blue", b.players.blue.hand.indexOf(a.card as CardId), a.x, a.y).ok).toBe(true);
        b.step();
      }
      expect(digest(b), `${row.replay.seed}:${checkpoint.tick}`).toBe(checkpoint.digest);
    }
  }
}, 20000);

for (const team of ["blue", "red"] as const) {
  it(`${team} reproduces all complete native fresh ordinary episodes and supplied modifier changes`, () => {
    let frames = 0, ordinaryRequests = 0;
    for (const row of [...native.cases, ...native.controls]) {
      const { b, bandit, target } = controlled(55, team, row.fields.direction);
      const initial = row.fields.initialBuffs;
      bandit.rage = initial.includes("Rage") ? { remaining: 10 } : undefined;
      bandit.slow = initial.includes("IceWizardSlowDown") ? { remaining: 10 } : undefined;
      let hits = 0, ordinary = 0;
      for (const frame of row.frames) {
        for (const supplied of frame.supplied) {
          if (supplied[0] === "target") Object.assign(target, { x: supplied[1] / 1000, y: supplied[2] / 1000 });
          if (supplied[0] === "buffs") {
            bandit.rage = supplied.includes("Rage") ? { remaining: 10 } : undefined;
            bandit.slow = supplied.includes("IceWizardSlowDown") ? { remaining: 10 } : undefined;
          }
        }
        while (b.tick < Math.ceil(frame.step * 1.5)) b.step();
        if (frame.hit) hits++;
        ordinary += frame.ordinaryRequests.length;
        const label = `${team}/${JSON.stringify(row.fields)}/${frame.step}`;
        const clock = bandit.pendingAttack?.recovery ?? bandit.banditRecovery;
        expect({ x: bandit.x, y: bandit.y }, label).toEqual({ x: frame.xy[0] / 1000, y: frame.xy[1] / 1000 });
        expect({ elapsed: clock?.elapsedMs ?? 0, reload: clock?.reloadMs ?? 0 }, label)
          .toEqual({ elapsed: frame.elapsedMs, reload: frame.reloadMs });
        expect(bandit.dashCharge?.remainingMs ?? (bandit.dash && frame.clockMs ? 1000 : 0), label).toBe(frame.clockMs);
        expect(!!bandit.dash, label).toBe(frame.state === 4);
        // Request timing is native; this checks delivery using the established
        // normalized browser packet, independently supported by selected delivery.
        expect(target.hp, label).toBe(10000 - hits * Math.round(320 * 1.1 ** 2) - ordinary * bandit.damage);
        frames++; ordinaryRequests += frame.ordinaryRequests.length;
      }
    }
    expect({ frames, ordinaryRequests }).toEqual({ frames: 4480, ordinaryRequests: 192 });
  });
}


for (const team of ["blue", "red"] as const) {
  it(`${team} reconstructs four legal pre-dash ordinary hits with and without Rage under both rule sets`, () => {
    for (const version of [54,55] as const) for (const raged of [false,true]) {
      const {battle:b,bandit,knight}=banditOrdinaryOpening(version,team,raged);
      const hits=()=>b.events.filter(e=>e.type==="hit" && e.card==="bandit" && !e.effect);
      while(hits().length<4 && b.tick<400) { expect(bandit.dashCharge ?? bandit.dash).toBeUndefined(); b.step(); }
      expect(hits().map(e=>Math.round(e.time*30))).toEqual(version===54 ?
        raged ? [225,248,271,294] : [229,259,289,319] : raged ? [224,246,269,291] : [228,258,288,318]);
      expect(bandit.hp).toBe(302); expect(knight.hp).toBe(raged?672:563);
      expect(!!bandit.nativeBanditOrdinary).toBe(version===55);
      expect(!!bandit.banditRecovery).toBe(version===55);
      expect(b.exportReplay().actions.map(a=>a.card)).toEqual(raged ? ["knight","bandit","rage"] : ["knight","bandit"]);
      const replay=new Battle({replay:b.exportReplay()}); while(replay.tick<b.tick) replay.step();
      expect(snapshot(replay)).toEqual(snapshot(b)); expect(replay.audioEvents).toEqual(b.audioEvents);
    }
  });
}

it("aligns initial ordinary requests with twenty world phases for every modifier and team", () => {
  for (const team of ["blue","red"] as const) for (let phase=0;phase<20;phase++)
    for (const [rage,slow,frames] of [[false,false,8],[true,false,6],[false,true,13],[true,true,10]] as const) {
      const {b,bandit,target}=controlled(55,team); b.tick=phase;
      bandit.rage=rage?{remaining:10}:undefined; bandit.slow=slow?{remaining:10}:undefined;
      const hp=target.hp;
      while(target.hp===hp && b.tick<phase+40) b.step();
      let expected=1;
      while(Math.floor((phase+expected)*2/3+1e-8)-Math.floor(phase*2/3+1e-8)<frames) expected++;
      expect(b.tick-phase).toBe(expected); expect(target.hp).toBe(hp-bandit.damage);
      expect(bandit.pendingAttack).toBeUndefined(); expect(bandit.banditRecovery).toBeDefined();
    }
});

it("keeps fresh committed forecasts exact through distance changes and supplied modifier expiry", () => {
  for (const [rage,slow] of [[0,0],[0.11,0],[0,0.27],[0.11,0.27]]) {
    const {b,bandit,target}=controlled();
    while(!bandit.pendingAttack?.recovery?.animating && b.tick<20) b.step();
    target.x=bandit.x+5; bandit.rage=rage?{remaining:rage}:undefined; bandit.slow=slow?{remaining:slow}:undefined;
    const before=JSON.stringify(bandit.pendingAttack);
    const projected=projectTornadoWindup(bandit,target,[]);
    expect(JSON.stringify(bandit.pendingAttack)).toBe(before);
    const start=b.tick,hp=target.hp;
    while(target.hp===hp && b.tick<start+60) b.step();
    expect(b.tick-start).toBe(projected.releaseStep);
  }
});

it("uses the same fresh committed clock for a lethal King deadline", () => {
  const {b,bandit,target}=controlled();
  while(!bandit.pendingAttack?.recovery?.animating && b.tick<20) b.step();
  Object.assign(target,{x:bandit.x+5,card:"tower",kind:"tower",king:true,hp:bandit.damage});
  const projected=fatalKingWindups(target.team,[bandit,target]); expect(projected).toHaveLength(1);
  const start=b.tick; while(target.hp>0 && b.tick<start+60) b.step();
  expect(b.tick-start).toBe(projected[0].step);
});

it("retains stun, lost-target, shield and protected-receiver handling for fresh pending attacks", () => {
  for (const effect of ["stun","lost","shield","dash"] as const) {
    const {b,bandit,target}=controlled();
    while(!bandit.pendingAttack?.recovery?.animating && b.tick<20) b.step();
    const hp=target.hp;
    if(effect==="stun") bandit.stun=1;
    if(effect==="lost") target.hp=0;
    if(effect==="shield") {target.shield=50;target.maxShield=50;}
    if(effect==="dash") target.dash={target:bandit.id,elapsed:0,remaining:5};
    while(b.tick<12) b.step();
    expect(target.hp).toBe(effect==="lost"?0:hp);
    if(effect==="stun"||effect==="lost") expect(bandit.pendingAttack).toBeUndefined();
    if(effect==="shield") expect(target.shield).toBe(0);
  }
});

it("copies fresh nested clocks for guests and clears the optional policy when an old host replaces state", () => {
  const {b,bandit}=controlled(); while(!bandit.pendingAttack?.recovery?.animating && b.tick<20) b.step();
  const guest=perspective(snapshot(b),"red").entities.find(e=>e.card==="bandit")!;
  expect(guest.nativeBanditOrdinary).toBe(true);
  expect(guest.pendingAttack?.recovery).toEqual(bandit.pendingAttack?.recovery);
  expect(guest.pendingAttack?.recovery).not.toBe(bandit.pendingAttack?.recovery);
  const old=controlled(54); applySnapshot(b,snapshot(old.b),"blue");
  expect(b.entities.find(e=>e.card==="bandit")?.nativeBanditOrdinary).toBeUndefined();
});

it("gives Mirror and Clone the host policy while fresh copies clear their parent's ordinary clock", () => {
  for (const version of [54,55] as const) {
    const {b,bandit}=controlled(version);
    while((version===55?!bandit.pendingAttack?.recovery?.animating:!bandit.pendingAttack) && b.tick<20) b.step();
    b.players.blue.lastPlayed="bandit"; b.players.blue.hand[0]="mirror"; b.players.blue.elixir=10;
    expect(b.play("blue",0,4,22).ok).toBe(true);
    const mirrored=b.entities.filter(e=>e.card==="bandit").at(-1)!;
    expect(!!mirrored.nativeBanditOrdinary).toBe(version===55); expect(mirrored.banditRecovery).toBeUndefined();
    b.players.blue.hand[0]="clone"; b.players.blue.elixir=10;
    expect(b.play("blue",0,bandit.x,bandit.y).ok).toBe(true); b.step();
    const cloned=b.entities.find(e=>e.card==="bandit"&&e.clone)!;
    expect(!!cloned.nativeBanditOrdinary).toBe(version===55);
    expect(cloned.banditRecovery).toBeUndefined(); expect(cloned.pendingAttack).toBeUndefined();
  }
});

it("pins the new policy to the source-imported fresh clock evidence without changing generated runtime data", () => {
  const manifest=JSON.parse(readFileSync("reference/client/bandit-manifest.json","utf8"));
  for(const input of [...manifest.inputs,manifest.output])
    expect(createHash("sha256").update(readFileSync(input.path)).digest("hex")).toBe(input.sha256);
  expect(manifest.nativeOrdinary).toMatchObject({initialElapsedMs:0,initialReloadMs:0,
    normalRequestUpdates:[8,28,48,68],rageRequestUpdates:[6,21,36,51,66]});
  expect(manifest.output.sha256).toBe("867157ab8c7e8fd77e24e84471da7b60c9212167ef33e9efa1cadd9143569f88");
});

it("records and exactly replays a complete rules-55 game with fresh ordinary attacks", () => {
  const b=new Battle({replay:{...golden.cases[7].replay,version:55} as Replay});
  while(!b.winner&&b.tick<12000) b.step(); expect(b.winner).not.toBeNull();
  const replay=new Battle({replay:b.exportReplay()}); while(replay.tick<b.tick) replay.step();
  expect(replay.rulesVersion).toBe(55); expect(snapshot(replay)).toEqual(snapshot(b));
  expect(replay.audioEvents).toEqual(b.audioEvents);
});
