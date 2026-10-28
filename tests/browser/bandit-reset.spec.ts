import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { expectedEffects } from "./native-assets";

test("Bandit retains a queued cycle across legal Zap target removal and close reselection",async({page},info)=>{
  test.setTimeout(180000);
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/tests/fixtures/bandit-reset.html");
  const state=async()=>JSON.parse((await page.locator("#status").getAttribute("data-state"))!);
  await expect.poll(async()=>(await state()).effects,{timeout:60000}).toBe(expectedEffects);
  const traces=[];
  const replay=async(before:any)=>{
    await page.locator("#replay").click();
    await expect.poll(async()=>(await state()).replayBuilds).toBe(before.replayBuilds+1);
    expect(await state()).toEqual({...before,replayBuilds:before.replayBuilds+1});
  };
  for(const version of [55,56])for(const runner of ["blue","red"]) {
    await page.locator("#rules").selectOption(String(version));await page.locator("#team").selectOption(runner);
    await expect.poll(async()=>{const s=await state();return[s.stage,s.version,s.runner];}).toEqual(["preparing",version,runner]);
    const before=await state();expect(before.tick).toBe(182);expect(before.native).toBe(version===56);
    await page.locator("#zap").click();await expect.poll(async()=>(await state()).stage).toBe("lost");
    const lost=await state();expect(lost.tick).toBe(187);expect(lost.victimHp).toBe(0);expect(lost.hits).toHaveLength(0);
    await replay(lost);
    await page.locator("#retarget").click();await expect.poll(async()=>(await state()).stage).toBe("resumed");
    const resumed=await state();expect(resumed.tick).toBe(188);expect(resumed.pending.target).toBe(resumed.knightId);
    expect(resumed.pending.recovery.elapsedMs).toBe(version===56?850:650);
    expect(resumed.pending.recovery.finishMs).toBe(version===56?1:undefined);
    await replay(resumed);
    await page.locator("#advance").click();await expect.poll(async()=>(await state()).stage).toBe("hit");
    const hit=await state();expect(hit.tick).toBe(version===56?192:198);
    expect(hit.hits).toHaveLength(1);expect(hit.hp).toBe(544);expect(hit.targetHp).toBe(1280);
    expect(hit.dash??hit.charge).toBeUndefined();
    expect(hit.actions.map((a:{card:string})=>a.card)).toEqual(["knight","skeletons","bandit","zap"]);
    if(version===56)await page.screenshot({path:info.outputPath(`bandit-${runner}-replacement-hit.png`)});
    await replay(hit);traces.push({version,runner,before,lost,resumed,hit});
  }
  expect(errors).toEqual([]);
  const path=info.outputPath("bandit-reset-traces.json");await writeFile(path,JSON.stringify(traces,null,2));
  await info.attach("bandit-reset-traces",{path,contentType:"application/json"});
});
