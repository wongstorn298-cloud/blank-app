"""Isometric 3D office where the AI agents visibly work (Three.js, rendered in the browser)."""

from __future__ import annotations

import json

from .agents import STATUS

OFFICE_HTML = r"""<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Office</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600&family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..24,500,1,0&display=swap">
<style>
  :root { --pink:#c2185b; --glass:rgba(255,255,255,.92); --ink:#2e2a3f; }
  html, body { margin:0; height:100%; overflow:hidden;
    font-family: "IBM Plex Sans Thai", system-ui, sans-serif; color:var(--ink); }
  .ms { font-family:"Material Symbols Rounded"; font-size:18px; line-height:1; vertical-align:-4px; font-weight:normal; }
  body { background: radial-gradient(120% 90% at 50% 0%, #fff4ec 0%, #fde6e4 45%, #e7e3fb 100%); transition: background .8s; }
  body.night { background: radial-gradient(120% 90% at 50% 0%, #2a2f5c 0%, #171b3a 55%, #0d1026 100%); }
  #c { position:absolute; inset:0; display:block; width:100%; height:100%; }
  .label { position:absolute; transform:translate(-50%,-100%); pointer-events:none; white-space:nowrap;
    background:var(--glass); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    border-radius:999px; padding:4px 10px 4px 8px; font-size:12px; color:var(--ink);
    box-shadow:0 4px 14px rgba(60,40,90,.15); border:1px solid rgba(255,255,255,.8); }
  .label::after { content:""; position:absolute; left:50%; bottom:-5px; transform:translateX(-50%);
    border:5px solid transparent; border-top-color:var(--glass); border-bottom:0; }
  .label b { font-weight:650; } .label .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:5px;
    box-shadow:0 0 0 3px color-mix(in srgb, var(--c) 25%, transparent); background:var(--c); }
  .label .task { display:block; font-size:10.5px; opacity:.65; max-width:180px; overflow:hidden; text-overflow:ellipsis; padding-left:13px; }
  #ui { position:absolute; left:0; right:0; bottom:14px; display:flex; flex-direction:column; align-items:center; gap:10px; }
  .btns { display:flex; gap:8px; flex-wrap:wrap; justify-content:center; padding:0 10px; }
  .btns button { border:1px solid rgba(255,255,255,.85); border-radius:999px; padding:9px 16px; background:var(--glass);
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); font-size:14px; cursor:pointer; color:var(--ink);
    box-shadow:0 6px 18px rgba(60,40,90,.14); font-family:inherit; transition:transform .15s, background .2s; }
  .btns button:hover { transform:translateY(-2px); }
  .btns button.on { background:var(--pink); color:#fff; border-color:var(--pink); }
  .legend { display:flex; gap:16px; background:var(--glass); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
    padding:7px 16px; border-radius:999px; font-size:13px; flex-wrap:wrap; justify-content:center;
    box-shadow:0 6px 18px rgba(60,40,90,.12); border:1px solid rgba(255,255,255,.85); }
  .legend span::before { content:""; display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:6px; background:var(--c); }
  #panel { position:absolute; top:14px; right:14px; width:250px; background:var(--glass); backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px); border-radius:18px; padding:16px; border:1px solid rgba(255,255,255,.85);
    box-shadow:0 10px 30px rgba(60,40,90,.2); display:none; font-size:14px; }
  #panel h3 { margin:0 0 2px; } #panel .x { position:absolute; top:10px; right:14px; cursor:pointer; opacity:.5; }
  #panel .chip { display:inline-block; padding:2px 10px; border-radius:999px; color:#fff; font-size:12px; }
  #title { position:absolute; top:14px; left:14px; background:var(--glass); backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px); border-radius:16px; padding:9px 16px; border:1px solid rgba(255,255,255,.85);
    box-shadow:0 6px 18px rgba(60,40,90,.12); }
  #title b { color:var(--pink); } #title small { display:block; opacity:.6; }
  #err { position:absolute; inset:0; display:none; align-items:center; justify-content:center; text-align:center; padding:20px; }
  @media (max-width:600px) { #panel { left:12px; right:12px; width:auto; top:auto; bottom:120px; } .label .task { display:none; }
    .btns button { padding:8px 12px; font-size:13px; } }
</style></head>
<body>
<canvas id="c"></canvas>
<div id="labels"></div>
<div id="title"><b><span class="ms">factory</span> __COMPANY__</b> · ออฟฟิศ AI<small id="clock"></small></div>
<div id="panel"><span class="x ms" id="px">close</span><div id="pc"></div></div>
<div id="ui">
  <div class="btns">
    <button id="bLight"><span class="ms">light_mode</span> ปรับแสง</button><button id="bReset"><span class="ms">center_focus_strong</span> มุมเดิม</button>
    <button id="bNight"><span class="ms">bedtime</span> ไฟกลางคืน</button><button id="bSpin"><span class="ms">360</span> หมุนอัตโนมัติ</button>
  </div>
  <div class="legend" id="legend"></div>
</div>
<div id="err">ไม่สามารถแสดงภาพ 3D ได้ในเบราว์เซอร์นี้ (ต้องรองรับ WebGL)</div>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
"three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const DATA = __DATA__;
const STATUS = __STATUS__;
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

$('legend').innerHTML = Object.entries(STATUS).map(([k, [t, c]]) => {
  const n = DATA.agents.filter(a => a.status === k).length;
  return `<span style="--c:${c}">${t} <b>${n}</b></span>`;
}).join('');
const tickClock = () => $('clock').textContent = new Date().toLocaleString('th-TH', {weekday:'long', hour:'2-digit', minute:'2-digit'});
tickClock(); setInterval(tickClock, 10000);

let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true }); }
catch (e) { $('err').style.display = 'flex'; throw e; }
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();

// sky gradients painted once into textures (bloom needs an opaque background, not a transparent canvas)
function sky(stops, stars) {
  const c = document.createElement('canvas'); c.width = 16; c.height = 512;
  const g = c.getContext('2d'), grad = g.createLinearGradient(0, 0, 0, 512);
  stops.forEach(([o, col]) => grad.addColorStop(o, col)); g.fillStyle = grad; g.fillRect(0, 0, 16, 512);
  if (!stars) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
  const big = document.createElement('canvas'); big.width = 1024; big.height = 1024;
  const b = big.getContext('2d'); b.drawImage(c, 0, 0, 1024, 1024);
  for (let i = 0; i < 160; i++) {
    const y = Math.random() ** 1.6 * 700, r = Math.random() * 1.3 + .3;
    b.fillStyle = `rgba(255,255,255,${.35 + Math.random() * .6})`; b.beginPath(); b.arc(Math.random() * 1024, y, r, 0, 7); b.fill();
  }
  const t = new THREE.CanvasTexture(big); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const DAY_SKY = sky([[0, '#fff4ec'], [.5, '#fde6e4'], [1, '#e7e3fb']]);
const NIGHT_SKY = sky([[0, '#0d1026'], [.55, '#171b3a'], [1, '#2a2f5c']], true);
scene.background = DAY_SKY;

// ---------------------------------------------------------------- camera
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
const HOME = new THREE.Vector3(30, 27, 30);
camera.position.copy(HOME);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2.4; controls.minZoom = .6; controls.maxZoom = 3.5;
controls.autoRotateSpeed = .6;
const TARGET = new THREE.Vector3(0, 1, 1);
controls.target.copy(TARGET);
// post-processing: scene -> bloom (night only) -> output (sRGB). Own MSAA target since composer buffers aren't multisampled.
const composer = new EffectComposer(renderer,
  new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .85, .55, .62);
bloom.enabled = false;
composer.addPass(bloom);
composer.addPass(new OutputPass());
function resize() {
  const w = innerWidth, h = innerHeight, a = w / h, V = a < 1 ? 27 : 17;
  camera.left = -V * a; camera.right = V * a; camera.top = V; camera.bottom = -V;
  camera.updateProjectionMatrix(); renderer.setSize(w, h, false); composer.setSize(w, h);
}
addEventListener('resize', resize); resize();

// ---------------------------------------------------------------- lights
const hemi = new THREE.HemisphereLight(0xfff6f0, 0xd8c3c8, 1.15); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffeedd, 1.5);
sun.position.set(20, 32, 14); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.radius = 4;
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 90 });
scene.add(sun);
const fill = new THREE.DirectionalLight(0xc9d6ff, .35); fill.position.set(-20, 12, -6); scene.add(fill);

// ---------------------------------------------------------------- helpers
const MATS = {};
const mat = (c, o = {}) => {
  const k = c + JSON.stringify(o);
  return MATS[k] ??= new THREE.MeshStandardMaterial({ color: c, roughness: .82, metalness: 0, ...o });
};
function rbox(w, h, d, m, x, y, z, parent = scene, r = .08) {
  const g = new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.05, h / 2.05, d / 2.05));
  const mesh = new THREE.Mesh(g, typeof m === 'object' ? m : mat(m));
  mesh.position.set(x, y + h / 2, z); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function cyl(rt, rb, h, m, x, y, z, parent = scene, seg = 24) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), typeof m === 'object' ? m : mat(m));
  mesh.position.set(x, y + h / 2, z); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function sphere(r, m, x, y, z, parent = scene, seg = 20) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg * .7)), typeof m === 'object' ? m : mat(m));
  mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh;
}
const nightLights = [], windowMats = [], lampMats = [];

// palette
const C = {
  grass: 0xa8d58f, grassDark: 0x8cc27a, soil: 0xe3c7a8, soilDark: 0xcfae8c, stone: 0xf1e8dc, road: 0x8f8a99,
  floorA: 0xf3dcc0, floorB: 0xeed2b2, wall: 0xfffaf4, trim: 0xf6c1cf, wood: 0xd9a77c, woodDark: 0xb98257,
  pink: 0xf4a6bd, pinkDeep: 0xe8618c, sage: 0xbcd9b2, cream: 0xfff3e2, lilac: 0xcdbdf0, mint: 0xa8e0d0, white: 0xffffff,
};

// ---------------------------------------------------------------- floating island
const island = new THREE.Group(); scene.add(island);
rbox(40, 2.6, 36, C.soil, 0, -3.1, 0, island, .9);
rbox(38.6, 1.2, 34.6, C.soilDark, 0, -4.1, 0, island, .7);
rbox(40.4, .7, 36.4, C.grass, 0, -.7, 0, island, .35);
// sidewalk ring + entrance path
rbox(27, .12, 23, C.stone, 0, -.02, -.5, island, .06);
rbox(4, .1, 6, C.stone, -6.5, -.04, 12.5, island, .05);
// road along the front with stripes and crosswalk
rbox(40.4, .08, 4.2, C.road, 0, -.02, 15.6, island, .04);
for (let x = -18; x <= 18; x += 4) rbox(1.8, .02, .22, C.white, x, .06, 15.6, island, .01);
for (let i = 0; i < 6; i++) rbox(.55, .02, 3.6, C.white, -8.6 + i * .9, .06, 15.6, island, .01);

// ---------------------------------------------------------------- nature
function roundTree(x, z, s = 1, col = 0x7cc47a) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); island.add(g);
  cyl(.16, .22, 1.3, 0xa9785a, 0, 0, 0, g, 10);
  [[0, 2.1, 0, 1.05], [.55, 1.8, .2, .7], [-.5, 1.85, -.15, .72], [.1, 2.7, .1, .7]]
    .forEach(([a, b, c, r]) => sphere(r, mat(col, { roughness: .95 }), a, b, c, g, 14));
}
function pine(x, z, s = 1) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); island.add(g);
  cyl(.15, .2, .8, 0xa9785a, 0, 0, 0, g, 8);
  [[1.1, 1.6, .7], [.85, 1.3, 1.7], [.55, 1, 2.5]].forEach(([r, h, y]) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 10), mat(0x5fae7a)); m.position.y = y + h / 2; m.castShadow = true; g.add(m);
  });
}
[[-16,-14,1.1],[-17,-4,.9],[-16.5,6,1],[16.5,-13,1],[17,-3,.85],[16,7,1.05],[-9,-15.5,.9],[3,-16,1],[11,-15.5,.8]]
  .forEach(([x, z, s], i) => (i % 3 === 1 ? pine : roundTree)(x, z, s, [0x7cc47a, 0x92cf7c, 0x6db88a][i % 3]));
[[-14.5,11,.7],[14.5,11,.75],[-2,12.2,.55],[9,12,.6]].forEach(([x, z, s]) => roundTree(x, z, s, 0xf3a5c0)); // blossom trees
// flowers & bushes
const flowerCols = [0xff8fab, 0xffd166, 0xffffff, 0xc3a5ff, 0xff9e7a];
for (let i = 0; i < 70; i++) {
  const ang = Math.random() * Math.PI * 2, rx = 15 + Math.random() * 3.5, rz = 13 + Math.random() * 3;
  const x = Math.cos(ang) * rx, z = Math.sin(ang) * rz * .95 - 1;
  if (z > 12.8 && z < 18) continue;
  sphere(.13, mat(flowerCols[i % 5], { roughness: .6 }), x, .12, z, island, 8);
}
[[-13.6,-9],[-13.6,-3],[-13.6,3],[13.6,-9],[13.6,-3],[13.6,3]].forEach(([x, z]) => sphere(.75, mat(C.grassDark), x, .45, z, island, 12));

// street lamps & benches
function lamp(x, z) {
  cyl(.07, .09, 2.6, 0x5a5470, x, 0, z, island, 8);
  const lm = new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffd27a, emissiveIntensity: 0 });
  lampMats.push(lm); sphere(.26, lm, x, 2.75, z, island, 14);
  const l = new THREE.PointLight(0xffc977, 0, 9, 1.6); l.position.set(x, 2.7, z); island.add(l); nightLights.push([l, 6]);
}
[[-12.5,12.6],[-3,12.6],[6,12.6],[12.5,12.6],[-14,-12],[14,-12]].forEach(([x, z]) => lamp(x, z));
function bench(x, z, ry = 0) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; island.add(g);
  rbox(1.8, .14, .55, C.wood, 0, .45, 0, g, .05); rbox(1.8, .5, .12, C.wood, 0, .6, -.25, g, .05);
  rbox(.12, .45, .45, 0x5a5470, -.75, 0, 0, g, .03); rbox(.12, .45, .45, 0x5a5470, .75, 0, 0, g, .03);
}
bench(2, 12.4); bench(10, 12.4);

// clouds
const clouds = [];
for (let i = 0; i < 5; i++) {
  const g = new THREE.Group(), cm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: .92 });
  [[0, 0, 0, 1.3], [1.2, -.2, .2, 1], [-1.2, -.3, 0, .95], [.4, .5, 0, .9]].forEach(([x, y, z, r]) => sphere(r, cm, x, y, z, g, 14));
  g.position.set(-30 + i * 14, 9 + (i % 3) * 2, -30 - (i % 2) * 6); g.scale.setScalar(.9 + (i % 3) * .25);
  g.traverse(o => o.castShadow = false); scene.add(g); clouds.push(g);
}

// cars on the front road
const cars = [];
[[0xff8fab, 1], [0x7fb8ff, -1], [0xffd166, 1], [0xb39ddb, -1]].forEach(([c, dir], i) => {
  const g = new THREE.Group(); island.add(g);
  rbox(2.3, .65, 1.15, c, 0, .2, 0, g, .25); rbox(1.3, .55, 1.0, 0xf5f7ff, -.15, .75, 0, g, .22);
  [[-.75, .55], [.75, .55], [-.75, -.55], [.75, -.55]].forEach(([a, b]) => {
    const w = cyl(.22, .22, .16, 0x3b3550, a, .1, b, g, 12); w.rotation.x = Math.PI / 2; w.position.y = .22;
  });
  const hl = new THREE.PointLight(0xfff0b3, 0, 6, 2); hl.position.set(1.4, .5, 0); g.add(hl); nightLights.push([hl, 2]);
  g.rotation.y = dir > 0 ? 0 : Math.PI;
  cars.push({ g, x: -20 + i * 11, dir, z: dir > 0 ? 16.6 : 14.6, speed: 3 + i * .6 });
});

// pedestrians strolling around the sidewalk
const peds = [];
for (let i = 0; i < 6; i++) {
  const g = new THREE.Group(); island.add(g);
  const shirt = [0x7fb8ff, 0xff8fab, 0xffd166, 0x9ad6a5, 0xb39ddb, 0xffa07a][i];
  sphere(.26, mat(shirt), 0, .55, 0, g, 12).scale.set(1, 1.3, 1);
  sphere(.2, mat(0xffd8be), 0, 1.05, 0, g, 12); sphere(.21, mat(0x5b4636), 0, 1.13, -.03, g, 12).scale.set(1, .7, 1);
  peds.push({ g, t: Math.random() * 90, speed: .9 + Math.random() * .5 });
}
function pedPos(t) {
  const W = 13, D = 11.2, Z0 = -.5, P = 2 * (2 * W + 2 * D); t = ((t % P) + P) % P;
  if (t < 2 * W) return [t - W, Z0 + D, Math.PI / 2];
  if (t < 2 * W + 2 * D) return [W, Z0 + D - (t - 2 * W), Math.PI];
  if (t < 4 * W + 2 * D) return [W - (t - 2 * W - 2 * D), Z0 - D, -Math.PI / 2];
  return [-W, Z0 - D + (t - 4 * W - 2 * D), 0];
}

// ---------------------------------------------------------------- office building (cut-away diorama)
const office = new THREE.Group(); scene.add(office);
rbox(23, .4, 19, C.trim, 0, -.1, 0, office, .12);                       // base plinth
for (let i = 0; i < 11; i++) rbox(2, .06, 18.4, i % 2 ? C.floorA : C.floorB, -10 + i * 2, .3, 0, office, .02); // planks

// back + left walls with window cut-outs (built from segments)
const wallM = mat(C.wall), frameM = mat(0xffffff, { roughness: .5 });
const WALL_H = 3.2;
function windowGlass(w, h, x, y, z, ry) {
  const gm = new THREE.MeshStandardMaterial({ color: 0xcfe9ff, emissive: 0xffc977, emissiveIntensity: 0, transparent: true, opacity: .55, roughness: .1 });
  windowMats.push(gm);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, .06), gm); m.position.set(x, y, z); m.rotation.y = ry; office.add(m);
}
// back wall z=-9.3 : segments around 3 windows
rbox(23, .9, .4, wallM, 0, .3, -9.3, office, .06);                       // sill band
rbox(23, .6, .4, wallM, 0, .3 + WALL_H - .6, -9.3, office, .06);          // top band
[-11.3, -5.7, .8, 6.6, 11.3].forEach(x => rbox(x === -11.3 || x === 11.3 ? .4 : 1.4, WALL_H, .4, wallM, x, .3, -9.3, office, .06));
[[-8.5, 4.6], [-2.45, 5.1], [3.7, 4.4], [9, 3.4]].forEach(([x, w]) => windowGlass(w, 1.7, x, .3 + .9 + .85, -9.3, 0));
// left wall x=-11.3
rbox(.4, .9, 19, wallM, -11.3, .3, 0, office, .06);
rbox(.4, .6, 19, wallM, -11.3, .3 + WALL_H - .6, 0, office, .06);
[-9.3, -2.5, 2.5, 9.3].forEach(z => rbox(.4, WALL_H, z === -9.3 || z === 9.3 ? .4 : 1.6, wallM, -11.3, .3, z, office, .06));
[[-5.9, 6.4], [6, 6]].forEach(([z, w]) => { windowGlass(w, 1.7, -11.3, .3 + .9 + .85, z, Math.PI / 2); });
// low front walls
rbox(.35, .7, 19, C.trim, 11.4, .3, 0, office, .12);
rbox(15, .7, .35, C.trim, 3.9, .3, 9.4, office, .12);
rbox(4.8, .7, .35, C.trim, -9, .3, 9.4, office, .12);

// meeting room (glass) with pink carpet
rbox(7.2, .04, 5.8, C.pink, -7.3, .32, -5.9, office, .02);
const glassM = new THREE.MeshStandardMaterial({ color: 0xe8f4ff, transparent: true, opacity: .32, roughness: .05 });
rbox(.12, 2.2, 5.8, glassM, -3.6, .32, -5.9, office, .02);
rbox(4.6, 2.2, .12, glassM, -9, .32, -2.95, office, .02);
rbox(.18, 2.2, .18, 0xffffff, -3.6, .32, -3, office, .03);
rbox(4.2, .14, 2.1, C.white, -7.3, 1.05, -5.9, office, .07); cyl(.18, .3, .73, 0xd7d0e6, -7.3, .32, -5.9, office, 16);
[[-8.8, -4.5], [-5.8, -4.5], [-8.8, -7.3], [-5.8, -7.3]].forEach(([x, z]) => rbox(.7, .55, .7, C.lilac, x, .32, z, office, .2));
const approveMat = new THREE.MeshStandardMaterial({ color: 0xffc94d, emissive: 0xffb300, emissiveIntensity: .15, roughness: .4 });
const approveBox = rbox(.75, .5, .55, approveMat, -7.3, 1.2, -5.9, office, .12);
rbox(2.6, 1.4, .08, 0x3b3550, -7.3, 1.3, -8.95, office, .04);                     // TV screen
rbox(2.4, 1.2, .02, new THREE.MeshStandardMaterial({ color: 0x6b7cff, emissive: 0x6b7cff, emissiveIntensity: .45 }), -7.3, 1.4, -8.9, office, .02);

// workstations
const DESKS = { analyst: [0, -5.6], architect: [3.6, -5.6], developer: [7.2, -5.6], qa: [0, -1.2], devops: [3.6, -1.2], secretary: [-7.2, 4.3] };
const CHAIR_COL = { analyst: 0x7fb8ff, architect: 0xc3a5ff, developer: 0x7fd8c4, qa: 0xffc177, devops: 0xff9aa2, secretary: 0xff8fab };
const screens = {};
rbox(11, .04, 9, 0xf8ead9, 3.6, .32, -3.4, office, .02);                           // work-zone rug
Object.entries(DESKS).forEach(([id, [x, z]]) => {
  if (id !== 'secretary') {
    rbox(2.6, .12, 1.3, C.wood, x, 1.0, z, office, .05);
    [[-1.15, -.5], [1.15, -.5], [-1.15, .5], [1.15, .5]].forEach(([a, b]) => cyl(.05, .05, .7, 0xffffff, x + a, .32, z + b, office, 8));
    rbox(.7, .04, .25, 0xf4f1f8, x - .1, 1.12, z + .2, office, .02);                 // keyboard
    cyl(.09, .08, .2, [0xff8fab, 0x7fb8ff, 0xffd166][Math.abs(x) % 3 | 0], x + .85, 1.12, z + .15, office, 12); // mug
    cyl(.18, .14, .25, 0xffffff, x - 1, 1.12, z - .35, office, 12);                   // tiny plant
    sphere(.22, mat(0x7cc47a), x - 1, 1.5, z - .35, office, 10);
  }
  rbox(1.0, .66, .07, 0x3b3550, x, 1.3, z - .4, office, .05);                        // monitor
  cyl(.04, .04, .2, 0x3b3550, x, 1.12, z - .42, office, 8);
  const sm = new THREE.MeshStandardMaterial({ color: 0x2b3050, emissive: 0x8fd3ff, emissiveIntensity: .06 });
  screens[id] = rbox(.9, .56, .02, sm, x, 1.35, z - .36, office, .03);
  // chair
  const cc = CHAIR_COL[id];
  rbox(.75, .14, .7, cc, x, .72, z + 1.1, office, .07); rbox(.75, .7, .14, cc, x, .82, z + 1.42, office, .07);
  cyl(.05, .05, .4, 0x9a94ad, x, .32, z + 1.1, office, 8); cyl(.3, .3, .05, 0x9a94ad, x, .32, z + 1.1, office, 12);
});
// reception desk (secretary) + rug + logo sign
cyl(3.0, 3.0, .04, C.sage, -7.2, .32, 5.4, office, 40);
rbox(3.4, 1.05, .9, C.white, -7.2, .32, 3.8, office, .2); rbox(3.6, .1, 1.1, C.wood, -7.2, 1.37, 3.8, office, .05);
const logoCanvas = document.createElement('canvas'); logoCanvas.width = 512; logoCanvas.height = 160;
const lc = logoCanvas.getContext('2d');
lc.fillStyle = '#e8618c'; lc.beginPath(); lc.roundRect(0, 0, 512, 160, 40); lc.fill();
lc.fillStyle = '#fff'; lc.font = 'bold 74px system-ui, sans-serif'; lc.textAlign = 'center'; lc.textBaseline = 'middle';
lc.fillText('__COMPANY_SHORT__', 256, 84);
const logoTex = new THREE.CanvasTexture(logoCanvas); logoTex.colorSpace = THREE.SRGBColorSpace;
const logo = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1), new THREE.MeshStandardMaterial({ map: logoTex, transparent: true, emissive: 0xffffff, emissiveMap: logoTex, emissiveIntensity: .25 }));
logo.position.set(-11.07, 2.45, 2.5); logo.rotation.y = Math.PI / 2; office.add(logo);

// bookshelf on the left wall
rbox(.6, 2.4, 2.6, C.woodDark, -10.75, .32, -.6, office, .05);
const bookCols = [0xff8fab, 0x7fb8ff, 0xffd166, 0x9ad6a5, 0xc3a5ff, 0xffa07a];
[.75, 1.45, 2.15].forEach((y, r) => { for (let i = 0; i < 7; i++) rbox(.4, .45 + (i % 3) * .08, .24, bookCols[(i + r) % 6], -10.62, y - .02, -1.6 + i * .32, office, .03); });

// wall art above desks
[[-.4, 0xff8fab], [2.1, 0x7fb8ff]].forEach(([x, c]) => {
  rbox(1.4, 1, .06, 0xffffff, x, 2.05, -9.05, office, .04);
  rbox(1.15, .75, .02, mat(c, { roughness: .6 }), x, 2.17, -9.0, office, .02);
});
// wall clock
const clockFace = cyl(.45, .45, .06, 0xffffff, 5.6, 2.2, -9.05, office, 24); clockFace.rotation.x = Math.PI / 2;
const hand = rbox(.04, .34, .02, 0x3b3550, 5.6, 2.4, -9.0, office, .01);

// kitchen / coffee bar
rbox(1.0, 1.0, 3.6, C.white, 10.6, .32, 1.8, office, .1); rbox(1.1, .1, 3.8, C.wood, 10.6, 1.32, 1.8, office, .04);
rbox(.6, .75, .5, 0x3b3550, 10.6, 1.42, .6, office, .1);
[[2.3, 0xff8fab], [2.8, 0x7fb8ff]].forEach(([z, c]) => cyl(.1, .09, .2, c, 10.5, 1.42, z, office, 12));
rbox(.9, 2.0, .9, 0xe9f0ff, 10.55, .32, 4.4, office, .15);                         // fridge

// lounge: sofa, round table, bean bags, floor lamp, big plant
cyl(3.4, 3.4, .04, 0xffe3b8, 6.6, .32, 5.4, office, 48);
rbox(4.2, .55, 1.2, C.pinkDeep, 6.6, .32, 7.6, office, .25); rbox(4.2, .85, .35, C.pinkDeep, 6.6, .55, 8.15, office, .17);
rbox(.35, .75, 1.2, C.pinkDeep, 4.6, .32, 7.6, office, .15); rbox(.35, .75, 1.2, C.pinkDeep, 8.6, .32, 7.6, office, .15);
[[5.6, 0xffd166], [7.6, 0x7fb8ff]].forEach(([x, c]) => rbox(.8, .5, .3, c, x, .9, 7.85, office, .14));
cyl(.85, .85, .1, C.white, 6.6, .75, 5.3, office, 32); cyl(.12, .2, .43, 0xd7d0e6, 6.6, .32, 5.3, office, 12);
cyl(.2, .14, .14, 0xff8fab, 6.4, .85, 5.2, office, 12);
[[3.8, 4.4, 0xc3a5ff], [9.3, 5.6, 0x9ad6a5]].forEach(([x, z, c]) => sphere(.55, mat(c), x, .7, z, office, 16).scale.set(1, .7, 1));
cyl(.05, .05, 2.2, 0x3b3550, 9.6, .32, 7.9, office, 8);
const floorLampM = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffc977, emissiveIntensity: 0 }); lampMats.push(floorLampM);
cyl(.25, .4, .45, floorLampM, 9.6, 2.4, 7.9, office, 16);

// plants
function pot(x, z, s = 1) {
  const g = new THREE.Group(); g.position.set(x, .32, z); g.scale.setScalar(s); office.add(g);
  cyl(.38, .28, .6, 0xffffff, 0, 0, 0, g, 16);
  [[0, 1.0, 0, .45], [.25, 1.35, .1, .35], [-.22, 1.3, -.08, .36], [0, 1.65, 0, .3]].forEach(([a, b, c, r]) => sphere(r, mat(0x6db88a), a, b, c, g, 12));
}
[[-10.5, -8.6], [10.6, -8.6], [-10.5, 8.6], [2.4, 8.4], [-3.9, -8.5], [-3.9, 1.2]].forEach(([x, z]) => pot(x, z, 1));

// ceiling lights for night
[[-7, -5.5], [1.8, -5.5], [5.4, -1.5], [-7, 4.5], [6.6, 5.5], [-1, 4]].forEach(([x, z]) => {
  const l = new THREE.PointLight(0xffcf8f, 0, 10, 1.4); l.position.set(x, 3.4, z); office.add(l); nightLights.push([l, 7]);
});
const lampLight = new THREE.PointLight(0xffc977, 0, 6, 1.5); lampLight.position.set(9.6, 2.5, 7.9); office.add(lampLight); nightLights.push([lampLight, 4]);

// ---------------------------------------------------------------- chibi agents
const SPOTS = {
  idle: [[5.2, 4.6], [8.2, 4.4], [9.6, 2.1], [1.4, 6.6], [-2.2, 3.2], [-8.6, 1.6], [-1.4, 7.2], [3.4, 5.8], [5.6, 2.4]],
  review: [[-8.8, -5.2], [-5.8, -5.2], [-8.8, -6.6], [-5.8, -6.6]],
  new: [[-5.2, 6.6], [-3.6, 7.2]],
};
const HAIR = [0x4a3427, 0x2e2a3f, 0x8a5a3c, 0xd99a6c, 0x3b2a4a, 0x6b4430];
const agents = [], labelsEl = $('labels');
DATA.agents.forEach((a, i) => {
  const g = new THREE.Group(); office.add(g);
  const rig = new THREE.Group(); g.add(rig);
  const shirt = mat(a.color, { roughness: .7 }), skin = mat(0xffdcc4, { roughness: .7 }), hairM = mat(HAIR[i % HAIR.length], { roughness: .6 });
  // shadow blob
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(.45, 20), new THREE.MeshBasicMaterial({ color: 0x3b3550, transparent: true, opacity: .18 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = .34; g.add(shadow);
  // legs + body + arms
  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(.09, .25, 4, 8), mat(0x4b4565)); legL.position.set(-.13, .55, 0); rig.add(legL);
  const legR = legL.clone(); legR.position.x = .13; rig.add(legR);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.3, .3, 6, 14), shirt); body.position.y = 1.0; body.castShadow = true; rig.add(body);
  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(.075, .3, 4, 8), shirt); armL.position.set(-.36, 1.0, 0); armL.rotation.z = .25; rig.add(armL);
  const armR = armL.clone(); armR.position.x = .36; armR.rotation.z = -.25; rig.add(armR);
  // big head with face
  const head = sphere(.42, skin, 0, 1.72, 0, rig, 24);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(.45, 24, 14, 0, Math.PI * 2, 0, Math.PI * .55), hairM);
  hair.position.set(0, 1.76, -.03); hair.rotation.x = -.25; hair.castShadow = true; rig.add(hair);
  if (i % 3 === 0) sphere(.2, hairM, 0, 2.18, -.18, rig, 12);                         // bun
  if (i % 3 === 1) { const back = sphere(.4, hairM, 0, 1.6, -.17, rig, 16); back.scale.set(1.05, 1.1, .7); } // long hair
  const eyeM = mat(0x2b2540, { roughness: .3 });
  const eyes = [];
  [-.14, .14].forEach(x => { eyes.push(sphere(.055, eyeM, x, 1.72, .38, rig, 10)); eyes.push(sphere(.018, mat(0xffffff), x + .02, 1.745, .43, rig, 6)); });
  const blushM = new THREE.MeshBasicMaterial({ color: 0xff9db5, transparent: true, opacity: .55 });
  [-.24, .24].forEach(x => { const b = new THREE.Mesh(new THREE.CircleGeometry(.065, 12), blushM); b.position.set(x, 1.62, .37); b.rotation.y = x * .9; rig.add(b); });
  const smile = new THREE.Mesh(new THREE.TorusGeometry(.06, .014, 6, 12, Math.PI), eyeM); smile.position.set(0, 1.6, .405); smile.rotation.z = Math.PI; rig.add(smile);
  // status orb + halo
  const color = new THREE.Color(STATUS[a.status][1]);
  const orb = sphere(.13, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1 }), 0, 2.6, 0, g, 14);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(.24, .03, 8, 28), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .55 }));
  halo.position.y = 2.6; g.add(halo);

  let target;
  if (a.status === 'working') { const [x, z] = DESKS[a.id]; target = [x, z + 1.05]; }
  else { const s = SPOTS[a.status]; target = s[i % s.length]; }
  const start = a.status === 'working' ? target : SPOTS.idle[i % SPOTS.idle.length];
  g.position.set(start[0], .32, start[1]);
  [body, head, hair].forEach(m => m.userData.agent = a);

  const label = document.createElement('div');
  label.className = 'label';
  label.style.setProperty('--c', STATUS[a.status][1]);
  label.innerHTML = `<span class="dot"></span><b>${esc(a.name)}</b>` +
    (a.status === 'idle' ? '' : ` · ${esc(a.role)}<span class="task">${esc(a.task)}</span>`);
  labelsEl.appendChild(label);
  agents.push({ a, g, rig, body, head, armL, armR, legL, legR, orb, halo, label, target, eyes, speed: 0, hover: 0,
    blinkAt: 1 + Math.random() * 3, wanderAt: 2 + Math.random() * 4, pickables: [body, head, hair] });
  if (a.status === 'working') screens[a.id].material.emissiveIntensity = .9;
});
const hasReview = DATA.agents.some(a => a.status === 'review');
if (hasReview) approveMat.emissiveIntensity = .9;

// ---------------------------------------------------------------- interaction
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
renderer.domElement.addEventListener('click', e => {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObjects(agents.flatMap(x => x.pickables), false)[0];
  if (!hit) return;
  const a = hit.object.userData.agent, [st, c] = STATUS[a.status];
  $('pc').innerHTML = `<h3>${esc(a.name)}</h3><div style="opacity:.6;margin-bottom:8px">${esc(a.role)}</div>
    <span class="chip" style="background:${c}">${st}</span>
    <p style="margin:10px 0 6px">${esc(a.task)}</p><p style="opacity:.7;font-size:13px;margin:0 0 6px">${esc(a.desc)}</p>
    <div style="opacity:.55;font-size:12px">งานที่เสร็จแล้ว ${a.done} งาน</div>`;
  $('panel').style.display = 'block';
});
$('px').onclick = () => $('panel').style.display = 'none';
let hovered = null;
renderer.domElement.addEventListener('pointermove', e => {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObjects(agents.flatMap(x => x.pickables), false)[0];
  hovered = hit ? agents.find(x => x.pickables.includes(hit.object)) : null;
  renderer.domElement.style.cursor = hovered ? 'pointer' : 'grab';
});

// glowing "code" particles that drift up from the screens of agents who are working
const sparkGeo = new THREE.BoxGeometry(.09, .09, .09), sparks = [];
for (let i = 0; i < 40; i++) {
  const m = new THREE.Mesh(sparkGeo, new THREE.MeshStandardMaterial({ color: 0x8fd3ff, emissive: 0x8fd3ff, emissiveIntensity: 1.6, transparent: true, opacity: 0 }));
  m.visible = false; office.add(m); sparks.push({ m, life: 0 });
}
const workingDesks = DATA.agents.filter(a => a.status === 'working').map(a => DESKS[a.id]);
let sparkAt = 0;

let level = 1, night = false;
$('bLight').onclick = () => { level = level === 1 ? 1.35 : level === 1.35 ? .75 : 1; applyLight(); };
$('bReset').onclick = () => { camera.position.copy(HOME); controls.target.copy(TARGET); camera.zoom = 1; camera.updateProjectionMatrix(); };
$('bNight').onclick = () => { night = !night; $('bNight').classList.toggle('on', night); document.body.classList.toggle('night', night); applyLight(); };
$('bSpin').onclick = () => { controls.autoRotate = !controls.autoRotate; $('bSpin').classList.toggle('on', controls.autoRotate); };
function applyLight() {
  scene.background = night ? NIGHT_SKY : DAY_SKY;
  bloom.enabled = night; bloom.strength = .85 * level;
  hemi.intensity = (night ? .32 : 1.15) * level;
  hemi.color.set(night ? 0x9aa6ff : 0xfff6f0);
  sun.intensity = (night ? .25 : 1.5) * level;
  sun.color.set(night ? 0x8c9eff : 0xffeedd);
  fill.intensity = night ? .25 : .35;
  nightLights.forEach(([l, v]) => l.intensity = night ? v * level : 0);
  windowMats.forEach(m => { m.emissiveIntensity = night ? .85 : 0; m.opacity = night ? .9 : .55; });
  lampMats.forEach(m => m.emissiveIntensity = night ? 1.6 : 0);
  clouds.forEach(c => c.traverse(o => o.material && (o.material.opacity = night ? .25 : .92)));
}
applyLight();

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock(), tmp = new THREE.Vector3(), damp = THREE.MathUtils.damp;
function tick() {
  const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
  controls.update();
  clouds.forEach((c, i) => { c.position.x += dt * (.4 + i * .08); if (c.position.x > 40) c.position.x = -40; });
  cars.forEach(c => { c.x += c.dir * c.speed * dt; if (c.x > 21) c.x = -21; if (c.x < -21) c.x = 21; c.g.position.set(c.x, 0, c.z); });
  peds.forEach(p => { p.t += p.speed * dt; const [x, z, ry] = pedPos(p.t);
    p.g.position.set(x, Math.abs(Math.sin(t * 7 + p.t)) * .05, z); p.g.rotation.y = ry; });
  hand.rotation.z = -t * .5; hand.position.set(5.6 + Math.sin(t * .5) * .1, 2.23 + Math.cos(t * .5) * .1, -9.0);

  agents.forEach(ag => {
    if (ag.a.status === 'idle' && t > ag.wanderAt) {   // idle agents mingle around the office
      ag.target = SPOTS.idle[Math.floor(Math.random() * SPOTS.idle.length)].map(v => v + (Math.random() - .5) * .8);
      ag.wanderAt = t + 5 + Math.random() * 7;
    }
    const p = ag.g.position, dx = ag.target[0] - p.x, dz = ag.target[1] - p.z, d = Math.hypot(dx, dz);
    const moving = d > .05, seated = !moving && ag.a.status === 'working';
    // ease in/out of walking instead of snapping to full speed
    ag.speed = damp(ag.speed, moving ? Math.min(2.2, d * 3 + .4) : 0, 6, dt);
    if (moving) {
      const s = Math.min(d, ag.speed * dt); p.x += dx / d * s; p.z += dz / d * s;
      let diff = Math.atan2(dx, dz) - ag.g.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      ag.g.rotation.y += diff * (1 - Math.exp(-10 * dt));
    } else if (seated) {
      let diff = Math.PI - ag.g.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      ag.g.rotation.y += diff * (1 - Math.exp(-8 * dt));
    }
    const gait = ag.speed / 2.2, swing = Math.sin(t * 9) * .6 * gait;
    const bob = moving ? Math.abs(Math.sin(t * 9)) * .07 * gait : Math.sin(t * 2 + p.x) * .015;
    ag.rig.position.y = damp(ag.rig.position.y, (seated ? .12 : 0) + bob, 12, dt);
    const armTarget = seated ? -1.1 : swing;
    ag.armL.rotation.x = damp(ag.armL.rotation.x, armTarget + (seated ? Math.sin(t * 16) * .15 : 0), 14, dt);
    ag.armR.rotation.x = damp(ag.armR.rotation.x, seated ? -1.1 + Math.cos(t * 16) * .15 : -swing, 14, dt);
    ag.legL.rotation.x = swing * .8; ag.legR.rotation.x = -swing * .8;
    ag.head.rotation.y = damp(ag.head.rotation.y, moving || seated ? 0 : Math.sin(t * .8 + p.z) * .35, 4, dt);
    ag.body.scale.y = 1 + Math.sin(t * 2.4 + p.x) * .02;                       // breathing
    // blink every few seconds
    if (t > ag.blinkAt) { ag.blinkAt = t + 2.5 + Math.random() * 3.5; ag.blinkEnd = t + .12; }
    const eyeY = t < (ag.blinkEnd || 0) ? .15 : 1;
    ag.eyes.forEach(e => e.scale.y = eyeY);
    // hover highlight
    ag.hover = damp(ag.hover, hovered === ag ? 1 : 0, 10, dt);
    ag.g.scale.setScalar(1 + ag.hover * .12);
    ag.orb.position.y = 2.6 + Math.sin(t * 3 + p.x) * .07; ag.halo.position.y = ag.orb.position.y;
    ag.halo.rotation.x = Math.PI / 2 + Math.sin(t) * .3; ag.halo.rotation.y = t;

    tmp.copy(p); tmp.y += 3.0; office.localToWorld(tmp); tmp.project(camera);
    ag.sx = (tmp.x * .5 + .5) * innerWidth; ag.sy = (-tmp.y * .5 + .5) * innerHeight;
  });
  // keep name tags from overlapping: stack any tag that collides with one placed before it
  const placed = [];
  [...agents].sort((a, b) => b.sy - a.sy).forEach(ag => {
    const w = ag.label.offsetWidth || 100, h = ag.label.offsetHeight || 24;
    let y = ag.sy;
    for (let k = 0; k < 6; k++) {
      const hit = placed.find(o => Math.abs(o.x - ag.sx) < (o.w + w) / 2 + 4 && Math.abs(o.y - y) < (o.h + h) / 2 + 2);
      if (!hit) break;
      y = hit.y - (hit.h + h) / 2 - 3;
    }
    placed.push({ x: ag.sx, y, w, h });
    ag.label.style.left = ag.sx + 'px'; ag.label.style.top = y + 'px';
  });
  if (workingDesks.length && t > sparkAt) {
    sparkAt = t + .18;
    const sp = sparks.find(x => x.life <= 0), [x, z] = workingDesks[Math.floor(Math.random() * workingDesks.length)];
    if (sp) { sp.life = 1; sp.m.visible = true; sp.m.position.set(x + (Math.random() - .5) * .7, 1.7, z - .35); sp.vx = (Math.random() - .5) * .3; }
  }
  sparks.forEach(sp => {
    if (sp.life <= 0) return;
    sp.life -= dt * .7; sp.m.position.y += dt * .9; sp.m.position.x += sp.vx * dt;
    sp.m.rotation.x += dt * 3; sp.m.rotation.y += dt * 2;
    sp.m.material.opacity = Math.min(1, sp.life * 2) * .9;
    if (sp.life <= 0) sp.m.visible = false;
  });
  Object.values(screens).forEach(s => { if (s.material.emissiveIntensity > .5) s.material.emissiveIntensity = .75 + Math.sin(t * 5) * .15; });
  if (hasReview) { approveBox.rotation.y = t * 1.2; approveBox.position.y = 1.45 + Math.sin(t * 3) * .06; approveMat.emissiveIntensity = .7 + Math.sin(t * 4) * .3; }
  composer.render();
}
renderer.setAnimationLoop(tick);
</script></body></html>"""


def render(agent_states: list[dict], company: str = "ZipForge AI") -> str:
    data = json.dumps({"agents": agent_states}, ensure_ascii=False).replace("</", "<\\/")
    status = json.dumps({k: list(v) for k, v in STATUS.items()}, ensure_ascii=False)
    short = company.split(" ")[0][:10].replace("'", "")
    return (OFFICE_HTML.replace("__DATA__", data)
            .replace("__STATUS__", status)
            .replace("__COMPANY_SHORT__", short)
            .replace("__COMPANY__", company))
