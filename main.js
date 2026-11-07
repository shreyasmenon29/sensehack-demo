import * as THREE from 'three';

const $ = id => document.getElementById(id);
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TAU = Math.PI * 2;

const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({canvas, antialias: true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, .05, 1000);
camera.position.set(0, 0, 17); camera.lookAt(0, 0, 0);

// Sun
const sun = new THREE.DirectionalLight(0xffffff, 2.6); sun.position.set(30, 18, 14); scene.add(sun);
scene.add(new THREE.AmbientLight(0x223355, .15));

// Textures
const mgr = new THREE.LoadingManager(() => $('load').classList.add('done'));
const loader = new THREE.TextureLoader(mgr);
const aniso = renderer.capabilities.getMaxAnisotropy();
const T = (f, srgb) => { const t = loader.load('assets/' + f); t.anisotropy = aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
const albedo = T('albedo.jpg', true), bump = T('bump.jpg'), cloudMap = T('clouds.jpg'), ocean = T('ocean.jpg'), lights = T('lights.jpg', true), sky = T('sky.jpg', true);
cloudMap.wrapS = THREE.RepeatWrapping;   // needed so the shifted cloud-shadow lookup wraps around the seam

// Star sky: an inverted sphere (so it can rotate with the Earth for parallax); r160 has no scene.backgroundRotation
const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(600, 64, 32),
  new THREE.MeshBasicMaterial({map: sky, side: THREE.BackSide, depthWrite: false, toneMapped: false, color: new THREE.Color(1.5, 1.5, 1.5)}));
skyMesh.renderOrder = -10; scene.add(skyMesh);

// Earth (tilted group; India faces the camera)
const group = new THREE.Group();
group.position.set(3, -7, 0); group.rotation.z = 23.5 * Math.PI / 180; scene.add(group);

const cloudUniform = {value: 0};   // uv_xOffset from the tutorial: clouds drift relative to the ground
const earthMat = new THREE.MeshStandardMaterial({
  map: albedo, bumpMap: bump, bumpScale: .03,
  roughnessMap: ocean, metalness: .1, metalnessMap: ocean,
  emissiveMap: lights, emissive: new THREE.Color(0xffff88)
});
earthMat.onBeforeCompile = s => {
  s.uniforms.tClouds = {value: cloudMap};
  s.uniforms.uv_xOffset = cloudUniform;
  s.fragmentShader = s.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform sampler2D tClouds;\nuniform float uv_xOffset;')
    .replace('#include <roughnessmap_fragment>', `
      float roughnessFactor = roughness;
      #ifdef USE_ROUGHNESSMAP
        vec4 texelRoughness = vec4(1.0) - texture2D(roughnessMap, vRoughnessMapUv);
        roughnessFactor *= clamp(texelRoughness.g, 0.5, 1.0);
      #endif`)
    .replace('#include <emissivemap_fragment>', `
      #ifdef USE_EMISSIVEMAP
        vec4 emissiveColor = texture2D(emissiveMap, vEmissiveMapUv);
        emissiveColor *= 1.0 - smoothstep(-0.02, 0.0, dot(normal, directionalLights[0].direction));
        totalEmissiveRadiance *= emissiveColor.rgb;
      #endif
      float cloudShadow = smoothstep(0.32, 0.9, texture2D(tClouds, vec2(vMapUv.x - uv_xOffset, vMapUv.y)).r);
      diffuseColor.rgb *= max(1.0 - cloudShadow, 0.2);
      float rim = 1.4 - dot(normal, vec3(0.0, 0.0, 1.0));
      diffuseColor.rgb += vec3(0.3, 0.6, 1.0) * pow(rim, 5.0);`);
};
const earth = new THREE.Mesh(new THREE.SphereGeometry(10, 96, 96), earthMat);
const cloudMat = new THREE.MeshStandardMaterial({alphaMap: cloudMap, transparent: true, depthWrite: false});
// the supplied cloud map has a grey surface layer under the clouds: keep only the bright cloud areas
cloudMat.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace('#include <alphamap_fragment>', `
  #ifdef USE_ALPHAMAP
    diffuseColor.a *= smoothstep(0.32, 0.9, texture2D(alphaMap, vAlphaMapUv).g);
  #endif`); };
