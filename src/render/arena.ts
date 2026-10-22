import * as T from 'three';
import { Battle } from '../game/engine';
import type { Entity, Point } from '../game/engine';
import { CARD_MAP } from '../game/cards';
import type { CardId } from '../game/cards';
import { box,cylinder,sphere,mat,towerModel,troopModel,buildingModel,teamColor } from './models';
import type { Model } from './models';
interface Visual{object:T.Group;model?:Model;label?:HTMLDivElement}
interface Particle{mesh:T.Mesh;velocity:T.Vector3;life:number;max:number}
export class Arena {
 readonly renderer:T.WebGLRenderer;readonly scene=new T.Scene();readonly camera:T.OrthographicCamera;
 private root=new T.Group();private units=new Map<number,Visual>();private shots=new Map<number,T.Group>();
 private particles:Particle[]=[];private waters:T.Mesh[]=[];private flags:T.Mesh[]=[];
 private observer:ResizeObserver;private ray=new T.Raycaster();private floor=new T.Plane(new T.Vector3(0,1,0),0);private cursor=new T.Group();private rangeRing:T.Mesh;private block:T.Mesh;private lastEvent=0;
 private battle:Battle|null=null;private width=1;private height=1;private labels:HTMLDivElement;private destroyed=false;
 private ghost:T.Group|null=null;private ghostId:CardId|null=null;private contextLost=false;
 onContextLost:()=>void=()=>{};
 constructor(readonly host:HTMLElement){
  this.renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
  this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;
  this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.25;
  this.renderer.domElement.setAttribute('aria-label','3D battle arena. Select a card, then click your side of the arena to deploy.');this.renderer.domElement.setAttribute('role','img');
  this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();this.contextLost=true;this.onContextLost();});
  this.renderer.domElement.addEventListener('webglcontextrestored',()=>{this.contextLost=false;});
  host.append(this.renderer.domElement);this.labels=document.createElement('div');this.labels.className='tower-labels';host.append(this.labels);
  this.camera=new T.OrthographicCamera(-12,12,18,-18,0.1,160);this.camera.position.set(0,40,29);this.camera.lookAt(0,0,0);
  this.scene.add(new T.HemisphereLight(0xe0f4ff,0x687d4c,2.5));const sun=new T.DirectionalLight(0xffedce,3.1);sun.position.set(-15,28,12);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-22;sun.shadow.camera.right=22;sun.shadow.camera.top=25;sun.shadow.camera.bottom=-25;sun.shadow.normalBias=0.04;sun.shadow.bias=-0.0002;this.scene.add(sun);this.scene.add(this.root);
  this.buildArena();
  this.rangeRing=new T.Mesh(new T.RingGeometry(1,1.08,64),new T.MeshBasicMaterial({color:0x8bffcc,transparent:true,opacity:0.85,side:T.DoubleSide,depthWrite:false}));this.rangeRing.rotation.x=-Math.PI/2;this.rangeRing.position.y=0.09;this.cursor.add(this.rangeRing);
  const center=new T.Mesh(new T.CircleGeometry(0.1,16),new T.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.8}));center.rotation.x=-Math.PI/2;center.position.y=0.1;this.cursor.add(center);this.cursor.visible=false;this.scene.add(this.cursor);
  this.block=new T.Mesh(new T.PlaneGeometry(18,14.4),new T.MeshBasicMaterial({color:0xee3848,transparent:true,opacity:0.13,depthWrite:false}));this.block.rotation.x=-Math.PI/2;this.block.position.set(0,0.05,-8.8);this.block.visible=false;this.scene.add(this.block);
  this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);this.resize();
 }
 private buildArena(){
  const r=this.root;
  box(r,0,-1.15,0,22.6,1.8,35.6,0x35484c);box(r,0,-0.42,0,22,0.5,35,0x6a8074);box(r,0,-0.1,0,20.8,0.35,34.1,0x9da28d);
  const tileGeo=new T.BoxGeometry(0.99,0.09,0.99),tileMat=mat(0xffffff);const grass=new T.InstancedMesh(tileGeo,tileMat,18*32);grass.receiveShadow=true;const m=new T.Matrix4(),col=new T.Color();let n=0;
  for(let x=0;x<18;x++)for(let z=0;z<32;z++){m.makeTranslation(x-8.5,0.02,z-15.5);grass.setMatrixAt(n,m);col.setHex((x+z)%2===0?0x86b954:0x7aaf4a);if(z===14||z===15||z===16)col.setHex(0x779948);grass.setColorAt(n++,col);}r.add(grass);
  for(const x of [-5,5])for(const z of [-9.4,9.4]){const path=box(r,x,0.085,z,2.6,0.035,10.8,0xa6b77b);path.receiveShadow=true;for(let k=0;k<8;k++){const stone=box(r,x+Math.sin(k*3.1)*0.32,0.12,z-4.5+k*1.25,0.8,0.05,0.75,0xbac394);stone.rotation.y=k*0.7;}}
  const water=new T.Mesh(new T.PlaneGeometry(20.7,2.85),new T.MeshStandardMaterial({color:0x42c0d4,roughness:0.22,metalness:0.15,transparent:true,opacity:0.95}));water.rotation.x=-Math.PI/2;water.position.set(0,0.1,0);water.receiveShadow=true;r.add(water);
  for(let i=0;i<20;i++){const wave=new T.Mesh(new T.PlaneGeometry(0.35+(i%4)*0.28,0.055),new T.MeshBasicMaterial({color:0xbcf1e5,transparent:true,opacity:0.25,depthWrite:false}));wave.rotation.x=-Math.PI/2;wave.position.set(-10+i*1.1,0.13,Math.sin(i*12)*1);r.add(wave);this.waters.push(wave);}
  for(const z of [-1.6,1.6])for(let x=-9.5;x<=9.5;x+=1){if(Math.abs(x+5)<1.2||Math.abs(x-5)<1.2)continue;box(r,x,0.12,z,0.96,0.27,0.36,0xc2c4a1);}
  for(const x of [-5,5]){
   for(let i=0;i<9;i++)box(r,x,0.19,-1.6+i*0.4,2.5,0.25,0.37,i%2?0xb98c52:0xc89b60);
   for(const dx of [-1.2,1.2]){box(r,x+dx,0.17,0,0.16,0.37,3.7,0x8f673f);for(const z of [-1.7,1.7])cylinder(r,x+dx,0.45,z,0.13,0.85,0xa67a48);}
  }
  for(const s of [-1,1]){
   for(let i=0;i<34;i++){const z=i-16.5;box(r,s*9.55,0.2,z,0.65,0.4,0.96,i%3?0xb0b8a6:0x929f94);}
   for(let i=0;i<8;i++){const z=-14+i*4;box(r,s*10.45,0.48,z,0.75,0.55,2.6,0x798c76);box(r,s*10.45,0.81,z-0.4,0.75,0.12,1.8,0xb0ba9a);}
   for(const z of [-16.6,16.6])for(let i=0;i<20;i++)box(r,-9.5+i,0.2,z,0.96,0.4,0.65,0xadb6a2);
  }
  for(const x of [-10.3,10.3])for(const z of [-14,-9,-4,4,9,14]){
   const tree=new T.Group();tree.position.set(x,0,z);cylinder(tree,0,0.6,0,0.15,1.2,0x785b39);sphere(tree,0,1.8,0,0.7,0x4d913d,1,1.2,1);sphere(tree,-0.25,1.6,0.15,0.48,0x65a443);sphere(tree,0.25,2.1,0,0.45,0x76b94b);tree.scale.setScalar(z%3===0?0.8:1);r.add(tree);
  }
  for(const z of [-13,13])for(const s of [-1,1]){
   const x=s*10.4;box(r,x,0.2,z,0.6,0.4,0.6,0x8c9989);cylinder(r,x,1.6,z,0.055,3,0xdbc18c);sphere(r,x,3.2,z,0.12,0xffda68);
   const flag=new T.Mesh(new T.PlaneGeometry(1.1,0.75,8,1),new T.MeshStandardMaterial({color:z<0?0xdb4b52:0x428fda,side:T.DoubleSide,roughness:1}));flag.position.set(x+s*0.56,2.7,z);flag.userData.base=new Float32Array(flag.geometry.attributes.position.array);r.add(flag);this.flags.push(flag);
  }
  // Shrubs, flowers and river stones make the arena feel like a little physical diorama.
  for(let i=0;i<65;i++){
   const s=i%2?-1:1,x=s*(9.9+(i%3)*0.28),z=Math.sin(i*17.3)*15.7;
   if(Math.abs(z)<2)continue;sphere(r,x,0.14,z,0.14, i%7===0?0xf3d772:i%11===0?0xe8c8e6:0x6b9f43,1,0.7,1);
  }
  for(let i=0;i<12;i++){const x=-10.4+(i%2)*20.8,z=-1.3+Math.floor(i/2)*0.48;sphere(r,x,0.1,z,0.3,0x8a9c8e,1,0.55,0.7);}
 }
 setBattle(battle:Battle){
  for(const v of this.units.values()){this.scene.remove(v.object);v.label?.remove();this.disposeObject(v.object);}this.units.clear();
  for(const p of this.shots.values()){this.scene.remove(p);this.disposeObject(p);}this.shots.clear();
  for(const p of this.particles){this.scene.remove(p.mesh);p.mesh.geometry.dispose();}this.particles=[];
  this.battle=battle;this.lastEvent=battle.events.at(-1)?.id??0;
 }
 private resize(){
  const {width,height}=this.host.getBoundingClientRect();if(!width||!height)return;this.width=width;this.height=height;
  this.renderer.setSize(width,height,false);const ratio=width/height;const h=Math.max(34,24/ratio),w=h*ratio;this.camera.left=-w/2;this.camera.right=w/2;this.camera.top=h/2;this.camera.bottom=-h/2;this.camera.updateProjectionMatrix();
 }
 point(clientX:number,clientY:number):Point|null{
  const rect=this.renderer.domElement.getBoundingClientRect();const v=new T.Vector2((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1);this.ray.setFromCamera(v,this.camera);const hit=new T.Vector3();if(!this.ray.ray.intersectPlane(this.floor,hit))return null;return{x:hit.x+9,y:hit.z+16};
 }
 screen(x:number,y:number,height=0){const v=new T.Vector3(x-9,height,y-16).project(this.camera);return{x:(v.x+1)/2*this.width,y:(-v.y+1)/2*this.height};}
 showPlacement(id:CardId|null,point:Point|null,valid=true){
  this.block.visible=!!id&&CARD_MAP[id].kind!=='spell';this.cursor.visible=!!id&&!!point;
  if(!id||!point){if(this.ghost)this.ghost.visible=false;return;}
  this.cursor.position.set(point.x-9,0,point.y-16);const card=CARD_MAP[id];const radius=card.radius??(card.kind==='building'?card.range:0.8);this.rangeRing.scale.set(radius,radius,1);(this.rangeRing.material as T.MeshBasicMaterial).color.setHex(valid?0x9bffca:0xff536a);
  if(card.kind!=='spell'){
   if(this.ghostId!==id){if(this.ghost){this.scene.remove(this.ghost);this.disposeObject(this.ghost);}this.ghostId=id;this.ghost=card.kind==='building'?buildingModel(id,'blue'):troopModel(id,'blue').group;this.ghost.traverse(o=>{if(o instanceof T.Mesh){o.material=(o.material as T.Material).clone();(o.material as T.MeshStandardMaterial).transparent=true;(o.material as T.MeshStandardMaterial).opacity=0.5;o.castShadow=false;}});this.scene.add(this.ghost);}
   this.ghost!.visible=true;this.ghost!.position.set(point.x-9,0.15,point.y-16);this.ghost!.rotation.y=Math.PI;
  }else if(this.ghost)this.ghost.visible=false;
 }
 render(dt:number,time:number){
  if(this.destroyed||this.contextLost)return;
  for(let i=0;i<this.waters.length;i++){const wave=this.waters[i];wave.position.x+=dt*0.35;if(wave.position.x>10)wave.position.x=-10;(wave.material as T.MeshBasicMaterial).opacity=0.2+Math.sin(time*1.8+i)*0.12;}
  for(let i=0;i<this.flags.length;i++){const f=this.flags[i],positions=f.geometry.attributes.position,base=f.userData.base as Float32Array;for(let j=0;j<positions.count;j++){positions.setZ(j,base[j*3+2]+Math.sin(time*3+base[j*3]*4+i)*0.11*(base[j*3]+0.56));}positions.needsUpdate=true;f.geometry.computeVertexNormals();}
  const b=this.battle;if(!b)return;
  const alive=new Set<number>();
  for(const e of b.entities){alive.add(e.id);let v=this.units.get(e.id);
   if(!v){
    let object:T.Group,model:Model|undefined;
    if(e.kind==='tower')object=towerModel(e.team,!!e.king);else if(e.kind==='building')object=buildingModel(e.card as CardId,e.team);else{model=troopModel(e.card as CardId,e.team);object=model.group;}
    this.scene.add(object);v={object,model};
    if(e.kind==='tower'){const label=document.createElement('div');label.className=`tower-health ${e.team}`;label.innerHTML='<span></span><i><b></b></i>';this.labels.append(label);v.label=label;}
    else{const ring=new T.Mesh(new T.RingGeometry(e.radius*1.1,e.radius*1.35,24),new T.MeshBasicMaterial({color:teamColor(e.team),transparent:true,opacity:0.8,depthWrite:false,side:T.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=0.03;object.add(ring);}
    this.units.set(e.id,v);
   }
   this.updateUnit(v,e,dt,time);
  }
  for(const [id,v] of this.units)if(!alive.has(id)){this.scene.remove(v.object);this.disposeObject(v.object);v.label?.remove();this.units.delete(id);}
  const liveShots=new Set<number>();
  for(const p of b.projectiles){liveShots.add(p.id);let shot=this.shots.get(p.id);if(!shot){shot=new T.Group();const spell=p.style==='fireball'||p.style==='zap';if(p.style==='arrows'){for(let i=0;i<9;i++){const arrow=cylinder(shot,Math.sin(i*2.4)*1.5,0,Math.cos(i*2.4)*1.5,0.035,0.7,0xecdcb6);arrow.rotation.x=-Math.PI/5;}}else{sphere(shot,0,0,0,spell?0.34:p.style==='balloon'?0.25:0.1,spell?0xff9e32:p.style==='tesla'?0x9ff6ff:0xeacf8b);if(spell)sphere(shot,0,0,0,0.2,0xfff2ab);}
    this.shots.set(p.id,shot);this.scene.add(shot);}
   const progress=1-p.remaining/p.duration;const target=p.target?b.entities.find(e=>e.id===p.target):undefined;const tx=target?.x??p.tx,ty=target?.y??p.ty;
   shot.position.set(T.MathUtils.lerp(p.x,tx,progress)-9,1+Math.sin(progress*Math.PI)*(p.source===0?7:1.5),T.MathUtils.lerp(p.y,ty,progress)-16);
   if(p.style==='fireball'&&Math.random()<0.6)this.particle(shot.position,0xffab3d,0.13,0.4,0.6);
  }
  for(const [id,s] of this.shots)if(!liveShots.has(id)){this.scene.remove(s);this.disposeObject(s);this.shots.delete(id);}
  for(const event of b.events){if(event.id<=this.lastEvent)continue;this.lastEvent=event.id;const pos=new T.Vector3(event.x-9,0.6,event.y-16);
   if(event.type==='hit'){const spell=event.card==='fireball'||event.card==='arrows'||event.card==='zap';for(let i=0;i<(spell?22:5);i++)this.particle(pos,event.card==='zap'?0xaff3ff:spell?0xffae3c:0xffe8a1,spell?0.13:0.07,spell?0.7:0.3,spell?4:2);}
   if(event.type==='death')for(let i=0;i<(event.card==='tower'?55:9);i++)this.particle(pos,event.card==='tower'?0xc7c3a6:0xcc8ae6,event.card==='tower'?0.22:0.09,1,4);
   if(event.type==='deploy')for(let i=0;i<12;i++)this.particle(pos,0xf2d09e,0.08,0.7,2);
   if(event.type==='crown')for(let i=0;i<24;i++)this.particle(new T.Vector3(event.x-9,3,event.y-16),0xffcd4d,0.16,1.5,5);
  }
  for(const p of this.particles){p.life-=dt;p.velocity.y-=dt*5;p.mesh.position.addScaledVector(p.velocity,dt);p.mesh.scale.setScalar(Math.max(0,p.life/p.max));}
  const dead=this.particles.filter(p=>p.life<=0);for(const p of dead){this.scene.remove(p.mesh);p.mesh.geometry.dispose();}this.particles=this.particles.filter(p=>p.life>0);
  this.renderer.render(this.scene,this.camera);
 }
 private updateUnit(v:Visual,e:Entity,dt:number,time:number){
  const o=v.object;const y=e.air?2.2:0.1;const oldX=o.position.x,oldZ=o.position.z;o.position.x=T.MathUtils.damp(o.position.x,e.x-9,25,dt);o.position.z=T.MathUtils.damp(o.position.z,e.y-16,25,dt);
  if(e.age<0.1||e.kind==='tower'){o.position.x=e.x-9;o.position.z=e.y-16;}
  const moving=Math.abs(o.position.x-oldX)+Math.abs(o.position.z-oldZ)>0.002;
  o.position.y=y+(e.air?Math.sin(time*4+e.id)*0.12:moving&&e.kind==='troop'?Math.abs(Math.sin(time*9+e.id))*0.05:0);
  if(e.kind!=='tower'){
   const target=this.battle?.entities.find(t=>t.id===e.target);const targetAngle=target?Math.atan2(target.x-e.x,target.y-e.y):e.team==='blue'?Math.PI:0;
   let diff=targetAngle-o.rotation.y;while(diff>Math.PI)diff-=Math.PI*2;while(diff<-Math.PI)diff+=Math.PI*2;o.rotation.y+=diff*Math.min(1,dt*12);
   if(v.model){const m=v.model;for(let i=0;i<m.legs.length;i++)m.legs[i].rotation.x=moving?Math.sin(time*10+e.id+i*Math.PI)*0.55:0;for(let i=0;i<m.arms.length;i++)m.arms[i].rotation.x=e.attack>0?-Math.sin(e.attack/0.3*Math.PI)*1.2:moving?Math.sin(time*10+e.id+i*Math.PI)*0.22:0;for(let i=0;i<m.wings.length;i++)m.wings[i].rotation.z=Math.sin(time*9+e.id)*(i===0?-1:1)*0.55;
    const scale=m.scale*(e.deploy>0?Math.max(0.05,1-e.deploy):1);o.scale.setScalar(scale);
   }
  }
  if(e.kind==='tower'&&e.team==='red')o.rotation.y=Math.PI;
  if(v.label){const p=this.screen(e.x,e.y,4);v.label.style.transform=`translate(${p.x}px,${p.y}px) translate(-50%,-50%)`;v.label.querySelector('span')!.textContent=Math.ceil(e.hp).toLocaleString();(v.label.querySelector('b') as HTMLElement).style.width=`${e.hp/e.maxHp*100}%`;}
 }
 private particle(pos:T.Vector3,color:number,size:number,life:number,speed:number){if(this.particles.length>400)return;const mesh=new T.Mesh(new T.IcosahedronGeometry(size,0),mat(color));mesh.position.copy(pos);this.scene.add(mesh);this.particles.push({mesh,velocity:new T.Vector3((Math.random()-0.5)*speed,Math.random()*speed,(Math.random()-0.5)*speed),life,max:life});}
 private disposeObject(object:T.Object3D){object.traverse(o=>{if(o instanceof T.Mesh)o.geometry.dispose();});}
 destroy(){this.destroyed=true;this.observer.disconnect();this.scene.traverse(o=>{if(o instanceof T.Mesh)o.geometry.dispose();});this.renderer.dispose();this.renderer.domElement.remove();this.labels.remove();}
}
