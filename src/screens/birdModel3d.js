// Low-poly 3D birds for the species page's 3D model tab, ported from v1 (birding-refresh js/model3d.js). three.js
// comes from the npm package instead of v1's vendor copy; the page imports this module only when the tab is first
// opened, so three.js loads on demand (the service worker still precaches its chunk for offline use). One change from
// v1: with reduced motion the bird keeps still (v1 stopped the spin but kept the gentle bob).
import * as THREE from 'three';
import { PAL } from '../core/palettes.js';

// Shape defaults by group. pose: perch | wade | swim | ground | upright
const GROUP_SHAPE = {
  landfowl:   { pose: 'ground', body: [1.25, 0.9, 0.85], head: 0.36, bill: 'short', tail: 1.1, legs: 0.9, neck: 0.6 },
  waterfowl:  { pose: 'swim', body: [1.3, 0.75, 0.8], head: 0.34, bill: 'flat', tail: 0.6, legs: 0, neck: 0.9 },
  pigeons:    { pose: 'perch', body: [1.1, 0.85, 0.8], head: 0.3, bill: 'short', tail: 1.1, legs: 0.6, neck: 0.4 },
  nightbirds: { pose: 'upright', body: [0.95, 1.05, 0.85], head: 0.48, bill: 'hook', tail: 0.8, legs: 0.5, neck: 0.2 },
  cuckoos:    { pose: 'perch', body: [1.15, 0.72, 0.7], head: 0.32, bill: 'short', tail: 1.6, legs: 0.5, neck: 0.4 },
  rails:      { pose: 'ground', body: [1.1, 0.85, 0.72], head: 0.32, bill: 'short', tail: 0.6, legs: 1.2, neck: 0.6 },
  shorebirds: { pose: 'wade', body: [1.05, 0.7, 0.68], head: 0.32, bill: 'long', tail: 0.7, legs: 1.5, neck: 0.5 },
  seabirds:   { pose: 'swim', body: [1.3, 0.72, 0.75], head: 0.32, bill: 'big', tail: 0.8, legs: 0, neck: 0.9 },
  herons:     { pose: 'wade', body: [1.1, 0.72, 0.66], head: 0.28, bill: 'long', tail: 0.6, legs: 2.0, neck: 1.6 },
  raptors:    { pose: 'upright', body: [1.15, 0.95, 0.85], head: 0.36, bill: 'hook', tail: 1.2, legs: 0.6, neck: 0.4 },
  kingfishers:{ pose: 'perch', body: [1.0, 0.85, 0.8], head: 0.44, bill: 'king', tail: 0.8, legs: 0.35, neck: 0.2 },
  parrots:    { pose: 'perch', body: [1.05, 0.85, 0.8], head: 0.38, bill: 'parrot', tail: 1.2, legs: 0.45, neck: 0.3 },
  rainforest: { pose: 'perch', body: [1.1, 0.82, 0.78], head: 0.34, bill: 'short', tail: 1.1, legs: 0.7, neck: 0.4 },
  wrens:      { pose: 'perch', body: [0.95, 0.85, 0.82], head: 0.38, bill: 'short', tail: 1.2, legs: 0.6, neck: 0.2 },
  honeyeaters:{ pose: 'perch', body: [1.05, 0.8, 0.74], head: 0.34, bill: 'thin', tail: 1.1, legs: 0.6, neck: 0.3 },
  whistlers:  { pose: 'perch', body: [1.05, 0.82, 0.76], head: 0.36, bill: 'short', tail: 1.2, legs: 0.6, neck: 0.3 },
  magpies:    { pose: 'perch', body: [1.15, 0.85, 0.8], head: 0.36, bill: 'big', tail: 1.2, legs: 0.8, neck: 0.4 },
  songbirds:  { pose: 'perch', body: [1.0, 0.82, 0.78], head: 0.36, bill: 'short', tail: 1.1, legs: 0.6, neck: 0.25 },
};
// Swimmers that are better shown standing
const STANDING = new Set(['Magpie Goose', 'Australian Wood Duck', 'Plumed Whistling-Duck', 'Silver Gull', 'Greater Crested Tern', 'Caspian Tern', 'Australasian Darter', 'Little Pied Cormorant', 'Little Black Cormorant', 'Pied Cormorant']);

const mat = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c), flatShading: true, roughness: 0.75, metalness: 0.02, ...extra });

function ellipsoid(r, sx, sy, sz, detail = 1) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  g.scale(sx, sy, sz);
  return g;
}

