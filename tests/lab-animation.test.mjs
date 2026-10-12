import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AnimationClock,ribbonReveal,ease,stagger,lerpAngle,polylineSampler} from '../lab-animation.mjs';

test('Animation speed changes preserve progress; pause freezes and resume completes',()=>{
  const clock=new AnimationClock(1000);clock.speed=.1;
  assert.equal(clock.advance(1000),.1);
  clock.paused=true;assert.equal(clock.advance(5000),.1);
  clock.speed=2;assert.equal(clock.progress,.1);
  clock.paused=false;assert.equal(clock.advance(200),.5);
  assert.equal(clock.advance(250),1);assert.equal(clock.advance(500),1);
});

test('Ribbon reveal follows distance continuously across bends and restores complete geometry',()=>{
  // First segment goes right 10 units; second goes down 30 units.
  const original=new Float32Array([0,0,-1,0,0,1,10,0,-1,10,0,1, 9,0,0,11,0,0,9,0,30,11,0,30]);
  const attr={array:original.slice()},reveal=ribbonReveal({getAttribute:()=>attr});
  reveal(0);assert.equal(attr.array[6],0);assert.equal(attr.array[20],0);
  reveal(.125);assert.equal(attr.array[6],5);assert.equal(attr.array[20],0);
  reveal(.5);assert.equal(attr.array[6],10);assert.equal(attr.array[20],10);
  reveal(1);assert.deepEqual(attr.array,original);
  reveal(.25);assert.equal(attr.array[20],0);
});

test('Easing curves start at 0, end at 1, and outBack overshoots before settling',()=>{
  for(const f of Object.values(ease)){assert.ok(Math.abs(f(0))<1e-12);assert.ok(Math.abs(f(1)-1)<1e-12);}
  assert.ok(ease.outBack(.7)>1);assert.equal(ease.inOutCubic(.5),.5);
  assert.equal(stagger(.1,.2,.4),0);assert.equal(stagger(.4,.2,.4),.5);assert.equal(stagger(.9,.2,.4),1);
});

test('Angles interpolate along the shorter arc',()=>{
  const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} vs ${b}`);
  near(lerpAngle(0,Math.PI/2,.5),Math.PI/4);
  near(lerpAngle(3,-3,1),3+(2*Math.PI-6));   // across ±π, not back through 0
  near(lerpAngle(-3,3,.5),-3-(Math.PI-3));
});

test('Polyline sampler walks by arc length, skips duplicate points and wraps',()=>{
  const s=polylineSampler([[0,0],[10,0],[10,0],[10,30]]);
  assert.equal(s.total,40);
  assert.deepEqual(s.at(5),[5,0]);assert.deepEqual(s.at(25),[10,15]);
  assert.deepEqual(s.at(45),[5,0]);assert.deepEqual(s.at(-5),[10,25]);
});
