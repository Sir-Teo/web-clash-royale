import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

type Reference = "a" | "b" | null;
interface Clock { target: Reference; elapsedMs: number; reloadMs: number; finishMs: number; flag1d: number; cached: number[] }
interface Operation { method: "set" | "remove"; reference: Reference; before: Clock; after: Clock; events: unknown[][]; exactHeapChangesOnly: boolean }
interface Frame extends Clock { step: number; operations: Operation[]; events: unknown[][]; ordinaryRequests: any[];
  policyReturns: number[]; calls: Record<string, number>; targetHp: number[]; exactHeapChangesOnly: boolean }
interface Episode { fields: { direction: number[]; method: string; modifiers: string[]; warmUpdates: number; gapUpdates: number;
  lossUpdate: number; resumeUpdate: number | null; targetPoints: Record<"a" | "b", number[]> }; frames: Frame[] }
const path = "reference/client/bandit-target-reset-native-trace.json";
const trace = JSON.parse(readFileSync(path, "utf8"));
const rows: Episode[] = [...trace.cases, ...trace.controls];
const ticks = (r: Episode) => r.frames.filter(f => f.ordinaryRequests.length).map(f => f.step);

it("pins full Bandit target transitions to source profiles, settings, selected native blocks and prerequisites", () => {
  expect(trace.sha256).toBe("c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746");
  expect(createHash("sha256").update(readFileSync(path)).digest("hex")).toBe("22bcccdaed004b4a99542b57a0e9f6334237a37e77d74084455d4b126abd64b8");
  for (const input of trace.inputs)
    expect(createHash("sha256").update(readFileSync(input.path)).digest("hex")).toBe(input.sha256);
  expect(trace.stepMs).toBe(50);
  expect(trace.profiles).toEqual({ attacker: "Assassin", targets: ["Knight", "Knight"], targetHp: [1000,1000],
    loadTimeMs: 600, hitSpeedMs: 1000, dashCooldownMs: 1000, finishTimeMs: 250, allowAoeWithoutTarget: true,
    loadFirstHit: false, selfAsAoeCenter: false, hasProjectile: false, targetlessPolicyReturn: 1,
    initialExtraClockMs: 0, targetDistance: 1750, ownRadius: 600, targetRadius: 500 });
  expect(trace.globalReads).toEqual([{offset:"0x1dc",size:4,pc:"0x1f3571"},{offset:"0x201",size:1,pc:"0x25f6d2"},
    {offset:"0x295",size:1,pc:"0x25ddea"},{offset:"0x314",size:4,pc:"0x25de02"}]);
  expect(trace.cases).toHaveLength(8); expect(trace.controls).toHaveLength(76);
  expect(trace.blocks).toHaveLength(11);
  for (const b of trace.blocks) expect(b.instructions.length).toBeGreaterThan(3);
});

