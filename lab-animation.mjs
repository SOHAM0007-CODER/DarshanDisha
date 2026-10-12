// Time is accumulated at the current rate, so changing speed never jumps a tween.
export class AnimationClock {
  constructor(duration=800){this.duration=duration;this.elapsed=0;this.speed=1;this.paused=false;}
  get progress(){return Math.min(1,this.elapsed/this.duration);}
  advance(ms){if(!this.paused)this.elapsed=Math.min(this.duration,this.elapsed+Math.max(0,ms)*this.speed);return this.progress;}
}

// Reveal a ribbon continuously by distance, including partial segments. Four
// vertices per segment: start-left, start-right, end-left, end-right.
export function ribbonReveal(geometry) {
  const attr=geometry.getAttribute('position'),original=attr.array.slice(),segments=[];
  let total=0;
  for(let o=0;o<original.length;o+=12){
    const length=Math.hypot(original[o+6]-original[o],original[o+8]-original[o+2]);
    segments.push({o,start:total,length});total+=length;
  }
  return progress=>{
    const distance=Math.max(0,Math.min(1,progress))*total;
    for(const {o,start,length} of segments){
      const t=length?Math.max(0,Math.min(1,(distance-start)/length)):1;
      for(let k=0;k<6;k++)attr.array[o+6+k]=original[o+k]+(original[o+6+k]-original[o+k])*t;
    }
    attr.needsUpdate=true;
  };
}

// Easing curves. outBack overshoots slightly before settling, for "pop" moments.
export const ease={
  smooth:t=>t*t*(3-2*t),
  inOutCubic:t=>t<.5?4*t*t*t:1-(-2*t+2)**3/2,
  outBack:(t,s=1.70158)=>1+(s+1)*(t-1)**3+s*(t-1)**2
};
// Local 0..1 progress of an item that starts at `delay` and lasts `span` (fractions of the whole tween).
export const stagger=(t,delay,span)=>Math.max(0,Math.min(1,(t-delay)/span));
// Interpolate angles along the shorter arc, so a camera glide never spins the long way round.
export function lerpAngle(a,b,t){const d=((b-a)%(2*Math.PI)+3*Math.PI)%(2*Math.PI)-Math.PI;return a+d*t;}
// Arc-length sampler for a 2D polyline [[x,z],...]; positions wrap around the total length.
export function polylineSampler(points){
  const pts=[];for(const p of points){const q=pts.at(-1);if(!q||q[0]!==p[0]||q[1]!==p[1])pts.push(p);}
  const cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
  const total=cum.at(-1);
  return {total,at(s){
    if(!total)return pts[0]||[0,0];
    s=(s%total+total)%total;let i=1;while(i<cum.length-1&&cum[i]<s)i++;
    const t=(s-cum[i-1])/((cum[i]-cum[i-1])||1),a=pts[i-1],b=pts[i];return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
  }};
}
