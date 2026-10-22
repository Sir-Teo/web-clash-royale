import { CARD_MAP, STARTER_DECK } from './cards';
import type { CardId } from './cards';
export type Team='blue'|'red';
export type Mode='classic'|'training'|'double';
export const STEP=1/30;
export const other=(t:Team):Team=>t==='blue'?'red':'blue';
export interface Point{x:number;y:number}
export interface Entity extends Point {
 id:number;team:Team;card:CardId|'tower';kind:'troop'|'building'|'tower';hp:number;maxHp:number;
 radius:number;air:boolean;damage:number;range:number;cooldown:number;interval:number;speed:number;
 target:number|null;age:number;deploy:number;stun:number;attack:number;move:number;king?:boolean;active:boolean;
 lane?:'left'|'right';lifetime?:number;spawnTimer:number;
}
export interface Projectile extends Point {id:number;team:Team;tx:number;ty:number;target:number|null;damage:number;remaining:number;duration:number;splash:number;air:boolean;style:string;stun:number;source:number}
export interface BattleEvent extends Point {id:number;type:'deploy'|'hit'|'death'|'crown'|'spell'|'phase'|'finish';team:Team;card?:CardId|'tower';value?:number}
export interface Action extends Point {tick:number;team:Team;card:CardId}
export interface Replay {version:1;seed:number;mode:Mode;deck:CardId[];enemyDeck:CardId[];actions:Action[];duration:number}
export interface PlayerState {elixir:number;hand:CardId[];queue:CardId[];crowns:number}
export interface EngineOptions{seed?:number;mode?:Mode;deck?:CardId[];enemyDeck?:CardId[];replay?:Replay;ai?:boolean}
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
export class Battle {
 readonly seed:number;readonly mode:Mode;readonly deck:CardId[];readonly enemyDeck:CardId[];
 tick=0;entities:Entity[]=[];projectiles:Projectile[]=[];events:BattleEvent[]=[];actions:Action[]=[];
 players:Record<Team,PlayerState>;winner:Team|'draw'|null=null;reason='';
 private randomState:number;private nextId=1;private aiTimer=2.5;private ai:boolean;private replayActions:Action[]|null;private replayIndex=0;
 constructor(options:EngineOptions={}){
   const r=options.replay;
   this.seed=r?.seed??options.seed??Date.now()%2147483647;this.randomState=this.seed||1;
   this.mode=r?.mode??options.mode??'classic';this.deck=[...(r?.deck??options.deck??STARTER_DECK)];
   this.enemyDeck=[...(r?.enemyDeck??options.enemyDeck??['giant','archers','knight','bomber','minions','fireball','mini-pekka','arrows'])];
   this.validateDeck(this.deck);this.validateDeck(this.enemyDeck);
   this.ai=!r&&(options.ai??true);this.replayActions=r?.actions??null;
   const player=(deck:CardId[]):PlayerState=>{const shuffled=[...deck];for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]]}return{elixir:5,hand:shuffled.slice(0,4),queue:shuffled.slice(4),crowns:0}};
   this.players={blue:player(this.deck),red:player(this.enemyDeck)};
   for(const team of ['red','blue'] as Team[]){
    this.makeTower(team,4,team==='blue'?26:6,false,'left');this.makeTower(team,14,team==='blue'?26:6,false,'right');
    this.makeTower(team,9,team==='blue'?29.5:2.5,true);
   }
 }
 private validateDeck(deck:CardId[]){if(deck.length!==8||new Set(deck).size!==8||deck.some(id=>!CARD_MAP[id]))throw new Error('A deck must contain eight unique valid cards.');}
 random(){this.randomState=(Math.imul(1664525,this.randomState)+1013904223)>>>0;return this.randomState/4294967296;}
 get time(){return this.tick*STEP;}
 get phase(){return this.time>=240?'triple':this.time>=180?'overtime':this.time>=120?'double':'normal';}
 get multiplier(){return this.mode==='double'?this.time>=240?3:2:this.time>=240?3:this.time>=120?2:1;}
 get remaining(){return Math.max(0,(this.time>=180?300:180)-this.time);}
 private makeTower(team:Team,x:number,y:number,king:boolean,lane?:'left'|'right'){
  this.entities.push({id:this.nextId++,team,x,y,card:'tower',kind:'tower',hp:king?4824:3052,maxHp:king?4824:3052,radius:king?1.25:1.05,air:false,damage:king?109:109,range:king?7:7.5,cooldown:0,interval:king?1:0.8,speed:0,target:null,age:0,deploy:0,stun:0,attack:0,move:0,king,lane,active:!king,spawnTimer:0});
 }
 canPlace(team:Team,id:CardId,x:number,y:number):{ok:boolean;reason:string}{
   if(this.winner)return{ok:false,reason:'The battle has ended.'};
   if(!Number.isFinite(x)||!Number.isFinite(y)||x<0.5||x>17.5||y<0.7||y>31.3)return{ok:false,reason:'Place your card inside the arena.'};
   const c=CARD_MAP[id];if(!c)return{ok:false,reason:'Unknown card.'};
   if(c.kind==='spell')return{ok:true,reason:''};
   const lane=x<9?'left':'right';const enemyPrincess=this.entities.some(e=>e.team!==team&&e.kind==='tower'&&!e.king&&e.lane===lane&&e.hp>0);
   if(team==='blue'&&y<(enemyPrincess?17.8:11.5)||team==='red'&&y>(enemyPrincess?14.2:20.5))return{ok:false,reason:'Deploy troops on your side of the arena.'};
   if(y>14.5&&y<17.5)return{ok:false,reason:'Troops cannot be deployed in the river.'};
   if(this.entities.some(e=>e.hp>0&&e.kind!=='troop'&&dist(e,{x,y})<e.radius+(c.kind==='building'?1.05:0.35)))return{ok:false,reason:'That space is occupied by a building.'};
   return{ok:true,reason:''};
 }
 play(team:Team,slot:number,x:number,y:number):{ok:boolean;reason:string}{
   const p=this.players[team];const id=p.hand[slot];if(!id)return{ok:false,reason:'Select a card.'};
   const c=CARD_MAP[id];if(p.elixir+1e-6<c.cost)return{ok:false,reason:`You need ${c.cost} elixir.`};
   const allowed=this.canPlace(team,id,x,y);if(!allowed.ok)return allowed;
   if(this.entities.filter(e=>e.kind==='troop'&&e.team===team&&e.hp>0).length>160)return{ok:false,reason:'Too many troops on the field.'};
   p.elixir-=c.cost;p.hand[slot]=p.queue.shift()!;p.queue.push(id);
   this.actions.push({tick:this.tick,team,card:id,x,y});
   this.emit(c.kind==='spell'?'spell':'deploy',team,x,y,id);
   if(c.kind==='spell'){
    const duration=id==='zap'?0.15:id==='arrows'?0.65:0.9;
    this.projectiles.push({id:this.nextId++,team,x:team==='blue'?9:9,y:team==='blue'?30:2,tx:x,ty:y,target:null,damage:c.damage,remaining:duration,duration,splash:c.radius!,air:true,style:id,stun:c.stun??0,source:0});
   }else{
    for(let i=0;i<c.count;i++){
     const angle=i*2.39996;const spread=c.count===1?0:Math.sqrt(i)*0.43;
     this.spawn(id,team,clamp(x+Math.cos(angle)*spread,0.6,17.4),clamp(y+Math.sin(angle)*spread,0.8,31.2));
    }
   }
   return{ok:true,reason:''};
 }
 private spawn(id:CardId,team:Team,x:number,y:number){
   const c=CARD_MAP[id];this.entities.push({id:this.nextId++,team,x,y,card:id,kind:c.kind==='building'?'building':'troop',hp:c.hp,maxHp:c.hp,radius:c.kind==='building'?0.8:c.hp>3000?0.55:c.count>2?0.25:0.37,air:!!c.air,damage:c.damage,range:c.range,cooldown:0.4,interval:c.interval,speed:c.speed,target:null,age:0,deploy:1,stun:0,attack:0,move:0,active:true,lifetime:c.lifetime,spawnTimer:4});
 }
 private emit(type:BattleEvent['type'],team:Team,x:number,y:number,card?:CardId|'tower',value?:number){this.events.push({id:this.nextId++,type,team,x,y,card,value});if(this.events.length>160)this.events.splice(0,this.events.length-160);}
 step(){
   if(this.winner)return;
   if(this.replayActions){while(this.replayIndex<this.replayActions.length&&this.replayActions[this.replayIndex].tick===this.tick){const a=this.replayActions[this.replayIndex++];this.play(a.team,this.players[a.team].hand.indexOf(a.card),a.x,a.y);}}
   if(this.ai){this.aiTimer-=STEP;if(this.aiTimer<=0){this.think();this.aiTimer=(this.mode==='training'?2.5:1.1)+this.random()*1.3;}}
   const beforePhase=this.phase;this.tick++;
   for(const t of ['blue','red'] as Team[])this.players[t].elixir=Math.min(10,this.players[t].elixir+STEP/2.8*this.multiplier);
   for(const e of [...this.entities]){
    if(e.hp<=0)continue;
    e.age+=STEP;e.attack=Math.max(0,e.attack-STEP);e.stun=Math.max(0,e.stun-STEP);
    if(e.deploy>0){e.deploy-=STEP;continue;}
    if(e.lifetime){this.hurt(e,e.maxHp/e.lifetime*STEP);if(e.hp<=0)continue;}
    if(e.stun>0)continue;
    e.cooldown=Math.max(0,e.cooldown-STEP);
    if(!e.active)continue;
    if(e.card==='witch'){
     e.spawnTimer-=STEP;if(e.spawnTimer<=0){e.spawnTimer=7;for(let i=0;i<3;i++)this.spawn('skeletons',e.team,clamp(e.x+(i-1)*0.6,0.6,17.4),clamp(e.y+(e.team==='blue'?-0.8:0.8),0.8,31.2));}
    }
    const card=e.card==='tower'?null:CARD_MAP[e.card];
    const canAttack=(v:Entity)=>v.hp>0&&v.team!==e.team&&(!v.air||e.kind==='tower'||card?.hitsAir)&&(!card?.buildingsOnly||v.kind!=='troop');
    let target=this.entities.find(v=>v.id===e.target&&canAttack(v));
    if(target&&target.kind==='troop'&&dist(e,target)>Math.max(6.5,e.range+2))target=undefined;
    if(!target){
     const inSight=this.entities.filter(v=>canAttack(v)&&dist(e,v)<Math.max(5.5,e.range+v.radius));
     target=inSight.sort((a,b)=>dist(e,a)-a.radius-(dist(e,b)-b.radius))[0];
     if(!target&&e.kind==='troop')target=this.entities.filter(v=>canAttack(v)&&v.kind!=='troop').sort((a,b)=>dist(e,a)-a.radius-(dist(e,b)-b.radius))[0];
     e.target=target?.id??null;
    }
    if(!target)continue;
    const distance=dist(e,target);
    if(distance<=e.range+target.radius+e.radius*0.35){
      if(e.cooldown<=0){
       const damage=e.damage*(e.card==='prince'&&e.move>=2.3?2:1);e.move=0;e.cooldown=e.interval;e.attack=0.3;
       if(e.range>2||e.kind==='tower'||e.card==='balloon'){
        const duration=Math.max(0.1,distance/18);this.projectiles.push({id:this.nextId++,team:e.team,x:e.x,y:e.y,tx:target.x,ty:target.y,target:target.id,damage,remaining:duration,duration,splash:card?.splash??0,air:e.kind==='tower'||!!card?.hitsAir,style:e.kind==='tower'?'arrow':e.card,stun:0,source:e.id});
       }else if(card?.splash){for(const v of this.entities)if(canAttack(v)&&dist(v,e)<=card.splash+v.radius)this.hurt(v,damage);this.emit('hit',e.team,e.x,e.y,e.card);}
       else this.hurt(target,damage);
      }
    }else if(e.kind==='troop')this.moveToward(e,target);
   }
   for(const p of this.projectiles){
    p.remaining-=STEP;if(p.remaining>0)continue;
    const target=this.entities.find(e=>e.id===p.target&&e.hp>0);
    const point=target??{x:p.tx,y:p.ty};
    if(p.splash>0){for(const e of this.entities)if(e.hp>0&&e.team!==p.team&&(!e.air||p.air)&&dist(e,point)<p.splash+e.radius){this.hurt(e,p.damage*(p.source===0&&e.kind==='tower'?0.3:1));e.stun=Math.max(e.stun,p.stun);if(p.stun)e.cooldown=e.interval;}}
    else if(target)this.hurt(target,p.damage);
    this.emit('hit',p.team,point.x,point.y,p.source===0?p.style as CardId:undefined,p.damage);
   }
   this.projectiles=this.projectiles.filter(p=>p.remaining>0);
   this.separate();this.entities=this.entities.filter(e=>e.hp>0);
   if(beforePhase!==this.phase)this.emit('phase','blue',9,16);
   if(this.time>=180&&this.players.blue.crowns!==this.players.red.crowns)this.finish(this.players.blue.crowns>this.players.red.crowns?'blue':'red','More crowns');
   if(this.time>=300&&!this.winner){
    const lowest=(team:Team)=>Math.min(...this.entities.filter(e=>e.team===team&&e.kind==='tower').map(e=>e.hp));
    const blue=lowest('blue'),red=lowest('red');this.finish(Math.abs(blue-red)<0.01?'draw':blue>red?'blue':'red','Tiebreaker');
   }
 }
 private moveToward(e:Entity,target:Entity){
  let x=target.x,y=target.y;
  const crossing=e.y<14.8&&target.y>16||e.y>17.2&&target.y<16||e.y>=14.8&&e.y<=17.2;
  if(crossing&&!e.air&&e.card!=='hog-rider'){
   const bridge=e.x<9?4:14;
   if(e.team==='blue'&&e.y>17.2){x=bridge;y=17.15;}else if(e.team==='red'&&e.y<14.8){x=bridge;y=14.85;}else{x=bridge;y=e.team==='blue'?14.6:17.4;}
  }
  const dx=x-e.x,dy=y-e.y,d=Math.hypot(dx,dy);if(d<0.001)return;
  const speed=e.speed*(e.card==='prince'&&e.move>2.3?1.8:1);const move=Math.min(d,speed*STEP);
  e.x=clamp(e.x+dx/d*move,0.5,17.5);e.y=clamp(e.y+dy/d*move,0.6,31.4);e.move+=STEP;
 }
 private separate(){
  const units=this.entities.filter(e=>e.kind==='troop'&&e.hp>0&&e.deploy<=0);
  for(let i=0;i<units.length;i++)for(let j=i+1;j<units.length;j++){
   const a=units[i],b=units[j];if(a.air!==b.air)continue;const d=dist(a,b),min=(a.radius+b.radius)*0.86;
   if(d<min&&d>0.001){const push=(min-d)*0.18,dx=(a.x-b.x)/d*push,dy=(a.y-b.y)/d*push;
    a.x=clamp(a.x+dx,0.5,17.5);b.x=clamp(b.x-dx,0.5,17.5);a.y=clamp(a.y+dy,0.6,31.4);b.y=clamp(b.y-dy,0.6,31.4);
   }
  }
 }
 private hurt(e:Entity,amount:number){
   if(e.hp<=0)return;e.hp-=amount;
   if(e.king)e.active=true;
   if(e.hp>0)return;e.hp=0;this.emit('death',e.team,e.x,e.y,e.card);
   if(e.card==='balloon')this.projectiles.push({id:this.nextId++,team:e.team,x:e.x,y:e.y,tx:e.x,ty:e.y,target:null,damage:240,remaining:0.8,duration:0.8,splash:2.2,air:false,style:'bomb',stun:0,source:e.id});
   if(e.kind==='tower'){
    const enemy=other(e.team);this.players[enemy].crowns=e.king?3:this.players[enemy].crowns+1;
    this.emit('crown',enemy,e.x,e.y,'tower');for(const king of this.entities.filter(t=>t.team===e.team&&t.king))king.active=true;
    if(e.king)this.finish(enemy,'King Tower destroyed');else if(this.time>=180)this.finish(enemy,'Sudden death');
   }
 }
 private think(){
   const p=this.players.red;const affordable=p.hand.map((id,slot)=>({id,slot,c:CARD_MAP[id]})).filter(v=>v.c.cost<=p.elixir);
   if(!affordable.length)return;
   const threats=this.entities.filter(e=>e.team==='blue'&&e.kind==='troop'&&e.y<15).sort((a,b)=>a.y-b.y);
   const threat=threats[0];
   if(!threat&&p.elixir<6&&this.mode!=='training')return;
   const scored=affordable.map(a=>{
    let score=this.random()*2;
    if(threat){
     if(a.c.kind==='spell'){const nearby=threats.filter(e=>dist(e,threat)<(a.c.radius??2.5));score+=nearby.length>2?6:-5;if(threat.hp<a.c.damage)score+=2;}
     else {score+=a.c.buildingsOnly?-3:3;if(threat.air&&!a.c.hitsAir)score-=8;if(a.c.splash&&threats.length>=3)score+=3;if(a.c.kind==='building')score+=2;}
    }else{if(a.c.kind!=='troop')score-=7;if(a.c.buildingsOnly)score+=2;}
    return{...a,score};
   }).sort((a,b)=>b.score-a.score);
   const a=scored[0];if(a.score<0)return;
   const lane=threat?threat.x<9?4:14:this.random()<0.5?4:14;
   let x=lane+(this.random()-0.5)*1.4,y=threat?clamp(threat.y+1.3,8,13.8):a.c.buildingsOnly?3.5:9;
   if(a.c.kind==='spell'){const target=threat??this.entities.find(e=>e.team==='blue'&&e.kind==='tower'&&!e.king);if(!target)return;x=target.x;y=target.y;}
   if(a.c.kind==='building'){x=9;y=10;}
   this.play('red',a.slot,x,y);
 }
 finish(winner:Team|'draw',reason:string){if(this.winner)return;this.winner=winner;this.reason=reason;this.emit('finish',winner==='draw'?'blue':winner,9,16);}
 exportReplay():Replay{return{version:1,seed:this.seed,mode:this.mode,deck:[...this.deck],enemyDeck:[...this.enemyDeck],actions:this.actions.map(a=>({...a})),duration:this.tick};}
}