// Body coloured back→belly using vertex colours.
function twoToneBody(geo, top, bottom) {
  const a = new THREE.Color(top), b = new THREE.Color(bottom);
  const pos = geo.attributes.position;
  const cols = [];
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) { minY = Math.min(minY, pos.getY(i)); maxY = Math.max(maxY, pos.getY(i)); }
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - minY) / (maxY - minY);
    const c = b.clone().lerp(a, THREE.MathUtils.smoothstep(t, 0.35, 0.6));
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return geo;
}

function makeBill(type, color) {
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.5 });
  const cone = (r, len) => { const c = new THREE.Mesh(new THREE.ConeGeometry(r, len, 6), m); c.rotation.z = -Math.PI / 2; c.position.x = len / 2; return c; };
  const curve = (pts, r) => {
    const path = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
    return new THREE.Mesh(new THREE.TubeGeometry(path, 12, r, 5, false), m);
  };
  switch (type) {
    case 'flat': { const b = new THREE.Mesh(ellipsoid(0.16, 1.6, 0.35, 0.9, 1), m); b.position.x = 0.2; g.add(b); break; }
    case 'cone': g.add(cone(0.12, 0.22)); break;
    case 'thin': { const c = cone(0.05, 0.4); c.rotation.z = -Math.PI / 2 - 0.15; g.add(c); break; }
    case 'needle': { const c = cone(0.035, 0.55); c.rotation.z = -Math.PI / 2 - 0.2; g.add(c); break; }
    case 'king': g.add(cone(0.11, 0.6)); break;
    case 'long': g.add(cone(0.06, 0.8)); break;
    case 'long-up': { const c = cone(0.045, 0.9); c.rotation.z = -Math.PI / 2 + 0.12; g.add(c); break; }
    case 'big': g.add(cone(0.1, 0.45)); break;
    case 'curved': g.add(curve([[0, 0, 0], [0.3, -0.02, 0], [0.55, -0.15, 0], [0.7, -0.32, 0]], 0.035)); break;
    case 'curved-long': g.add(curve([[0, 0, 0], [0.4, -0.02, 0], [0.75, -0.18, 0], [0.95, -0.42, 0]], 0.035)); break;
    case 'spoon': {
      g.add(curve([[0, 0, 0], [0.7, -0.05, 0]], 0.03));
      const s = new THREE.Mesh(ellipsoid(0.1, 1.3, 0.3, 1, 1), m); s.position.set(0.75, -0.05, 0); g.add(s); break;
    }
    case 'pouch': {
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.07, 0.14), m); top.position.x = 0.5; g.add(top);
      const p = new THREE.Mesh(ellipsoid(0.2, 2.2, 0.7, 0.6, 1), mat('#e8b0a0')); p.position.set(0.45, -0.14, 0); g.add(p); break;
    }
    case 'wide': { const b = new THREE.Mesh(ellipsoid(0.2, 0.9, 0.4, 1.3, 1), m); b.position.x = 0.12; g.add(b); break; }
    case 'parrot': {
      const b = new THREE.Mesh(ellipsoid(0.14, 1, 1.1, 0.9, 1), m); b.position.set(0.07, -0.02, 0); g.add(b);
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 5), m); t.rotation.z = Math.PI; t.position.set(0.12, -0.15, 0); g.add(t); break;
    }
    case 'hook': case 'hookshort': {
      const len = type === 'hook' ? 0.24 : 0.32;
      g.add(cone(type === 'hook' ? 0.1 : 0.07, len));
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 5), m); t.rotation.z = Math.PI; t.position.set(len - 0.02, -0.06, 0); g.add(t); break;
    }
    default: g.add(cone(0.08, 0.24));
  }
  return g;
}

