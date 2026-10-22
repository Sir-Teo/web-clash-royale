import{describe,it,expect,beforeEach,vi}from'vitest';
import{loadProfile,saveProfile,recordBattle,openChest}from'../src/game/profile';
import{Battle}from'../src/game/engine';
const data=new Map<string,string>();
beforeEach(()=>{data.clear();vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)});});
describe('local progress',()=>{
 it('recovers from corrupt data and rejects duplicate deck cards',()=>{data.set('browser-royale.profile.v1','{broken');expect(loadProfile().deck).toHaveLength(8);const p=loadProfile();p.deck=Array(8).fill('knight');saveProfile(p);expect(new Set(loadProfile().deck).size).toBe(8);});
 it('awards a chest for ranked wins and allows each chest to be claimed once',()=>{const p=loadProfile(),b=new Battle({seed:1,ai:false});b.finish('blue','Test victory');const reward=recordBattle(p,b);expect(reward).toEqual({trophies:30,gold:125,chest:'silver'});expect(p.history).toHaveLength(1);expect(openChest(p,0)?.gold).toBe(150);expect(openChest(p,0)).toBeNull();expect(p.gold).toBe(1275);});
 it('keeps training separate from ranked rewards',()=>{const p=loadProfile(),b=new Battle({seed:1,ai:false,mode:'training'});b.finish('blue','Training victory');recordBattle(p,b);expect(p.trophies).toBe(0);expect(p.gold).toBe(1000);expect(p.chests).toHaveLength(0);expect(p.history).toHaveLength(1);});
 it('caps history and chest slots while preserving nonnegative trophies',()=>{const p=loadProfile();for(let i=0;i<12;i++){const b=new Battle({seed:i,ai:false});b.finish('blue','Win');recordBattle(p,b);}expect(p.history).toHaveLength(10);expect(p.chests).toHaveLength(4);p.trophies=4;const loss=new Battle({ai:false});loss.finish('red','Loss');expect(recordBattle(p,loss).trophies).toBe(-4);expect(p.trophies).toBe(0);});
});
