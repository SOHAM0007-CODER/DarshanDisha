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

// Night colours are darker than they look: the (unchanged) warm lights brighten them.
// Day / night only recolours scenery (sky, table, parks, buildings). Lights and every
// algorithm colour stay the same, so the replay reads identically in both modes.
const SKY={
  day:{bg:'#e7eade',base:colors.base,rim:colors.rim,park:colors.park,building:colors.building,windows:'#000000',lamp:'#000000'},
  night:{bg:'#172031',base:'#2c3650',rim:'#2a211b',park:'#2a3d34',building:'#465170',windows:'#2e2416',lamp:'#a8581c'}
};
for(const mode of Object.values(SKY))for(const k in mode)mode[k]=new THREE.Color(mode[k]);

// Sun and moon discs with a soft halo, drawn once onto a canvas.
function skyTexture(kind) {
  const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d'),sun=kind==='sun';
  const halo=g.createRadialGradient(128,128,24,128,128,128);
  halo.addColorStop(0,sun?'rgba(255,205,110,.85)':'rgba(214,226,255,.5)');halo.addColorStop(.35,sun?'rgba(255,184,84,.3)':'rgba(196,212,255,.16)');halo.addColorStop(1,'rgba(255,200,120,0)');
  g.fillStyle=halo;g.fillRect(0,0,256,256);
  const disc=g.createRadialGradient(118,118,4,128,128,42);
  disc.addColorStop(0,sun?'#fff6cf':'#fbfbf6');disc.addColorStop(1,sun?'#f5b23c':'#d9dce4');
  g.beginPath();g.arc(128,128,42,0,Math.PI*2);g.fillStyle=disc;g.fill();
  if(!sun){g.fillStyle='rgba(150,158,178,.5)';for(const [x,y,r] of [[112,116,9],[143,136,7],[134,104,5],[114,146,6],[146,116,4]]){g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();}}
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}

// Headlight beam: a flat fan along +x that fades from warm white to black. With additive
// blending the black end adds nothing, so the beam melts into the road.
function beamGeometry() {
  const g=new THREE.BufferGeometry(),warm=[1,.93,.74];
  g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,-.16,0,0,.16,1,0,-.55,1,0,.55],3));
  g.setAttribute('color',new THREE.Float32BufferAttribute([...warm,...warm,0,0,0,0,0,0],3));g.setIndex([0,1,2,2,1,3]);
  return g;
}
// Soft round pool of light under a street lamp.
function poolTexture() {
  const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d'),r=g.createRadialGradient(32,32,0,32,32,32);
  r.addColorStop(0,'rgba(255,214,140,1)');r.addColorStop(.5,'rgba(255,190,100,.35)');r.addColorStop(1,'rgba(255,180,90,0)');g.fillStyle=r;g.fillRect(0,0,64,64);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}
const additive=options=>new THREE.MeshBasicMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,opacity:0,...options});

// Lit windows: small panes on the outside of every building wall, one or two rows by height.
function windowPanes(polygons,toWorld) {
  const panes=[];let seed=3;const rand=()=>(seed=(seed*16807)%2147483647)/2147483647;
  for(const [index,polygon] of polygons.entries()){
    let pts=polygon.map(p=>toWorld(p[0],p[1]));if(pts.length>3&&pts[0][0]===pts.at(-1)[0]&&pts[0][1]===pts.at(-1)[1])pts=pts.slice(0,-1);if(pts.length<3)continue;
    const height=.16+(index%5)*.055,rows=height>.3?[.33,.72]:[.55],cx=pts.reduce((s,p)=>s+p[0],0)/pts.length,cz=pts.reduce((s,p)=>s+p[1],0)/pts.length;
    for(let i=0;i<pts.length;i++){
      const [ax,az]=pts[i],[bx,bz]=pts[(i+1)%pts.length],len=Math.hypot(bx-ax,bz-az),n=Math.floor(len/.24);if(!n)continue;
      let nx=-(bz-az)/len,nz=(bx-ax)/len;if(((ax+bx)/2-cx)*nx+((az+bz)/2-cz)*nz<0){nx=-nx;nz=-nz;}
      for(let j=0;j<n;j++)for(const row of rows)if(rand()<.5){const t=(j+.5)/n;panes.push([ax+(bx-ax)*t+nx*.012,height*row,az+(bz-az)*t+nz*.012,Math.atan2(-(bz-az),bx-ax),rand()]);}
    }
  }
  return panes;
}