export function buildBird(sp) {
  const p = PAL[sp.name] || ['#7a7e84', '#c8c4bc', '#7a7e84', '#6a6e74', '#2a2a2a', '#5a5a5a'];
  const [back, belly, headC, wingC, billC, legC, accent, opts = {}] = p;
  const base = GROUP_SHAPE[sp.group] || GROUP_SHAPE.songbirds;
  let pose = base.pose;
  if (pose === 'swim' && STANDING.has(sp.name)) pose = 'wade';
  const shape = { ...base, bill: opts.bill || base.bill, tail: base.tail * (opts.tail || 1), legs: base.legs * (opts.legs || 1), neck: base.neck * (opts.neck || 1) };
  if (pose === 'wade' && sp.group === 'seabirds') shape.legs = 0.6;

  const bird = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8 });
  const [bx, by, bz] = shape.body;
  const body = new THREE.Mesh(twoToneBody(ellipsoid(0.6, bx, by, bz, 2), back, belly), bodyMat);
  bird.add(body);

  // tilt of the body: upright birds lean back
  const pitch = { perch: 0.45, upright: 0.85, wade: 0.12, swim: 0.05, ground: 0.18 }[pose];
  body.rotation.z = pitch;

  // neck + head
  const neckLen = 0.25 + shape.neck * 0.35;
  const front = new THREE.Vector3(0.6 * bx * Math.cos(pitch) * 0.82, 0.6 * by * 0.55 + 0.6 * bx * Math.sin(pitch) * 0.82, 0);
  const headPos = front.clone().add(shape.neck > 0.7
    ? new THREE.Vector3(0.08, neckLen, 0)
    : new THREE.Vector3(0.02, shape.head * 0.45, 0));
  if (shape.neck > 0.7) {
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, headPos.distanceTo(front) + 0.1, 7), mat(opts.neckC || headC));
    neck.position.copy(front.clone().lerp(headPos, 0.5));
    neck.lookAt(headPos); neck.rotateX(Math.PI / 2);
    bird.add(neck);
  }
  const head = new THREE.Group();
  head.position.copy(headPos);
  const hr = shape.head;
  head.add(new THREE.Mesh(ellipsoid(hr, 1.05, 1, 0.95, 1), mat(headC)));
  // eyes
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(hr * 0.16, 8, 6), mat('#0d0d0d', { roughness: 0.2 }));
    eye.position.set(hr * 0.42, hr * 0.22, s * hr * 0.82);
    head.add(eye);
    if (sp.group === 'nightbirds' && sp.name !== 'Tawny Frogmouth') {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(hr * 0.38, 10), mat(accent || '#e8c84a', { side: THREE.DoubleSide }));
      disc.position.set(hr * 0.55, hr * 0.2, s * hr * 0.55); disc.lookAt(disc.position.clone().multiplyScalar(3)); head.add(disc);
      eye.position.set(hr * 0.66, hr * 0.2, s * hr * 0.58);
    }
  }
  // face/cheek accent patch
  if (accent && !['nightbirds'].includes(sp.group)) {
    for (const s of [-1, 1]) {
      const patch = new THREE.Mesh(ellipsoid(hr * 0.32, 1.2, 0.8, 0.4, 0), mat(accent));
      patch.position.set(-hr * 0.15, -hr * 0.2, s * hr * 0.84);
      head.add(patch);
    }
  }
  const bill = makeBill(shape.bill, billC);
  bill.position.set(hr * 0.9, -hr * 0.05, 0);
  head.add(bill);
  if (opts.crest) {
    const crest = new THREE.Mesh(new THREE.ConeGeometry(hr * 0.35, hr * (opts.crest === 2 ? 1.6 : 1.1), 5), mat(opts.crest === 2 ? accent : headC));
    crest.position.set(-hr * 0.35, hr * 1.05, 0); crest.rotation.z = 0.9; head.add(crest);
  }
  if (opts.wattle) {
    const w = new THREE.Mesh(ellipsoid(hr * 0.4, 1.4, 0.8, 1, 1), mat(accent));
    w.position.set(-hr * 0.1, -hr * 0.95, 0); head.add(w);
  }
  bird.add(head);

  // wings (folded on the sides)
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(ellipsoid(0.5, bx * 0.95, by * 0.55, 0.18, 1), mat(wingC));
    wing.position.set(-0.08, 0.06, s * bz * 0.5);
    wing.rotation.z = pitch * 0.9; wing.rotation.y = s * 0.08;
    bird.add(wing);
  }
  // tail
  const tailLen = 0.35 * shape.tail;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(tailLen, 0.05, 0.28 + 0.06 * shape.tail), mat(opts.tailC || wingC));
  const tailBase = new THREE.Vector3(-0.6 * bx * Math.cos(pitch) * 0.8, -0.6 * bx * Math.sin(pitch) * 0.8, 0);
  tail.position.copy(tailBase).add(new THREE.Vector3(-tailLen / 2 * Math.cos(pitch), -tailLen / 2 * Math.sin(pitch), 0));
  tail.rotation.z = pitch;
  bird.add(tail);

  // legs
  let feetY = -0.6 * by * 0.95;
  if (shape.legs > 0 && pose !== 'swim') {
    const legLen = 0.18 + shape.legs * 0.3;
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, legLen, 5), mat(legC));
      leg.position.set(0.02, feetY - legLen / 2 + 0.05, s * 0.14);
      bird.add(leg);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.025, 0.06), mat(legC));
      foot.position.set(0.07, feetY - legLen + 0.06, s * 0.14);
      bird.add(foot);
    }
    feetY = feetY - legLen + 0.05;
  }

  // centre and scale to a standard size
  const box = new THREE.Box3().setFromObject(bird);
  const size = box.getSize(new THREE.Vector3());
  const scale = 2.2 / Math.max(size.x, size.y);
  bird.scale.setScalar(scale);
  const center = box.getCenter(new THREE.Vector3());
  bird.position.set(-center.x * scale, -box.min.y * scale - 1.1, -center.z * scale);
  return { bird, pose, groundY: -1.1 };
}

