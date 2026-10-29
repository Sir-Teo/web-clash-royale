import { Battle, type Entity, type Replay, type Team } from "../../src/game/engine";
import { Arena } from "../../src/render/arena";
import { banditResetOpening, zapBanditTarget } from "./bandit-reset-setup";

const arena=new Arena(document.querySelector<HTMLElement>("#arena")!);
const status=document.querySelector<HTMLOutputElement>("#status")!;
const value=(id:string)=>document.querySelector<HTMLSelectElement>(`#${id}`)!.value;
let scene:ReturnType<typeof banditResetOpening>, battle:Battle,bandit:Entity,knight:Entity;
let stage="preparing",replayBuilds=0,renderedTime=0,removedAt=0;
const hits=()=>battle.events.filter(e=>e.type==="hit"&&e.card==="bandit"&&!e.effect);
function setup() {
  scene=banditResetOpening(Number(value("rules")) as Replay["version"],value("team") as Team);
  ({battle,bandit,knight}=scene);stage="preparing";replayBuilds=removedAt=0;
  arena.setBattle(battle);renderedTime=battle.time;
}
document.querySelectorAll("select").forEach(s=>s.addEventListener("change",setup));
document.querySelector("#zap")!.addEventListener("click",()=>{
  if(stage!=="preparing")return;
  const victim=battle.entities.find(e=>e.id===scene.victim.id)!;
  removedAt=zapBanditTarget({...scene,battle,bandit,knight,victim});stage="lost";
});
document.querySelector("#retarget")!.addEventListener("click",()=>{
  if(stage!=="lost")return;
  battle.step();
  if(bandit.pendingAttack?.target!==knight.id)throw new Error("Bandit did not reselect the Knight");
  stage="resumed";
});
document.querySelector("#advance")!.addEventListener("click",()=>{
  if(stage!=="resumed")return;
  while(!hits().length&&battle.tick<scene.castTick+60&&bandit.hp>0)battle.step();
  if(hits().length!==1)throw new Error("Bandit did not release one replacement hit");stage="hit";
});
document.querySelector("#replay")!.addEventListener("click",()=>{
  const tick=battle.tick;battle=new Battle({replay:battle.exportReplay()});
  while(battle.tick<tick)battle.step();
  bandit=battle.entities.find(e=>e.card==="bandit")!;
  knight=battle.entities.find(e=>e.id===knight.id)!;
  replayBuilds++;arena.setBattle(battle);renderedTime=battle.time;
});
setup();
function render() {
  arena.render(Math.max(0,battle.time-renderedTime),battle.time);renderedTime=battle.time;
  status.textContent=`Bandit · ${stage} · ${hits().length} replacement hits`;
  status.dataset.state=JSON.stringify({tick:battle.tick,version:battle.rulesVersion,runner:value("team"),stage,
    castTick:scene.castTick,removedAt,hp:bandit.hp,targetHp:knight.hp,knightId:knight.id,
    victimHp:battle.entities.find(e=>e.id===scene.victim.id)?.hp??0,x:bandit.x,y:bandit.y,
    pending:bandit.pendingAttack,recovery:bandit.banditRecovery,dash:bandit.dash,charge:bandit.dashCharge,
    native:!!bandit.nativeBanditTargetReset,hits:hits(),hitTicks:hits().map(e=>Math.round(e.time*30)),
    replayBuilds,actions:battle.exportReplay().actions,effects:arena.loadedEffects,
    attacks:battle.audioEvents.filter(e=>e.phase==="attack"&&e.profile==="bandit").length,
    cancels:battle.audioEvents.filter(e=>e.phase==="cancel"&&e.profile==="bandit").length});
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