// A Pune mandir in miniature (unit scale, entrance facing +z): a stepped stone plinth,
// a pillared mandapa sheltering a sindoor-red Ganesha, the sanctum with its tiered
// nagara shikhara, gold amalaka and kalash, and a saffron flag. Returns shared
// geometries with a material key each, plus festival-light positions for night.
const TEMPLE_TOP=2.55;
function templeParts() {
  const parts=[],box=(key,w,h,d,x,y,z)=>parts.push([new THREE.BoxGeometry(w,h,d).translate(x,y+h/2,z),key]);
  box('stone',1.8,.14,1.5,0,0,0);box('trim',1.6,.03,1.3,0,.14,0);box('stone',1.55,.09,1.25,0,.17,0);
  box('stone',.56,.17,.12,0,0,.81);box('stone',.56,.085,.12,0,0,.93);            // front steps
  box('stone',.8,.55,.7,0,.26,-.25);box('door',.24,.36,.02,0,.26,.105);          // sanctum and its doorway
  for(const x of [-.36,.36])for(const z of [.18,.56])parts.push([new THREE.CylinderGeometry(.04,.05,.48,8).translate(x,.5,z),'gold']);
  box('stone',.92,.06,.56,0,.74,.37);box('trim',.96,.025,.6,0,.8,.37);
  parts.push([new THREE.ConeGeometry(.62,.34,4).rotateY(Math.PI/4).translate(0,.995,.37),'gold']);
  // Ganesha on a small pedestal: belly, head and a hint of the trunk.
  box('gold',.2,.08,.16,0,.26,.36);
  parts.push([new THREE.SphereGeometry(.1,12,8).translate(0,.43,.36),'idol'],[new THREE.SphereGeometry(.07,12,8).translate(0,.58,.38),'idol'],[new THREE.CylinderGeometry(.015,.025,.12,6).rotateX(.5).translate(0,.52,.45),'idol']);
  // Shikhara: tiers narrowing on a curve, with gold bands between groups of tiers.
  const base=.81,height=1.15,n=7,radius=t=>.36*(1-Math.pow(t,1.7))+.07,rings=[];
  for(let i=0;i<n;i++){
    const h=height/n,y=base+h*i;
    parts.push([new THREE.CylinderGeometry(radius((i+1)/n),radius(i/n),h,8).translate(0,y+h/2,-.25),i===n-1?'gold':'stone']);
    if(i===2||i===4)parts.push([new THREE.CylinderGeometry(radius(i/n)+.02,radius(i/n)+.02,.03,8).translate(0,y,-.25),'gold']);
    rings.push([y,radius(i/n)+.015]);
  }
  const top=base+height;
  parts.push([new THREE.CylinderGeometry(.12,.12,.05,14).translate(0,top+.025,-.25),'gold'],[new THREE.SphereGeometry(.055,10,8).translate(0,top+.1,-.25),'gold'],[new THREE.ConeGeometry(.03,.1,8).translate(0,top+.19,-.25),'gold']);
  parts.push([new THREE.CylinderGeometry(.01,.01,.42,5).translate(0,top+.21,-.25),'door']);
  const pennant=new THREE.Shape([new THREE.Vector2(0,0),new THREE.Vector2(.3,-.07),new THREE.Vector2(0,-.16)]);
  parts.push([new THREE.ShapeGeometry(pennant).translate(0,top+.42,-.25),'flag']);
  // Festival lights: the mandapa eaves, rings up the shikhara, and strings from the
  // shikhara to the plinth corners.
  const lights=[];
  for(let t=0;t<1;t+=1/12){lights.push([-.48+.96*t,.79,.67],[-.48+.96*t,.79,.07],[-.48,.79,.07+.6*t],[.48,.79,.07+.6*t]);}
  for(const [y,r] of rings)for(let a=0;a<8;a++)lights.push([Math.cos(a/8*Math.PI*2)*r,y,-.25+Math.sin(a/8*Math.PI*2)*r]);
  for(const [x,z] of [[-.88,.73],[.88,.73],[-.88,-.73],[.88,-.73]])for(let t=0;t<=1;t+=1/14){const sag=Math.sin(Math.PI*t)*.25;lights.push([x*t,top-(top-.3)*t-sag,-.25+(z+.25)*t]);}
  return {parts,lights};
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
  constructor(host,labelLayer,{onPick,onStatus,onFollow,reducedMotion=false}={}) {
    this.host=host;this.labelLayer=labelLayer;this.onPick=onPick;this.onStatus=onStatus;this.onFollow=onFollow;this.reducedMotion=reducedMotion;
    this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'low-power'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));   // a sharp model without a 4x pixel bill on HiDPI laptops
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
    this.createSky();this.createMinimap();
    this.bindEvents();this.resize();
    this.resizeObserver=new ResizeObserver(()=>{this.resize();this.request();});this.resizeObserver.observe(host);
    // Nothing animates while the lab is scrolled out of view or the tab is hidden.
    this.onScreen=true;this.lifeEnabled=true;
    this.intersection=new IntersectionObserver(([entry])=>{this.onScreen=entry.isIntersecting;if(this.onScreen)this.request();});this.intersection.observe(host);
    this.resetCamera(true);
  }
  // Sky: sun, moon and stars ride with the camera, so they stay in view while orbiting.
  createSky() {
    this.sky=new THREE.Group();this.camera.add(this.sky);this.scene.add(this.camera);
    this.skyMaps=[skyTexture('sun'),skyTexture('moon')];
    // Sun and moon draw over the city (like a sky dial); stars only show where the sky is open.
    [this.sun,this.moon]=this.skyMaps.map(map=>{const s=new THREE.Sprite(new THREE.SpriteMaterial({map,fog:false,depthTest:false,depthWrite:false,transparent:true}));s.renderOrder=10;this.sky.add(s);return s;});
    const n=160,pts=new Float32Array(n*3);let seed=11;const rand=()=>(seed=(seed*16807)%2147483647)/2147483647;
    for(let i=0;i<n;i++)pts.set([rand()*2.4-1.2,rand()*1.5-.4,0],i*3);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(pts,3));
    this.stars=new THREE.Points(geometry,new THREE.PointsMaterial({color:'#f4f1e6',size:2,sizeAttenuation:false,transparent:true,opacity:0,fog:false,depthWrite:false}));
    this.sky.add(this.stars);this.night={p:0,goal:0};this.applySky();
  }
  setNight(night,animate=true) {
    this.night.goal=night?1:0;
    if(!animate||this.reducedMotion){this.night.p=this.night.goal;this.applySky();}
    this.request();
  }
  // Minimap: the whole table from above. The pointer is you (where the camera looks,
  // aimed the way it faces); click or drag on the minimap to move the camera there.
  createMinimap() {
    const c=this.mini=document.createElement('canvas');c.className='lab3d-minimap';c.setAttribute('role','img');
    c.setAttribute('aria-label','Minimap of the whole map. The white pointer shows where the camera is looking; click or drag to move the camera.');
    c.title='Minimap: click or drag to move the camera';this.host.append(c);this.miniCtx=c.getContext('2d');
    let dragging=false;
    const move=(e,glide)=>{const r=c.getBoundingClientRect(),E=this.extent||TABLE;this.moveTo(((e.clientX-r.left)/r.width-.5)*E,((e.clientY-r.top)/r.height-.5)*E,glide);};
    c.addEventListener('pointerdown',e=>{e.preventDefault();dragging=true;c.setPointerCapture(e.pointerId);move(e,true);});
    c.addEventListener('pointermove',e=>{if(dragging)move(e,false);});
    for(const type of ['pointerup','pointercancel'])c.addEventListener(type,()=>{dragging=false;});
  }
  // Moving the camera by hand hands control back from Follow.
  moveTo(x,z,glide) {
    this.setFollow(false);
    const h=(this.extent||TABLE)/2,p=this.pose();p.target.set(THREE.MathUtils.clamp(x,-h,h),0,THREE.MathUtils.clamp(z,-h,h));
    if(glide)this.flyTo(p.target,p.sph,350);else{this.fly=null;this.applyPose(p.target,p.sph);this.request();}
  }
  // Streets are drawn once per model into an offscreen canvas; each frame only adds the
  // route, the markers and the pointer on top.
  drawMiniBase(W) {
    const off=document.createElement('canvas');off.width=off.height=W;const g=off.getContext('2d'),E=this.extent||TABLE,s=W/E;
    g.fillStyle='#22302a';g.fillRect(0,0,W,W);g.strokeStyle='rgba(236,228,206,.5)';g.lineWidth=Math.max(.7,W/280);g.lineCap=g.lineJoin='round';g.beginPath();
    for(const l of this.edgeLines)l.points.forEach(([x,z],i)=>i?g.lineTo((x+E/2)*s,(z+E/2)*s):g.moveTo((x+E/2)*s,(z+E/2)*s));
    g.stroke();g.fillStyle='#e8913a';
    for(const p of this.places||[]){g.beginPath();g.arc((p.world[0]+E/2)*s,(p.world[1]+E/2)*s,W/80,0,Math.PI*2);g.fill();}
    return off;
  }
  drawMinimap() {
    const c=this.mini;if(!c||!this.edgeLines||c.offsetParent===null)return;
    const W=Math.round(c.clientWidth*Math.min(devicePixelRatio||1,2));if(!W)return;
    if(c.width!==W){c.width=c.height=W;this.miniBase=null;}
    this.miniBase??=this.drawMiniBase(W);
    const g=this.miniCtx,E=this.extent||TABLE,s=W/E,P=(x,z)=>[(x+E/2)*s,(z+E/2)*s],v=this.view;
    g.drawImage(this.miniBase,0,0);
    if(v){
      if(v.pathEdges?.length){g.strokeStyle=colors.path;g.lineWidth=W/60;g.lineCap=g.lineJoin='round';g.beginPath();for(const id of v.pathEdges)this.edgeLines[id].points.forEach(([x,z],i)=>{const [a,b]=P(x,z);i?g.lineTo(a,b):g.moveTo(a,b);});g.stroke();}
      const dot=(n,color,r)=>{if(n<0)return;const [a,b]=P(...this.nodeWorld[n]);g.beginPath();g.arc(a,b,r,0,Math.PI*2);g.fillStyle=color;g.fill();g.lineWidth=W/150;g.strokeStyle='#fffaf0';g.stroke();};
      dot(v.source,colors.source,W/34);dot(v.target,colors.target,W/34);if(!v.finished)dot(v.current,colors.current,W/48);
    }
    // You: a view cone and an arrow at the camera's focus, pointing the way it faces.
    const t=this.controls.target,[px,pz]=P(t.x,t.z),dir=Math.atan2(t.z-this.camera.position.z,t.x-this.camera.position.x),reach=THREE.MathUtils.clamp(this.camera.position.distanceTo(t)*.45*s,W*.07,W*.35);
    g.beginPath();g.moveTo(px,pz);g.arc(px,pz,reach,dir-.42,dir+.42);g.closePath();g.fillStyle=this.follow?'rgba(255,190,120,.28)':'rgba(255,240,205,.2)';g.fill();
    const a=W/11;g.save();g.translate(px,pz);g.rotate(dir);g.beginPath();g.moveTo(a*.75,0);g.lineTo(-a*.5,a*.45);g.lineTo(-a*.22,0);g.lineTo(-a*.5,-a*.45);g.closePath();
    g.fillStyle='#ffffff';g.fill();g.lineWidth=W/90;g.strokeStyle='#ad4b21';g.stroke();g.restore();
  }
  // Follow: the camera glides after the junction the search is looking at, then frames the
  // finished route. Orbit and zoom still work; moving the camera by hand turns it off.
  setFollow(on) {
    if(!!this.follow===on)return;this.follow=on;this.onFollow?.(on);
    this.followGoal=null;if(on)this.aimFollow(true);this.request();
  }
  aimFollow(start) {
    const v=this.view;if(!this.follow||!v||!this.nodeWorld)return;
    let x,z;
    if(v.followAt!=null)[x,z]=this.nodeWorld[v.followAt];
    else if(v.finished||v.current<0){const a=this.nodeWorld[v.source],b=this.nodeWorld[v.target];x=(a[0]+b[0])/2;z=(a[1]+b[1])/2;}else [x,z]=this.nodeWorld[v.current];
    this.followGoal=new THREE.Vector3(x,0,z);
    if(start){const {sph}=this.pose();sph.radius=Math.min(sph.radius,this.model.kind==='pune'?30:90);sph.phi=Math.min(sph.phi,1);this.flyTo(this.followGoal,sph,900);}
  }
  stepFollow(dt) {
    if(!this.follow||!this.followGoal||this.fly)return false;
    const t=this.controls.target,d=this.followGoal.clone().sub(t);if(d.lengthSq()<1e-4)return false;
    d.multiplyScalar(this.reducedMotion?1:1-Math.exp(-dt/260));t.add(d);this.camera.position.add(d);return true;
  }
  // Traffic and crowds can be switched off on slower machines; the lab then idles again.
  setLife(on) {
    this.lifeEnabled=on;for(const mesh of this.lifeMeshes||[])mesh.visible=on;
    if(!on){clearTimeout(this.lifeTimer);}this.request();
  }
  // Sun sets to the right as the moon rises from the left along the same arc (and back).
  placeSky() {
    const Z=900,hh=Z*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2)),hw=hh*this.camera.aspect,p=ease.inOutCubic(this.night.p);
    const R=hh*.8,cx=hw*.12,cy=hh*.66-R,size=hh*.3;
    const at=(sprite,a)=>{const y=cy+R*Math.sin(a);sprite.position.set(cx+R*Math.cos(a),y,-Z);sprite.scale.setScalar(size*(.75+.25*Math.sin(a)));
      sprite.material.opacity=THREE.MathUtils.clamp((y-(hh*.66-R*.95))/(R*.6),0,1);sprite.visible=sprite.material.opacity>.01;};
    at(this.sun,Math.PI/2-p*1.5);at(this.moon,Math.PI/2+(1-p)*1.5);
    this.stars.position.z=-Z;this.stars.scale.set(hw,hh,1);this.stars.material.opacity=p*.9;this.stars.visible=p>.01;
  }
  applySky() {
    const p=ease.inOutCubic(this.night.p),{day,night}=SKY;
    this.scene.background.lerpColors(day.bg,night.bg,p);this.scene.fog.color.copy(this.scene.background);
    for(const [material,key] of this.scenery||[])material.color.lerpColors(day[key],night[key],p);
    for(const [material,key] of this.glow||[])material.emissive.lerpColors(day[key],night[key],p);
    for(const [material,max] of this.nightLights||[]){material.opacity=max*p;material.visible=p>.01;}
    this.placeSky();
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
    const visible=this.host.offsetParent!==null&&this.onScreen&&!document.hidden;
    if(visible&&this.fx.length){this.flow.uTime.value+=dt/1000;this.fx=this.fx.filter(f=>f(dt));busy=busy||this.fx.length>0;}
    busy=this.stepHover(dt)||busy;
    busy=this.stepFollow(dt)||busy;
    const n=this.night;
    if(n.p!==n.goal){n.p=n.goal>n.p?Math.min(n.goal,n.p+dt/1800):Math.max(n.goal,n.p-dt/1800);this.applySky();busy=true;}else this.placeSky();
    // City life steps at ~30 fps and, on its own, only asks for frames at that rate.
    const life=visible&&this.life&&this.lifeEnabled&&!this.reducedMotion;
    if(life){this.lifeTime=(this.lifeTime||0)+dt;if(this.lifeTime>=30){this.life(this.lifeTime);this.lifeTime=0;}}
    const moving=this.controls.update(),d=this.camera.position.distanceTo(this.controls.target),e=this.extent||TABLE;
    this.scene.fog.near=d;this.scene.fog.far=d+e*1.7;
    this.renderer.render(this.scene,this.camera);this.placeLabels();this.drawMinimap();
    if((visible&&busy)||(moving&&this.controls.enableDamping)||(this.animation&&!this.animation.clock.paused))this.request();
    else if(life){clearTimeout(this.lifeTimer);this.lifeTimer=setTimeout(()=>this.request(),33);}
    else this.idle=true;
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
    const dist=Math.max(30,(teaching?1.02:1.25)*Math.max(f.size/2/(half*this.camera.aspect),f.size*.4/half)),dir=new THREE.Vector3(-.12,teaching?1.25:1.55,.9).normalize();
    this.flyTo(new THREE.Vector3(f.x,0,f.z),new THREE.Spherical().setFromVector3(dir.multiplyScalar(dist)),instant?0:this.intro.t!=null?1500:1000);
  }
  focus(nodes){
    if(!nodes?.length||!this.nodeWorld){this.home=null;this.setDetail(null);return this.resetCamera();}
    let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;for(const v of nodes){const [x,z]=this.nodeWorld[v];x0=Math.min(x0,x);x1=Math.max(x1,x);z0=Math.min(z0,z);z1=Math.max(z1,z);}
    this.home={x:(x0+x1)/2,z:(z0+z1)/2,size:Math.max(14,Math.max(x1-x0,z1-z0)*1.15+6)};this.setDetail(this.home.size);this.resetCamera();
  }
  // Search marks scale with the framed region: a short leg is not buried under giant
  // markers, and a long leg's explored junctions and roads stay visible from afar.
  setDetail(size){
    const base=STYLES[this.model?.kind||'pune'],k=this.model?.kind==='pune'&&size?THREE.MathUtils.clamp(size/40,.45,2.2):1;
    this.detail=k;this.style={...base,road:base.road*k,node:base.node*k,path:base.path*k,marker:base.marker*k,edge:base.edge*k};
    if(!this.group)return;this.nodeRadius=this.style.node;
    // The start / destination markers, the search car and the mandirs grow less than the
    // search marks, so a long leg does not turn them into giants when you zoom in.
    const c=Math.min(k,1.15),flags=this.model?.kind==='pune'?.6:1;
    this.current.scale.setScalar(c);for(const o of [this.sourceMarker,this.targetMarker])o.scale.setScalar(c*flags);
    for(const p of this.places)this.placeTemple(p,k);
  }
  // A mandir sits beside its junction, clear of the junction marker.
  placeTemple(p,k){
    const s=p.scale*Math.min(k,1.3),gap=this.nodeRadius*1.6+.9*s;
    p.group.scale.setScalar(s);p.group.position.set(p.world[0]+gap,0,p.world[1]-gap);p.top=TEMPLE_TOP*s;
  }
  topView(){const half=Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2)),d=1.08*(this.extent||TABLE)/2/(half*Math.min(1,this.camera.aspect));this.flyTo(new THREE.Vector3(),new THREE.Spherical(d*1.35,1e-4,0),900);}
  zoom(f){const p=this.pose();p.sph.radius*=f;this.flyTo(p.target,p.sph,380);}
  rotate(deg){const p=this.pose();p.sph.theta+=THREE.MathUtils.degToRad(deg);this.flyTo(p.target,p.sph,480);}
  pan(dx,dy){
    const p=this.pose(),s=p.sph.radius*.0035,right=new THREE.Vector3().setFromMatrixColumn(this.camera.matrix,0),fwd=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),right);
    p.target.add(right.multiplyScalar(-dx*s).add(fwd.multiplyScalar(dy*s)));this.flyTo(p.target,p.sph,260);
  }

  setModel(model,intro=true) {
    this.model=model;this.clearModel();this.miniBase=null;
    const style=this.style={...STYLES[model.kind]},group=this.group=new THREE.Group();this.scene.add(group);
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
    const scenery=this.scenery=[],glow=this.glow=[],nightLights=this.nightLights=[];
    // Lights that only exist after dark (windows, lamps, headlights) fade with the sky.
    const lit=(material,max=1)=>{material.transparent=true;nightLights.push([material,max]);return material;};
    this.lit=lit;
    const rim=add(new THREE.BoxGeometry(W+pad*2+3,4,H+pad*2+3),new THREE.MeshLambertMaterial({color:colors.rim}));rim.position.y=-2.05;scenery.push([rim.material,'rim']);
    const base=add(new THREE.BoxGeometry(W+pad*2,.1,H+pad*2),new THREE.MeshLambertMaterial({color:colors.base}));base.position.y=-.05;scenery.push([base.material,'base']);
    if(model.parks?.length)scenery.push([add(flatShapes(model.parks,toWorld,.015),reveal(new THREE.MeshLambertMaterial({color:colors.park}))).material,'park']);
    if(model.buildings?.length){const b=add(flatShapes(model.buildings,toWorld,.03,true),reveal(new THREE.MeshLambertMaterial({color:colors.building,side:THREE.DoubleSide,transparent:model.kind==='pune',opacity:.45,depthWrite:false}),{grow:true}));scenery.push([b.material,'building']);glow.push([b.material,'windows']);
      if(model.kind==='pune'){
        const panes=windowPanes(model.buildings,toWorld),geometry=new THREE.PlaneGeometry(.1,.065),material=reveal(lit(new THREE.MeshBasicMaterial({color:'#ffffff',depthWrite:false,side:THREE.DoubleSide})),{instanced:true});
        const mesh=add(geometry,material,new THREE.InstancedMesh(geometry,material,panes.length)),m4=new THREE.Matrix4(),q=new THREE.Quaternion(),up=new THREE.Vector3(0,1,0),one=new THREE.Vector3(1,1,1),c=new THREE.Color();
        const tones=['#ffd27a','#ffc35c','#fff0b8','#ffdf9a','#cfe0ff'];
        panes.forEach(([x,y,z,angle,r],i)=>{mesh.setMatrixAt(i,m4.compose(new THREE.Vector3(x,y,z),q.setFromAxisAngle(up,angle),one));mesh.setColorAt(i,c.set(tones[Math.floor(r*tones.length)]));});
        mesh.computeBoundingSphere();mesh.renderOrder=1;   // drawn after the translucent walls
      }
    }
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
    // The search's attention: a saffron car that drives to the junction being looked at.
    // Its nose (+x) turns toward each new junction; headlights come on after dark.
    this.current=new THREE.Group();
    {
      const L=m*2.6,Wd=m*1.25,glass=reveal(new THREE.MeshLambertMaterial({color:'#2b3a48'}),{grow:true}),tyre=reveal(new THREE.MeshLambertMaterial({color:'#262626'}),{grow:true});
      const lens=reveal(new THREE.MeshBasicMaterial({color:'#fff4cf'})),tail=reveal(new THREE.MeshBasicMaterial({color:'#d8402c'})),beamMat=lit(additive({vertexColors:true}),.5);
      const body=new THREE.BoxGeometry(L,m*.55,Wd).translate(0,m*.5,0),cabin=new THREE.BoxGeometry(L*.5,m*.5,Wd*.86).translate(-L*.06,m*1.02,0),windows=new THREE.BoxGeometry(L*.53,m*.3,Wd*.9).translate(-L*.06,m*1.02,0);
      const wheel=new THREE.CylinderGeometry(m*.3,m*.3,m*.24,14).rotateX(Math.PI/2),lamp=new THREE.BoxGeometry(m*.08,m*.16,m*.28),beam=beamGeometry();
      geometries.push(body,cabin,windows,wheel,lamp,beam);materials.push(glass,tyre,lens,tail,beamMat);
      const car=new THREE.Group();car.scale.setScalar(.6);this.current.add(car);
      car.add(new THREE.Mesh(body,saffron),new THREE.Mesh(cabin,saffron),new THREE.Mesh(windows,glass));
      for(const x of [L*.32,-L*.32])for(const z of [Wd*.5,-Wd*.5]){const w=new THREE.Mesh(wheel,tyre);w.position.set(x,m*.3,z);car.add(w);}
      for(const z of [Wd*.3,-Wd*.3]){const h=new THREE.Mesh(lamp,lens);h.position.set(L/2,m*.55,z);const t=new THREE.Mesh(lamp,tail);t.position.set(-L/2,m*.55,z);car.add(h,t);}
      const light=new THREE.Mesh(beam,beamMat);light.position.set(L/2,m*.04,0);light.scale.set(m*4.5,1,m*2.4);car.add(light);
    }
    group.add(this.current);
    const flag=new THREE.Group(),pole=new THREE.CylinderGeometry(m*.1,m*.1,m*5,8).translate(0,m*2.5,0),cloth=new THREE.BoxGeometry(m*2,m*1.2,m*.12).translate(m,m*4.3,0),srcMat=reveal(new THREE.MeshLambertMaterial({color:colors.source}),{grow:true});
    flag.add(new THREE.Mesh(pole,srcMat),new THREE.Mesh(cloth,srcMat));geometries.push(pole,cloth);materials.push(srcMat);group.add(flag);this.sourceMarker=flag;
    const goal=new THREE.Group(),gem=new THREE.OctahedronGeometry(m*1.1).translate(0,m*4.4,0),stem=new THREE.CylinderGeometry(m*.1,m*.1,m*3.3,8).translate(0,m*1.65,0),goalMat=reveal(new THREE.MeshLambertMaterial({color:colors.target}),{grow:true});
    goal.add(new THREE.Mesh(gem,goalMat),new THREE.Mesh(stem,goalMat));geometries.push(gem,stem);materials.push(goalMat,saffron);group.add(goal);this.targetMarker=goal;
    // Mandal markers: a miniature mandir per place, strung with festival lights at night.
    const temple=templeParts(),solidMat=color=>reveal(new THREE.MeshLambertMaterial({color,side:THREE.DoubleSide}),{grow:true});
    const templeMats={stone:solidMat(colors.temple),trim:solidMat('#c9a25a'),gold:solidMat('#d4a53c'),door:solidMat('#5a4030'),idol:solidMat('#d2491f'),flag:solidMat('#ee7a1c')};
    geometries.push(...temple.parts.map(([g])=>g));materials.push(...Object.values(templeMats));
    glow.push([templeMats.stone,'windows'],[templeMats.gold,'lamp']);   // mandirs glow warm after dark
    const bulbs=new THREE.BufferGeometry(),tones=[[1,.81,.35],[1,.48,.23],[1,.95,.75]];
    bulbs.setAttribute('position',new THREE.Float32BufferAttribute(temple.lights.flat(),3));bulbs.setAttribute('color',new THREE.Float32BufferAttribute(temple.lights.flatMap((_,i)=>tones[i%3]),3));
    const bulbMat=lit(new THREE.PointsMaterial({size:3,sizeAttenuation:false,vertexColors:true,depthWrite:false}));geometries.push(bulbs);materials.push(bulbMat);
    this.places=(model.places||[]).map(p=>{
      const t=new THREE.Group(),k=(p.rank?1.25:.95)*m,[x,z]=toWorld(p.x,p.y);
      for(const [geometry,key] of temple.parts)t.add(new THREE.Mesh(geometry,templeMats[key]));
      t.add(new THREE.Points(bulbs,bulbMat));group.add(t);
      const place={...p,world:[x,z],group:t,scale:k};this.placeTemple(place,1);return place;
    });
    // Cost ruler.
    this.ruler=new THREE.Group();const rulerMat=new THREE.MeshLambertMaterial({color:'#5b4632'});materials.push(rulerMat);
    const post=new THREE.BoxGeometry(.5,style.pillar,.5).translate(0,style.pillar/2,0),tick=new THREE.BoxGeometry(2,.18,.5);geometries.push(post,tick);
    this.ruler.add(new THREE.Mesh(post,rulerMat));for(let i=0;i<=4;i++){const t=new THREE.Mesh(tick,rulerMat);t.position.set(1,style.pillar*i/4,0);this.ruler.add(t);}
    this.ruler.position.set(-W/2-pad+1.5,0,H/2+pad-1.5);group.add(this.ruler);this.rulerCorner=[-W/2-pad+1.5,H/2+pad-1.5];
    // Hover ring: a thin halo that eases in around the junction under the pointer.
    const halo=new THREE.TorusGeometry(1,.07,8,40).rotateX(Math.PI/2),haloMat=new THREE.MeshBasicMaterial({color:colors.check});
    this.hoverRing=add(halo,haloMat);this.hoverRing.visible=false;this.hover={v:-1,s:0};
    this.dynamic=[];this.home=null;this.detail=1;
    if(model.kind==='pune')this.addLife(add,reveal);
    this.applySky();this.resetCamera(true);
    // Intro: the camera swoops down from above while the city rises out of the table.
    if(intro&&!this.reducedMotion){
      this.intro.t=0;this.intro.uReveal.value=0;this.labelLayer.style.opacity=0;
      const {target,sph}=this.pose();this.applyPose(target,new THREE.Spherical(sph.radius*1.55,sph.phi*.3,sph.theta-.7));this.flyTo(target,sph,1900);
    } else {this.intro.t=null;this.intro.uReveal.value=2;this.labelLayer.style.opacity='';}
  }
  // Ambient city life on the Pune map: cars and auto-rickshaws wander the streets, people
  // walk the lanes and crowds gather at the mandals. Purely decorative: never picked,
  // never coloured by the replay, and frozen in place under reduced motion.
  addLife(add,reveal) {
    const edges=this.model.edges,lines=this.edgeLines,major=e=>['primary','secondary','tertiary'].includes(e.kind);
    let seed=7;const rand=()=>(seed=(seed*16807)%2147483647)/2147483647;
    const len=lines.map(l=>{const c=[0];for(let i=1;i<l.points.length;i++)c.push(c[i-1]+Math.hypot(l.points[i][0]-l.points[i-1][0],l.points[i][1]-l.points[i-1][1]));return c;});
    const adj=new Map();
    edges.forEach((e,id)=>{if(e.closed||len[id].at(-1)<.05)return;for(const v of [e.a,e.b]){if(!adj.has(v))adj.set(v,[]);adj.get(v).push(id);}});
    const pick=(ids,weight)=>{let total=0;for(const id of ids)total+=weight(id);let r=rand()*total;for(const id of ids)if((r-=weight(id))<=0)return id;return ids.at(-1);};
    const carWeight=id=>['footway','steps'].includes(edges[id].kind)?0:major(edges[id])?4:1,walkWeight=id=>edges[id].kind==='primary'?0:['footway','living_street'].includes(edges[id].kind)?3:1;
    const usable=[...new Set([...adj.values()].flat())];
    // Spread agents over the network in proportion to street length.
    const spawn=(n,weight,speed,lane)=>Array.from({length:n},()=>{const id=pick(usable,id=>weight(id)*len[id].at(-1));return {id,fwd:rand()<.5,s:rand()*len[id].at(-1),speed:speed[0]+rand()*(speed[1]-speed[0]),lane,weight};});
    const cars=spawn(Math.min(70,Math.round(usable.length/18)),carWeight,[1.4,2.6],.13),walkers=spawn(Math.min(60,Math.round(usable.length/24)),walkWeight,[.18,.32],.2);
    // At a junction, continue onto another street (busier roads more likely), else turn back.
    const turn=a=>{const e=edges[a.id],v=a.fwd?e.b:e.a,opts=(adj.get(v)||[]).filter(id=>id!==a.id&&a.weight(id)>0);
      const id=opts.length?pick(opts,a.weight):a.id;a.id=id;a.fwd=edges[id].a===v;};
    const where=(a,k)=>{
      const pts=lines[a.id].points,c=len[a.id],L=c.at(-1),d=a.fwd?a.s:L-a.s;let i=1;while(i<pts.length-1&&c[i]<d)i++;
      const [x0,z0]=pts[i-1],[x1,z1]=pts[i],seg=(c[i]-c[i-1])||1,f=THREE.MathUtils.clamp((d-c[i-1])/seg,0,1),sign=a.fwd?1:-1,dx=(x1-x0)/seg*sign,dz=(z1-z0)/seg*sign;
      return [x0+(x1-x0)*f-dz*a.lane*k,z0+(z1-z0)*f+dx*a.lane*k,Math.atan2(-dz,dx)];
    };
    // Crowds: devotees mill around each mandal shown on the map.
    const crowd=this.places.flatMap(place=>Array.from({length:place.rank?34:22},()=>({place,a:rand()*Math.PI*2,r:1.2+rand()*1.4,w:(rand()-.5)*.3,phase:rand()*6})));
    const solid=color=>reveal(new THREE.MeshLambertMaterial({color}),{grow:true,instanced:true});
    const instanced=(geometry,material,count,palette)=>{
      const mesh=add(geometry,material,new THREE.InstancedMesh(geometry,material,count));mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if(palette)for(let i=0;i<count;i++)mesh.setColorAt(i,new THREE.Color(palette[Math.floor(rand()*palette.length)]));
      return mesh;
    };
    const carBody=instanced(new THREE.BoxGeometry(1,1,1).translate(0,.5,0),solid('#ffffff'),cars.length,['#f4f1ea','#f4f1ea','#c8402e','#2f4f7a','#9aa3ab','#2d2d2d','#e8c33a','#e8c33a']);
    const carCabin=instanced(new THREE.BoxGeometry(.55,1,.86).translate(-.06,.5,0),solid('#34414e'),cars.length);
    // After dark: two headlights, two tail lights and a beam ahead of every car.
    const lit=this.lit,lamps=instanced(new THREE.BoxGeometry(1,1,1),reveal(lit(new THREE.MeshBasicMaterial({color:'#ffffff'})),{instanced:true}),cars.length*4);
    for(let i=0;i<cars.length*4;i++)lamps.setColorAt(i,new THREE.Color(i%4<2?'#fff3c4':'#ff3b2a'));
    const beams=instanced(beamGeometry(),lit(additive({vertexColors:true}),.45),cars.length),lampSpots=[[.3,.09],[.3,-.09],[-.3,.09],[-.3,-.09]];
    // Street lamps along the main roads: a post by day, a bulb and a pool of light by night.
    const posts=[];
    edges.forEach((e,id)=>{
      if(!major(e)||e.closed)return;const pts=lines[id].points,c=len[id];
      for(let d=1.2;d<c.at(-1);d+=3.2){let i=1;while(i<pts.length-1&&c[i]<d)i++;const [x0,z0]=pts[i-1],[x1,z1]=pts[i],seg=(c[i]-c[i-1])||1,f=(d-c[i-1])/seg,side=posts.length%2?1:-1;
        posts.push([x0+(x1-x0)*f-(z1-z0)/seg*.42*side,z0+(z1-z0)*f+(x1-x0)/seg*.42*side]);}
    });
    if(posts.length){
      this.poolMap=poolTexture();
      const pole=instanced(new THREE.CylinderGeometry(.018,.022,.5,5).translate(0,.25,0),solid('#a29d8c'),posts.length),bulb=instanced(new THREE.SphereGeometry(.06,8,6),reveal(lit(new THREE.MeshBasicMaterial({color:'#ffe2a0'})),{instanced:true}),posts.length);
      const pool=instanced(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),lit(additive({map:this.poolMap}),.55),posts.length),m=new THREE.Matrix4(),one=new THREE.Vector3(1,1,1),flat=new THREE.Quaternion();
      posts.forEach(([x,z],i)=>{pole.setMatrixAt(i,m.compose(new THREE.Vector3(x,0,z),flat,one));bulb.setMatrixAt(i,m.compose(new THREE.Vector3(x,.52,z),flat,one));pool.setMatrixAt(i,m.compose(new THREE.Vector3(x,.07,z),flat,new THREE.Vector3(1.8,1,1.8)));});
    }
    const people=crowd.length+walkers.length,clothes=['#e07b2a','#f2efe6','#c23b3b','#d9568f','#3f7a52','#e9c14a','#5a6fa8','#f2efe6'];
    const bodies=instanced(new THREE.CylinderGeometry(.75,1,1,6).translate(0,.5,0),solid('#ffffff'),people,clothes);
    const heads=instanced(new THREE.SphereGeometry(1,6,4),solid('#8a5a3c'),people);
    const m4=new THREE.Matrix4(),q=new THREE.Quaternion(),up=new THREE.Vector3(0,1,0),pos=new THREE.Vector3(),scale=new THREE.Vector3(),base=new THREE.Vector3();
    const at=(lx,ly,lz)=>pos.set(lx,ly,lz).applyQuaternion(q).add(base);
    let time=0;
    const person=(i,x,z,y,k)=>{
      const r=.06*k,h=.21*k;
      bodies.setMatrixAt(i,m4.compose(pos.set(x,y,z),q.identity(),scale.set(r,h,r)));
      heads.setMatrixAt(i,m4.compose(pos.set(x,y+h+r*.85,z),q,scale.setScalar(r*.85)));
    };
    this.life=dt=>{
      // Readable on a short leg framed close up, but never giants on a long one.
      const k=THREE.MathUtils.clamp(this.detail||1,.7,1.1),sec=dt/1000;time+=sec;
      cars.forEach((a,i)=>{
        a.s+=a.speed*k*sec;let L;while(a.s>(L=len[a.id].at(-1))){a.s-=L;turn(a);}
        const [x,z,heading]=where(a,k);q.setFromAxisAngle(up,heading);
        carBody.setMatrixAt(i,m4.compose(pos.set(x,.07,z),q,scale.set(.6*k,.13*k,.28*k)));
        carCabin.setMatrixAt(i,m4.compose(pos.set(x,.07+.13*k,z),q,scale.set(.6*k,.1*k,.28*k)));
        base.set(x,.07,z);
        lampSpots.forEach(([lx,lz],j)=>lamps.setMatrixAt(i*4+j,m4.compose(at(lx*k,.08*k,lz*k),q,scale.set(.025*k,.04*k,.06*k))));
        beams.setMatrixAt(i,m4.compose(at(.3*k,.006,0),q,scale.set(1.8*k,1,.9*k)));
      });
      crowd.forEach((c,i)=>{
        c.a+=c.w*sec;const {x,z}=c.place.group.position,rad=c.r*c.place.group.scale.x;
        person(i,x+Math.cos(c.a)*rad,z+Math.sin(c.a)*rad,Math.abs(Math.sin(time*5+c.phase))*.025*k,k);
      });
      walkers.forEach((a,j)=>{
        a.s+=a.speed*k*sec;let L;while(a.s>(L=len[a.id].at(-1))){a.s-=L;turn(a);}
        const [x,z]=where(a,k);person(crowd.length+j,x,z,Math.abs(Math.sin(time*7+j))*.02*k,k);
      });
      for(const mesh of [carBody,carCabin,bodies,heads,lamps,beams])mesh.instanceMatrix.needsUpdate=true;
    };
    this.lifeMeshes=[carBody,carCabin,bodies,heads,lamps,beams];for(const mesh of this.lifeMeshes)mesh.visible=this.lifeEnabled;
    this.life(0);
  }
  clearModel() {
    this.animation=null;this.view=null;this.life=null;this.lifeMeshes=[];this.scenery=[];this.glow=[];this.nightLights=[];
    this.hoverRing=null;this.shadowMap?.dispose();this.shadowMap=null;this.poolMap?.dispose();this.poolMap=null;
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
  //        pillars, maxCost, method, finished, labels:[{key,text,node|world,cls}]}
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
      if(kind==='unknown'){const u=r/Math.max(1,this.detail||1);pos.set(world[v][0],u*.45,world[v][1]);scale.setScalar(u*.4);}
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
    // Dynamic overlays: explored roads (city graph), final path and the lane being checked.
    this.clearDynamic();
    if(this.model.kind==='pune'&&tree.size){
      const lines=[...tree].filter(id=>!this.model.edges[id].closed).map(id=>this.edgeLines[id]);
      this.addDynamic(ribbon(lines,this.style.road*2.2,.1).geometry,new THREE.MeshBasicMaterial({color:colors.tree}));
    }
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
      const arrowSize=this.model.kind==='pune'?.55:1;   // keeps the city arrowhead in proportion to the cars
      const line=this.edgeLines[view.edge],toEnd=view.edgeTo===this.model.edges[view.edge].b,pts=toEnd?line.points:[...line.points].reverse();
      const strip=ribbon([{points:pts}],this.style.edge,.2);this.addDynamic(strip.geometry,new THREE.MeshBasicMaterial({color:view.updated?colors.current:colors.check}));
      if(step)reveals.push(ribbonReveal(strip.geometry));
      const [x1,z1]=pts.at(-1),[x0,z0]=pts.at(-2),dir=new THREE.Vector3(x1-x0,0,z1-z0).normalize(),len=this.style.edge*3*arrowSize;
      const head=new THREE.ConeGeometry(this.style.edge*1.3*arrowSize,len,12).translate(0,len/2,0),arrow=this.addDynamic(head,new THREE.MeshLambertMaterial({color:view.updated?colors.current:colors.check}));
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir);arrow.position.set(x1-dir.x*(r*2.4+len),.3,z1-dir.z*(r*2.4+len));
      if(step){const end=arrow.position.clone(),start=new THREE.Vector3(pts[0][0],.3,pts[0][1]);reveals.push(t=>{arrow.position.lerpVectors(start,end,t);arrow.scale.setScalar(Math.min(1,t*5));});}
    }
    const place=(obj,v,extra=0)=>{if(v<0){obj.visible=false;return;}obj.visible=true;obj.position.set(world[v][0],(view.status(v)==='unknown'?r*1.7:lift(v))+extra,world[v][1]);};
    const from=this.current.visible?this.current.position.clone():null;
    place(this.current,view.current,.05);place(this.sourceMarker,view.source);place(this.targetMarker,view.target);
    // The car turns its nose toward the junction it is driving to.
    if(from&&view.current>=0){const dx=this.current.position.x-from.x,dz=this.current.position.z-from.z;if(Math.hypot(dx,dz)>1e-3)this.current.rotation.y=Math.atan2(-dz,dx);}
    this.sourceMarker.position.x+=r*1.4;this.targetMarker.position.x-=r*1.4;
    this.ruler.visible=!!view.pillars;
    this.updateLabels(view);this.aimFollow(false);
    for(const v of settledNow)this.pulse(v);
    if(animate){
      const targetRoads=attr.array.slice(),endMarkers=markers.map(o=>o.position.clone());
      const clock=new AnimationClock(rise?1600:800);clock.speed=rise?1:this.animationSpeed||1;
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
        // Markers glide with the tween; the attention car drives between junctions.
        markers.forEach((o,i)=>{if(oldMarkers[i]&&o.visible)o.position.lerpVectors(oldMarkers[i],endMarkers[i],eased);});
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
      else if(l.place){const pl=this.places.find(x=>x.id===l.place);if(!pl)continue;p=pl.group.position.clone().setY(pl.top+.6);}
      else if(l.ruler!=null){p=new THREE.Vector3(this.rulerCorner[0]+5,this.style.pillar*l.ruler,this.rulerCorner[1]);if(!view.pillars)continue;}
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
    this.disposed=true;cancelAnimationFrame(this.raf);clearTimeout(this.lifeTimer);this.intersection.disconnect();this.resizeObserver.disconnect();this.controls.dispose();this.clearModel();
    this.canvas.removeEventListener('webglcontextlost',this.onLost);this.canvas.removeEventListener('webglcontextrestored',this.onRestored);
    for(const map of this.skyMaps)map.dispose();for(const o of [this.sun,this.moon,this.stars])o.material.dispose();this.stars.geometry.dispose();
    this.renderer.dispose();this.renderer.forceContextLoss();this.canvas.remove();this.mini.remove();
  }
}