function reconstruct(row: Episode) {
  const f = row.fields, [dx,dy] = f.direction;
  const points = {a:[8250+1750*dx,8250+1750*dy],b:[8250-1750*dx,8250-1750*dy]};
  expect(f.targetPoints).toEqual(points);
  let target: Reference="a", elapsed=0, reload=0, finish=0, flag=0, cached=[0,0];
  const state = (): Clock => ({target,elapsedMs:elapsed,reloadMs:reload,finishMs:finish,flag1d:flag,cached:[...cached]});
  const positive = f.modifiers.includes("Rage") ? 135 : 100;
  const negative = f.modifiers.includes("IceWizardSlowDown") ? 35 : 0;
  const delta = Math.trunc(Math.trunc(50*positive/100)*(100-negative)/100);
  for (const frame of row.frames) {
    const commands: ["set"|"remove",Reference][]=[];
    if(frame.step===f.lossUpdate) commands.push(f.method==="null"?["set",null]:f.method==="removal"?["remove","a"]:
      f.method==="switch"?["set","b"]:f.method==="refresh"?["set","a"]:["remove","b"]);
    if(frame.step===f.resumeUpdate) commands.push(["set","b"]);
    expect(frame.operations.map(o=>[o.method,o.reference])).toEqual(commands);
    const events: unknown[][]=[],requests: any[]=[];
    let setters=0, removals=0, setterValidity=0, resetNotifications=0;
    frame.operations.forEach((op,i)=>{
      expect(op.before).toEqual(state());
      const operationEvents: unknown[][]=[];
      const [method,reference]=commands[i];
      if(method==="set") {
        setters++;
        if(target!==reference) {
          target=reference;
          if(target===null) {operationEvents.push(["providedReset"]);resetNotifications++;}
          else setterValidity++;
          if(!finish) operationEvents.push(["providedPathRefresh"]);
        }
        if(target) cached=[...points[target]];
      } else {
        removals++;
        if(target===reference) {target=null;if(elapsed>0) finish=1;}
      }
      expect(op.after).toEqual(state()); expect(op.events).toEqual(operationEvents);
      expect(op.exactHeapChangesOnly).toBe(true); events.push(...operationEvents);
    });
    const beforeFinish=finish, policy=target===null && flag!==0;
    reload=Math.max(0,reload-50);
    const expiry=target===null && beforeFinish>0 && beforeFinish+50>=250;
    const inactive=target===null && beforeFinish===0;
    if(target===null) {
      if(finish>0) finish+=50;
      if(!finish || finish>=250) {elapsed=finish=flag=0;if(inactive) events.push(["providedReset"]);}
    } else {
      cached=[...points[target]];
      const cycle=Math.floor(elapsed/1000);
      if(!elapsed) {elapsed+=600-reload;reload=600;flag=Number(elapsed%1000>=600);}
      elapsed+=delta;
      if(Math.floor(elapsed/1000)>cycle) {
        flag=0;
        events.push(["providedView","attack"],["ordinaryRequest",-1]);
        requests.push({tick:frame.step,elapsedMs:elapsed,reloadMs:reload,finishMs:finish,target,flag1d:0,hitIndex:-1,reloadAfterMs:600});
        reload=600;
      }
    }
    expect({target:frame.target,elapsedMs:frame.elapsedMs,reloadMs:frame.reloadMs,
      finishMs:frame.finishMs,flag1d:frame.flag1d,cached:frame.cached}).toEqual(state());
    expect(frame.events).toEqual(events); expect(frame.ordinaryRequests).toEqual(requests);
    expect(frame.policyReturns).toEqual(policy?[1]:[]);
    expect(frame.targetHp).toEqual([1000,1000]); expect(frame.exactHeapChangesOnly).toBe(true);
    const drivers={fullAttack:1,targetSetter:setters,targetRemoval:removals,removalBase:removals,
      providedValidity:Number(target!==null)+setterValidity,admission:2*Number(target!==null),buffClock:Number(target!==null),
      ordinaryRequest:requests.length,providedPrimaryScan:Number(target===null && beforeFinish===0),providedExtraScan:0,
      targetlessPolicy:Number(policy),targetlessPolicyExit:Number(policy),finishExpiry:Number(expiry),inactiveClock:Number(inactive),
      providedReset:resetNotifications+Number(inactive),countdownFragment:0,movementFrame:0,attackReload:0};
    for(const [name,count] of Object.entries(drivers)) expect(frame.calls[name]??0,`${f.method}/${frame.step}/${name}`).toBe(count);
  }
}

it("independently reconstructs every operation, native update, request, ordered event and selected driver", () => {
  rows.forEach(reconstruct);
  const frames=rows.flatMap(r=>r.frames);
  expect(frames).toHaveLength(5040);
  expect(frames.flatMap(f=>f.operations)).toHaveLength(156);
  expect(frames.flatMap(f=>f.ordinaryRequests)).toHaveLength(236);
});

it("retains real-time reload across explicit null gaps under every source modifier", () => {
  for(const [modifiers,expected] of [[[],[20,40,60]],[["Rage"],[17,32,47]],[["IceWizardSlowDown"],[28,59]],
    [["Rage","IceWizardSlowDown"],[23,46]]] as const) {
    const samples=rows.filter(r=>r.fields.method==="null" && r.fields.warmUpdates===3 && r.fields.gapUpdates===4 &&
      JSON.stringify(r.fields.modifiers)===JSON.stringify(modifiers));
    expect(samples).toHaveLength(4);
    for(const r of samples) {
      expect(ticks(r)).toEqual(expected);
      expect(r.frames.slice(3,7).map(f=>f.reloadMs)).toEqual([450,400,350,300]);
      expect(r.frames.slice(3,7).map(f=>f.elapsedMs)).toEqual([0,0,0,0]);
      expect(r.frames[7].operations[0].before).toMatchObject({target:null,elapsedMs:0,reloadMs:300});
      expect(r.frames[7].target).toBe("b");
    }
  }
});