const clouds = new THREE.Mesh(new THREE.SphereGeometry(10.3, 96, 96), cloudMat);
const atmos = new THREE.Mesh(new THREE.SphereGeometry(12.5, 96, 96), new THREE.ShaderMaterial({
  uniforms: {atmOpacity: {value: .7}, atmPowFactor: {value: 4.1}, atmMultiplier: {value: 9.5}},
  vertexShader: `varying vec3 vNormal; varying vec3 eyeVector;
    void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vNormal = normalize(normalMatrix * normal); eyeVector = normalize(mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying vec3 vNormal; varying vec3 eyeVector; uniform float atmOpacity; uniform float atmPowFactor; uniform float atmMultiplier;
    void main(){ float d = dot(vNormal, eyeVector); float f = pow(d, atmPowFactor) * atmMultiplier;
      vec3 c = vec3(0.35 + d/4.5, 0.35 + d/4.5, 1.0); gl_FragColor = vec4(c, atmOpacity) * f; }`,
  blending: THREE.AdditiveBlending, side: THREE.BackSide, transparent: true, depthWrite: false
}));
earth.rotation.y = clouds.rotation.y = -2.93;
group.add(earth, clouds, atmos);

// Pin marker (click the Earth)
const pinMat = new THREE.MeshBasicMaterial({color: 0xf3b53f, transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false});
const pin = new THREE.Group(); pin.visible = false;
const ringA = new THREE.Mesh(new THREE.RingGeometry(.9, 1, 48), pinMat.clone()), ringB = new THREE.Mesh(new THREE.RingGeometry(.9, 1, 48), pinMat.clone());
pin.add(ringA, ringB, new THREE.Mesh(new THREE.CircleGeometry(.1, 16), pinMat));
earth.add(pin);
let pinT0 = 0;

function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); drawStars(); }

// ---------- Starfield + grid background for the non-3D screens (matches the Solar System Scope look) ----------
const bgc = $('bg'), bx = bgc.getContext('2d');
function drawStars() {
  const dpr = Math.min(devicePixelRatio, 2), W = innerWidth + 40, H = innerHeight + 40;
  bgc.width = W * dpr; bgc.height = H * dpr; bgc.style.width = W + 'px'; bgc.style.height = H + 'px'; bgc.style.inset = '-20px auto auto -20px';
  bx.setTransform(dpr, 0, 0, dpr, 0, 0); bx.fillStyle = '#020407'; bx.fillRect(0, 0, W, H);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const n = Math.round(W * H / 2600);
  for (let i = 0; i < n; i++) {
    const x = rnd() * W, y = rnd() * H, big = rnd() > .93, r = big ? .9 + rnd() * .7 : .3 + rnd() * .6;
    bx.fillStyle = `rgba(${215 + rnd() * 40 | 0},${225 + rnd() * 30 | 0},255,${big ? .8 : .25 + rnd() * .5})`;
    bx.beginPath(); bx.arc(x, y, r, 0, TAU); bx.fill();
    if (big) { bx.fillStyle = 'rgba(180,210,255,.08)'; bx.beginPath(); bx.arc(x, y, r * 4, 0, TAU); bx.fill(); }
  }
}
addEventListener('resize', resize); resize();

// ---------- Scroll journey ----------
const TRACKS = [   // edit these
  {name: 'Open Innovation',  tag: 'Build anything that senses and responds.', date: 'Dates to be announced'},
  {name: 'AI and Sensing',   tag: 'Models that make sense of raw signals.',   date: 'Dates to be announced'},
  {name: 'Health Tech',      tag: 'Devices and tools for better care.',       date: 'Dates to be announced'},
  {name: 'Sustainability',   tag: 'Measure, reduce, and reuse.',              date: 'Dates to be announced'},
  {name: 'Hardware and IoT', tag: 'Connected things that work in the field.', date: 'Dates to be announced'}
];

const C = group.position.clone(), T0 = new THREE.Vector3(0, 0, 0);
const dir = new THREE.Vector3(0, 0, 17).sub(C).normalize(), r0 = new THREE.Vector3(0, 0, 17).distanceTo(C);
const north = new THREE.Vector3(0, 1, 0).addScaledVector(dir, -dir.y).normalize();
const east = new THREE.Vector3().crossVectors(north, dir).normalize();

