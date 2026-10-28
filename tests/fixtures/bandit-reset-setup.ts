import { Battle, type Replay, type Team } from "../../src/game/engine";
import type { CardId } from "../../src/game/cards";
import { attackReach } from "../../src/game/attack-range";

const deck: CardId[] = ["bandit","zap","rage","heal","cannon","archers","ice-wizard","knight"];
const enemy: CardId[] = ["knight","skeletons","cannon","archers","zap","ice-wizard","rage","poison"];

/** Legal close targets; Zap can remove the selected Skeleton during a swing. */
export function banditResetOpening(version: Replay["version"] = 56, runner: Team = "blue") {
  const defender = runner === "blue" ? "red" : "blue";
  let initial: Battle | undefined;
  for(let seed=1;seed<10000;seed++) {
    const sample=new Battle({seed,ai:false,deck:runner==="blue"?deck:enemy,enemyDeck:runner==="blue"?enemy:deck});
    if(["bandit","zap","rage"].every(card=>sample.players[runner].hand.includes(card as CardId)) &&
       ["knight","skeletons"].every(card=>sample.players[defender].hand.includes(card as CardId))) {initial=sample;break;}
  }
  if(!initial) throw new Error("No legal target-reset opening");
  const battle=new Battle({replay:{...initial.exportReplay(),version}});
  const x=runner==="blue"?4:14, y=runner==="blue"?19:13;
  const play=(team:Team,card:CardId,px:number,py:number)=>{
    const result=battle.play(team,battle.players[team].hand.indexOf(card),px,py);
    if(!result.ok) throw new Error(`${card}: ${result.reason}`);
  };
  while(battle.tick<15) battle.step(); play(defender,"knight",runner==="blue"?3.5:14.5,runner==="blue"?13.5:18.5);
  while(battle.tick<30) battle.step(); play(defender,"skeletons",x,runner==="blue"?13.5:18.5);
  while(battle.tick<150) battle.step(); play(runner,"bandit",x,y);
  const bandit=battle.entities.find(e=>e.card==="bandit")!, knight=battle.entities.find(e=>e.card==="knight")!;
  while(battle.tick<250) {
    battle.step();
    if(bandit.dashCharge||bandit.dash) throw new Error("Close target opening unexpectedly dashed");
    const victim=battle.entities.find(e=>e.id===bandit.pendingAttack?.target);
    if(victim?.card==="skeletons" && Math.hypot(bandit.x-knight.x,bandit.y-knight.y)<=attackReach(bandit,knight))
      return {battle,bandit,knight,victim,runner,defender,castTick:battle.tick};
  }
  throw new Error("No legal Skeleton windup beside the Knight");
}

export function zapBanditTarget(scene:ReturnType<typeof banditResetOpening>) {
  const {battle,runner,victim}=scene;
  const result=battle.play(runner,battle.players[runner].hand.indexOf("zap"),victim.x,victim.y);
  if(!result.ok) throw new Error(`Zap: ${result.reason}`);
  while(victim.hp>0 && battle.tick<scene.castTick+15) battle.step();
  if(victim.hp>0) throw new Error("Zap did not remove the selected Skeleton");
  return battle.tick;
}