it("keeps a removal finish window and distinguishes inline expiry from notified inactive resets", () => {
  for(const r of rows.filter(r=>r.fields.method==="removal" && !r.fields.modifiers.length && r.fields.warmUpdates===3)) {
    if(r.fields.gapUpdates===4) {
      expect(r.frames.slice(3,7).map(f=>[f.elapsedMs,f.finishMs])).toEqual([[750,51],[750,101],[750,151],[750,201]]);
      expect(ticks(r)).toEqual([12,32,52]);
    }
    if(r.fields.gapUpdates===16) {
      expect(r.frames[7]).toMatchObject({target:null,elapsedMs:0,finishMs:0,reloadMs:250,flag1d:0});
      expect(r.frames[7].calls.finishExpiry).toBe(1); expect(r.frames[7].calls.inactiveClock).toBeUndefined();
      expect(r.frames[7].events).toEqual([]);
      expect(r.frames[8].calls.inactiveClock).toBe(1); expect(r.frames[8].events).toEqual([["providedReset"]]);
      expect(ticks(r)).toEqual([27,47]);
    }
  }
});

it("preserves a queued phase across immediate distinct-target reselection for both notification methods", () => {
  const samples=rows.filter(r=>["null","removal"].includes(r.fields.method) && r.fields.gapUpdates===0);
  expect(samples).toHaveLength(8);
  for(const r of samples) {
    expect(r.frames[3].target).toBe("b"); expect(r.frames[3].elapsedMs).toBe(800);
    expect(ticks(r)).toEqual([8,28,48]);
    expect(r.frames[3].finishMs).toBe(r.fields.method==="removal"?1:0);
    expect(r.frames[7].ordinaryRequests[0].target).toBe("b");
  }
});

it("distinguishes unstarted clocks from target loss after an ordinary request", () => {
  const samples=rows.filter(r=>[0,8].includes(r.fields.warmUpdates));
  expect(samples).toHaveLength(16);
  for(const r of samples) {
    if(r.fields.warmUpdates===0) {
      expect(r.frames[0].operations[0].after).toMatchObject({target:null,elapsedMs:0,reloadMs:0,finishMs:0});
      expect(ticks(r)).toEqual([12,32,52]);
    } else expect(ticks(r)).toEqual(r.fields.method==="null"?[8,27,47]:[8,32,52]);
  }
});

it("keeps direct switching, same-reference refresh and unrelated removal distinct", () => {
  const samples=rows.filter(r=>["switch","refresh","other-removal"].includes(r.fields.method));
  expect(samples).toHaveLength(12);
  for(const r of samples) {
    expect(ticks(r)).toEqual([8,28,48]);
    const op=r.frames[3].operations[0];
    if(r.fields.method==="switch") {
      expect(op.after).toMatchObject({target:"b",elapsedMs:750,reloadMs:500,cached:r.fields.targetPoints.b});
      expect(op.events).toEqual([["providedPathRefresh"]]);
    } else {expect(op.after).toEqual(op.before);expect(op.events).toEqual([]);}
  }
});

it("keeps native packet delivery, natural death propagation and acquisition outside the claim", () => {
  expect(trace.limits.join(" ")).toContain("Natural death/removal propagation");
  expect(trace.limits.join(" ")).toContain("request timing is not proof of a hit");
  expect(trace.limits.join(" ")).toContain("Gameplay remains rules 55");
  for(const row of rows) for(const frame of row.frames) for(const request of frame.ordinaryRequests) {
    expect(["a","b"]).toContain(request.target);expect(request.hitIndex).toBe(-1);expect(request.reloadAfterMs).toBe(600);
  }
});
