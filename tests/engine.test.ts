import { describe,it,expect } from 'vitest';
import { Battle,STEP } from '../src/game/engine';
import { CARD_MAP,STARTER_DECK } from '../src/game/cards';
const advance=(b:Battle,seconds:number)=>{for(let i=0;i<Math.round(seconds/STEP);i++)b.step();};
describe('battle rules',()=>{
 it('spends elixir and cycles exactly through the next four cards',()=>{
  const b=new Battle({seed:42,ai:false});b.players.blue.elixir=10;
  const first=b.players.blue.hand[0],next=b.players.blue.queue[0];
  const r=b.play('blue',0,4,22);expect(r.ok).toBe(true);
  expect(b.players.blue.elixir).toBe(10-CARD_MAP[first].cost);expect(b.players.blue.hand[0]).toBe(next);expect(b.players.blue.queue.at(-1)).toBe(first);
 });
 it('rejects enemy territory, invalid coordinates, tower overlaps and insufficient elixir without mutations',()=>{
  const b=new Battle({seed:42,ai:false});b.players.blue.hand=[...STARTER_DECK.slice(0,4)];
  for(const [x,y] of [[4,6],[9,16],[9,29.5],[NaN,20]])expect(b.play('blue',0,x,y).ok).toBe(false);
  b.players.blue.elixir=0;expect(b.play('blue',0,4,20).ok).toBe(false);expect(b.actions).toHaveLength(0);
 });
 it('lets spells target either half and applies reduced crown tower damage',()=>{
  const b=new Battle({seed:1,ai:false});b.players.blue.hand[0]='fireball';b.players.blue.elixir=10;
  const t=b.entities.find(e=>e.team==='red'&&!e.king)!;const hp=t.hp;
  expect(b.play('blue',0,t.x,t.y).ok).toBe(true);advance(b,1.1);
  expect(t.hp).toBeCloseTo(hp-CARD_MAP.fireball.damage*0.3);
 });
 it('requires ground troops to cross the bridges',()=>{
  const b=new Battle({seed:1,ai:false});b.players.blue.hand[0]='knight';b.players.blue.elixir=10;b.play('blue',0,8,18);
  let crosses=false;for(let i=0;i<1800;i++){b.step();const e=b.entities.find(e=>e.card==='knight');if(e&&e.y>14.8&&e.y<17.2){crosses=true;expect(Math.min(Math.abs(e.x-4),Math.abs(e.x-14))).toBeLessThan(0.7);}}
  expect(crosses).toBe(true);
 });
 it('regenerates capped elixir and increases the rate at the correct phases',()=>{
  const b=new Battle({seed:1,ai:false});advance(b,2.8);expect(b.players.blue.elixir).toBeCloseTo(6);
  advance(b,20);expect(b.players.blue.elixir).toBe(10);b.tick=120/STEP;expect(b.multiplier).toBe(2);b.tick=240/STEP;expect(b.multiplier).toBe(3);
 });
 it('produces identical complete state when replaying recorded commands',()=>{
  const b=new Battle({seed:77});for(let i=0;i<3600;i++){if(i%130===0){const slot=b.players.blue.hand.findIndex(id=>CARD_MAP[id].cost<=b.players.blue.elixir);if(slot>=0)b.play('blue',slot,4,20);}b.step();}
  const replay=new Battle({replay:b.exportReplay()});for(let i=0;i<b.tick;i++)replay.step();
  expect(replay.entities).toEqual(b.entities);expect(replay.players).toEqual(b.players);expect(replay.projectiles).toEqual(b.projectiles);
 });
 it('finishes a tie at five minutes and prevents actions after the match',()=>{
  const b=new Battle({seed:1,ai:false});advance(b,301);expect(b.winner).toBe('draw');expect(b.time).toBe(300);expect(b.play('blue',0,4,20).ok).toBe(false);
 });
 it('keeps AI within its elixir budget and allows a full match to resolve',()=>{
  const b=new Battle({seed:87});advance(b,301);expect(b.winner).not.toBeNull();expect(b.players.red.elixir).toBeGreaterThanOrEqual(0);expect(b.actions.length).toBeGreaterThan(10);
 });
});
