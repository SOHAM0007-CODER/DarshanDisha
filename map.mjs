const palette={background:'#142e2a',building:'#1c3630',outline:'#244137',road:'#385144',minor:'#2c493d',route:'#f1bb6c',label:'#66846e'};
const line=(ctx,points)=>{if(!points.length)return;ctx.beginPath();ctx.moveTo(...points[0]);for(let i=1;i<points.length;i++)ctx.lineTo(...points[i]);};
export function createBasemap(data) {
  const canvas=document.createElement('canvas');canvas.width=3000;canvas.height=2800;
  const c=canvas.getContext('2d');c.scale(1.5,1.5);c.fillStyle=palette.background;c.fillRect(0,0,2000,1900);
  for(const polygon of data.parks){line(c,polygon);c.fillStyle='#243e31';c.fill();}
  c.lineWidth=.7;c.fillStyle=palette.building;c.strokeStyle=palette.outline;
  for(const polygon of data.buildings){line(c,polygon);c.closePath();c.fill();c.stroke();}
  c.lineJoin='round';c.lineCap='round';
  for(const r of data.roads){const major=['primary','secondary','tertiary'].includes(r.kind);c.strokeStyle=major?'#112721':palette.background;c.lineWidth=major?13:7;line(c,r.points);c.stroke();c.strokeStyle=major?palette.road:palette.minor;c.lineWidth=major?8:3.5;line(c,r.points);c.stroke();}
  return canvas;
}

