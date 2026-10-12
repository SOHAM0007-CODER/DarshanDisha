// Canvas 2D fallback for the 3D Algorithm Lab when WebGL is unavailable. It draws the
// same replay state from above; cost pillars become upright bars. Same interface as Scene3D.
import {colors} from './lab-colors.mjs';

export class FlatScene {
  constructor(host,labelLayer,{onPick}={}) {
    this.host=host;this.onPick=onPick;this.zoomLevel=1;this.offset=[0,0];
    const c=this.canvas=document.createElement('canvas');c.className='lab3d-canvas';c.tabIndex=0;c.setAttribute('role','img');
    c.setAttribute('aria-label','Flat 2D view of the algorithm replay (WebGL unavailable). The text panel describes every step.');
    host.append(c);this.ctx=c.getContext('2d');
    c.addEventListener('click',e=>this.pick(e));
    this.resizeObserver=new ResizeObserver(()=>{this.resize();this.request();});this.resizeObserver.observe(host);this.resize();
  }
  resize(){this.w=this.host.clientWidth||1;this.h=this.host.clientHeight||1;this.dpr=Math.min(devicePixelRatio||1,2);this.canvas.width=Math.round(this.w*this.dpr);this.canvas.height=Math.round(this.h*this.dpr);}
  request(){if(!this.raf&&!this.disposed)this.raf=requestAnimationFrame(()=>{this.raf=0;this.draw();});}
  resetCamera(){this.zoomLevel=1;this.offset=[0,0];this.request();}
  topView(){this.resetCamera();}
  zoom(f){this.zoomLevel=Math.min(6,Math.max(.5,this.zoomLevel/f));this.request();}
  rotate(){}
  pan(dx,dy){this.offset[0]+=dx*3;this.offset[1]+=dy*3;this.request();}
  setModel(model){
    this.model=model;const xs=model.nodes.map(n=>n.x),ys=model.nodes.map(n=>n.y);
    this.bounds=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];this.frame=null;this.resetCamera();
  }
  // Same leg framing as the 3D view: fit the explored region, or the whole graph.
  focus(nodes){
    if(!nodes?.length){this.frame=null;return this.resetCamera();}
    const xs=nodes.map(v=>this.model.nodes[v].x),ys=nodes.map(v=>this.model.nodes[v].y),pad=Math.max(40,(Math.max(...xs)-Math.min(...xs))*.08);
    this.frame=[Math.min(...xs)-pad,Math.min(...ys)-pad,Math.max(...xs)+pad,Math.max(...ys)+pad];this.resetCamera();
  }
  setView(view){this.view=view;this.request();}
  project(x,y){
    const [x0,y0,x1,y1]=this.frame||this.bounds,pad=this.model.kind==='teach'?50:24,top=this.view?.pillars?70:20;
    const s=Math.min((this.w-pad*2)/(x1-x0),(this.h-pad-top)/(y1-y0))*this.zoomLevel;
    return [this.w/2+(x-(x0+x1)/2)*s+this.offset[0],top+(this.h-pad-top)/2+(y-(y0+y1)/2)*s+this.offset[1]];
  }
  draw(){
    const c=this.ctx,view=this.view,model=this.model;if(!model||!view)return;
    c.setTransform(this.dpr,0,0,this.dpr,0,0);c.fillStyle=colors.base;c.fillRect(0,0,this.w,this.h);
    const teach=model.kind==='teach',r=teach?9:2.2,tree=new Set();
    for(let v=0;v<model.nodes.length;v++)if(view.predEdge[v]>=0&&Number.isFinite(view.dist[v]))tree.add(view.predEdge[v]);
    const stroke=(points,color,width,dash=[])=>{c.beginPath();points.forEach((p,i)=>{const [x,y]=this.project(p[0],p[1]);i?c.lineTo(x,y):c.moveTo(x,y);});c.strokeStyle=color;c.lineWidth=width;c.setLineDash(dash);c.stroke();c.setLineDash([]);};
    c.lineCap='round';c.lineJoin='round';
    model.edges.forEach((e,id)=>stroke(e.points,e.closed?colors.closed:tree.has(id)?colors.tree:colors.road,teach?4:1.4,e.closed?[5,4]:[]));
    for(const id of view.pathEdges||[])stroke(model.edges[id].points,colors.path,teach?8:4);
    if(view.edge>=0)stroke(model.edges[view.edge].points,view.updated?colors.current:colors.check,teach?6:3,view.updated?[]:[4,3]);
    const max=view.maxCost||1,bar=teach?70:55;
    model.nodes.forEach((n,v)=>{
      const [x,y]=this.project(n.x,n.y),status=view.status(v),fill=colors[status==='reached'?'tentative':status];c.fillStyle=fill;
      if(view.pillars&&status!=='unknown'){const h=Math.max(2,view.dist[v]/max*bar);c.globalAlpha=.85;c.fillRect(x-(teach?4:1.2),y-h,teach?8:2.4,h);c.globalAlpha=1;}
      c.beginPath();
      if(status==='unknown')c.arc(x,y,r*.7,0,Math.PI*2);else if(status==='settled')c.arc(x,y,r,0,Math.PI*2);else c.rect(x-r,y-r,r*2,r*2);
      c.fill();if(v===view.current){c.lineWidth=2.5;c.strokeStyle=colors.current;c.beginPath();c.arc(x,y,r+5,0,Math.PI*2);c.stroke();}
    });
    c.font='600 11px Segoe UI, sans-serif';c.textAlign='center';
    for(const l of view.labels||[]){
      let p;if(l.node!=null)p=this.project(model.nodes[l.node].x,model.nodes[l.node].y);else if(l.place){const pl=model.places?.find(x=>x.id===l.place);if(pl)p=this.project(pl.x,pl.y);}else if(l.edge!=null){const points=model.edges[l.edge].points,a=points[Math.floor((points.length-1)/2)],b=points[Math.ceil((points.length-1)/2)];p=this.project((a[0]+b[0])/2,(a[1]+b[1])/2);p[1]+=r+16;}
      if(!p)continue;const w=c.measureText(l.text).width+8;c.fillStyle='#fffaf0e6';c.fillRect(p[0]-w/2,p[1]-r-22,w,16);c.fillStyle='#27382f';c.fillText(l.text,p[0],p[1]-r-10);
    }
  }
  pick(e){
    if(!this.model)return;const rect=this.canvas.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;let best=-1,min=18;
    this.model.nodes.forEach((n,v)=>{const p=this.project(n.x,n.y),d=Math.hypot(p[0]-x,p[1]-y);if(d<min){min=d;best=v;}});
    if(best>=0)this.onPick?.(best);
  }
  dispose(){this.disposed=true;cancelAnimationFrame(this.raf);this.resizeObserver.disconnect();this.canvas.remove();}
}