// 3D cloud layer: sprites floating above the surface; the camera flies through them
const pc = document.createElement('canvas'); pc.width = pc.height = 128;
const px = pc.getContext('2d');
for (let i = 0; i < 14; i++) {
  const x = 40 + Math.random() * 48, y = 50 + Math.random() * 28, r = 22 + Math.random() * 26;
  const g = px.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, 'rgba(255,248,255,.6)'); g.addColorStop(.6, 'rgba(225,215,255,.25)'); g.addColorStop(1, 'rgba(225,215,255,0)');
  px.fillStyle = g; px.fillRect(0, 0, 128, 128);
}
const puffTex = new THREE.CanvasTexture(pc); puffTex.colorSpace = THREE.SRGBColorSpace;
const puffs = [];
for (let i = 0; i < 220; i++) {
  const a = (Math.random() - .5) * .8, b = (Math.random() - .5) * .8, R = 10.45 + Math.random() * .3;
  const m = new THREE.SpriteMaterial({map: puffTex, transparent: true, depthWrite: false, opacity: .55 + Math.random() * .4, color: i % 3 ? 0xffffff : 0xf3dcff});
  const sp = new THREE.Sprite(m), s = 1.2 + Math.random() * 2.2;
  sp.scale.set(s, s * .75, 1);
  sp.position.copy(C).addScaledVector(dir.clone().addScaledVector(east, a).addScaledVector(north, b).normalize(), R);
  sp.userData.o = m.opacity; scene.add(sp); puffs.push(sp);
}

// ---------- Track cards: scroll-driven 3D coverflow ----------
const tracksEl = $('tracks'), stage = $('stage');
const N = TRACKS.length;
const cardEls = TRACKS.map((t, i) => {
  const c = document.createElement('div'); c.className = 'card';
  c.innerHTML = `<i class="c"></i><i class="c"></i><div class="idx">TRACK 0${i + 1}</div><div class="num">0${i + 1}</div><div class="bars"></div><h3>${t.name}</h3>`;
  c.addEventListener('pointermove', e => { const r = c.getBoundingClientRect(); c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px'); });
  c.addEventListener('click', () => scrollToTrack(i));
  stage.appendChild(c); return c;
});

// Info block (video 2 behaviour): label scrambles, name + tagline snap, segmented bar follows the active track
const tlab = $('tlab'), tname = $('tname'), ttag = $('ttag'), tdate = $('tdate'), tsegs = $('tsegs');
const segEls = TRACKS.map(() => tsegs.appendChild(document.createElement('i')));
const GLY = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#@/+<>';
let scrRaf = 0;
function scramble(node, text) {
  cancelAnimationFrame(scrRaf);
  if (reduce) { node.textContent = text; return; }
  const t0 = performance.now(), D = 800, at = [...text].map((_, i) => (i / text.length) * .65 + Math.random() * .3);
  const tick = () => {
    const k = Math.min(1, (performance.now() - t0) / D);
    node.textContent = [...text].map((ch, i) => (ch === ' ' || ch === '/' || k >= 1 || k >= at[i]) ? ch : GLY[Math.random() * GLY.length | 0]).join('');
    if (k < 1) scrRaf = requestAnimationFrame(tick);
  };
  tick();
}
let curIdx = -1;
function setTrack(i, animate) {
  curIdx = i; const t = TRACKS[i];
  tname.textContent = t.name; ttag.textContent = t.tag; tdate.textContent = t.date;      // these snap, no fade
  const lab = `TRACK 0${i + 1} / 0${N}`;
  if (animate) scramble(tlab, lab); else { cancelAnimationFrame(scrRaf); tlab.textContent = lab; }
  segEls.forEach((e, k) => { e.className = k < i ? 'past' : k === i ? 'act' : ''; });
}
setTrack(0, false);

// card size follows the stage so it fits any viewport
let CW = 300, CH = 360;
function sizeStage() {
  const h = stage.clientHeight, w = stage.clientWidth;
  CH = Math.max(190, Math.min(h * .97, 430)); CW = Math.min(CH * .84, w * .62);
  tracksEl.style.setProperty('--cw', CW + 'px'); tracksEl.style.setProperty('--ch', CH + 'px');
}
addEventListener('resize', sizeStage); sizeStage();

// ---------- Signal-lost screen: lines type in and the bar fills as you scroll ----------
const errEl = $('err'), errLog = $('errlog'), errBar = $('errbar'), errPct = $('errpct');
const ERR_LINES = [
  ['> descent vector unstable', 'bad'], ['> hull integrity ........ 0%', 'bad'], ['> telemetry link ........ LOST', 'bad'],
  ['> flight recorder ....... RECOVERED', 'ok'], ['> mission tracks ........ FOUND', 'ok'], ['> rerouting to tracks ...', '']
];
const errRows = ERR_LINES.map(([t, c]) => { const d = document.createElement('div'); if (c) d.className = c; errLog.appendChild(d); return d; });
function drawErr(S) {
  const eP = Math.min(1, Math.max(0, (S - ERR0) / (ERR1 - ERR0)));
  const o = sm(ERR0 - .012, ERR0 + .012, S) * (1 - sm(ERR1 - .005, ERR1 + .02, S));
  errEl.style.opacity = o; errEl.style.visibility = o > .001 ? 'visible' : 'hidden';
  if (o <= .001) return;
  errRows.forEach((d, i) => {
    const t = ERR_LINES[i][0], n = Math.round(Math.min(1, Math.max(0, (eP - (.03 + i * .12)) / .1)) * t.length);
    if (d._n !== n) { d._n = n; d.textContent = t.slice(0, n); }
  });
  errBar.style.width = (eP * 100).toFixed(1) + '%';
  errPct.textContent = 'Rerouting to tracks · ' + Math.round(eP * 100) + '%';
}

// ---------- One scroll drives everything ----------
// S = smoothed scroll progress 0..1:  [0 .. CRASH0] orbit -> dive -> clouds,  [CRASH0 .. ERR0] hull breach,  [ERR0 .. ERR1] signal-lost screen,
//     [ENTER0 .. ENTER1] tracks rise in,  [FLOW0 .. FLOW1] coverflow
const CRASH0 = .40, ERR0 = .46, ERR1 = .61, ENTER0 = .60, ENTER1 = .68, FLOW0 = .68, FLOW1 = .96;
const root = document.documentElement, body = document.body;
let target = 0, S = 0, last = performance.now(), lastCap = '';
const maxScroll = () => Math.max(1, root.scrollHeight - innerHeight);
const readScroll = () => { target = Math.min(1, Math.max(0, scrollY / maxScroll())); };
addEventListener('scroll', readScroll, {passive: true});
readScroll(); S = target;
function scrollToTrack(i) { scrollTo({top: (FLOW0 + i / (N - 1) * (FLOW1 - FLOW0)) * maxScroll(), behavior: reduce ? 'auto' : 'smooth'}); }
addEventListener('keydown', e => {
  if (S < FLOW0 - .02) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); scrollToTrack(Math.min(N - 1, curIdx + 1)); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); scrollToTrack(Math.max(0, curIdx - 1)); }
});
const look = new THREE.Vector3(), hor = new THREE.Vector3();

