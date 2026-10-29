import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Battle, type Replay, type Team } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import { attackClockRate } from "../src/game/attack-clock";
import { advanceBanditRecovery, bindBanditRecovery, type BanditRecoveryClock } from "../src/game/bandit-recovery";
import { snapshot, perspective, applySnapshot } from "../src/network/perspective";
import { projectTornadoWindup } from "../src/game/tornado-pull";
import { fatalKingWindups } from "./helpers/fatal-king-windups";
import { banditResetOpening, zapBanditTarget } from "./fixtures/bandit-reset-setup";
import golden from "./fixtures/bandit-reset-rules55-golden.json";

const native=JSON.parse(readFileSync("reference/client/bandit-target-reset-native-trace.json","utf8"));
const digest=(b:Battle)=>createHash("sha256").update(JSON.stringify(Object.fromEntries(golden.stateFields.map(k=>[k,(b as any)[k]])))).digest("hex");
function controlled(version: Replay["version"] = 56, team: Team = "blue", direction = [1, 0]) {
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
  (b as any).spawn("knight", target.team, 8.25 - 1.75 * direction[0], 8.25 - 1.75 * direction[1], false, 0);
  const second=b.entities.at(-1)!;
  Object.assign(second,{active:false,speed:0,hp:10000,maxHp:10000,radius:0.5});
  let candidate: typeof target | undefined=target;
  const select=(next: typeof candidate)=>{candidate=next;};
  (b as any).acquireTarget = () => { bandit.target=candidate?.id ?? null; return candidate; };
  (b as any).separate = () => {};
  return { b, bandit, target, second, select };
}
it("preserves nine complete rules-55 games independently built from the saved historical engine", () => {
  expect(golden.sourceCommit).toBe("0df4570");
  expect(golden.cases[5].followUp).toEqual({ firstLandingTick: 252, readyUpdates: 2, nextChargeTick: 253, nextLaunchTick: 282 });
  expect(golden.cases[4].startupZap.zapDamage).toBe(192);
  expect(golden.cases[3].dashPoison.duePulses).toBe(1);
  expect(golden.cases[6].ordinaryPull).toMatchObject({ landingTick: 249, castTick: 266, comparisonTick: 278, hitsAtComparison: 1 });
  expect(golden.cases[7].ordinaryOpening).toMatchObject({ preparingTick:216, dashed:false, hitTicks:[224,246,269,291,314,336] });
  expect(golden.cases[8].targetReset).toEqual({castTick:182,removedAt:187,firstHitTick:198,banditHp:544,targetHp:1280,closeAtCast:true,dashed:false});
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

it("reproduces every native target operation, finish window and ordinary request with the shared clock",()=>{
  let updates=0,operations=0,requests=0;
  for(const row of [...native.cases,...native.controls]) {
    const clock:BanditRecoveryClock={elapsedMs:0,reloadMs:0,carry:0,target:1};
    const rate=attackClockRate({nativeAttackClock:true},row.fields.modifiers.includes("Rage"),row.fields.modifiers.includes("IceWizardSlowDown"));
    const label=()=>clock.target===1?"a":clock.target===2?"b":null;
    for(const f of row.frames) {
      for(const op of f.operations) {
        if(op.method==="set")bindBanditRecovery(clock,op.reference==="a"?1:op.reference==="b"?2:undefined);
        else if(label()===op.reference)bindBanditRecovery(clock,undefined,true,true);
        expect({target:label(),elapsedMs:clock.elapsedMs,reloadMs:clock.reloadMs,finishMs:clock.finishMs??0})
          .toEqual({target:op.after.target,elapsedMs:op.after.elapsedMs,reloadMs:op.after.reloadMs,finishMs:op.after.finishMs});
        operations++;
      }
      const released=advanceBanditRecovery(clock,1/20,rate,clock.target===undefined?"targetless":true);
      expect({target:label(),elapsedMs:clock.elapsedMs,reloadMs:clock.reloadMs,finishMs:clock.finishMs??0})
        .toEqual({target:f.target,elapsedMs:f.elapsedMs,reloadMs:f.reloadMs,finishMs:f.finishMs});
      expect(released).toBe(!!f.ordinaryRequests.length);requests+=Number(released);updates++;
    }
  }
  expect({updates,operations,requests}).toEqual({updates:5040,operations:156,requests:236});
});

for(const team of ["blue","red"] as const) {
  it(`${team} reproduces complete native null/removal continuations through the actor loop`,()=>{
    let updates=0,requests=0;
    for(const row of [...native.cases,...native.controls].filter(r=>["null","removal"].includes(r.fields.method))) {
      const {b,bandit,target,second,select}=controlled(56,team,row.fields.direction);
      bandit.rage=row.fields.modifiers.includes("Rage")?{remaining:10}:undefined;
      bandit.slow=row.fields.modifiers.includes("IceWizardSlowDown")?{remaining:10}:undefined;
      let beforeHits=0,afterHits=0;
      for(const frame of row.frames) {
        if(frame.step===row.fields.lossUpdate) {
          if(row.fields.method==="removal")target.hp=0;else target.air=true;
          select(undefined);
        }
        if(frame.step===row.fields.resumeUpdate)select(second);
        while(b.tick<Math.ceil(frame.step*1.5))b.step();
        for(const req of frame.ordinaryRequests) {if(req.target==="a")beforeHits++;else afterHits++;}
        const clock=bandit.pendingAttack?.recovery??bandit.banditRecovery;
        const actualRef=clock?.target===target.id?"a":clock?.target===second.id?"b":null;
        const where=`${team}/${row.fields.method}/${JSON.stringify(row.fields.modifiers)}/${row.fields.warmUpdates}/${row.fields.gapUpdates}/${frame.step}`;
        expect({target:actualRef,elapsed:clock?.elapsedMs??0,reload:clock?.reloadMs??0,finish:clock?.finishMs??0},where)
          .toEqual({target:frame.target,elapsed:frame.elapsedMs,reload:frame.reloadMs,finish:frame.finishMs});
        expect(second.hp,where).toBe(10000-afterHits*bandit.damage);
        if(target.hp>0)expect(target.hp,where).toBe(10000-beforeHits*bandit.damage);
        expect(bandit.dash??bandit.dashCharge,where).toBeUndefined();
        requests+=frame.ordinaryRequests.length;updates++;
      }
    }
    expect(updates).toBe(4320);expect(requests).toBe(200);
  });
  it(`${team} resumes the legal Zap replacement swing sooner and exactly replays each stage`,()=>{
    for(const version of [55,56] as const) {
      const scene=banditResetOpening(version,team),removedAt=zapBanditTarget(scene);
      const {battle:b,bandit,knight}=scene;
      expect([scene.castTick,removedAt]).toEqual([182,187]);
      const rebuild=()=>{
        const replay=new Battle({replay:b.exportReplay()});while(replay.tick<b.tick)replay.step();
        expect(snapshot(replay)).toEqual(snapshot(b));expect(replay.audioEvents).toEqual(b.audioEvents);
      };
      rebuild();b.step();expect(bandit.pendingAttack?.target).toBe(knight.id);
      const clock=bandit.pendingAttack?.recovery!;
      expect(clock.elapsedMs).toBe(version===56?850:650);
      expect(clock.finishMs).toBe(version===56?1:undefined);
      rebuild();
      while(!b.events.some(e=>e.type==="hit"&&e.card==="bandit"&&!e.effect)&&b.tick<230)b.step();
      expect(b.tick).toBe(version===56?192:198);expect(bandit.hp).toBe(544);expect(knight.hp).toBe(1280);
      expect(b.exportReplay().actions.map(a=>a.card)).toEqual(["knight","skeletons","bandit","zap"]);rebuild();
    }
  });
}

it("releases a retargeted swing once when reselection occurs on the native request frame",()=>{
  for(const [rage,slow,first,next,elapsed] of [[false,false,8,28,1000],[true,false,6,21,1002],
    [false,true,13,44,1016],[true,true,10,33,1030]] as const) {
    const {b,bandit,target,second,select}=controlled();
    bandit.rage=rage?{remaining:10}:undefined;bandit.slow=slow?{remaining:10}:undefined;
    while(b.tick<Math.ceil((first-1)*1.5))b.step();
    target.hp=0;select(second);
    while(b.tick<Math.ceil(first*1.5))b.step();
    expect(second.hp).toBe(10000-bandit.damage);expect(bandit.pendingAttack).toBeUndefined();
    expect(bandit.banditRecovery).toMatchObject({target:second.id,elapsedMs:elapsed,finishMs:1});
    while(b.tick<Math.ceil(next*1.5))b.step();
    expect(second.hp).toBe(10000-2*bandit.damage);
  }
});

it("retains reload while walking and resets phase for a newly selected out-of-range reference",()=>{
  const prior=JSON.parse(readFileSync("reference/client/primary-transition-native-trace.json","utf8"));
  const source=prior.cases.filter((r:any)=>r.owner==="Knight" && r.setterRangeResults.length===1 &&
    !r.setterRangeResults[0] && r.before.elapsedMs>0 && !r.variableDamage);
  expect(source.length).toBeGreaterThan(0);
  for(const r of source)expect(r.after).toMatchObject({elapsedMs:0,reloadMs:r.before.reloadMs,finishMs:0,flag1d:0});
  const {b,bandit,target,second,select}=controlled();
  while(b.tick<5)b.step();target.hp=0;second.x=bandit.x+3;second.y=bandit.y;select(second);b.step();
  expect(bandit.banditRecovery).toMatchObject({elapsedMs:0,reloadMs:450,target:second.id});
  expect(bandit.banditRecovery?.finishMs).toBeUndefined();expect(bandit.dashCharge).toBeUndefined();
  second.x=bandit.x+1.75;
  while(second.hp===10000&&b.tick<50)b.step();
  expect(b.tick).toBe(30);expect(second.hp).toBe(10000-bandit.damage);
});

it("can charge a new distant reference after its setter reset while reload is still positive",()=>{
  const {b,bandit,target,second,select}=controlled();
  while(b.tick<5)b.step();target.hp=0;second.x=bandit.x+5;second.y=bandit.y;select(second);b.step();
  expect(bandit.banditRecovery).toMatchObject({elapsedMs:0,reloadMs:450,target:second.id});
  expect(bandit.dashCharge).toMatchObject({target:second.id,remainingMs:950});
  expect(bandit.banditRecovery?.finishMs).toBeUndefined();
});

it("preserves existing same-reference ordinary-to-dash timing through every native transition episode",()=>{
  const prior=JSON.parse(readFileSync("reference/client/dash-transition-native-trace.json","utf8"));
  let frames=0,requests=0;
  for(const team of ["blue","red"] as const)for(const row of [...prior.cases,...prior.controls]) {
    const {b,bandit,target,select}=controlled(56,team,row.fields.direction);
    target.x=bandit.x+5*row.fields.direction[0];target.y=bandit.y+5*row.fields.direction[1];select(target);
    if(row.fields.scenario==="phase-boundary") {
      const clock:BanditRecoveryClock={elapsedMs:row.fields.initialElapsedMs,reloadMs:row.fields.initialReloadMs,carry:0,target:target.id};
      if(clock.elapsedMs%1000>=600)bandit.pendingAttack={target:target.id,damage:bandit.damage,remaining:1,recovery:{...clock,animating:true}};
      else bandit.banditRecovery=clock;
    }
    let dashHits=0,normalHits=0;
    for(const f of row.frames) {
      for(const supplied of f.supplied) {
        if(supplied[0]==="target")Object.assign(target,{x:supplied[1]/1000,y:supplied[2]/1000});
        if(supplied[0]==="buffs") {
          bandit.rage=supplied.includes("Rage")?{remaining:10}:undefined;
          bandit.slow=supplied.includes("IceWizardSlowDown")?{remaining:10}:undefined;
        }
      }
      while(b.tick<Math.ceil(f.step*1.5))b.step();
      dashHits+=Number(f.hit);normalHits+=f.ordinaryRequests.length;
      const clock=bandit.pendingAttack?.recovery??bandit.banditRecovery;
      expect({x:bandit.x,y:bandit.y,elapsed:clock?.elapsedMs??0,reload:clock?.reloadMs??0})
        .toEqual({x:f.xy[0]/1000,y:f.xy[1]/1000,elapsed:f.elapsedMs,reload:f.reloadMs});
      expect(target.hp).toBe(10000-dashHits*Math.round(320*1.1**2)-normalHits*bandit.damage);
      expect(!!bandit.dash).toBe(f.state===4);frames++;requests+=f.ordinaryRequests.length;
    }
  }
  expect({frames,requests}).toEqual({frames:5736,requests:136});
});

it("keeps resumed control forecasts and fatal King deadlines exact with a retained finish clock",()=>{
  for(const [rage,slow] of [[0,0],[0.11,0],[0,0.27],[0.11,0.27]]) {
    const {b,bandit,target,second,select}=controlled();
    while(b.tick<5)b.step();target.hp=0;select(second);b.step();
    expect(bandit.pendingAttack?.recovery?.finishMs).toBe(1);
    second.x=bandit.x+5;bandit.rage=rage?{remaining:rage}:undefined;bandit.slow=slow?{remaining:slow}:undefined;
    const before=JSON.stringify(bandit.pendingAttack),start=b.tick;
    const forecast=projectTornadoWindup(bandit,second,[]);
    Object.assign(second,{card:"tower",kind:"tower",king:true,hp:bandit.damage});
    const fatal=fatalKingWindups(second.team,[bandit,second]);expect(fatal).toHaveLength(1);
    expect(JSON.stringify(bandit.pendingAttack)).toBe(before);
    while(second.hp>0&&b.tick<start+60)b.step();
    expect(b.tick-start).toBe(forecast.releaseStep);expect(b.tick-start).toBe(fatal[0].step);
  }
});

it("keeps shared stun cancellation and unrelated target death outside the retained-reference path",()=>{
  const {b,bandit,target,second}=controlled();while(b.tick<5)b.step();
  const before=bandit.pendingAttack?.recovery?.elapsedMs;second.hp=0;b.step();
  expect(bandit.pendingAttack?.target).toBe(target.id);expect(bandit.pendingAttack?.recovery?.elapsedMs).toBeGreaterThan(before!);
  bandit.stun=1;b.step();expect(bandit.pendingAttack).toBeUndefined();expect(bandit.banditRecovery).toBeUndefined();
});

it("copies retained reference/finish state for guests and replaces it with old-host policy",()=>{
  const current=controlled();while(current.b.tick<5)current.b.step();current.target.hp=0;current.select(current.second);current.b.step();
  const live=current.bandit.pendingAttack!.recovery!;
  const guest=perspective(snapshot(current.b),"red").entities.find(e=>e.card==="bandit")!;
  expect(guest.nativeBanditTargetReset).toBe(true);expect(guest.pendingAttack?.recovery).toEqual(live);
  expect(guest.pendingAttack?.recovery).not.toBe(live);
  const old=controlled(55);applySnapshot(current.b,snapshot(old.b),"blue");
  expect(current.b.entities.find(e=>e.card==="bandit")?.nativeBanditTargetReset).toBeUndefined();
});

it("keeps Mirror/Clone policy while fresh copies clear retained reference and finish clocks",()=>{
  for(const version of [55,56] as const) {
    const {b,bandit}=controlled(version);while(b.tick<5)b.step();
    if(version===56)bandit.pendingAttack!.recovery!.finishMs=201;
    b.players.blue.lastPlayed="bandit";b.players.blue.hand[0]="mirror";b.players.blue.elixir=10;
    expect(b.play("blue",0,4,22).ok).toBe(true);
    const mirrored=b.entities.filter(e=>e.card==="bandit").at(-1)!;
    expect(!!mirrored.nativeBanditTargetReset).toBe(version===56);expect(mirrored.banditRecovery).toBeUndefined();
    b.players.blue.hand[0]="clone";b.players.blue.elixir=10;
    expect(b.play("blue",0,bandit.x,bandit.y).ok).toBe(true);b.step();
    const cloned=b.entities.find(e=>e.card==="bandit"&&e.clone)!;
    expect(!!cloned.nativeBanditTargetReset).toBe(version===56);expect(cloned.banditRecovery).toBeUndefined();
    expect(cloned.pendingAttack).toBeUndefined();
  }
});

it("pins finish timing to the new source output while preserving the prior card-data output",()=>{
  const manifest=JSON.parse(readFileSync("reference/client/bandit-manifest.json","utf8"));
  for(const input of [...manifest.inputs,manifest.output,manifest.nativeTargetReset.output])
    expect(createHash("sha256").update(readFileSync(input.path)).digest("hex")).toBe(input.sha256);
  expect(manifest.nativeTargetReset).toMatchObject({finishTimeMs:250,nullRequestUpdates:[20,40,60],removalRequestUpdates:[12,32,52]});
  expect(manifest.output.sha256).toBe("867157ab8c7e8fd77e24e84471da7b60c9212167ef33e9efa1cadd9143569f88");
});

it("records and reconstructs a complete rules-56 game containing the legal target replacement",()=>{
  const b=new Battle({replay:{...golden.cases[8].replay,version:56} as Replay});
  while(!b.winner&&b.tick<12000)b.step();expect(b.winner).not.toBeNull();
  const replay=new Battle({replay:b.exportReplay()});while(replay.tick<b.tick)replay.step();
  expect(replay.rulesVersion).toBe(56);expect(snapshot(replay)).toEqual(snapshot(b));expect(replay.audioEvents).toEqual(b.audioEvents);
});

it("expires targetless finish windows on native frames across twenty world phases and every modifier",()=>{
  for(const team of ["blue","red"] as const)for(let phase=0;phase<20;phase++)
    for(const [rage,slow] of [[false,false],[true,false],[false,true],[true,true]] as const) {
      const {b,bandit,target,select}=controlled(56,team);b.tick=phase;
      bandit.rage=rage?{remaining:10}:undefined;bandit.slow=slow?{remaining:10}:undefined;
      const rate=attackClockRate(bandit,rage,slow),warm=600+3*Math.round(50*rate);
      while((bandit.pendingAttack?.recovery?.elapsedMs??0)<warm&&b.tick<phase+20)b.step();
      expect(bandit.pendingAttack?.recovery?.reloadMs).toBe(500);
      target.hp=0;select(undefined);const start=b.tick;let expected=1;
      while(Math.floor((start+expected)*2/3+1e-8)-Math.floor(start*2/3+1e-8)<5)expected++;
      b.step();while(bandit.banditRecovery?.finishMs&&b.tick<start+20)b.step();
      expect(b.tick-start).toBe(expected);
      expect(bandit.banditRecovery).toMatchObject({elapsedMs:0,reloadMs:250});
      expect(bandit.banditRecovery?.finishMs).toBeUndefined();expect(bandit.banditRecovery?.target).toBeUndefined();
    }
});
