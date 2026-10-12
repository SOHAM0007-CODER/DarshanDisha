// Tabletop 3D view of a routing graph and one replay state. Loaded only when the
// 3D Algorithm Lab opens. Renders on demand: camera interaction, a new view, or a
// running effect (camera glide, intro, tween, path flow); idle frames cost nothing.
import * as THREE from './vendor/three/three.module.js';
import {OrbitControls} from './vendor/three/OrbitControls.js';
import {colors} from './lab-colors.mjs';
import {AnimationClock,ribbonReveal,ease,stagger,lerpAngle,polylineSampler} from './lab-animation.mjs';

const TABLE=100;
const STYLES={
  pune:{road:.26,major:.46,node:.27,pillar:6,path:.95,marker:.7,edge:.8},
  teach:{road:.85,major:.85,node:1.65,pillar:12,path:2.1,marker:1.7,edge:2}
};

function ribbon(polylines,width,y) {
  // One quad per segment, merged into a single indexed geometry with vertex colours.
  // `arc` is the distance along each polyline, used by the flowing-path shader.
  let quads=0;for(const p of polylines)quads+=Math.max(0,p.points.length-1);
  const pos=new Float32Array(quads*12),col=new Float32Array(quads*12),arc=new Float32Array(quads*4),index=new Uint32Array(quads*6),ranges=[];
  let q=0;
  for(const p of polylines){
    const start=q*4,w=(p.width??width)/2;let s=0;
    for(let i=1;i<p.points.length;i++){
      const [x0,z0]=p.points[i-1],[x1,z1]=p.points[i],seg=Math.hypot(x1-x0,z1-z0),len=seg||1,nx=-(z1-z0)/len*w,nz=(x1-x0)/len*w,o=q*12;
      pos.set([x0+nx,y,z0+nz,x0-nx,y,z0-nz,x1+nx,y,z1+nz,x1-nx,y,z1-nz],o);arc.set([s,s,s+seg,s+seg],q*4);s+=seg;
      const v=q*4;index.set([v,v+2,v+1,v+1,v+2,v+3],q*6);q++;
    }
    ranges.push([start,q*4-start]);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('color',new THREE.BufferAttribute(col,3));g.setAttribute('arc',new THREE.BufferAttribute(arc,1));g.setIndex(new THREE.BufferAttribute(index,1));
  return {geometry:g,ranges};
}

// City intro: anything within uReveal of the table centre is drawn; `grow` also raises
// it out of the table with a slight overshoot. uReveal >= 1 shows everything.
function introReveal(material,uniforms,{grow=false,instanced=false}={}) {
  const head='uniform float uReveal;uniform float uRadius;varying vec2 vIntroXZ;\n',front='(uReveal*1.3-length(vIntroXZ)/uRadius)';
  material.onBeforeCompile=s=>{
    s.uniforms.uReveal=uniforms.uReveal;s.uniforms.uRadius=uniforms.uRadius;
    s.vertexShader=head+s.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      vIntroXZ=(modelMatrix*${instanced?'instanceMatrix*vec4(0.,0.,0.,1.)':'vec4(position,1.)'}).xz;
      ${grow?`{float m=clamp(${front}/.3,0.,1.)-1.;transformed${instanced?'':'.y'}*=max(0.,1.+2.70158*m*m*m+1.70158*m*m);}`:''}`);
    s.fragmentShader=head+s.fragmentShader.replace('#include <dithering_fragment>',`#include <dithering_fragment>
      if(${front}<0.)discard;`);
  };
  material.customProgramCacheKey=()=>`intro-${grow}-${instanced}`;
}

// Final route: light pulses travel along the ribbon from source to destination.
function flowing(material,uniforms,dash) {
  material.onBeforeCompile=s=>{
    s.uniforms.uTime=uniforms.uTime;
    s.vertexShader='attribute float arc;varying float vArc;\n'+s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvArc=arc;');
    s.fragmentShader='uniform float uTime;varying float vArc;\n'+s.fragmentShader.replace('#include <dithering_fragment>',`#include <dithering_fragment>
      float f=fract(vArc/${dash.toFixed(3)}-uTime*.8);
      gl_FragColor.rgb=mix(gl_FragColor.rgb,vec3(1.,.87,.68),.42*smoothstep(.55,.8,f)*smoothstep(1.,.86,f));`);
  };
  material.customProgramCacheKey=()=>'flow-'+dash.toFixed(3);
}

// Soft round shadow texture for the tabletop's footprint.
function shadowTexture() {
  const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d'),r=g.createRadialGradient(64,64,10,64,64,64);
  r.addColorStop(0,'rgba(38,52,36,.34)');r.addColorStop(.55,'rgba(38,52,36,.16)');r.addColorStop(1,'rgba(38,52,36,0)');g.fillStyle=r;g.fillRect(0,0,128,128);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}

function flatShapes(polygons,toWorld,y,raised=false) {
  const positions=[];
  for(const [polygonIndex,polygon] of polygons.entries()){
    let pts=polygon.map(p=>new THREE.Vector2(...toWorld(p[0],p[1])));
    if(pts.length>3&&pts[0].equals(pts.at(-1)))pts=pts.slice(0,-1);
    if(pts.length<3)continue;
    const height=raised ? .16+(polygonIndex%5)*.055 : 0;
    for(const [a,b,c] of THREE.ShapeUtils.triangulateShape(pts,[]))for(const v of [a,c,b])positions.push(pts[v].x,y+height,pts[v].y);
    if(raised)for(let i=0;i<pts.length;i++){
      const a=pts[i],b=pts[(i+1)%pts.length];
      positions.push(a.x,y,a.y,b.x,y,b.y,b.x,y+height,b.y,a.x,y,a.y,b.x,y+height,b.y,a.x,y+height,a.y);
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();return g;
}

export class Scene3D {
  constructor(host,labelLayer,{onPick,onStatus,reducedMotion=false}={}) {
    this.host=host;this.labelLayer=labelLayer;this.onPick=onPick;this.onStatus=onStatus;this.reducedMotion=reducedMotion;
    this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'low-power'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
    const canvas=this.canvas=this.renderer.domElement;
    canvas.className='lab3d-canvas';canvas.tabIndex=0;canvas.setAttribute('role','application');canvas.setAttribute('aria-roledescription','3D model');
    canvas.setAttribute('aria-label','3D algorithm model. Drag to orbit, right-drag or Shift-drag to pan, scroll to zoom. Keys: arrows pan, plus and minus zoom, Q and E rotate, T top-down, R reset. Click a junction to inspect it. The text panel describes every step.');
    host.append(canvas);
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#e7eade');
    // Depth haze: the far side of the table melts into the backdrop (range follows the camera).
    this.scene.fog=new THREE.Fog('#e7eade',100,400);
    this.camera=new THREE.PerspectiveCamera(38,1,1,1200);
    this.scene.add(new THREE.HemisphereLight(0xfffaf0,0x627365,1.65));
    const sun=new THREE.DirectionalLight(0xfff0d9,1.35);sun.position.set(-45,110,70);this.scene.add(sun);
    this.controls=new OrbitControls(this.camera,canvas);
    Object.assign(this.controls,{enableDamping:!reducedMotion,dampingFactor:.12,maxPolarAngle:Math.PI*.495,minDistance:12,maxDistance:320,zoomToCursor:true});
    this.controls.addEventListener('change',()=>this.request());
    this.controls.addEventListener('start',()=>{this.fly=null;});   // grabbing the camera cancels a glide
    this.intro={uReveal:{value:2},uRadius:{value:TABLE},t:null};this.flow={uTime:{value:0}};this.fx=[];this.hover={v:-1,s:0};
    this.labels=new Map();this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();
    this.bindEvents();this.resize();
    this.resizeObserver=new ResizeObserver(()=>{this.resize();this.request();});this.resizeObserver.observe(host);
    this.resetCamera(true);
  }
  bindEvents() {
    const c=this.canvas;let down=null;
    this.onLost=e=>{e.preventDefault();this.lostView=this.view;this.lost=true;this.clearModel();this.onStatus?.('lost');};
    this.onRestored=()=>{this.lost=false;if(this.model)this.setModel(this.model,false);if(this.lostView)this.setView({...this.lostView,animate:false});this.lostView=null;this.onStatus?.('restored');};
    c.addEventListener('webglcontextlost',this.onLost);c.addEventListener('webglcontextrestored',this.onRestored);
    c.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];});
    c.addEventListener('pointerup',e=>{if(down&&Math.hypot(e.clientX-down[0],e.clientY-down[1])<5)this.pick(e);down=null;});
    // Hover: one raycast per animation frame at most, and none while dragging.
    const hoverAt=v=>{if(v!==this.hover.v){this.hover.v=v;c.style.cursor=v>=0?'pointer':'';this.request();}};
    c.addEventListener('pointermove',e=>{if(e.buttons||this.hoverQueued)return;this.hoverQueued=true;const x=e.clientX,y=e.clientY;requestAnimationFrame(()=>{this.hoverQueued=false;hoverAt(this.nodeAt(x,y));});});
    c.addEventListener('pointerleave',()=>hoverAt(-1));
    c.addEventListener('keydown',e=>{
      const k=e.key.toLowerCase(),pan=this.controls.keyPanSpeed;
      const act={'+':()=>this.zoom(1/1.2),'=':()=>this.zoom(1/1.2),'-':()=>this.zoom(1.2),q:()=>this.rotate(-15),e:()=>this.rotate(15),t:()=>this.topView(),r:()=>this.resetCamera(),
        arrowup:()=>this.pan(0,pan),arrowdown:()=>this.pan(0,-pan),arrowleft:()=>this.pan(pan,0),arrowright:()=>this.pan(-pan,0)}[k];
      if(act&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();e.stopPropagation();act();}
    });
  }
  resize() {
    const w=this.host.clientWidth||1,h=this.host.clientHeight||1;
    this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.w=w;this.h=h;
  }
  request(){
    if(this.raf||this.disposed)return;
    if(this.idle){this.idle=false;this.animationTime=performance.now();}   // no time jump after an idle gap
    this.raf=requestAnimationFrame(()=>this.frame());
  }
  frame() {
    this.raf=0;if(this.lost||this.disposed)return;
    const now=performance.now(),dt=Math.min(100,now-(this.animationTime??now));this.animationTime=now;
    let busy=false;
    if(this.fly){this.stepFly(dt);busy=true;}
    if(this.intro.t!=null){
      const t=this.intro.t=Math.min(1,this.intro.t+dt/1800);this.intro.uReveal.value=t<1?ease.inOutCubic(t):2;
      this.labelLayer.style.opacity=t<1?stagger(t,.75,.25):'';if(t>=1)this.intro.t=null;busy=true;
    }
    if(this.animation){const t=this.animation.clock.advance(dt);this.animation.draw(t);if(t>=1)this.animation=null;}
    // Continuous effects only run while the lab is on screen.
    const visible=this.host.offsetParent!==null;
    if(visible&&this.fx.length){this.flow.uTime.value+=dt/1000;this.fx=this.fx.filter(f=>f(dt));busy=busy||this.fx.length>0;}
    busy=this.stepHover(dt)||busy;
    const moving=this.controls.update(),d=this.camera.position.distanceTo(this.controls.target),e=this.extent||TABLE;
    this.scene.fog.near=d;this.scene.fog.far=d+e*1.7;
    this.renderer.render(this.scene,this.camera);this.placeLabels();
    if((visible&&busy)||(moving&&this.controls.enableDamping)||(this.animation&&!this.animation.clock.paused))this.request();else this.idle=true;
  }
  stepHover(dt) {
    const h=this.hover,ring=this.hoverRing,goal=h.v>=0&&this.view?1:0;if(!ring)return false;
    if(goal){const v=h.v,[x,z]=this.nodeWorld[v];ring.position.set(x,(this.view.status(v)==='unknown'?this.nodeRadius*.9:this.height(this.view,v))+.06,z);}
    h.s=this.reducedMotion?goal:THREE.MathUtils.damp(h.s,goal,16,dt/1000);
    ring.visible=h.s>.01;ring.scale.setScalar(Math.max(.001,h.s)*this.nodeRadius*2.5);
    return Math.abs(h.s-goal)>.004;
  }
  setAnimationSpeed(speed){this.animationSpeed=speed;if(this.animation)this.animation.clock.speed=speed;}
  setAnimationPaused(paused){if(this.animation){this.animation.clock.paused=paused;this.animationTime=performance.now();if(!paused)this.request();}}
  // Camera helpers: also used by the on-screen buttons.
  // Apply any remaining damped drag/zoom now, so a preset is not followed by drift.
  settle(){const d=this.controls.enableDamping;this.controls.enableDamping=false;this.controls.update();this.controls.enableDamping=d;}
  // Glides: the camera eases between poses in spherical coordinates around a moving target,
  // so presets sweep along an orbit rather than cutting through the table.
  pose(){
    if(this.fly)return {target:this.fly.target.clone(),sph:this.fly.sph.clone()};
    return {target:this.controls.target.clone(),sph:new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target))};
  }
  applyPose(target,sph){this.controls.target.copy(target);this.camera.position.setFromSpherical(sph).add(target);this.controls.update();}
  flyTo(target,sph,ms=800){
    this.settle();sph.radius=THREE.MathUtils.clamp(sph.radius,this.controls.minDistance,this.controls.maxDistance);sph.phi=THREE.MathUtils.clamp(sph.phi,1e-4,this.controls.maxPolarAngle);
    if(this.reducedMotion||!ms){this.fly=null;this.applyPose(target,sph);this.request();return;}
    const from={target:this.controls.target.clone(),sph:new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target))};
    this.fly={from,target:target.clone(),sph:sph.clone(),t:0,ms};this.request();
  }
  stepFly(dt){
    const f=this.fly;f.t=Math.min(1,f.t+dt/f.ms);const k=ease.inOutCubic(f.t),a=f.from.sph,b=f.sph;
    // Radius interpolates in log space so zooming feels uniform at any distance.
    const sph=new THREE.Spherical(Math.exp(THREE.MathUtils.lerp(Math.log(a.radius),Math.log(b.radius),k)),THREE.MathUtils.lerp(a.phi,b.phi,k),lerpAngle(a.theta,b.theta,k));
    this.applyPose(new THREE.Vector3().lerpVectors(f.from.target,f.target,k),sph);if(f.t>=1)this.fly=null;
  }
  // Home framing: the region a search explores (set by focus), else the whole table.
  resetCamera(instant=false){
    const f=this.home||{x:0,z:0,size:this.extent||TABLE},half=Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2));
    // Fit the region's width and (foreshortened) depth for the current aspect ratio.
    const teaching=this.model?.kind==='teach';
    const dist=Math.max(30,(teaching?1.02:1.25)*Math.max(f.size/2/(half*this.camera.aspect),f.size*.4/half)),dir=new THREE.Vector3(-.12,teaching?1.25:.78,.9).normalize();
    this.flyTo(new THREE.Vector3(f.x,0,f.z),new THREE.Spherical().setFromVector3(dir.multiplyScalar(dist)),instant?0:this.intro.t!=null?1500:1000);
  }
  focus(nodes){
    if(!nodes?.length||!this.nodeWorld){this.home=null;return this.resetCamera();}
    let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;for(const v of nodes){const [x,z]=this.nodeWorld[v];x0=Math.min(x0,x);x1=Math.max(x1,x);z0=Math.min(z0,z);z1=Math.max(z1,z);}
    this.home={x:(x0+x1)/2,z:(z0+z1)/2,size:Math.max(22,Math.max(x1-x0,z1-z0)+10)};this.resetCamera();
  }
  topView(){const half=Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2)),d=1.08*(this.extent||TABLE)/2/(half*Math.min(1,this.camera.aspect));this.flyTo(new THREE.Vector3(),new THREE.Spherical(d*1.35,1e-4,0),900);}
  zoom(f){const p=this.pose();p.sph.radius*=f;this.flyTo(p.target,p.sph,380);}
  rotate(deg){const p=this.pose();p.sph.theta+=THREE.MathUtils.degToRad(deg);this.flyTo(p.target,p.sph,480);}
  pan(dx,dy){
    const p=this.pose(),s=p.sph.radius*.0035,right=new THREE.Vector3().setFromMatrixColumn(this.camera.matrix,0),fwd=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),right);
    p.target.add(right.multiplyScalar(-dx*s).add(fwd.multiplyScalar(dy*s)));this.flyTo(p.target,p.sph,260);
  }

  setModel(model,intro=true) {
    this.model=model;this.clearModel();
    const style=this.style=STYLES[model.kind],group=this.group=new THREE.Group();this.scene.add(group);
    const xs=model.nodes.map(n=>n.x),ys=model.nodes.map(n=>n.y),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    const s=this.unit=TABLE/Math.max(maxX-minX,maxY-minY),cx=(minX+maxX)/2,cy=(minY+maxY)/2;
    const toWorld=this.toWorld=(x,y)=>[(x-cx)*s,(y-cy)*s];
    const W=(maxX-minX)*s,H=(maxY-minY)*s,pad=model.kind==='teach'?12:5;this.extent=Math.max(W,H)+pad*2;
    const geometries=this.geometries=[],materials=this.materials=[];this.instanced=[];
    const add=(geometry,material,mesh=new THREE.Mesh(geometry,material))=>{geometries.push(geometry);materials.push(material);group.add(mesh);if(mesh.isInstancedMesh)this.instanced.push(mesh);return mesh;};
    const reveal=(material,options)=>(introReveal(material,this.intro,options),material);
    this.intro.uRadius.value=this.extent*.72;
    // A soft shadow anchors the board to the backdrop.
    const shadowMap=shadowTexture(),shadow=add(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({map:shadowMap,transparent:true,depthWrite:false}));
    shadow.scale.set((W+pad*2)*1.45,1,(H+pad*2)*1.45);shadow.position.y=-4.15;shadow.renderOrder=-1;this.shadowMap=shadowMap;
    // Tabletop: a cream map sheet on a wooden board.
    add(new THREE.BoxGeometry(W+pad*2+3,4,H+pad*2+3),new THREE.MeshLambertMaterial({color:colors.rim})).position.y=-2.05;
    add(new THREE.BoxGeometry(W+pad*2,.1,H+pad*2),new THREE.MeshLambertMaterial({color:colors.base})).position.y=-.05;
    if(model.parks?.length)add(flatShapes(model.parks,toWorld,.015),reveal(new THREE.MeshLambertMaterial({color:colors.park})));
    if(model.buildings?.length)add(flatShapes(model.buildings,toWorld,.03,true),reveal(new THREE.MeshLambertMaterial({color:colors.building,side:THREE.DoubleSide}),{grow:true}));
    // Roads: every graph edge as a narrow ribbon; colours change with the replay.
    const lines=model.edges.map(e=>({points:e.points.map(p=>toWorld(p[0],p[1])),width:['primary','secondary','tertiary'].includes(e.kind)?style.major:style.road}));
    const roads=ribbon(lines,style.road,.06);this.roadRanges=roads.ranges;this.edgeLines=lines;
    this.roads=add(roads.geometry,reveal(new THREE.MeshBasicMaterial({vertexColors:true})));
    this.roadColor=model.edges.map(e=>new THREE.Color(e.closed?colors.closed:['primary','secondary','tertiary'].includes(e.kind)?colors.major:colors.road));
    // Closed lanes also get an X marker, so closure is not shown by colour alone.
    const closed=model.edges.filter(e=>e.closed);
    if(closed.length){
      const bar=new THREE.BoxGeometry(style.marker*2.2,style.marker*.35,style.marker*.35),mat=reveal(new THREE.MeshLambertMaterial({color:colors.closed}),{grow:true,instanced:true});
      for(const angle of [Math.PI/4,-Math.PI/4]){
        const mesh=add(bar,mat,new THREE.InstancedMesh(bar,mat,closed.length)),m=new THREE.Matrix4(),q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),angle);
        closed.forEach((e,i)=>{const p=e.points[Math.floor(e.points.length/2)],[x,z]=toWorld(p[0],p[1]);mesh.setMatrixAt(i,m.compose(new THREE.Vector3(x,style.marker*.4,z),q,new THREE.Vector3(1,1,1)));});
      }
    }
    // Junctions: one instanced mesh per shape. Sphere = unknown, square pillar =
    // tentative / reached, round pillar = settled.
    const n=model.nodes.length,r=style.node;
    const sphere=new THREE.SphereGeometry(1,12,8),box=new THREE.BoxGeometry(1.7,1,1.7).translate(0,.5,0),cyl=new THREE.CylinderGeometry(1,1,1,18).translate(0,.5,0);
    const instanced=geometry=>{const material=reveal(new THREE.MeshLambertMaterial({color:'#ffffff'}),{grow:true,instanced:true});return add(geometry,material,new THREE.InstancedMesh(geometry,material,n));};
    this.nodeMeshes={unknown:instanced(sphere),pillar:instanced(box),settled:instanced(cyl)};
    for(const mesh of Object.values(this.nodeMeshes)){mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.setColorAt(0,new THREE.Color());mesh.count=0;}
    this.nodeWorld=model.nodes.map(p=>toWorld(p.x,p.y));this.nodeRadius=r;
    // Markers.
    const m=style.marker,saffron=reveal(new THREE.MeshLambertMaterial({color:colors.current}),{grow:true});
    this.current=new THREE.Group();
    const ring=new THREE.TorusGeometry(r*2.3+m*.3,m*.16,8,32).rotateX(Math.PI/2),cone=new THREE.ConeGeometry(m*.7,m*1.8,4).rotateX(Math.PI);
    add(ring,saffron,new THREE.Mesh(ring,saffron));this.current.add(group.children.at(-1));
    const pointer=new THREE.Mesh(cone,saffron);pointer.position.y=m*3.4;geometries.push(cone);this.current.add(pointer);group.add(this.current);
    const flag=new THREE.Group(),pole=new THREE.CylinderGeometry(m*.1,m*.1,m*5,8).translate(0,m*2.5,0),cloth=new THREE.BoxGeometry(m*2,m*1.2,m*.12).translate(m,m*4.3,0),srcMat=reveal(new THREE.MeshLambertMaterial({color:colors.source}),{grow:true});
    flag.add(new THREE.Mesh(pole,srcMat),new THREE.Mesh(cloth,srcMat));geometries.push(pole,cloth);materials.push(srcMat);group.add(flag);this.sourceMarker=flag;
    const goal=new THREE.Group(),gem=new THREE.OctahedronGeometry(m*1.1).translate(0,m*4.4,0),stem=new THREE.CylinderGeometry(m*.1,m*.1,m*3.3,8).translate(0,m*1.65,0),goalMat=reveal(new THREE.MeshLambertMaterial({color:colors.target}),{grow:true});
    goal.add(new THREE.Mesh(gem,goalMat),new THREE.Mesh(stem,goalMat));geometries.push(gem,stem);materials.push(goalMat,saffron);group.add(goal);this.targetMarker=goal;
    // Mandal markers: a small temple (plinth, shikhara and flag) per place.
    const plinth=new THREE.BoxGeometry(1,1,1).translate(0,.5,0),spire=new THREE.ConeGeometry(.75,1.6,6).translate(0,1.8,0),pennant=new THREE.BoxGeometry(.5,.3,.05).translate(.25,2.9,0);
    const templeMat=reveal(new THREE.MeshLambertMaterial({color:colors.temple}),{grow:true}),spireMat=reveal(new THREE.MeshLambertMaterial({color:'#c46a2c'}),{grow:true});geometries.push(plinth,spire,pennant);materials.push(templeMat,spireMat);
    this.places=(model.places||[]).map(p=>{const t=new THREE.Group(),k=(p.rank?1.25:.95)*m,[x,z]=toWorld(p.x,p.y);t.add(new THREE.Mesh(plinth,templeMat),new THREE.Mesh(spire,spireMat),new THREE.Mesh(pennant,spireMat));t.scale.setScalar(k);t.position.set(x+r*2.4,0,z-r*2.4);group.add(t);return {...p,world:[x,z],top:3.2*k};});
    // Heuristic line (A*) and cost ruler.
    this.hLine=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineDashedMaterial({color:colors.heuristic,dashSize:style.marker,gapSize:style.marker*.6}));
    geometries.push(this.hLine.geometry);materials.push(this.hLine.material);group.add(this.hLine);
    this.ruler=new THREE.Group();const rulerMat=new THREE.MeshLambertMaterial({color:'#5b4632'});materials.push(rulerMat);
    const post=new THREE.BoxGeometry(.5,style.pillar,.5).translate(0,style.pillar/2,0),tick=new THREE.BoxGeometry(2,.18,.5);geometries.push(post,tick);
    this.ruler.add(new THREE.Mesh(post,rulerMat));for(let i=0;i<=4;i++){const t=new THREE.Mesh(tick,rulerMat);t.position.set(1,style.pillar*i/4,0);this.ruler.add(t);}
    this.ruler.position.set(-W/2-pad+1.5,0,H/2+pad-1.5);group.add(this.ruler);this.rulerCorner=[-W/2-pad+1.5,H/2+pad-1.5];
    // Hover ring: a thin halo that eases in around the junction under the pointer.
    const halo=new THREE.TorusGeometry(1,.07,8,40).rotateX(Math.PI/2),haloMat=new THREE.MeshBasicMaterial({color:colors.check});
    this.hoverRing=add(halo,haloMat);this.hoverRing.visible=false;this.hover={v:-1,s:0};
    this.dynamic=[];this.home=null;this.resetCamera(true);
    // Intro: the camera swoops down from above while the city rises out of the table.
    if(intro&&!this.reducedMotion){
      this.intro.t=0;this.intro.uReveal.value=0;this.labelLayer.style.opacity=0;
      const {target,sph}=this.pose();this.applyPose(target,new THREE.Spherical(sph.radius*1.55,sph.phi*.3,sph.theta-.7));this.flyTo(target,sph,1900);
    } else {this.intro.t=null;this.intro.uReveal.value=2;this.labelLayer.style.opacity='';}
  }
  clearModel() {
    this.animation=null;this.view=null;
    this.hoverRing=null;this.shadowMap?.dispose();this.shadowMap=null;
    for(const g of this.geometries||[])g.dispose();for(const m of this.materials||[])m.dispose();for(const m of this.instanced||[])m.dispose();this.clearDynamic();
    this.geometries=[];this.materials=[];this.instanced=[];
    if(this.group)this.scene.remove(this.group);this.group=null;for(const el of this.labels.values())el.remove();this.labels.clear();
  }
  clearDynamic(){for(const o of this.dynamic||[]){o.geometry.dispose();o.material.dispose();if(o.isInstancedMesh)o.dispose();this.group?.remove(o);}this.dynamic=[];this.fx=[];}
  height(view,v) {
    const d=view.dist[v],r=this.nodeRadius;
    if(!view.pillars||!Number.isFinite(d))return r*1.5;
    return Math.max(r*.8,view.maxCost>0?d/view.maxCost*this.style.pillar:0);
  }
  // view: {dist, status(v), predEdge, current, edge, edgeTo, updated, source, target, pathEdges,
  //        pillars, maxCost, method, finished, labels:[{key,text,node|world,cls}], hValue}
  setView(view) {
    if(this.animation){this.animation.draw(1);this.animation=null;}
    const prev=this.view,motion=!this.reducedMotion&&!!prev&&!!this.group;
    // Two tweens: one teaching step, or the cost ripple when "cost as height" is toggled
    // (pillars rise in order of their cost, so the wave retraces the search frontier).
    const step=motion&&view.animate&&this.model?.kind==='teach',rise=motion&&!step&&!!view.pillars!==!!prev.pillars,animate=step||rise;
    const newPath=motion&&!step&&view.pathEdges?.length>0&&!prev.pathEdges?.length;
    const oldNodes=animate?this.nodeVisuals:null;
    const oldRoads=animate?this.roads.geometry.getAttribute('color').array.slice():null;
    const markers=[this.current,this.sourceMarker,this.targetMarker],oldMarkers=animate?markers.map(o=>o.visible?o.position.clone():null):null;
    this.view=view;if(!this.group||this.lost)return;
    const reveals=[],nodeTweens=[],settledNow=[];this.nodeVisuals=[];
    const {nodeMeshes:meshes,nodeWorld:world,nodeRadius:r}=this,m4=new THREE.Matrix4(),q=new THREE.Quaternion(),pos=new THREE.Vector3(),scale=new THREE.Vector3(),color=new THREE.Color();
    for(const mesh of Object.values(meshes))mesh.count=0;
    this.instanceNodes={unknown:[],pillar:[],settled:[]};
    for(let v=0;v<world.length;v++){
      const status=view.status(v),kind=status==='unknown'?'unknown':status==='settled'?'settled':'pillar',mesh=meshes[kind],i=mesh.count++;
      const h=this.height(view,v);
      if(kind==='unknown'){pos.set(world[v][0],r*.45,world[v][1]);scale.setScalar(r*.4);}
      else {pos.set(world[v][0],0,world[v][1]);scale.set(r,h,r);}
      mesh.setMatrixAt(i,m4.compose(pos,q,scale));mesh.setColorAt(i,color.set(colors[status==='reached'?'tentative':status]));this.instanceNodes[kind].push(v);
      this.nodeVisuals[v]={pos:pos.clone(),scale:scale.clone(),color:color.clone(),kind};
      const old=oldNodes?.[v],pop=step&&kind==='settled'&&old?.kind!=='settled';if(pop)settledNow.push(v);
      if(old)nodeTweens.push({mesh,i,v,from:old,to:this.nodeVisuals[v],pop,delay:rise&&Number.isFinite(view.dist[v])&&view.maxCost>0?view.dist[v]/view.maxCost*.6:0});
    }
    for(const mesh of Object.values(meshes)){mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();}
    // Road colours: predecessor-tree lanes highlighted, closed lanes stay red.
    const attr=this.roads.geometry.getAttribute('color'),tree=new Set();
    for(let v=0;v<world.length;v++)if(view.predEdge[v]>=0&&Number.isFinite(view.dist[v]))tree.add(view.predEdge[v]);
    const treeColor=new THREE.Color(colors.tree);
    this.roadRanges.forEach(([start,count],id)=>{const c=tree.has(id)&&!this.model.edges[id].closed?treeColor:this.roadColor[id];for(let k=start;k<start+count;k++)attr.setXYZ(k,c.r,c.g,c.b);});
    attr.needsUpdate=true;
    // Dynamic overlays: final path and the lane being checked.
    this.clearDynamic();
    const lift=v=>this.height(view,v);
    if(view.pathEdges?.length){
      let from=view.source;
      const lines=view.pathEdges.map(id=>{const edge=this.model.edges[id],forward=edge.a===from;from=forward?edge.b:edge.a;return {points:forward?this.edgeLines[id].points:[...this.edgeLines[id].points].reverse()};});
      const halo=ribbon(lines,this.style.path*2.4,.32);this.addDynamic(halo.geometry,new THREE.MeshBasicMaterial({color:colors.path,transparent:true,opacity:.15,depthWrite:false}));
      const pathMat=new THREE.MeshBasicMaterial({color:colors.path});if(!this.reducedMotion)flowing(pathMat,this.flow,this.style.path*5);
      const path=ribbon(lines,this.style.path,.34);this.addDynamic(path.geometry,pathMat);
      if(step)reveals.push(ribbonReveal(halo.geometry),ribbonReveal(path.geometry));
      // The route draws itself from source to destination the first time it appears.
      else if(newPath){const a=ribbonReveal(halo.geometry),b=ribbonReveal(path.geometry);let t=0;const f=dt=>{t=Math.min(1,t+dt/1400);const k=ease.inOutCubic(t);a(k);b(k);return t<1;};f(0);this.fx.push(f);}
      if(!this.reducedMotion)this.addTravellers(lines,newPath?1400:step?800/(this.animationSpeed||1):0);
    }
    if(view.edge>=0){
      const line=this.edgeLines[view.edge],toEnd=view.edgeTo===this.model.edges[view.edge].b,pts=toEnd?line.points:[...line.points].reverse();
      const strip=ribbon([{points:pts}],this.style.edge,.2);this.addDynamic(strip.geometry,new THREE.MeshBasicMaterial({color:view.updated?colors.current:colors.check}));
      if(step)reveals.push(ribbonReveal(strip.geometry));
      const [x1,z1]=pts.at(-1),[x0,z0]=pts.at(-2),dir=new THREE.Vector3(x1-x0,0,z1-z0).normalize(),len=this.style.edge*3;
      const head=new THREE.ConeGeometry(this.style.edge*1.3,len,12).translate(0,len/2,0),arrow=this.addDynamic(head,new THREE.MeshLambertMaterial({color:view.updated?colors.current:colors.check}));
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir);arrow.position.set(x1-dir.x*(r*2.4+len),.3,z1-dir.z*(r*2.4+len));
      if(step){const end=arrow.position.clone(),start=new THREE.Vector3(pts[0][0],.3,pts[0][1]);reveals.push(t=>{arrow.position.lerpVectors(start,end,t);arrow.scale.setScalar(Math.min(1,t*5));});}
    }
    const place=(obj,v,extra=0)=>{if(v<0){obj.visible=false;return;}obj.visible=true;obj.position.set(world[v][0],(view.status(v)==='unknown'?r*1.7:lift(v))+extra,world[v][1]);};
    place(this.current,view.current,.05);place(this.sourceMarker,view.source);place(this.targetMarker,view.target);
    this.sourceMarker.position.x+=r*1.4;this.targetMarker.position.x-=r*1.4;
    // A*: dashed straight line from the selected node to the target = h(u).
    this.hLine.visible=view.method==='astar'&&view.current>=0&&view.current!==view.target&&!view.finished;
    if(this.hLine.visible){const a=world[view.current],b=world[view.target],y=Math.max(lift(view.current),lift(view.target))+r*2;this.hLine.geometry.setFromPoints([new THREE.Vector3(a[0],y,a[1]),new THREE.Vector3(b[0],y,b[1])]);this.hLine.computeLineDistances();}
    this.ruler.visible=!!view.pillars;
    this.updateLabels(view);
    for(const v of settledNow)this.pulse(v);
    if(animate){
      const targetRoads=attr.array.slice(),endMarkers=markers.map(o=>o.position.clone());
      const clock=new AnimationClock(rise?1600:800);clock.speed=rise?1:this.animationSpeed||1;
      const hop=oldMarkers[0]&&oldMarkers[0].distanceTo(endMarkers[0])>r?r*2.2:0;
      this.animation={clock,draw:t=>{
        const eased=ease.smooth(t);
        for(const reveal of reveals)reveal(eased);
        for(const n of nodeTweens){
          // Settled junctions and accepted relaxations land with a small springy overshoot.
          let k,bump=0;
          if(rise){k=stagger(t,n.delay,.4);k=view.pillars?ease.outBack(k):ease.smooth(k);}
          else{const late=view.updated&&n.v===view.edgeTo,raw=late?Math.max(0,(t-.55)/.45):t;k=late?ease.outBack(raw):ease.smooth(raw);if(n.pop)bump=Math.sin(Math.PI*raw)*.32;}
          const c=Math.min(1,Math.max(0,k));
          pos.lerpVectors(n.from.pos,n.to.pos,c);scale.lerpVectors(n.from.scale,n.to.scale,k);color.lerpColors(n.from.color,n.to.color,c);
          if(bump)scale.multiply(new THREE.Vector3(1+bump,1+bump*.5,1+bump));
          n.mesh.setMatrixAt(n.i,m4.compose(pos,q,scale));n.mesh.setColorAt(n.i,color);
        }
        for(const mesh of Object.values(meshes)){mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;}
        for(let k=0;k<attr.array.length;k++)attr.array[k]=oldRoads[k]+(targetRoads[k]-oldRoads[k])*eased;
        // The newly accepted connection appears behind the drawing stroke.
        if(view.updated&&view.edge>=0){const [start,count]=this.roadRanges[view.edge];for(let v=start;v<start+count;v++)for(let c=0;c<3;c++){const k=v*3+c;attr.array[k]=oldRoads[k]+(targetRoads[k]-oldRoads[k])*Math.max(0,(t-.8)*5);}}
        attr.needsUpdate=true;
        // Markers glide with the tween; the attention ring hops between junctions.
        markers.forEach((o,i)=>{if(oldMarkers[i]&&o.visible){o.position.lerpVectors(oldMarkers[i],endMarkers[i],eased);if(i===0)o.position.y+=Math.sin(Math.PI*eased)*hop;}});
      }};
      this.animationTime=performance.now();this.animation.draw(0);
    }
    this.request();
  }
  addDynamic(geometry,material,mesh=new THREE.Mesh(geometry,material)){this.group.add(mesh);this.dynamic.push(mesh);return mesh;}
  // A ring of light spreads from a junction the moment its cost becomes final.
  pulse(v) {
    const [x,z]=this.nodeWorld[v],material=new THREE.MeshBasicMaterial({color:colors.settled,transparent:true,depthWrite:false,side:THREE.DoubleSide});
    const ring=this.addDynamic(new THREE.RingGeometry(.84,1,48).rotateX(-Math.PI/2),material);ring.position.set(x,.1,z);
    let t=0;const f=dt=>{t=Math.min(1,t+dt*(this.animationSpeed||1)/1100);ring.scale.setScalar(this.nodeRadius*(1.4+ease.inOutCubic(t)*3.4));material.opacity=.55*(1-t)**2;ring.visible=t<1;return t<1;};
    f(0);this.fx.push(f);
  }
  // Travellers: small lights that walk the final route on a loop, with fading tails.
  addTravellers(lines,delay=0) {
    const st=this.style,sampler=polylineSampler(lines.flatMap(l=>l.points)),heads=Math.max(2,Math.min(8,Math.round(sampler.total/(st.path*16)))),tail=5,r=st.path*.34,speed=st.path*7;
    const mesh=this.addDynamic(null,null,new THREE.InstancedMesh(new THREE.SphereGeometry(1,12,8),new THREE.MeshBasicMaterial({color:'#fff3dd'}),heads*tail));mesh.frustumCulled=false;
    const m4=new THREE.Matrix4(),q=new THREE.Quaternion(),p=new THREE.Vector3(),scale=new THREE.Vector3();let age=-delay;
    const f=dt=>{
      age+=dt;const fade=ease.smooth(Math.max(0,Math.min(1,age/900)));
      for(let h=0;h<heads;h++)for(let j=0;j<tail;j++){
        const [x,z]=sampler.at(this.flow.uTime.value*speed+h*sampler.total/heads-j*r*1.3);
        mesh.setMatrixAt(h*tail+j,m4.compose(p.set(x,.36+r*.7,z),q,scale.setScalar(r*fade*(1-j*.17))));
      }
      mesh.instanceMatrix.needsUpdate=true;return true;
    };
    f(0);this.fx.push(f);
  }
  updateLabels(view) {
    const want=new Map(),r=this.nodeRadius,top=v=>(view.status(v)==='unknown'?r*2:this.height(view,v))+r*1.5;
    for(const l of view.labels||[]){
      let p;
      if(l.node!=null){const w=this.nodeWorld[l.node];p=new THREE.Vector3(w[0],top(l.node)+(l.lift||0),w[1]);}
      else if(l.place){const pl=this.places.find(x=>x.id===l.place);if(!pl)continue;p=new THREE.Vector3(pl.world[0]+r*2.4,pl.top+1,pl.world[1]-r*2.4);}
      else if(l.ruler!=null){p=new THREE.Vector3(this.rulerCorner[0]+5,this.style.pillar*l.ruler,this.rulerCorner[1]);if(!view.pillars)continue;}
      else if(l.hline){if(!this.hLine.visible)continue;const a=this.nodeWorld[view.current],b=this.nodeWorld[view.target];p=new THREE.Vector3((a[0]+b[0])/2,Math.max(this.height(view,view.current),this.height(view,view.target))+r*2.6,(a[1]+b[1])/2);}
      else if(l.edge!=null){const pts=this.edgeLines[l.edge].points,m=pts[Math.floor((pts.length-1)/2)],m2=pts[Math.ceil((pts.length-1)/2)];p=new THREE.Vector3((m[0]+m2[0])/2,r*2,(m[1]+m2[1])/2);}
      if(p)want.set(l.key,{...l,p});
    }
    for(const [key,el] of this.labels)if(!want.has(key)){el.remove();this.labels.delete(key);}
    for(const [key,l] of want){
      let el=this.labels.get(key);
      if(!el){el=document.createElement('span');this.labelLayer.append(el);this.labels.set(key,el);}
      el.className='lab3d-label '+(l.cls||'');if(el.textContent!==l.text)el.textContent=l.text;el._p=l.p;
    }
  }
  placeLabels() {
    const v=new THREE.Vector3();
    for(const el of this.labels.values()){
      v.copy(el._p).project(this.camera);
      const hidden=v.z>1||v.x<-1.1||v.x>1.1||v.y<-1.1||v.y>1.1;el.hidden=hidden;
      if(!hidden)el.style.transform=`translate(${((v.x+1)/2*this.w).toFixed(1)}px,${((1-v.y)/2*this.h).toFixed(1)}px) translate(-50%,-100%)`;
    }
  }
  pick(e) {
    if(!this.instanceNodes)return;
    const rect=this.canvas.getBoundingClientRect();this.pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
    this.raycaster.setFromCamera(this.pointer,this.camera);
    const hit=this.raycaster.intersectObjects(Object.values(this.nodeMeshes),false)[0];
    if(hit){const kind=Object.keys(this.nodeMeshes).find(k=>this.nodeMeshes[k]===hit.object);this.onPick?.(this.instanceNodes[kind][hit.instanceId]);}
  }
  dispose() {
    this.disposed=true;cancelAnimationFrame(this.raf);this.resizeObserver.disconnect();this.controls.dispose();this.clearModel();
    this.canvas.removeEventListener('webglcontextlost',this.onLost);this.canvas.removeEventListener('webglcontextrestored',this.onRestored);
    this.renderer.dispose();this.renderer.forceContextLoss();this.canvas.remove();
  }
}