// ---------- Live cockpit instruments (coordinates are in cockpit.png pixels; nudge if misaligned) ----------
const rig = $('rig'), cock = $('cockpit'), inst = $('inst'), hx = inst.getContext('2d');
const IW = 1395, IH = 695; inst.width = IW * 1.5; inst.height = IH * 1.5;
const RADAR = [701, 489, 52];
const RINGS = [[187, 616, 46, .6], [306, 602, 34, -.8], [1219, 616, 34, .7], [644, 596, 18, 1.2], [755, 596, 18, -1.2]];
const GRAPHS = [[359, 551, 130, 75, 1], [974, 576, 195, 70, 2]];
const LEDS = [0, 1, 2, 3, 4, 5].map(i => [679 + i * 13, 653]);
function layout() {
  const s = Math.max(innerWidth / IW, innerHeight / IH), w = IW * s, h = IH * s;
  for (const e of [cock, inst]) Object.assign(e.style, {left: (innerWidth - w) / 2 + 'px', top: (innerHeight - h) + 'px', width: w + 'px', height: h + 'px'});
  root.style.setProperty('--h', h * .3 + 'px');
}
addEventListener('resize', layout); layout();
let mx = 0, my = 0, tx = 0, ty = 0;
if (!reduce) addEventListener('pointermove', e => { tx = e.clientX / innerWidth * 2 - 1; ty = e.clientY / innerHeight * 2 - 1; });