function stage(pose, groundY) {
  const g = new THREE.Group();
  if (pose === 'swim') {
    const water = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.06, 28), mat('#3a7ab8', { transparent: true, opacity: 0.8, roughness: 0.2 }));
    water.position.y = groundY + 0.35; g.add(water);
  } else if (pose === 'perch' || pose === 'upright') {
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 3.2, 7), mat('#6b4a2f'));
    branch.rotation.x = Math.PI / 2; branch.rotation.y = 0.2; branch.position.y = groundY - 0.06; g.add(branch);
  } else {
    const ground = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.7, 0.12, 24), mat(pose === 'wade' ? '#c9b48a' : '#6f8f4e'));
    ground.position.y = groundY - 0.06; g.add(ground);
  }
  return g;
}

// Mount a spinnable 3D bird into a container. Returns a dispose function.
export function mountBird(container, sp) {
  const w = container.clientWidth, h = container.clientHeight || w * 0.75;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.setSize(w, h);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 50);
  // In a tall frame (the species hero) the name sits over the foot of the picture, so stand back a little and
  // aim lower, which lifts the bird into the clear middle.
  const frame = (W, H) => {
    const tall = H > W * 1.1;
    camera.aspect = W / H;
    camera.position.set(0, 0.5, tall ? 8.4 : 7.4);
    camera.lookAt(0, tall ? -0.95 : -0.35, 0);
    camera.updateProjectionMatrix();
  };
  frame(w, h);
  scene.add(new THREE.HemisphereLight('#ffffff', '#5a6b5f', 1.6));
  const sun = new THREE.DirectionalLight('#fff3dd', 2.2); sun.position.set(3, 5, 4); scene.add(sun);
  const rim = new THREE.DirectionalLight('#9fc2ff', 0.8); rim.position.set(-4, 2, -3); scene.add(rim);
  const { bird, pose, groundY } = buildBird(sp);
  const rig = new THREE.Group();
  rig.add(stage(pose, groundY));
  rig.add(bird);
  scene.add(rig);
  rig.rotation.y = -0.6;

  let dragging = false, lastX = 0, vel = 0.004, raf;
  const el = renderer.domElement;
  el.style.touchAction = 'pan-y';
  el.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', e => { if (!dragging) return; const dx = e.clientX - lastX; lastX = e.clientX; rig.rotation.y += dx * 0.012; vel = dx * 0.0006; });
  el.addEventListener('pointerup', () => { dragging = false; });
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Only draw while it can be seen: scrolled away, the loop stops (and the battery rests) until it is back.
  let visible = true;
  const loop = () => {
    if (!visible) { raf = 0; return; }
    if (!dragging) { rig.rotation.y += reduce ? 0 : vel; vel += (0.004 - vel) * 0.02; }
    if (!reduce) bird.position.y += Math.sin(performance.now() / 600) * 0.0006;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  const seen = 'IntersectionObserver' in window ? new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) loop(); }) : null;
  seen?.observe(container);
  // Keep the picture sharp and in proportion if the frame changes size (rotation, a resized window).
  const ro = 'ResizeObserver' in window ? new ResizeObserver(() => {
    const W = container.clientWidth, H = container.clientHeight;
    if (!W || !H) return;
    renderer.setSize(W, H); frame(W, H);
    if (!raf) renderer.render(scene, camera);
  }) : null;
  ro?.observe(container);
  loop();
  return () => {
    seen?.disconnect(); ro?.disconnect();
    cancelAnimationFrame(raf);
    scene.traverse(o => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach(m => m.dispose()); });
    // Give the WebGL context back now rather than at garbage collection, or browsing many species runs out of them.
    renderer.forceContextLoss();
    renderer.dispose();
    el.remove();
  };
}
