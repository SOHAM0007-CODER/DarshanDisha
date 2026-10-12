// 3D Algorithm Lab controller: graph / algorithm / leg selection, replay, and the
// text explanation. Loaded lazily by app.mjs. The renderer (Three.js or the flat
// fallback) is loaded only when the lab opens.
import {makeGraph,names} from './engine.mjs';
import {TracePlayer,describe,explainSimply,pseudocode} from './trace-player.mjs';
import {teachingData,teachingScenarios,teachingDefaults,teachingGraph} from './teaching-graph.mjs';

const $=id=>document.getElementById(id);
const speeds={teach:[.5,1,2,4],pune:[10,30,120,480,2000]};
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const count=n=>Math.round(n).toLocaleString('en-IN');

export function webglAvailable() {
  if(/[?&]flat3d\b/.test(location.search))return false;
  try{const c=document.createElement('canvas');return !!(c.getContext('webgl2')||c.getContext('webgl'));}catch{return false;}
}

export class Lab3D {
  // app: {data, label(place), placeName(id), onMethod(method)}
  constructor(app) {
    this.app=app;this.kind='pune';this.method='astar';this.leg=0;this.playing=false;this.inspect=null;this.cursor=0;
    this.teachSettings={...teachingDefaults};this.teach=null;this.job=0;this.renderer=null;
    this.speedIndex={teach:1,pune:1};this.bind();
    this.teachingSpeed=1;
  }
  bind() {
    $('lab3dLearn').onclick=()=>{
      this.pause();this.method='dijkstra';this.kind='teach';this.teachSettings={...teachingDefaults};this.inspect=null;
      $('pillarToggle').checked=false;$('lab3d').classList.remove('panel-collapsed');
      document.querySelector('.lab3d-reading').open=true;
      $('lab3dPanelToggle').setAttribute('aria-expanded','true');$('lab3dPanelToggle').textContent='Hide explanation';
      this.app.onMethod?.(this.method);this.load(true);
    };
    document.querySelectorAll('[data-chapter]').forEach(b=>b.onclick=()=>{
      if(!this.player)return;this.pause();
      const events=this.player.events,find=types=>Math.max(0,events.findIndex(e=>types.includes(e.type))+1);
      const steps=[0,find(['visit','pass']),find(['relax']),this.player.length];
      document.querySelector('.lab3d-reading').open=Number(b.dataset.chapter)===0;
      this.go(steps[Number(b.dataset.chapter)]);
      $('lab3dPanel').scrollTop=0;
    });
    $('lab3dFullscreen').onclick=()=>this.toggleFullscreen();
    $('lab3dPanelToggle').onclick=()=>{
      const collapsed=$('lab3d').classList.toggle('panel-collapsed');
      $('lab3dPanelToggle').setAttribute('aria-expanded',String(!collapsed));
      $('lab3dPanelToggle').textContent=collapsed?'Show explanation':'Hide explanation';
    };
    document.addEventListener('fullscreenchange',()=>{
      if(!document.fullscreenElement&&this.nativeFullscreen){this.nativeFullscreen=false;this.setImmersive(false);}
    });
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&this.immersive&&!document.fullscreenElement)this.setImmersive(false);});
    document.querySelectorAll('[data-graph]').forEach(b=>b.onclick=()=>this.setKind(b.dataset.graph));
    document.querySelectorAll('[data-algo3d]').forEach(b=>b.onclick=()=>{this.setMethod(b.dataset.algo3d);this.app.onMethod?.(this.method);});
    $('legSelect').onchange=e=>{this.leg=Number(e.target.value);this.load();};
    const letters=teachingData.nodes.map((n,i)=>`<option value="${i}">${n.label}</option>`).join('');
    $('teachSource').innerHTML=letters;$('teachTarget').innerHTML=letters;
    $('teachScenario').innerHTML=Object.entries(teachingScenarios).map(([id,s])=>`<option value="${id}">${s.label}</option>`).join('');
    $('teachSource').onchange=e=>{this.teachSettings.source=Number(e.target.value);this.runTeaching();};
    $('teachTarget').onchange=e=>{this.teachSettings.target=Number(e.target.value);this.runTeaching();};
    $('teachScenario').onchange=e=>{this.teachSettings.scenario=e.target.value;this.runTeaching();};
    $('pillarToggle').onchange=()=>this.render();
    $('lab3dPlay').onclick=()=>this.toggle();
    $('lab3dPrev').onclick=()=>this.go(this.player?this.player.step-1:0);
    $('lab3dNext').onclick=()=>this.go(this.player?this.player.step+1:0);
    $('lab3dReset').onclick=()=>this.go(0);
    $('lab3dSlider').oninput=e=>this.go(Number(e.target.value));
    $('lab3dSpeed').onchange=e=>{this.speedIndex[this.kind]=Number(e.target.value);};
    $('lab3dTeachingSpeed').oninput=e=>{
      this.teachingSpeed=Number(e.target.value);$('lab3dSpeedValue').value=`${this.teachingSpeed}×`;
      e.target.setAttribute('aria-valuetext',`${this.teachingSpeed} times normal speed`);
      this.renderer?.setAnimationSpeed?.(this.teachingSpeed);if(this.player)this.renderFacts();
    };
    $('inspectSelect').onchange=e=>{this.inspect=e.target.value===''?null:Number(e.target.value);this.render();};
    document.querySelectorAll('[data-camera]').forEach(b=>b.onclick=()=>{const r=this.renderer;if(!r)return;({reset:()=>r.resetCamera(),top:()=>r.topView(),left:()=>r.rotate(-15),right:()=>r.rotate(15),in:()=>r.zoom(1/1.25),out:()=>r.zoom(1.25)})[b.dataset.camera]();});
    this.keys=e=>{
      if(!this.open||e.ctrlKey||e.metaKey||e.altKey||!$('lab3d').contains(e.target)||/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))return;
      const k=e.key.toLowerCase();
      if(k==='[')this.go(this.player.step-1);else if(k===']')this.go(this.player.step+1);else if(k==='p')this.toggle();else return;
      e.preventDefault();
    };
    document.addEventListener('keydown',this.keys);
  }
  async show(result,method) {
    this.open=true;this.result=result;if(method)this.method=method;$('lab3d').hidden=false;
    if(!this.renderer)await this.createRenderer();
    this.load(true);
  }
  setImmersive(active) {
    this.immersive=active;
    $('lab3d').classList.toggle('immersive',active);
    document.body.classList.toggle('lab-immersive',active);
    $('lab3dFullscreen').textContent=active?'↙ Exit fullscreen':'⛶ Fullscreen';
    $('lab3dFullscreen').setAttribute('aria-pressed',String(active));
    if(!active)$('lab3dFullscreen').focus({preventScroll:true});
  }
  async toggleFullscreen() {
    if(this.immersive){
      if(document.fullscreenElement===$('lab3d'))await document.exitFullscreen();
      this.setImmersive(false);return;
    }
    this.setImmersive(true);
    try{if($('lab3d').requestFullscreen){await $('lab3d').requestFullscreen();this.nativeFullscreen=true;}}
    catch{/* The viewport-filling layout also works where native fullscreen is denied. */}
  }
  hide() {
    if(document.fullscreenElement===$('lab3d'))document.exitFullscreen().catch(()=>{});
    this.setImmersive(false);
    this.open=false;this.pause();$('lab3d').hidden=true;
    // Free GPU resources while the 2D view is in use; recreated on the next open.
    this.renderer?.dispose();this.renderer=null;this.modelKey=null;$('lab3dLabels').replaceChildren();
  }
  async createRenderer() {
    const stage=$('lab3dStage'),labels=$('lab3dLabels'),options={onPick:v=>{this.inspect=v;this.render();},onStatus:s=>this.status(s),reducedMotion:reduced()};
    if(webglAvailable()) {
      try{const {Scene3D}=await import('./scene3d.mjs');this.renderer=new Scene3D(stage,labels,options);this.flat=false;this.status(null);return;}
      catch(e){console.warn('3D renderer unavailable; using the flat view.',e);}
    }
    const {FlatScene}=await import('./lab-flat.mjs');this.renderer=new FlatScene(stage,labels,options);this.flat=true;
    this.status('flat');
  }
  status(kind) {
    const el=$('lab3dStatus');
    const text={flat:'WebGL is not available in this browser, so a flat 2D view shows the same replay. Bars stand in for cost pillars.',lost:'The 3D graphics context was lost. The text replay still works; the model will return when the browser restores graphics.',restored:null}[kind]??null;
    el.hidden=!text;el.textContent=text||'';document.querySelector('.lab3d-camera').classList.toggle('flat',!!this.flat);
  }
  // Labels follow the app's English / Marathi toggle; keep the current step.
  relabel(){if(!this.open||!this.player)return;const step=this.player.step;this.load();this.go(step);}
  setResult(result){this.result=result;if(this.open&&this.kind==='pune')this.load(true);}
  setMethod(method){if(method===this.method&&this.player)return this.syncButtons();this.method=method;if(this.open)this.load();}
  setKind(kind){if(kind===this.kind)return;this.kind=kind;this.inspect=null;this.load(true);}
  syncButtons() {
    document.querySelectorAll('[data-graph]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.graph===this.kind)));
    document.querySelectorAll('[data-algo3d]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.algo3d===this.method)));
    $('legField').hidden=this.kind!=='pune';for(const id of ['teachSourceField','teachTargetField','teachScenarioField'])$(id).hidden=this.kind!=='teach';
    $('lab3dAttribution').hidden=this.kind!=='pune';
    $('lab3dPuneSpeed').hidden=this.kind==='teach';$('lab3dTeachingSpeedControl').hidden=this.kind!=='teach';
    $('lab3dSpeed').innerHTML=speeds[this.kind].map((v,i)=>`<option value="${i}">${v} step${v===1?'':'s'}/s</option>`).join('');$('lab3dSpeed').value=this.speedIndex[this.kind];
  }
  runTeaching() {
    // Teaching runs go through the same engine in a worker, like journey routing.
    this.worker??=new Worker('./worker.mjs',{type:'module'});
    const id=++this.job;this.teach=null;this.player=null;this.render();
    return new Promise(resolve=>{
      this.worker.onmessage=({data:m})=>{if(m.id!==this.job)return;if(m.error){$('lab3dEventText').textContent='Could not run the teaching example: '+m.error;return resolve();}this.teach=m.result;this.load();resolve();};
      this.worker.postMessage({id,kind:'teaching',settings:{...this.teachSettings}});
    });
  }
  // (Re)build the graph model and the player for the chosen graph / algorithm / leg.
  load(resetLeg=false) {
    this.pause();this.syncButtons();
    if(this.kind==='teach') {
      $('teachSource').value=this.teachSettings.source;$('teachTarget').value=this.teachSettings.target;$('teachScenario').value=this.teachSettings.scenario;
      const key='teach|'+this.teachSettings.scenario;
      if(!this.teach||this.teach.settings.scenario!==this.teachSettings.scenario||this.teach.settings.source!==this.teachSettings.source||this.teach.settings.target!==this.teachSettings.target){this.runTeaching();return;}
      if(key!==this.modelKey){this.graph=teachingGraph(this.teachSettings);this.renderer.setModel({kind:'teach',nodes:teachingData.nodes,edges:this.graph.edges});this.modelKey=key;}
      this.run=this.teach.runs[this.method];
    } else {
      const r=this.result;if(!r)return;
      const key='pune|'+JSON.stringify(r.settings.closed)+'|'+r.settings.objective+'|'+r.settings.crowd+'|'+r.settings.start;
      if(key!==this.modelKey){
        const data=this.app.data;this.graph=makeGraph(data,r.settings);
        this.renderer.setModel({kind:'pune',nodes:data.nodes,edges:this.graph.edges,buildings:data.buildings,parks:data.parks,places:data.places.filter(p=>p.rank||r.order.includes(p.id))});this.modelKey=key;
      }
      const legs=r.comparisons[this.method].legs;if(resetLeg||this.leg>=legs.length)this.leg=0;
      $('legSelect').innerHTML=legs.map((l,i)=>`<option value="${i}">Leg ${i+1} of ${legs.length}: ${this.app.placeName(r.order[i])} → ${this.app.placeName(r.order[i+1])}${l.reachable?'':' (no route)'}</option>`).join('')||'<option>No leg: already at the destination</option>';
      $('legSelect').value=this.leg;$('legSelect').disabled=legs.length<2;
      this.run=legs[this.leg]||null;
    }
    // Each leg is an independent search: a fresh player starts again from g(s) = 0.
    this.player=this.run?new TracePlayer(this.graph,this.run):null;
    this.inspect=this.inspect!=null&&this.inspect<this.graph.nodes.length?this.inspect:null;
    // Frame the region Dijkstra explores on this leg, so all three algorithms share a view.
    if(this.player){const ref=this.kind==='pune'?this.result.comparisons.dijkstra.legs[this.leg]:null,nodes=new Set([this.player.source,this.player.target]);if(ref)for(const e of ref.trace)if(e.node!=null)nodes.add(e.node);const key=this.modelKey+'|'+this.leg;if(key!==this.focusKey){this.focusKey=key;this.renderer.focus?.(ref?[...nodes]:null);}}
    $('lab3dSlider').max=this.player?.length||0;this.go(0);this.inspectOptions();
  }
  name(v) {
    if(v==null||v<0)return '—';
    if(this.kind==='teach')return teachingData.nodes[v].label;
    const p=this.app.data.places.find(p=>p.node===v&&(p.rank||this.result.order.includes(p.id)))||this.app.data.places.find(p=>p.node===v);
    return p?this.app.label(p):`junction ${v}`;
  }
  unit(){return this.graph?.objective==='time'?'s':'m';}
  cost(x) {
    if(!Number.isFinite(x))return '∞';
    const digits=this.kind==='teach'?0:1;
    return `${x.toLocaleString('en-IN',{minimumFractionDigits:digits,maximumFractionDigits:digits})} ${this.unit()}`;
  }
  inspectOptions() {
    const sel=$('inspectSelect'),opts=[['','Current node']];
    if(this.player){
      if(this.kind==='teach')teachingData.nodes.forEach((n,i)=>opts.push([i,n.label]));
      else{
        const seen=new Set();const push=v=>{if(!seen.has(v)){seen.add(v);opts.push([v,this.name(v)+(v===this.player.source?' (source)':v===this.player.target?' (destination)':'')]);}};
        push(this.player.source);push(this.player.target);for(const p of this.app.data.places)if(p.rank||this.result.order.includes(p.id))push(p.node);
        if(this.inspect!=null)push(this.inspect);
      }
    }
    sel.innerHTML=opts.map(([v,t])=>`<option value="${v}">${t}</option>`).join('');sel.value=this.inspect??'';
  }
  go(step) {
    this.pause();
    if(!this.player){this.render();return;}
    const old=this.player.step;this.player.seek(step);this.cursor=this.player.step;this.render(this.player.step>old);
  }
  rate(){return this.kind==='teach'?this.teachingSpeed:speeds.pune[this.speedIndex.pune];}
  toggle() {
    if(!this.player)return;
    if(this.playing)return this.pause();
    if(this.player.step>=this.player.length)this.go(0);
    this.playing=true;this.last=performance.now();this.carry=0;this.setPlayIcon();$('lab3dExplain').setAttribute('aria-live','off');
    this.renderer?.setAnimationPaused?.(false);
    if(this.kind==='teach'&&!this.renderer?.animation){this.player.seek(this.player.step+1);this.render(true);}
    const tick=now=>{
      if(!this.playing)return;
      const rate=this.rate();this.carry+=Math.min(.1,(now-this.last)/1000)*rate;this.last=now;
      const steps=Math.floor(this.carry);
      if(steps&&this.player.step<this.player.length){this.carry-=steps;this.player.seek(this.player.step+steps);this.render(true);}
      if(this.player.step>=this.player.length&&!this.renderer?.animation)return this.pause();
      this.raf=requestAnimationFrame(tick);
    };
    this.raf=requestAnimationFrame(tick);
  }
  pause(){this.playing=false;cancelAnimationFrame(this.raf);this.renderer?.setAnimationPaused?.(true);this.setPlayIcon();$('lab3dExplain').setAttribute('aria-live','polite');}
  setPlayIcon(){$('lab3dPlay').innerHTML=`<svg aria-hidden="true"><use href="#${this.playing?'pause':'play'}"/></svg>`;$('lab3dPlay').setAttribute('aria-label',this.playing?'Pause replay':'Play replay');}

  render(animate=false) {
    const p=this.player,what=$('lab3dWhat');
    $('lab3dCode').innerHTML=pseudocode[this.method].map(l=>`<li>${l.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</li>`).join('');
    if(!p) {
      what.textContent=names[this.method];$('lab3dStep').textContent='';$('lab3dCalc').hidden=true;$('lab3dQueue').innerHTML='';$('inspectDetails').innerHTML='';
      $('lab3dEventTitle').textContent=this.kind==='teach'?'Running the teaching example…':this.result?.order?.length===1?'No search for this journey':'Choose a journey first';
      $('lab3dEventText').textContent=this.kind==='teach'?'':'Your start is already the destination, so there is no leg to search. Open the teaching example, or choose a different destination. The engine handles identical source and target with a zero-cost path.';
      $('lab3dFacts').innerHTML='';return;
    }
    const s=p.state,d=describe(p,v=>this.name(v),x=>this.cost(x)),simple=explainSimply(p,v=>this.name(v),x=>this.cost(x));
    $('lab3dChapters').hidden=this.kind!=='teach';
    $('lab3dStrategy').textContent={dijkstra:'Dijkstra: always explore the waiting junction with the lowest cost from the start.',bellman:'Bellman–Ford: check all roads repeatedly, keeping cheaper connections until a whole round changes nothing.',astar:'A*: explore using cost so far + an estimate of the cost still to go. The dashed line shows the straight-line estimate, not a walkable road.'}[this.method];
    $('lab3dMeaning').textContent=this.kind==='teach'?'Letters name junctions. Road labels show the cost of that road in metres. Node labels show the best total from the start; “?” means no route is known yet.':'This is the real Pune street graph. Buildings give location context; the search happens on the junctions and roads. Try the guided example to learn the same rules on a smaller map.';
    const legText=this.kind==='pune'?` · Leg ${this.leg+1} of ${this.result.comparisons[this.method].legs.length}: ${this.name(p.source)} → ${this.name(p.target)}`:` · Teaching example: ${this.name(p.source)} → ${this.name(p.target)}`;
    what.textContent=names[this.method]+legText;
    $('lab3dStep').textContent=`Step ${count(s.step)} of ${count(p.length)}`+(this.method==='bellman'&&s.pass?` · pass ${s.pass}`:'');
    $('lab3dSlider').value=s.step;$('lab3dSlider').setAttribute('aria-valuetext',`Step ${s.step} of ${p.length}: ${d.title}`);
    $('lab3dEventTitle').textContent=simple.title;$('lab3dEventText').textContent=simple.text;
    const calc=$('lab3dCalc');calc.hidden=!d.calc;
    if(d.calc){const c=d.calc;calc.tBodies[0].innerHTML=[
      [`Cost to ${this.name(c.from)}`,Number.isFinite(c.gu)?this.cost(c.gu):'Not reached'],[`This road adds`,this.cost(c.w)],
      ['New total',Number.isFinite(c.candidate)?this.cost(c.candidate):'No known route'],[`Previous total`,Number.isFinite(c.old)?this.cost(c.old):'No known route'],
      ['Decision',c.updated?'✓ Keep the new connection':'Keep the existing connection']].map(([k,v],i)=>`<tr${i===4?` class="${c.updated?'yes':'no'}"`:''}><th scope="row">${k}</th><td>${v}</td></tr>`).join('');}
    [...$('lab3dCode').children].forEach((li,i)=>{if(i===d.line)li.setAttribute('aria-current','step');});
    this.renderInspector();this.renderQueue();this.renderFacts();
    // Scene state.
    const pillars=$('pillarToggle').checked,path=s.finished?p.path():null,labels=[];
    if(this.kind==='teach'){
      for(let v=0;v<p.n;v++)labels.push({key:'n'+v,node:v,text:`${teachingData.nodes[v].label}${v===p.source?' · START':v===p.target?' · GOAL':''} · ${Number.isFinite(s.dist[v])?Math.round(s.dist[v])+' m total':'?'}`,cls:v===p.source?'src':v===p.target?'dst':''});
      this.graph.edges.forEach((e,id)=>{if(id!==s.edge)labels.push({key:'w'+id,edge:id,text:e.closed?'Closed':this.cost(e.weight),cls:'weight'});});
    }
    else{
      for(const pl of this.app.data.places)if((pl.rank||this.result.order.includes(pl.id))&&pl.node!==p.source&&pl.node!==p.target)labels.push({key:'p'+pl.id,place:pl.id,text:this.app.label(pl),cls:'place'});
      labels.push({key:'src',node:p.source,text:'Source · '+this.name(p.source),cls:'src',lift:4});
      if(p.target!==p.source)labels.push({key:'dst',node:p.target,text:'Destination · '+this.name(p.target),cls:'dst',lift:4});
    }
    if(s.edge>=0&&this.kind==='teach')labels.push({key:'edge',edge:s.edge,text:`Road: ${this.cost(this.graph.edges[s.edge].weight)} ${s.last.updated?'✓':'✕'}`,cls:s.last.updated?'yes':'no'});
    if(this.method==='astar'&&s.current>=0&&!s.finished)labels.push({key:'h',hline:true,text:`h(${this.name(s.current)}) = ${this.cost(p.h(s.current))}`,cls:'h'});
    if(pillars)for(let i=1;i<=4;i++)labels.push({key:'r'+i,ruler:i/4,text:this.cost(p.maxCost*i/4),cls:'ruler'});
    if(this.inspect!=null&&this.inspect!==p.source&&this.inspect!==p.target&&this.kind==='pune')labels.push({key:'inspect',node:this.inspect,text:'Inspecting · '+this.name(this.inspect),cls:'inspect'});
    $('lab3dScale').innerHTML=pillars?`<strong>Taller = more cost from the start.</strong> Full height = ${this.cost(p.maxCost)}. A shorter pillar means a cheaper known route, not a shorter building.`:`<strong>${s.finished?'The thick orange line is your route.':'The orange ring is the search’s attention.'}</strong> ${this.kind==='teach'?'Road number = one road’s cost. Node number = total from start.':'Colored branches are options being explored, not a person walking.'}`;
    this.renderer?.setAnimationSpeed?.(this.teachingSpeed);
    this.renderer?.setView({animate,dist:s.dist,predEdge:s.predEdge,status:v=>p.status(v),current:s.current,edge:s.edge,edgeTo:s.edgeTo,updated:!!s.last.updated,source:p.source,target:p.target,
      pathEdges:path?.edges||[],pillars,maxCost:p.maxCost,method:this.method,finished:s.finished,labels});
  }
  renderInspector() {
    const p=this.player,v=this.inspect??(p.state.current>=0?p.state.current:p.source),i=p.inspect(v),astar=this.method==='astar';
    const status={unknown:'Undiscovered: g = ∞',tentative:'Tentative: g may still decrease',settled:'Settled: g is final',reached:'Reached: g may still decrease in a later pass',final:'Final: a full pass changed nothing'}[i.status];
    const pred=i.pred>=0?`${this.name(i.pred)} (lane ${this.cost(this.graph.edges[i.predEdge].weight)})`:v===p.source?'none (source)':'none yet';
    const rows=[['Node',this.name(v)+(this.inspect==null?' (current)':'')],['Status',status],['Known cost g',this.cost(i.g)]];
    if(astar)rows.push(['Heuristic h',this.cost(i.h)+' (straight line'+(this.unit()==='s'?' ÷ 1.25 m/s':'')+')'],['f = g + h',Number.isFinite(i.g)?`${this.cost(i.g)} + ${this.cost(i.h)} = ${this.cost(i.f)}`:'∞']);
    rows.push(['Predecessor',pred]);
    $('inspectDetails').innerHTML=rows.map(([k,x])=>`<dt>${k}</dt><dd>${x}</dd>`).join('');
  }
  renderQueue() {
    const p=this.player,el=$('lab3dQueue');
    if(this.method==='bellman'){el.innerHTML=`<h5>No priority queue</h5><p>Bellman–Ford checks every open directed lane in each pass, in a fixed order. ${p.state.converged?'The last pass changed nothing, so every g is final.':`Pass ${p.state.pass||1} of at most V − 1 = ${count(p.n-1)}.`}</p>`;return;}
    const f=p.frontier(5),key=this.method==='astar'?'f = g + h':'g',heap=p.heapEntries(),stale=Math.max(0,p.state.heapSize-f.total);
    const rows=f.items.map(x=>`<li><span>${this.name(x.node)}</span><span>${this.cost(x.priority)}</span></li>`).join('')||'<li><span>None</span><span></span></li>';
    let heapText=`Binary heap: ${count(p.state.heapSize)} entr${p.state.heapSize===1?'y':'ies'}, of which ${count(stale)} ${stale===1?'is':'are'} outdated (stale) and will be skipped when popped.`;
    if(heap)heapText+=`</p><ol class="heap-list">${heap.slice(0,8).map(x=>`<li class="${x.stale?'stale':''}">${this.name(x.node)} · key ${this.cost(x.priority)}${x.stale?' · stale':''}</li>`).join('')}</ol><p class="note">`;
    el.innerHTML=`<h5>Tentative priorities (${key}) · ${count(f.total)} live</h5><ol class="frontier">${rows}</ol><p class="note">${heapText}</p>`;
  }
  renderFacts() {
    const r=this.run,m=r.metrics,p=this.player,rate=this.rate();
    const grouped=r.detail==='compact'?r.trace.reduce((s,e)=>s+(e.skipped||0),0):0;
    const facts=[[count(m.checks),'edge checks'],[count(m.updates),'distance updates'],[count(m.expanded),this.method==='bellman'?'nodes reached':'nodes selected'],...(this.method==='bellman'?[[m.passes,'passes']]:[[count(m.stale||0),'stale heap entries']]),[m.ms.toFixed(2)+' ms','measured compute time']];
    const note=r.detail==='full'?'Full trace: every edge check, update and stale heap entry is its own step.':`Compact trace for the full Pune graph: each step is a selection, an update or a pass boundary. ${count(grouped)} unsuccessful edge checks are grouped and reported in the step that follows them.`;
    $('lab3dFacts').innerHTML=`<div class="fact-row">${facts.map(([v,k])=>`<div><strong>${v}</strong><span>${k}</span></div>`).join('')}</div><p>${note} Replay runs at ${rate} recorded step${rate===1?'':'s'} per second (${count(p.length)} steps ≈ ${Math.ceil(p.length/rate)} s). Playback length depends on how many events were recorded and on this speed; it does not measure algorithm runtime. ${this.kind==='pune'?`Same graph and ${this.graph.objective==='time'?'crowd-aware walking-time':'distance'} weights as your journey; each leg is an independent search.`:'Teaching example only: an illustrative graph, not Pune streets.'}</p>`;
  }
}