// ---------- Earth interaction: drag / horizontal scroll / arrow keys / click-to-pin (orbit view only) ----------
let spin = 0, dragging = false, lx = 0, ly = 0, moved = 0, lastMove = 0, idle = 0, P = 0;
const BASE = .035;               // idle auto-rotation, rad/s
const canGrab = () => P < .3;
addEventListener('pointerdown', e => {
  if (!canGrab() || e.button > 0 || e.target.closest('#top,#tracks,button,a')) return;
  dragging = true; moved = 0; lx = e.clientX; ly = e.clientY; lastMove = performance.now(); body.classList.add('grab');
});
addEventListener('pointermove', e => {
  if (!dragging) return;
  const dx = e.clientX - lx, now = performance.now(), dt = Math.max(8, now - lastMove);
  moved += Math.abs(dx) + Math.abs(e.clientY - ly); lx = e.clientX; ly = e.clientY; lastMove = now;
  const d = dx * .0055 * (innerWidth < 700 ? 1.6 : 1);
  earth.rotation.y += d; spin = lerp(spin, d / (dt / 1000), .4); idle = 0;
});
function endDrag(e) {
  if (!dragging) return; dragging = false; body.classList.remove('grab');
  if (performance.now() - lastMove > 90) spin = 0;           // held still before release: no fling
  if (moved < 6 && e.type === 'pointerup') pinAt(e.clientX, e.clientY);
}
addEventListener('pointerup', endDrag); addEventListener('pointercancel', endDrag);
addEventListener('wheel', e => {
  if (!canGrab()) return;
  const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
  if (!dx) return;
  e.preventDefault();                                          // also stops trackpad swipe-back navigation
  const d = dx * .0022; earth.rotation.y += d; spin = lerp(spin, d * 60, .3); idle = 0;
}, {passive: false});
addEventListener('keydown', e => { if (!canGrab()) return; if (e.key === 'ArrowLeft') { spin = -1.3; idle = 0; } if (e.key === 'ArrowRight') { spin = 1.3; idle = 0; } });

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), UP = new THREE.Vector3(0, 0, 1);
const fmt = (lat, lon) => `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;
const toLatLon = v => { const n = v.clone().normalize(); return [Math.asin(n.y) * 180 / Math.PI, ((((Math.atan2(n.z, -n.x)) / TAU) % 1 + 1) % 1) * 360 - 180]; };
function pinAt(x, y) {
  ndc.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(earth)[0]; if (!hit) return;
  const l = earth.worldToLocal(hit.point.clone()), n = l.clone().normalize();
  pin.position.copy(n).multiplyScalar(10.04); pin.quaternion.setFromUnitVectors(UP, n); pin.visible = true; pinT0 = performance.now() / 1000;
  const [lat, lon] = toLatLon(l); $('pinline').textContent = 'Pin ' + fmt(lat, lon);
}

// ---------- Instruments drawing ----------
function drawHud(t, p, crash) {
  const g = hx; g.setTransform(1.5, 0, 0, 1.5, 0, 0); g.clearRect(0, 0, IW, IH); g.globalCompositeOperation = 'lighter';
  const [rx, ry, rr] = RADAR, cg = g.createConicGradient(t * 1.7, rx, ry);
  cg.addColorStop(0, 'rgba(95,227,255,0)'); cg.addColorStop(.85, 'rgba(95,227,255,0)'); cg.addColorStop(1, 'rgba(95,227,255,.55)');
  g.fillStyle = cg; g.beginPath(); g.arc(rx, ry, rr, 0, 7); g.fill();
  for (let i = 0; i < 4; i++) { const a = i * 1.9 + t * .1, d = rr * (.3 + .18 * i); g.fillStyle = `rgba(255,200,120,${.4 + .4 * Math.sin(t * 3 + i)})`; g.beginPath(); g.arc(rx + Math.cos(a) * d, ry + Math.sin(a) * d, 2.2, 0, 7); g.fill(); }
  g.lineWidth = 1.5;
  for (const [x, y, r, s] of RINGS) {
    g.strokeStyle = 'rgba(95,227,255,.7)'; g.setLineDash([3, 7]); g.lineDashOffset = -t * s * 18; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); g.setLineDash([]);
    const a = Math.sin(t * s * 1.3 + x) * 1.8 + p * 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * r * .7, y + Math.sin(a) * r * .7); g.stroke();
  }
  for (const [x, y, w, h, s] of GRAPHS) {
    g.strokeStyle = 'rgba(95,227,255,.85)'; g.beginPath();
    for (let i = 0; i <= 48; i++) { const u = i / 48, v = .45 + .25 * Math.sin(u * 8 + t * 1.8 + s) + .15 * Math.sin(u * 21 - t * 2.6 + s * 2) + .08 * Math.sin(t * 9 + i); i ? g.lineTo(x + u * w, y + h * (1 - v)) : g.moveTo(x + u * w, y + h * (1 - v)); }
    g.stroke();
  }
  LEDS.forEach(([x, y], i) => { g.fillStyle = `rgba(255,170,70,${((t * 2 | 0) % 6 === i) ? .9 : .25})`; g.beginPath(); g.arc(x, y, 2.5, 0, 7); g.fill(); });
  const warn = Math.max(sm(.45, .55, p) * (1 - sm(.72, .8, p)), sm(.82, .88, p), crash);
  if (warn > 0) { g.strokeStyle = `rgba(255,70,50,${warn * (.4 + .4 * Math.sin(t * (crash ? 18 : 8)))})`; g.lineWidth = 3; g.strokeRect(609, 446, 180, 92); }
  g.globalCompositeOperation = 'source-over';
}

// ---------- Coverflow update (f = fractional focused track, rise = 0..1 entrance offset) ----------
function drawFlow(f, rise) {
  const X1 = .7, X2 = .34;
  cardEls.forEach((c, i) => {
    const d = i - f, ad = Math.abs(d), sg = Math.sign(d);
    const x = sg * (Math.min(ad, 1) * CW * X1 + Math.max(0, ad - 1) * CW * X2);
    const sc = ad < 1 ? 1 - .2 * ad : Math.max(.5, .8 - (ad - 1) * .1);
    const ry = sg * Math.min(ad, 1) * 34;                      // outer edge comes forward, cards face the centre
    const y = rise * (70 + i * 16);
    c.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,${(-ad * 70).toFixed(1)}px) rotateY(${(-ry).toFixed(2)}deg) scale(${sc.toFixed(3)})`;
    c.style.opacity = (1 - sm(1.9, 3.2, ad)) * (1 - rise);
    c.style.zIndex = 100 - Math.round(ad * 10);
    c.style.filter = `brightness(${(1 - Math.min(ad, 2.5) * .12).toFixed(3)})`;
    c.style.setProperty('--a', (1 - Math.min(1, ad)).toFixed(3));
  });
}