export class Scene {
  constructor(canvas,data,base,options={}) {
    this.canvas=canvas;this.ctx=canvas.getContext('2d');this.data=data;this.base=base;this.options=options;this.scale=.5;this.tx=0;this.ty=0;this.route=[];this.alt=[];this.traveler=null;this.traceEdges=new Set();this.traceNodes=new Set();this.activeNodes=new Set();this.traceIndex=0;this.events=[];this.color='#f1bb6c';this.crowdEdges=[];this.closed=[];this.showCrowd=false;this.routeFade=0;
    this.labels=this.makeLabels();
    this.resizeObserver=new ResizeObserver(()=>{this.resize();this.fit(false);this.render();});this.resizeObserver.observe(canvas);this.resize();
    if(!options.mini)this.bind();
  }
  resize(){this.w=this.canvas.clientWidth;this.h=this.canvas.clientHeight;this.dpr=Math.min(devicePixelRatio||1,2);this.canvas.width=Math.round(this.w*this.dpr);this.canvas.height=Math.round(this.h*this.dpr);}
  makeLabels(){const seen=new Set(),labels=[];for(const r of this.data.roads){if(!r.name||seen.has(r.name)||r.points.length<3||!['primary','secondary','tertiary','residential'].includes(r.kind))continue;seen.add(r.name);const p=r.points[Math.floor(r.points.length/2)];labels.push({p,name:r.name.replace(/ Road$/,' Rd').replace(/ Path$/,' Path')});}return labels;}
  fit(animate=true) {
    const points=this.route.length?this.route:this.data.places.filter(p=>p.rank||p.id==='shaniwar').map(p=>[p.x,p.y]);
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),pad=this.options.mini?60:140;
    const minX=Math.min(...xs)-pad,maxX=Math.max(...xs)+pad,minY=Math.min(...ys)-pad,maxY=Math.max(...ys)+pad;
    const scale=Math.min(this.w/(maxX-minX),this.h/(maxY-minY),2.5),tx=this.w/2-(minX+maxX)/2*scale,ty=this.h/2-(minY+maxY)/2*scale;
    if(animate&&!matchMedia('(prefers-reduced-motion:reduce)').matches)this.camera={from:[this.scale,this.tx,this.ty],to:[scale,tx,ty],start:performance.now()};else{this.scale=scale;this.tx=tx;this.ty=ty;}
    this.options.onChange?.();
  }
  toScreen(p){return [p[0]*this.scale+this.tx,p[1]*this.scale+this.ty];}
  toWorld(x,y){return [(x-this.tx)/this.scale,(y-this.ty)/this.scale];}
  zoom(factor,x=this.w/2,y=this.h/2){const p=this.toWorld(x,y);this.scale=Math.min(5,Math.max(.18,this.scale*factor));this.tx=x-p[0]*this.scale;this.ty=y-p[1]*this.scale;this.camera=null;this.render();}
  setRoute(route,alt=[],settings={}){this.oldRoute=this.route;this.route=route;this.alt=alt;this.closed=settings.closed||[];this.routeFade=performance.now();this.distances=[0];for(let i=1;i<route.length;i++)this.distances[i]=this.distances[i-1]+Math.hypot(route[i][0]-route[i-1][0],route[i][1]-route[i-1][1]);this.total=this.distances.at(-1)||0;this.render();}
  position(progress){if(!this.route.length)return null;const target=progress*this.total;let i=1;while(i<this.distances.length&&this.distances[i]<target)i++;if(i>=this.route.length)return this.route.at(-1);const t=(target-this.distances[i-1])/(this.distances[i]-this.distances[i-1]||1),a=this.route[i-1],b=this.route[i];return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];}
  setEvents(events,color){this.events=events;this.color=color;this.traceIndex=0;this.traceEdges.clear();this.traceNodes.clear();this.activeNodes.clear();this.traceKey='';this.pendingEdges=[];this.pendingNodes=[];}
  advance(progress){const index=Math.floor(progress*this.events.length);if(index<this.traceIndex){this.traceIndex=0;this.traceEdges.clear();this.traceNodes.clear();this.activeNodes.clear();this.traceKey='';this.pendingEdges=[];this.pendingNodes=[];}while(this.traceIndex<index){const e=this.events[this.traceIndex++];if(e.edge!=null&&!this.traceEdges.has(e.edge)){this.traceEdges.add(e.edge);this.pendingEdges.push(e.edge);}if(e.node!=null){if(!this.traceNodes.has(e.node)){this.traceNodes.add(e.node);this.pendingNodes.push(e.node);}if(e.type==='visit'&&!this.activeNodes.has(e.node)){this.activeNodes.add(e.node);this.pendingNodes.push(e.node);}}}this.traceProgress=progress;}
  cachedBackground(){
    const key=[this.w,this.h,this.scale,this.tx,this.ty].join('|');
    if(key!==this.backgroundKey){
      this.backgroundKey=key;this.backgroundCanvas??=document.createElement('canvas');
      const bg=this.backgroundCanvas;bg.width=this.canvas.width;bg.height=this.canvas.height;
      const c=bg.getContext('2d');c.setTransform(this.dpr,0,0,this.dpr,0,0);c.fillStyle=palette.background;c.fillRect(0,0,this.w,this.h);c.translate(this.tx,this.ty);c.scale(this.scale,this.scale);c.drawImage(this.base,0,0,2000,2800/1.5);
    }
    return this.backgroundCanvas;
  }
  cachedTrace(){
    const key=[this.w,this.h,this.scale,this.tx,this.ty,this.color].join('|');
    this.traceCanvas??=document.createElement('canvas');const layer=this.traceCanvas;
    if(key!==this.traceKey){
      this.traceKey=key;layer.width=this.canvas.width;layer.height=this.canvas.height;
      this.pendingEdges=[...this.traceEdges];this.pendingNodes=[...this.traceNodes];
    }
    const c=layer.getContext('2d'),s=this.scale;c.setTransform(this.dpr*s,0,0,this.dpr*s,this.dpr*this.tx,this.dpr*this.ty);c.lineJoin='round';c.lineCap='round';c.strokeStyle=this.color;c.lineWidth=(this.options.mini?1.4:2)/s;c.globalAlpha=.48;
    for(const id of this.pendingEdges||[]){line(c,this.data.edges[id].points);c.stroke();}
    c.fillStyle=this.color;
    for(const id of this.pendingNodes||[]){const n=this.data.nodes[id];c.globalAlpha=this.activeNodes.has(id)?.75:.35;c.beginPath();c.arc(n.x,n.y,(this.options.mini?1.7:2.7)/s,0,Math.PI*2);c.fill();}
    this.pendingEdges=[];this.pendingNodes=[];return layer;
  }
  needsFrame(now){return !!this.camera||now-this.routeFade<650;}
  drawPath(points,color,width,alpha=1,dashed=false){const c=this.ctx;if(points.length<2)return;c.save();c.globalAlpha=alpha;c.lineJoin='round';c.lineCap='round';c.strokeStyle=color;c.lineWidth=width/this.scale;if(dashed)c.setLineDash([7/this.scale,6/this.scale]);line(c,points);c.stroke();c.restore();}
  render(now=performance.now()) {
    if(!this.w||!this.h)return;
    if(this.camera){const elapsed=Math.min(1,(now-this.camera.start)/500),t=1-(1-elapsed)**3;[this.scale,this.tx,this.ty]=this.camera.from.map((v,i)=>v+(this.camera.to[i]-v)*t);if(elapsed===1)this.camera=null;}
    const c=this.ctx,s=this.scale;c.setTransform(this.dpr,0,0,this.dpr,0,0);c.drawImage(this.cachedBackground(),0,0,this.w,this.h);if(this.lab)c.drawImage(this.cachedTrace(),0,0,this.w,this.h);c.save();c.translate(this.tx,this.ty);c.scale(s,s);
    if(this.showCrowd)for(const e of this.crowdEdges){this.drawPath(this.data.edges[e.id].points,'#ba7251',Math.min(12,e.level*2),.14+e.level*.015);}
    this.drawPath(this.alt,'#81b9b1',2,.65,true);
    const fade=Math.min(1,(now-this.routeFade)/550);
    if(!this.lab||this.traceProgress>=1){if(this.oldRoute?.length&&fade<1)this.drawPath(this.oldRoute,palette.route,4,1-fade);this.drawPath(this.route,'#f1bb6c',this.options.mini?3:9,.1*fade);this.drawPath(this.route,palette.route,this.options.mini?2:3.5,fade);}
    for(const id of this.closed){const e=this.data.edges[id];if(!e)continue;this.drawPath(e.points,'#dc8b73',4,.9,true);const p=e.points[Math.floor(e.points.length/2)];c.strokeStyle='#f1b093';c.lineWidth=2/s;c.beginPath();c.moveTo(p[0]-4/s,p[1]-4/s);c.lineTo(p[0]+4/s,p[1]+4/s);c.moveTo(p[0]+4/s,p[1]-4/s);c.lineTo(p[0]-4/s,p[1]+4/s);c.stroke();}
    c.restore();
    if(!this.options.mini){c.font='9px Segoe UI';c.fillStyle='#6c8975';const boxes=[];for(const label of this.labels){const [x,y]=this.toScreen(label.p);if(x<25||x>this.w-100||y<65||y>this.h-55)continue;const width=c.measureText(label.name).width;if(boxes.some(b=>Math.abs(x-b.x)<(width+b.w)/2+25&&Math.abs(y-b.y)<24))continue;boxes.push({x,y,w:width});c.fillText(label.name,x-width/2,y);}
      const neighborhoods=[['NARAYAN PETH',350,755],['KASBA PETH',1330,450],['BUDHWAR PETH',1200,840],['SHANIWAR PETH',760,650],['SHUKRAWAR PETH',1270,1460]];c.font='8px Segoe UI';c.fillStyle='#4c6a56';for(const [name,x,y] of neighborhoods){const p=this.toScreen([x,y]);if(p[1]>55&&p[1]<this.h-50)c.fillText(name,p[0],p[1]);}}
    this.markerPositions=[];
    for(const p of this.data.places){if(this.options.mini&&!p.rank&&!this.order?.includes(p.id))continue;if(p.type==='start'&&p.id!==this.startId)continue;const [x,y]=this.toScreen([p.x,p.y]);if(x<-30||x>this.w+30||y<-30||y>this.h+30)continue;const selected=this.order?.includes(p.id),rank=p.rank,r=this.options.mini?(rank?7:4):(rank?13:8);
      c.beginPath();c.arc(x,y,r+(selected?5:2),0,Math.PI*2);c.fillStyle=rank?'#ecd19c14':'#d4d9b111';c.fill();c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle=rank?'#e6c58c':selected?'#d1ddb5':'#4a6b50';c.fill();c.lineWidth=1;c.strokeStyle=rank?'#ffe5af':'#8fa582';c.stroke();c.textAlign='center';c.textBaseline='middle';c.font=`${this.options.mini?'8':'11'}px Segoe UI`;c.fillStyle=rank?'#3e3e26':'#e7eacd';c.fillText(rank?String(rank):p.type==='start'?'S':'+',x,y);this.markerPositions.push({p,x,y,r:Math.max(r,12)});
      if(!this.options.mini){const offsets={kasba:[0,-29],tambdi:[-17,-28],guruji:[-19,-28],tulshi:[-27,29],kesari:[-3,-29],dagdu:[45,-18],rangari:[52,-2],babu:[56,0],mandai:[50,0],jilbya:[-35,27],shaniwar:[-10,-23],'mandai-start':[0,-24]};const off=offsets[p.id]||[0,-20];const label=this.options.marathi?p.mr:p.short;c.font=rank?'600 10px Segoe UI':'9px Segoe UI';const width=c.measureText(label).width;c.fillStyle='#142e2ae6';c.fillRect(x+off[0]-width/2-4,y+off[1]-8,width+8,16);c.fillStyle=rank?'#e8d8b2':selected?'#dce4ca':'#a2b693';c.fillText(label,x+off[0],y+off[1]);}}
    c.textAlign='left';c.textBaseline='alphabetic';
    if(this.traveler!=null){const p=this.position(this.traveler);if(p){const [x,y]=this.toScreen(p);c.beginPath();c.arc(x,y,15,0,Math.PI*2);c.fillStyle='#f0ca7040';c.fill();c.beginPath();c.arc(x,y,7,0,Math.PI*2);c.fillStyle='#fff3c4';c.fill();c.lineWidth=2;c.strokeStyle='#d09243';c.stroke();}}
    if(this.options.onScale)this.options.onScale(100*s);
  }
  bind(){let down=null,moved=false;
    this.canvas.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY,tx:this.tx,ty:this.ty};moved=false;this.camera=null;this.canvas.setPointerCapture(e.pointerId);});
    this.canvas.addEventListener('pointermove',e=>{const r=this.canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;if(down){const dx=e.clientX-down.x,dy=e.clientY-down.y;if(Math.hypot(dx,dy)>4)moved=true;this.tx=down.tx+dx;this.ty=down.ty+dy;this.render();this.options.onHover?.(null,x,y);return;}const marker=this.markerPositions.find(m=>Math.hypot(m.x-x,m.y-y)<m.r+4);this.options.onHover?.(marker?.p||null,x,y);});
    this.canvas.addEventListener('pointerup',e=>{if(!moved){const r=this.canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;const marker=this.markerPositions.find(m=>Math.hypot(m.x-x,m.y-y)<m.r+4);if(this.pickingStart){const world=this.toWorld(x,y);let nearest=0,distance=Infinity;this.data.nodes.forEach((n,i)=>{const d=Math.hypot(n.x-world[0],n.y-world[1]);if(d<distance){distance=d;nearest=i;}});if(distance<=100)this.options.onStart?.(nearest);else this.options.onMiss?.();}else if(this.closing){const world=this.toWorld(x,y);let closest=null,min=14/this.scale;for(const edge of this.data.edges){for(let i=1;i<edge.points.length;i++){const a=edge.points[i-1],b=edge.points[i],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((world[0]-a[0])*dx+(world[1]-a[1])*dy)/(dx*dx+dy*dy||1))),d=Math.hypot(world[0]-a[0]-t*dx,world[1]-a[1]-t*dy);if(d<min){min=d;closest=edge;}}}if(closest)this.options.onLane?.(this.data.edges.indexOf(closest));else this.options.onMiss?.();}else if(marker)this.options.onPlace?.(marker.p); }down=null;});
    this.canvas.addEventListener('pointercancel',()=>down=null);
    this.canvas.addEventListener('pointerleave',()=>this.options.onHover?.(null));
    this.canvas.addEventListener('wheel',e=>{e.preventDefault();const r=this.canvas.getBoundingClientRect();this.zoom(Math.exp(-e.deltaY*.001),e.clientX-r.left,e.clientY-r.top);},{passive:false});
  }
  destroy(){this.resizeObserver.disconnect();}
}
