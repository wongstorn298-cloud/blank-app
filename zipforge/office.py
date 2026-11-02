"""Isometric 3D office where the AI agents visibly work (Three.js, rendered in the browser)."""

from __future__ import annotations

import json

from .agents import STATUS

OFFICE_HTML = r"""<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Office</title>
<style>
  :root { --pink:#ec407a; }
  html, body { margin:0; height:100%; overflow:hidden; background:#efe9e1;
    font-family: system-ui, -apple-system, "Segoe UI", "Noto Sans Thai", sans-serif; }
  body.night { background:#141a2e; }
  #c { display:block; width:100%; height:100%; }
  .label { position:absolute; transform:translate(-50%,-100%); pointer-events:none; white-space:nowrap;
    background:#fffffff0; border-radius:10px; padding:3px 8px; font-size:12px; color:#333;
    box-shadow:0 2px 6px #0002; }
  .label b { font-weight:600; } .label .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:4px; }
  .label .task { display:block; font-size:10px; color:#777; max-width:170px; overflow:hidden; text-overflow:ellipsis; }
  #ui { position:absolute; left:0; right:0; bottom:10px; display:flex; flex-direction:column; align-items:center; gap:8px; }
  .btns { display:flex; gap:8px; flex-wrap:wrap; justify-content:center; }
  .btns button { border:0; border-radius:14px; padding:9px 16px; background:#fff; font-size:14px; cursor:pointer;
    box-shadow:0 2px 8px #0002; font-family:inherit; }
  .btns button.on { background:var(--pink); color:#fff; }
  .legend { display:flex; gap:14px; background:#ffffffd9; padding:6px 14px; border-radius:12px; font-size:13px; flex-wrap:wrap; justify-content:center; }
  .legend span::before { content:""; display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:5px; background:var(--c); }
  #panel { position:absolute; top:12px; right:12px; width:240px; background:#fff; border-radius:14px; padding:14px;
    box-shadow:0 4px 18px #0003; display:none; font-size:14px; }
  #panel h3 { margin:0 0 4px; } #panel .x { position:absolute; top:8px; right:12px; cursor:pointer; color:#999; }
  #title { position:absolute; top:12px; left:12px; background:#ffffffe6; border-radius:14px; padding:8px 14px; box-shadow:0 2px 8px #0002; }
  #title b { color:var(--pink); } #title small { display:block; color:#888; }
  #err { position:absolute; inset:0; display:none; align-items:center; justify-content:center; color:#555; text-align:center; padding:20px; }
  @media (max-width:600px) { #panel { left:12px; right:12px; width:auto; top:auto; bottom:110px; } .label .task { display:none; } }
</style></head>
<body>
<canvas id="c"></canvas>
<div id="labels"></div>
<div id="title"><b>🏭 __COMPANY__</b> ออฟฟิศ AI<small id="clock"></small></div>
<div id="panel"><span class="x" id="px">✕</span><div id="pc"></div></div>
<div id="ui">
  <div class="btns">
    <button id="bLight">☀️ ปรับแสง</button><button id="bReset">🎯 มุมเดิม</button>
    <button id="bNight">🌙 ไฟกลางคืน</button><button id="bSpin">🔄 หมุนอัตโนมัติ</button>
  </div>
  <div class="legend" id="legend"></div>
</div>
<div id="err">ไม่สามารถแสดงภาพ 3D ได้ในเบราว์เซอร์นี้ (ต้องรองรับ WebGL)</div>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
"three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DATA = __DATA__;
const STATUS = __STATUS__;
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// legend
$('legend').innerHTML = Object.entries(STATUS).map(([k, [t, c]]) => {
  const n = DATA.agents.filter(a => a.status === k).length;
  return `<span style="--c:${c}">${t} ${n}</span>`;
}).join('');
setInterval(() => $('clock').textContent = new Date().toLocaleString('th-TH', {weekday:'long', hour:'2-digit', minute:'2-digit'}), 1000);

let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true }); }
catch (e) { $('err').style.display = 'flex'; throw e; }
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const DAY_BG = new THREE.Color(0xefe9e1), NIGHT_BG = new THREE.Color(0x141a2e);
scene.background = DAY_BG;

// isometric orthographic camera
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
const HOME = new THREE.Vector3(28, 26, 28);
camera.position.copy(HOME);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2.3; controls.minZoom = 0.5; controls.maxZoom = 3;
controls.target.set(0, 0, 0);
let VIEW = 15;
function resize() {
  const w = innerWidth, h = innerHeight, a = w / h;
  VIEW = a < 1 ? 22 : 15;
  camera.left = -VIEW * a; camera.right = VIEW * a; camera.top = VIEW; camera.bottom = -VIEW;
  camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
}
addEventListener('resize', resize); resize();

// lights
const hemi = new THREE.HemisphereLight(0xffffff, 0xb9a98f, 1.1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3e0, 1.6);
sun.position.set(18, 30, 10); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30 });
scene.add(sun);

// helpers
const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: .85, ...o });
function box(w, h, d, c, x, y, z, parent = scene, o) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof c === 'object' ? c : mat(c, o));
  m.position.set(x, y + h / 2, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
const nightLights = [], glowMats = [];

// ---------------------------------------------------------------- city block
box(80, .1, 80, 0xb8b2a8, 0, -.1, 0);                     // asphalt
box(34, .12, 30, 0xd9d3c7, 0, -.05, 0);                    // sidewalk
box(30, .14, 26, 0x9ccc65, 0, -.03, 0);                    // lawn
for (let i = -36; i <= 36; i += 6) {                       // road markings
  box(2.4, .02, .25, 0xffffff, i, 0, 19.5); box(.25, .02, 2.4, 0xffffff, 21.5, 0, i);
}
for (let i = 0; i < 6; i++) box(.6, .02, 3, 0xffffff, -12 + i * 1.1, 0, 17.5); // crosswalk

function tree(x, z, s = 1) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); scene.add(g);
  box(.3, 1.2, .3, 0x8d6e63, 0, 0, 0, g);
  const top = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), mat(0x66bb6a, { flatShading: true }));
  top.position.y = 2; top.castShadow = true; g.add(top);
}
[[-13,-11],[-13,-4],[-13,4],[-13,11],[13,-11],[13,11],[-7,-12],[7,-12],[0,-12.5],[-4,12],[5,12.5]].forEach(([x,z]) => tree(x, z, .9 + Math.random() * .3));

// buildings across the street
[[-28,-8,0xe0e0e0,9],[-28,8,0xffccbc,6],[30,-10,0xd7ccc8,7],[30,8,0xcfd8dc,11],[-6,-30,0xe1bee7,8],[10,-30,0xffe0b2,5]].forEach(([x,z,c,h]) => {
  const b = box(8, h, 8, c, x, 0, z);
  for (let y = 1.5; y < h - .5; y += 2) for (let k = -2.5; k <= 2.5; k += 2.5) {
    const wm = new THREE.MeshStandardMaterial({ color: 0x90a4ae, emissive: 0xffd54f, emissiveIntensity: 0 });
    glowMats.push(wm); box(1.2, .9, .05, wm, x + k, y, z + 4.03);
  }
});

// cars
const cars = [];
[[0xef5350, 0], [0x42a5f5, 25], [0xfdd835, 50], [0x7e57c2, 70]].forEach(([c, off], i) => {
  const g = new THREE.Group(); scene.add(g);
  box(2.2, .6, 1.1, c, 0, .25, 0, g); box(1.2, .5, 1, 0xeceff1, -.1, .85, 0, g);
  const hl = new THREE.PointLight(0xfff59d, 0, 6); hl.position.set(1.3, .5, 0); g.add(hl); nightLights.push([hl, 1.5]);
  cars.push({ g, t: off, speed: .09 + i * .015, lane: i % 2 });
});
const LOOP = 4 * 42;
function carPos(t, lane) {
  const r = lane ? 19 : 20.8; t = ((t % LOOP) + LOOP) % LOOP; const s = t % 42 - 21, side = Math.floor(t / 42);
  return [[s, r, 0], [r, -s, -Math.PI / 2], [-s, -r, Math.PI], [-r, s, Math.PI / 2]][side];
}

// pedestrians
const peds = [];
for (let i = 0; i < 8; i++) {
  const g = new THREE.Group(); scene.add(g);
  const c = [0x5d4037, 0x1e88e5, 0xe53935, 0x43a047][i % 4];
  box(.35, .7, .25, c, 0, 0, 0, g); const h = new THREE.Mesh(new THREE.SphereGeometry(.18), mat(0xffcc99)); h.position.y = .9; g.add(h);
  peds.push({ g, t: Math.random() * 120, speed: .03 + Math.random() * .02 });
}
function pedPos(t) {
  const W = 16, D = 14, P = 2 * (2 * W + 2 * D); t = ((t % P) + P) % P;
  if (t < 2 * W) return [t - W, D, 0];
  if (t < 2 * W + 2 * D) return [W, D - (t - 2 * W), -Math.PI / 2];
  if (t < 4 * W + 2 * D) return [W - (t - 2 * W - 2 * D), -D, Math.PI];
  return [-W, -D + (t - 4 * W - 2 * D), Math.PI / 2];
}

// ---------------------------------------------------------------- office building (cut-away)
const office = new THREE.Group(); scene.add(office);
box(22, .3, 18, 0xf3e5d0, 0, 0, 0, office);                         // floor
box(22, 2.6, .3, 0xfaf7f2, 0, .3, -9, office);                      // back wall
box(.3, 2.6, 18, 0xfaf7f2, -11, .3, 0, office);                     // left wall
box(.3, .8, 18, 0xfaf7f2, 11, .3, 0, office);                       // low front walls (cut-away)
box(22, .8, .3, 0xfaf7f2, 0, .3, 9, office);
for (let x = -9; x <= 9; x += 3) {                                   // windows on back wall
  const wm = new THREE.MeshStandardMaterial({ color: 0xb3e5fc, emissive: 0xffe082, emissiveIntensity: 0, transparent: true, opacity: .85 });
  glowMats.push(wm); box(2, 1.2, .1, wm, x, 1.2, -8.8, office);
}
// rooms
box(7, .02, 6, 0xf8bbd0, -7, .3, -5.7, office);                       // meeting room carpet (pink)
box(.2, 1.6, 6, 0xffffff, -3.4, .3, -5.7, office, { transparent: true, opacity: .45 }); // glass wall
box(7, .02, 6, 0xffe0b2, 7, .3, 5.5, office);                         // lounge rug
box(6, .02, 5, 0xc5e1a5, -7, .3, 5.5, office);                        // reception rug

// meeting table + approval box
box(4, .1, 2, 0xffffff, -7, 1.0, -5.7, office); box(.3, .7, .3, 0xbdbdbd, -7, .3, -5.7, office);
const approveMat = new THREE.MeshStandardMaterial({ color: 0xffb300, emissive: 0xffb300, emissiveIntensity: .2 });
const approveBox = box(.7, .5, .5, approveMat, -7, 1.1, -5.7, office);

// lounge: sofa, coffee table, coffee machine
box(4, .6, 1.2, 0xec407a, 7, .3, 7.5, office); box(4, .8, .3, 0xd81b60, 7, .3, 8.1, office);
box(1.6, .4, 1, 0xa1887f, 7, .3, 5.6, office);
box(1, 1.6, .8, 0x455a64, 10, .3, 3, office);

// reception desk (secretary)
box(3.2, 1, .8, 0xffffff, -7, .3, 4.2, office);

// plants inside
[[-10,-8],[10,-8],[-10,8],[3,8],[-1,-8]].forEach(([x,z]) => {
  box(.6, .5, .6, 0xffffff, x, .3, z, office);
  const p = new THREE.Mesh(new THREE.IcosahedronGeometry(.55, 0), mat(0x4caf50, { flatShading: true }));
  p.position.set(x, 1.3, z); p.castShadow = true; office.add(p);
});

// ceiling lamps (night)
[[-6,-5],[4,-4],[4,3],[-6,5],[8,6]].forEach(([x,z]) => {
  const l = new THREE.PointLight(0xffd59e, 0, 12, 1.5); l.position.set(x, 3.2, z); office.add(l); nightLights.push([l, 9]);
});

// desks: one per working agent
const DESKS = {
  analyst:   [0, -5.5], architect: [3.5, -5.5], developer: [7, -5.5],
  qa:        [0, -1],   devops:    [3.5, -1],   secretary: [-7, 4.2],
};
const screens = {};
Object.entries(DESKS).forEach(([id, [x, z]]) => {
  if (id !== 'secretary') { box(2.4, .1, 1.2, 0xffffff, x, 1.0, z, office); box(.15, .7, .15, 0xbdbdbd, x - 1, .3, z); box(.15, .7, .15, 0xbdbdbd, x + 1, .3, z); }
  const sm = new THREE.MeshStandardMaterial({ color: 0x263238, emissive: 0x4fc3f7, emissiveIntensity: .05 });
  box(.9, .6, .08, 0x37474f, x, 1.15, z - .35, office);
  screens[id] = box(.8, .5, .02, sm, x, 1.2, z - .3, office);
  box(.7, .5, .7, 0x546e7a, x, .3, z + 1.1, office);                // chair
});

// ---------------------------------------------------------------- agents
const SPOTS = {
  idle: [[5, 5.4], [8.6, 5.6], [9.4, 2.4], [1.5, 6.8], [-2, 3], [-8.5, 2], [-1.5, 7.5], [10, 7.6], [5.5, 2.4]],
  review: [[-8.6, -4.6], [-5.4, -4.6], [-8.6, -6.8], [-5.4, -6.8]],
  new: [[-5, 6.5], [-3.5, 7]],
};
const agents = [], labelsEl = $('labels');
DATA.agents.forEach((a, i) => {
  const g = new THREE.Group(); office.add(g);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.32, .55, 4, 10), mat(a.color));
  body.position.y = .75; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.3, 16, 12), mat(0xffd6b0));
  head.position.y = 1.55; head.castShadow = true; g.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(.32, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x3e2723));
  hair.position.y = 1.6; g.add(hair);
  const color = STATUS[a.status][1];
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.25, .06, 8, 24),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .8 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 2.15; g.add(ring);

  let target;
  if (a.status === 'working') { const [x, z] = DESKS[a.id]; target = [x, z + 1.1]; }
  else { const s = SPOTS[a.status]; target = s[i % s.length]; }
  const start = a.status === 'working' ? target : SPOTS.idle[i % SPOTS.idle.length];
  g.position.set(start[0], .3, start[1]);
  body.userData.agent = head.userData.agent = a;

  const label = document.createElement('div');
  label.className = 'label';
  label.innerHTML = `<span class="dot" style="background:${color}"></span><b>${a.emoji} ${esc(a.name)}</b>` +
    (a.status === 'idle' ? '' : ` · ${esc(a.role)}<span class="task">${esc(a.task)}</span>`);
  labelsEl.appendChild(label);
  agents.push({ a, g, body, ring, label, target, wanderAt: 2 + Math.random() * 4 });
  if (a.status === 'working') screens[a.id].material.emissiveIntensity = .9;
});
if (DATA.agents.some(a => a.status === 'review')) approveMat.emissiveIntensity = .9;

// ---------------------------------------------------------------- interaction
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
renderer.domElement.addEventListener('click', e => {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObjects(agents.flatMap(x => [x.body]), false)[0];
  if (!hit) return;
  const a = hit.object.userData.agent, [st, c] = STATUS[a.status];
  $('pc').innerHTML = `<h3>${a.emoji} ${esc(a.name)}</h3><div style="color:#888">${esc(a.role)}</div>
    <p>${esc(a.desc)}</p><p><span style="color:${c}">●</span> <b>${st}</b><br>${esc(a.task)}</p>
    <div style="color:#888;font-size:12px">งานที่เสร็จแล้ว ${a.done} งาน</div>`;
  $('panel').style.display = 'block';
});
$('px').onclick = () => $('panel').style.display = 'none';

let level = 1, night = false;
$('bLight').onclick = () => { level = level === 1 ? 1.4 : level === 1.4 ? .7 : 1; applyLight(); };
$('bReset').onclick = () => { camera.position.copy(HOME); controls.target.set(0, 0, 0); camera.zoom = 1; camera.updateProjectionMatrix(); };
$('bNight').onclick = () => { night = !night; $('bNight').classList.toggle('on', night); document.body.classList.toggle('night', night); applyLight(); };
$('bSpin').onclick = () => { controls.autoRotate = !controls.autoRotate; $('bSpin').classList.toggle('on', controls.autoRotate); };
function applyLight() {
  scene.background = night ? NIGHT_BG : DAY_BG;
  hemi.intensity = (night ? .25 : 1.1) * level;
  sun.intensity = (night ? .15 : 1.6) * level;
  sun.color.set(night ? 0x8c9eff : 0xfff3e0);
  nightLights.forEach(([l, v]) => l.intensity = night ? v * level : 0);
  glowMats.forEach(m => m.emissiveIntensity = night ? (Math.random() > .3 ? .9 : 0) : 0);
}
applyLight();

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock(), tmp = new THREE.Vector3();
function tick() {
  const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
  controls.update();
  cars.forEach(c => { c.t += c.speed * 60 * dt * (c.lane ? -1 : 1); const [x, z, ry] = carPos(c.t, c.lane);
    c.g.position.set(x, 0, z); c.g.rotation.y = ry + (c.lane ? Math.PI : 0); });
  peds.forEach(p => { p.t += p.speed * 60 * dt; const [x, z, ry] = pedPos(p.t);
    p.g.position.set(x, Math.abs(Math.sin(t * 8 + p.t)) * .06, z); p.g.rotation.y = -ry; });

  agents.forEach(ag => {
    if (ag.a.status === 'idle' && t > ag.wanderAt) {   // idle agents mingle in the lounge
      ag.target = SPOTS.idle[Math.floor(Math.random() * SPOTS.idle.length)].map(v => v + (Math.random() - .5));
      ag.wanderAt = t + 4 + Math.random() * 6;
    }
    const p = ag.g.position, dx = ag.target[0] - p.x, dz = ag.target[1] - p.z, d = Math.hypot(dx, dz);
    if (d > .05) {
      const s = Math.min(d, 2.2 * dt); p.x += dx / d * s; p.z += dz / d * s;
      ag.g.rotation.y = Math.atan2(dx, dz); ag.body.position.y = .75 + Math.abs(Math.sin(t * 10)) * .08;
    } else if (ag.a.status === 'working') {
      ag.g.rotation.y = Math.PI; ag.body.position.y = .72 + Math.sin(t * 14) * .02;   // typing
    } else ag.body.position.y = .75 + Math.sin(t * 2 + p.x) * .02;
    ag.ring.rotation.z = t * 2; ag.ring.position.y = 2.15 + Math.sin(t * 3) * .05;

    tmp.copy(p); tmp.y += 2.5; office.localToWorld(tmp); tmp.project(camera);
    ag.label.style.left = (tmp.x * .5 + .5) * innerWidth + 'px';
    ag.label.style.top = (-tmp.y * .5 + .5) * innerHeight + 'px';
  });
  Object.entries(screens).forEach(([id, s]) => { if (s.material.emissiveIntensity > .5) s.material.emissiveIntensity = .7 + Math.sin(t * 6) * .2; });
  approveBox.rotation.y = DATA.agents.some(a => a.status === 'review') ? t : 0;
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
</script></body></html>"""


def render(agent_states: list[dict], company: str = "ZipForge AI") -> str:
    data = json.dumps({"agents": agent_states}, ensure_ascii=False).replace("</", "<\\/")
    status = json.dumps({k: list(v) for k, v in STATUS.items()}, ensure_ascii=False)
    return (OFFICE_HTML.replace("__DATA__", data)
            .replace("__STATUS__", status)
            .replace("__COMPANY__", company))