const el = {flash: $('flash'), flare: $('flare'), hero: $('hero'), haze: $('haze'), cap: $('cap'), alt: $('alt'), ll: $('ll'), hud: $('hud'), geo: $('geo'), bg: $('bg'), gl: $('gl'), vig: $('vig')};
let frame = 0, lastLL = '', lastPf = -1;
renderer.setAnimationLoop(now => {
  const dt = Math.min(.1, (now - last) / 1000); last = now; frame++;
  const ts = now / 1000;

  // smooth the single scroll value; everything below is a pure function of S (so scrolling back just plays it in reverse)
  S = reduce ? target : S + (target - S) * (1 - Math.exp(-dt * 7));
  if (Math.abs(target - S) < 1e-5) S = target;
  const p = .9 * Math.min(1, S / CRASH0); P = p;                // dive progress (the crash takes over from here)
  const crashK = sm(CRASH0, CRASH0 + .05, S);                  // hull breach 0..1, scrubbed by scroll
  const k = 1 - sm(CRASH0 + .03, ERR0 + .01, S);               // cockpit + Earth cut to black as the error screen takes over
  el.bg.style.transform = `translate(${-tx * 10}px,${-ty * 8}px)`;

  // ----- tracks layer -----
  const tIn = sm(ENTER0, ENTER1 - .03, S), rise = 1 - sm(ENTER0 + .02, ENTER1, S);
  tracksEl.style.opacity = tIn; tracksEl.style.visibility = tIn > .001 ? 'visible' : 'hidden';
  tracksEl.classList.toggle('on', tIn > .5);
  if (tIn > .001) {
    const f = Math.min(1, Math.max(0, (S - FLOW0) / (FLOW1 - FLOW0))) * (N - 1);
    drawFlow(f, rise);
    const idx = Math.round(f); if (idx !== curIdx) setTrack(idx, tIn > .4);
  }

  drawErr(S);

  // ----- journey layers -----
  el.gl.style.opacity = k; rig.style.opacity = k; el.vig.style.opacity = k;
  if (k < .003) { el.hud.style.opacity = 0; el.geo.style.opacity = 0; el.hero.style.opacity = 0; el.flare.style.opacity = 0; el.haze.style.opacity = 0; body.style.cursor = ''; el.flash.style.opacity = 0; return; }   // 3D scene is fully gone: stop drawing it

  // Earth rotation: idle drift + user inertia; clouds drift relative to ground (shadows follow via uniform)
  if (!dragging) { idle += dt; spin += (BASE - spin) * (1 - Math.exp(-dt * (Math.abs(spin) > .3 ? 1.6 : .6))); earth.rotation.y += spin * dt; }
  if (!reduce) cloudUniform.value += dt * .03 / TAU;
  clouds.rotation.y = earth.rotation.y + cloudUniform.value * TAU;
  skyMesh.rotation.y = earth.rotation.y * .12; skyMesh.rotation.x = my * .04;
  sun.position.set(30 + mx * 9, 18 - my * 7, 14);

  const r = p < .5 ? lerp(r0, 11.2, sm(0, .5, p)) : lerp(11.2, 10.15, sm(.5, .78, p));
  camera.position.copy(C).addScaledVector(dir, r - crashK * .25);
  look.copy(T0).lerp(C, sm(.45, .62, p));
  hor.copy(camera.position).addScaledVector(north, 3).addScaledVector(dir, -.5);
  camera.lookAt(look.lerp(hor, sm(.7, .95, p)));
  mx += (tx - mx) * .05; my += (ty - my) * .05;
  camera.rotateY(-mx * .05); camera.rotateX(-my * .035);
  if (crashK > 0 && !reduce) { camera.rotateZ(crashK * crashK * .6 * Math.sin(ts * 3)); camera.rotateX(-crashK * .35); }
  const shake = reduce ? 0 : Math.max(sm(.45, .55, p) * (1 - sm(.72, .82, p)), sm(.8, .9, p) * .6, crashK * 3);
  rig.style.transform = `translate(${-mx * 8 + (Math.random() - .5) * shake * 5}px,${-my * 5 + (Math.random() - .5) * shake * 5}px) scale(${1.02 + crashK * .03}) rotate(${(Math.random() - .5) * crashK * 1.4}deg)`;
  atmos.material.uniforms.atmOpacity.value = .7 * sm(11.8, 13.5, r);
  const pf = sm(.3, .5, p); if (Math.abs(pf - lastPf) > .01) { lastPf = pf; for (const sp of puffs) { sp.material.opacity = sp.userData.o * pf; sp.visible = pf > .01; } }

  // pin pulse
  if (pin.visible) {
    const kk = ts - pinT0, a = (kk % 1.8) / 1.8, b = ((kk + .9) % 1.8) / 1.8;
    ringA.scale.setScalar(.15 + a * .9); ringA.material.opacity = (1 - a) * .9; ringB.scale.setScalar(.15 + b * .9); ringB.material.opacity = (1 - b) * .9;
    pin.visible = p < .45;
  }

  renderer.render(scene, camera);
  drawHud(ts, p, crashK);
  el.flash.style.opacity = reduce ? 0 : crashK * (.3 + .3 * Math.sin(ts * 18)) * k;
  el.flare.style.opacity = (1 - sm(.4, .58, p)) * k;
  el.hero.style.opacity = 1 - sm(.02, .1, p);
  el.hero.style.transform = `translate(-50%,-50%) scale(${1 + p * 1.6})`;
  el.haze.style.opacity = .65 * sm(.5, .62, p) * (1 - sm(.68, .8, p));
  el.geo.style.opacity = 1 - sm(.3, .42, p); el.hud.style.opacity = k;
  body.style.cursor = canGrab() && !dragging ? 'grab' : (dragging ? 'grabbing' : '');

  const cap = crashK > .05 ? 'Hull breach · signal lost' : p < .08 ? 'Orbit · standby' : p < .45 ? 'Approaching Earth' : p < .55 ? 'Entering atmosphere' : p < .78 ? 'Passing through clouds' : 'Hull integrity critical';
  if (cap !== lastCap) { el.cap.textContent = cap; lastCap = cap; }
  el.alt.textContent = 'Altitude ' + Math.max(0, Math.round((r - 10.15) * 640 * (1 - crashK))).toLocaleString() + ' km';

  if (frame % 6 === 0) {                           // live sub-camera longitude / latitude
    const [lat, lon] = toLatLon(earth.worldToLocal(C.clone().addScaledVector(dir, 10)));
    const s2 = fmt(lat, lon); if (s2 !== lastLL) { el.ll.textContent = s2; lastLL = s2; }
  }
});