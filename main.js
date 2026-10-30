import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as R from './rules.js';
import { Sound } from './audio.js';

/* ════════════════════════════════════════════════════════════════════
   Palette & Maße
   ════════════════════════════════════════════════════════════════════ */

const C = (hex) => new THREE.Color(hex);

const PAL = {
  sky: ['#d29d93', '#e4b09f', '#b88994', '#6b5b7b', '#2f2845'],
  fog: '#cf9f9a',
  stoneLight: '#ecdcc8',
  stoneDark: '#d6baa2',
  frame: '#cfab95',
  frameDark: '#b48d82',
  trim: '#e6c9b4',
  plinth: ['#c4978c', '#a57e88', '#836780', '#5a4b6c'],
  arch: '#6a5170',
  zone: ['#c98b7b', '#8ba3a8'],
  piece: ['#c47d6b', '#7d9ea8'],
  canalDeep: '#557f83',
  canal: '#7fa9a6',
  foam: '#e3eee6',
  accent: '#f2d7a6',
  ink: '#4a3c5e',
  coral: '#a9463d',
  teal: '#2f6c68',
  cloudA: '#f1cdbd',
  cloudB: '#c4959d',
};

const PIECE_NAME = { 1: 'Bauer', 2: 'Drohne', 3: 'Königin' };
const THIS_PIECE = { 1: 'Dieser Bauer', 2: 'Diese Drohne', 3: 'Diese Königin' };
const DEFAULT_NAMES = ['Spieler 1', 'Spieler 2'];
const ZONE_CSS = ['#eaae9a', '#b0cdcf'];

const TILE = 1;
const CANAL = 0.46;
const MARGIN = 0.26;
const HALF_W = 4 * TILE + CANAL / 2 + MARGIN;
const HALF_D = 2 * TILE + MARGIN;
const VAULT_X = HALF_W + 1.38;
const VAULT_Y = -0.3;
const VAULT_SCALE = 0.6;
const TOP = 0.02;

const tileX = (x) => (x - 3.5) * TILE + (x < 4 ? -CANAL / 2 : CANAL / 2);
const tileZ = (y) => (1.5 - y) * TILE;
const tilePos = (i) => {
  const [x, y] = R.xy(i);
  return new THREE.Vector3(tileX(x), TOP, tileZ(y));
};
const vaultPos = (p, k) => {
  const s = p === 0 ? -1 : 1;
  const col = k % 3;
  const row = Math.floor(k / 3);
  return new THREE.Vector3(s * (VAULT_X - 0.46 + col * 0.46), VAULT_Y + 0.03, -1.4 + row * 0.56);
};
const lampCenter = (p) => new THREE.Vector3((p === 0 ? -1 : 1) * (VAULT_X + 0.64), VAULT_Y + 1.45, 0);

/* ════════════════════════════════════════════════════════════════════
   Hilfsfunktionen
   ════════════════════════════════════════════════════════════════════ */

const ease = {
  linear: (k) => k,
  inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  out: (k) => 1 - Math.pow(1 - k, 3),
  in: (k) => k * k * k,
  outQuart: (k) => 1 - Math.pow(1 - k, 4),
  outBack: (k) => {
    const c1 = 1.5;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
  },
};
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
const rand = (a, b) => a + Math.random() * (b - a);

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const tweens = new Set();
function tween(duration, onUpdate, easing = ease.inOut, delay = 0) {
  return new Promise((resolve) => {
    tweens.add({ t: -delay, duration, onUpdate, easing, resolve });
  });
}
function updateTweens(dt) {
  for (const tw of tweens) {
    tw.t += dt;
    if (tw.t < 0) continue;
    const k = Math.min(tw.t / tw.duration, 1);
    tw.onUpdate(tw.easing(k), k);
    if (k >= 1) {
      tweens.delete(tw);
      tw.resolve();
    }
  }
}
const wait = (s) => tween(s, () => {}, ease.linear);

function storeGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function storeSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* egal */
  }
}

/* ════════════════════════════════════════════════════════════════════
   Renderer, Szenen, Kameras
   ════════════════════════════════════════════════════════════════════ */

const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  document.getElementById('nogl').hidden = false;
  document.getElementById('fade').classList.add('gone');
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(C(PAL.fog), 30, 85);
const camera = new THREE.PerspectiveCamera(24, window.innerWidth / window.innerHeight, 0.1, 400);

const bgScene = new THREE.Scene();
const bgCamera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 1000);

const sound = new Sound();
let time = 0;

/* ════════════════════════════════════════════════════════════════════
   Shader-Bausteine
   ════════════════════════════════════════════════════════════════════ */

const NOISE = /* glsl */ `
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
    return v;
  }
`;
const OUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;
const BASIC_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

/* ════════════════════════════════════════════════════════════════════
   Hintergrund: Himmel, Planet, Monde, Sternschnuppen
   ════════════════════════════════════════════════════════════════════ */

const bgUniforms = {
  uTime: { value: 0 },
  uAspect: { value: 1 },
  uPar: { value: new THREE.Vector2() },
  uC0: { value: C(PAL.sky[0]) },
  uC1: { value: C(PAL.sky[1]) },
  uC2: { value: C(PAL.sky[2]) },
  uC3: { value: C(PAL.sky[3]) },
  uC4: { value: C(PAL.sky[4]) },
  uNeb: { value: C('#9ab8bb') },
  uNeb2: { value: C('#e0a6ae') },
};

const sky = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({
    uniforms: bgUniforms,
    depthWrite: false,
    depthTest: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uAspect; uniform vec2 uPar;
      uniform vec3 uC0, uC1, uC2, uC3, uC4, uNeb, uNeb2;
      varying vec2 vUv;
      ${NOISE}
      void main() {
        vec2 uv = vUv + uPar * vec2(0.006, 0.012);
        float y = uv.y;
        vec3 col = mix(uC0, uC1, smoothstep(0.0, 0.36, y));
        col = mix(col, uC2, smoothstep(0.36, 0.6, y));
        col = mix(col, uC3, smoothstep(0.56, 0.84, y));
        col = mix(col, uC4, smoothstep(0.8, 1.1, y));

        float glow = exp(-pow((y - 0.44) * 4.2, 2.0)) * (1.0 - 0.55 * pow(abs(uv.x - 0.5) * 2.0, 2.0));
        col = mix(col, uC1 * 1.12, glow * 0.4);

        vec2 p = vec2(uv.x * uAspect, y);
        float n = fbm(p * 1.5 + vec2(uTime * 0.006, 0.0));
        float n2 = fbm(p * 3.0 + n * 1.8 - vec2(0.0, uTime * 0.004));
        float neb = smoothstep(0.48, 0.92, n2) * smoothstep(0.5, 0.95, y);
        col = mix(col, mix(uNeb, uNeb2, n), neb * 0.3);

        vec2 sp = p * 150.0;
        vec2 cell = floor(sp);
        float h = hash(cell);
        float star = 0.0;
        if (h > 0.972) {
          vec2 off = vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5;
          float d = length(fract(sp) - 0.5 - off * 0.5);
          float tw = 0.5 + 0.5 * sin(uTime * (0.5 + h * 2.0) + h * 60.0);
          star = smoothstep(0.16, 0.0, d) * mix(0.3, 1.0, tw) * ((h - 0.972) / 0.028);
        }
        vec2 sp2 = p * 24.0;
        vec2 c2 = floor(sp2);
        float h2 = hash(c2 + 11.0);
        if (h2 > 0.982) {
          vec2 o2 = vec2(hash(c2 + 1.7), hash(c2 + 5.3)) - 0.5;
          float d2 = length(fract(sp2) - 0.5 - o2 * 0.6);
          float tw2 = 0.6 + 0.4 * sin(uTime * 0.7 + h2 * 90.0);
          star += (smoothstep(0.05, 0.0, d2) + smoothstep(0.22, 0.0, d2) * 0.12) * tw2;
        }
        star *= smoothstep(0.5, 0.9, y) * (1.0 - neb * 0.5);
        col += vec3(1.0, 0.93, 0.85) * star * 0.75;

        gl_FragColor = vec4(col, 1.0);
        ${OUT}
        gl_FragColor.rgb += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;
      }
    `,
  })
);
sky.frustumCulled = false;
sky.renderOrder = -10;
bgScene.add(sky);

function bodyMaterial({ a, b, c, shadow, rim, bands, haze, hazeCol, speed = 0.01 }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uA: { value: C(a) },
      uB: { value: C(b) },
      uC: { value: C(c) },
      uShadow: { value: C(shadow) },
      uRim: { value: C(rim) },
      uHazeCol: { value: C(hazeCol) },
      uHaze: { value: haze },
      uBands: { value: bands },
      uSpeed: { value: speed },
      uLight: { value: new THREE.Vector3(-0.78, 0.38, 0.5).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vP; varying vec3 vV;
      void main() {
        vP = normalize(position);
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uHaze, uBands, uSpeed;
      uniform vec3 uA, uB, uC, uShadow, uRim, uHazeCol, uLight;
      varying vec3 vN; varying vec3 vP; varying vec3 vV;
      ${NOISE}
      void main() {
        vec3 n = normalize(vN);
        float lat = vP.y;
        float lon = atan(vP.z, vP.x);
        float t = lat * uBands + fbm(vec2(lon * 1.3 + uTime * uSpeed, lat * 5.0)) * 1.6;
        float band = 0.5 + 0.5 * sin(t * 3.14159);
        vec3 base = mix(uA, uB, band);
        base = mix(base, uC, smoothstep(0.55, 0.85, fbm(vec2(lon * 2.2 - uTime * uSpeed * 0.6, lat * 13.0))) * 0.45);
        float l = dot(n, uLight);
        float lit = smoothstep(-0.18, 0.6, l);
        vec3 col = mix(uShadow, base, lit);
        float rim = pow(1.0 - max(dot(n, normalize(vV)), 0.0), 2.6);
        col += uRim * rim * (0.2 + 0.8 * smoothstep(-0.35, 0.5, l)) * 0.55;
        col = mix(col, uHazeCol, uHaze);
        gl_FragColor = vec4(col, 1.0);
        ${OUT}
      }
    `,
  });
}

const planet = new THREE.Group();
const planetBody = new THREE.Mesh(
  new THREE.SphereGeometry(6.2, 96, 64),
  bodyMaterial({ a: '#dcc0b6', b: '#b8939b', c: '#93aeb0', shadow: '#5b4a6c', rim: '#f6cbb2', bands: 4.5, haze: 0.18, hazeCol: '#b88994' })
);
planetBody.rotation.z = 0.32;
planet.add(planetBody);

const ringMat = new THREE.ShaderMaterial({
  uniforms: { uInner: { value: 8.0 }, uOuter: { value: 13.5 }, uCol: { value: C('#ecd3c4') }, uCol2: { value: C('#b896a0') } },
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  vertexShader: /* glsl */ `
    varying float vR;
    void main() { vR = length(position.xy); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform float uInner, uOuter; uniform vec3 uCol, uCol2;
    varying float vR;
    void main() {
      float t = (vR - uInner) / (uOuter - uInner);
      float bands = 0.5 + 0.5 * sin(t * 46.0) * sin(t * 13.0 + 1.3);
      float a = smoothstep(0.0, 0.05, t) * smoothstep(1.0, 0.82, t) * (0.3 + 0.45 * bands);
      a *= 1.0 - 0.85 * smoothstep(0.5, 0.53, t) * smoothstep(0.6, 0.57, t);
      vec3 col = mix(uCol2, uCol, bands);
      gl_FragColor = vec4(col, a * 0.7);
      ${OUT}
    }
  `,
});
const ring = new THREE.Mesh(new THREE.RingGeometry(8, 13.5, 160, 1), ringMat);
ring.rotation.set(-1.22, 0.18, 0.32);
planet.add(ring);
bgScene.add(planet);

const moon1 = new THREE.Mesh(
  new THREE.SphereGeometry(1.25, 48, 32),
  bodyMaterial({ a: '#efe1d3', b: '#d8c6bb', c: '#c4b2b4', shadow: '#5d4c6d', rim: '#ffe2cc', bands: 1.2, haze: 0.22, hazeCol: '#8d7590', speed: 0.002 })
);
const moon2 = new THREE.Mesh(
  new THREE.SphereGeometry(0.55, 32, 24),
  bodyMaterial({ a: '#c9d6d3', b: '#a9bab9', c: '#e3d5c9', shadow: '#5d4c6d', rim: '#e6f2ee', bands: 1.0, haze: 0.25, hazeCol: '#8d7590', speed: 0.002 })
);
bgScene.add(moon1, moon2);

const shootMat = new THREE.ShaderMaterial({
  uniforms: { uA: { value: 0 } },
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform float uA; varying vec2 vUv;
    void main(){
      float a = pow(vUv.x, 4.0) * (1.0 - abs(vUv.y - 0.5) * 2.0) * uA;
      gl_FragColor = vec4(vec3(1.0, 0.94, 0.86) * a, a);
    }
  `,
});
const shootingStar = new THREE.Mesh(new THREE.PlaneGeometry(7, 0.07), shootMat);
shootingStar.visible = false;
bgScene.add(shootingStar);
let nextShoot = rand(8, 16);

function placeAtNDC(obj, nx, ny, dist) {
  bgCamera.updateMatrixWorld();
  const dir = new THREE.Vector3(nx, ny, 0.5).unproject(bgCamera).sub(bgCamera.position).normalize();
  obj.position.copy(bgCamera.position).addScaledVector(dir, dist);
}

function layoutBackground() {
  bgCamera.position.set(0, 0, 0);
  bgCamera.rotation.set(0, 0, 0);
  bgCamera.updateProjectionMatrix();
  const narrow = bgCamera.aspect < 1.3;
  placeAtNDC(planet, narrow ? 0.45 : 0.6, 0.6, 78);
  placeAtNDC(moon1, narrow ? -0.62 : -0.66, 0.72, 70);
  placeAtNDC(moon2, narrow ? -0.5 : -0.56, 0.6, 72);
}

function spawnShootingStar() {
  const sx = rand(-0.9, 0.5);
  const sy = rand(0.55, 0.92);
  placeAtNDC(shootingStar, sx, sy, 90);
  const angle = -rand(0.25, 0.6);
  shootingStar.rotation.set(0, 0, angle);
  const dir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
  const start = shootingStar.position.clone();
  shootingStar.visible = true;
  tween(1.1, (e, k) => {
    shootingStar.position.copy(start).addScaledVector(dir, k * 26);
    shootMat.uniforms.uA.value = Math.sin(Math.PI * k) * 0.9;
  }, ease.linear).then(() => (shootingStar.visible = false));
}

/* ════════════════════════════════════════════════════════════════════
   Licht
   ════════════════════════════════════════════════════════════════════ */

const hemi = new THREE.HemisphereLight(C('#ffe7dc'), C('#7a6487'), 1.35);
scene.add(hemi);

const sun = new THREE.DirectionalLight(C('#ffe6cf'), 2.3);
sun.position.set(-7, 12, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -9;
sun.shadow.camera.right = 9;
sun.shadow.camera.top = 7;
sun.shadow.camera.bottom = -7;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 40;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);

const rimLight = new THREE.DirectionalLight(C('#b5cfe2'), 0.7);
rimLight.position.set(7, 5, -9);
scene.add(rimLight);

/* ════════════════════════════════════════════════════════════════════
   Texturen (prozedural)
   ════════════════════════════════════════════════════════════════════ */

function canvasTex(draw, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const TEX = {
  glow: canvasTex((g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.18, 'rgba(255,255,255,0.55)');
    gr.addColorStop(0.45, 'rgba(255,255,255,0.12)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  }),
  dot: canvasTex((g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.55, 'rgba(255,255,255,0.95)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  }),
  hollow: canvasTex((g, s) => {
    g.strokeStyle = 'white';
    g.lineWidth = s * 0.035;
    g.shadowColor = 'white';
    g.shadowBlur = s * 0.02;
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.105, 0, Math.PI * 2);
    g.stroke();
  }),
  ring: canvasTex((g, s) => {
    g.strokeStyle = 'white';
    g.shadowColor = 'white';
    g.shadowBlur = s * 0.03;
    g.lineWidth = s * 0.03;
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = s * 0.012;
    g.globalAlpha = 0.6;
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.45, 0, Math.PI * 2);
    g.stroke();
  }),
  merge: canvasTex((g, s) => {
    g.strokeStyle = 'white';
    g.fillStyle = 'white';
    g.shadowColor = 'white';
    g.shadowBlur = s * 0.03;
    g.lineWidth = s * 0.026;
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.41, 0, Math.PI * 2);
    g.stroke();
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + Math.PI / 4;
      const r = s * 0.41;
      g.save();
      g.translate(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r);
      g.rotate(Math.PI / 4);
      g.fillRect(-s * 0.025, -s * 0.025, s * 0.05, s * 0.05);
      g.restore();
    }
  }),
  cross: canvasTex((g, s) => {
    g.strokeStyle = 'white';
    g.lineWidth = s * 0.03;
    g.lineCap = 'round';
    const r = s * 0.11;
    g.beginPath();
    g.moveTo(s / 2 - r, s / 2 - r);
    g.lineTo(s / 2 + r, s / 2 + r);
    g.moveTo(s / 2 + r, s / 2 - r);
    g.lineTo(s / 2 - r, s / 2 + r);
    g.stroke();
  }),
  square: canvasTex((g, s) => {
    g.strokeStyle = 'white';
    g.shadowColor = 'white';
    g.shadowBlur = s * 0.025;
    g.lineWidth = s * 0.028;
    const m = s * 0.075;
    const r = s * 0.08;
    g.beginPath();
    g.roundRect(m, m, s - 2 * m, s - 2 * m, r);
    g.stroke();
  }),
  fill: canvasTex((g, s) => {
    g.fillStyle = 'white';
    g.shadowColor = 'white';
    g.shadowBlur = s * 0.05;
    const m = s * 0.09;
    g.beginPath();
    g.roundRect(m, m, s - 2 * m, s - 2 * m, s * 0.07);
    g.fill();
  }),
  ripple: canvasTex((g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.7, 'rgba(255,255,255,0.8)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  }),
};

/* ════════════════════════════════════════════════════════════════════
   Plateau & Spielbrett
   ════════════════════════════════════════════════════════════════════ */

const gradMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 });

function gradientize(geo, top, bottom, yTop, yBottom) {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cT = C(top);
  const cB = C(bottom);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp((pos.getY(i) - yBottom) / (yTop - yBottom), 0, 1);
    c.copy(cB).lerp(cT, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function block(w, h, d, x, yTop, z, top, bottom, parent, shadows = true) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, yTop - h / 2, z);
  gradientize(g, top, bottom, yTop, yTop - h);
  const m = new THREE.Mesh(g, gradMat);
  m.receiveShadow = shadows;
  parent.add(m);
  return m;
}

function spike(w, d, yTop, depth, x, z, top, bottom, parent) {
  const g = new THREE.ConeGeometry(Math.SQRT1_2, depth, 4, 3);
  g.rotateY(Math.PI / 4);
  g.rotateX(Math.PI);
  g.scale(w, 1, d);
  g.translate(x, yTop - depth / 2, z);
  gradientize(g, top, bottom, yTop, yTop - depth);
  const m = new THREE.Mesh(g, gradMat);
  parent.add(m);
  return m;
}

function archShape(w, h) {
  const s = new THREE.Shape();
  const r = w / 2;
  s.moveTo(-r, 0);
  s.lineTo(-r, h - r);
  s.absarc(0, h - r, r, Math.PI, 0, true);
  s.lineTo(r, 0);
  s.lineTo(-r, 0);
  return s;
}

const world = new THREE.Group();
scene.add(world);
const board = new THREE.Group();
world.add(board);

// Rahmen links und rechts des Kanals
const frameW = HALF_W - CANAL / 2;
for (const s of [-1, 1]) {
  block(frameW, 0.5, HALF_D * 2, s * (CANAL / 2 + frameW / 2), -0.04, 0, PAL.frame, PAL.frameDark, board);
}
// Kanalbett
block(CANAL, 0.32, HALF_D * 2, 0, -0.23, 0, '#6f8d8c', '#5b7277', board);

// gestufter Sockel
block(HALF_W * 2 - 0.34, 0.07, HALF_D * 2 - 0.34, 0, -0.54, 0, PAL.trim, PAL.trim, board);
block(HALF_W * 2 - 0.52, 0.8, HALF_D * 2 - 0.52, 0, -0.61, 0, PAL.plinth[0], PAL.plinth[1], board);
block(HALF_W * 2 - 1.24, 0.06, HALF_D * 2 - 1.04, 0, -1.41, 0, PAL.trim, '#d9b6a6', board);
block(HALF_W * 2 - 1.44, 1.0, HALF_D * 2 - 1.24, 0, -1.47, 0, PAL.plinth[1], PAL.plinth[2], board);
spike(HALF_W * 2 - 2.3, HALF_D * 2 - 1.9, -2.47, 5.2, 0, 0, PAL.plinth[2], PAL.plinth[3], board);

// Torbögen in der Sockelwand – zwei davon glimmen
const archMat = new THREE.MeshBasicMaterial({ color: C(PAL.arch), fog: true });
const archGlowMat = new THREE.MeshBasicMaterial({ color: C('#f5d2a8'), transparent: true, opacity: 0.55 });
const archGeo = new THREE.ShapeGeometry(archShape(0.24, 0.5), 12);
const archFrontZ = HALF_D - 0.26 + 0.004;
const glowArches = [];
[-3.9, -2.85, -1.8, -0.75, 0.75, 1.8, 2.85, 3.9].forEach((x, k) => {
  const glowing = k === 1 || k === 6;
  const m = new THREE.Mesh(archGeo, glowing ? archGlowMat : archMat);
  m.position.set(x, -1.27, archFrontZ);
  board.add(m);
  if (glowing) glowArches.push(m);
});
const smallArchGeo = new THREE.ShapeGeometry(archShape(0.14, 0.32), 10);
[-2.6, -1.3, 1.3, 2.6].forEach((x) => {
  const m = new THREE.Mesh(smallArchGeo, archMat);
  m.position.set(x, -2.2, HALF_D - 0.62 + 0.004);
  board.add(m);
});

// Felder
const tileGeo = new RoundedBoxGeometry(0.93, 0.22, 0.93, 2, 0.04);
const tileMats = [0, 1].map((z) => [
  new THREE.MeshStandardMaterial({ color: C(PAL.stoneLight).lerp(C(PAL.zone[z]), z ? 0.13 : 0.11), roughness: 0.92, emissive: C(PAL.accent), emissiveIntensity: 0 }),
  new THREE.MeshStandardMaterial({ color: C(PAL.stoneDark).lerp(C(PAL.zone[z]), z ? 0.24 : 0.2), roughness: 0.92, emissive: C(PAL.accent), emissiveIntensity: 0 }),
]);
const tiles = [];
for (let i = 0; i < R.W * R.H; i++) {
  const [x, y] = R.xy(i);
  const z = R.zoneOf(i);
  const m = new THREE.Mesh(tileGeo, tileMats[z][(x + y) % 2]);
  m.position.set(tileX(x), TOP - 0.11, tileZ(y));
  m.receiveShadow = true;
  m.castShadow = true;
  m.userData.idx = i;
  tiles.push(m);
  board.add(m);
}

// Wasser im Kanal
const waterUniforms = {
  uTime: { value: 0 },
  uDeep: { value: C(PAL.canalDeep) },
  uLight: { value: C(PAL.canal) },
  uFoam: { value: C(PAL.foam) },
};
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(CANAL, HALF_D * 2, 1, 1).rotateX(-Math.PI / 2),
  new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: BASIC_VERT,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uDeep, uLight, uFoam;
      varying vec2 vUv;
      ${NOISE}
      void main() {
        float flow = abs(vUv.y - 0.5) * 2.0;
        float n = fbm(vec2(vUv.x * 3.0, flow * 9.0 - uTime * 0.5));
        float streak = smoothstep(0.58, 0.82, fbm(vec2(vUv.x * 7.0, flow * 26.0 - uTime * 1.2)));
        float edge = 1.0 - smoothstep(0.0, 0.3, min(vUv.x, 1.0 - vUv.x));
        vec3 col = mix(uDeep, uLight, n * 0.75 + 0.1);
        col = mix(col, uDeep * 0.8, edge * 0.5);
        col = mix(col, uFoam, streak * 0.4);
        gl_FragColor = vec4(col, 1.0);
        ${OUT}
      }
    `,
  })
);
water.position.set(0, -0.19, 0);
board.add(water);

// Wasserfälle an beiden Enden des Kanals
const fallMat = new THREE.ShaderMaterial({
  uniforms: waterUniforms,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  vertexShader: BASIC_VERT,
  fragmentShader: /* glsl */ `
    uniform float uTime; uniform vec3 uDeep, uLight, uFoam;
    varying vec2 vUv;
    ${NOISE}
    void main() {
      float fall = 1.0 - vUv.y;
      float n = fbm(vec2(vUv.x * 4.0, fall * 5.0 - uTime * 1.6));
      float streak = smoothstep(0.42, 0.85, fbm(vec2(vUv.x * 12.0, fall * 2.5 - uTime * 2.2)));
      vec3 col = mix(uDeep, uLight, n);
      col = mix(col, uFoam, streak * 0.55 + smoothstep(0.05, 0.0, fall) * 0.5);
      float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
      float a = edge * (1.0 - smoothstep(0.25, 1.0, fall)) * (0.7 + 0.3 * n);
      gl_FragColor = vec4(col, a * 0.92);
      ${OUT}
    }
  `,
});
for (const s of [1, -1]) {
  const f = new THREE.Mesh(new THREE.PlaneGeometry(CANAL - 0.03, 6.5), fallMat);
  f.position.set(0, -0.19 - 3.25, s * (HALF_D + 0.012));
  if (s < 0) f.rotation.y = Math.PI;
  board.add(f);
}

// Schatzkammern (gefangene Figuren) mit Laternen
const lamps = [[], []];
const lampLevel = [0.15, 0.15];
const lampTarget = [0.15, 0.15];
const lampDim = C('#8f7473');
const lampBright = C('#fff0d0');

for (const p of [0, 1]) {
  const s = p === 0 ? -1 : 1;
  const cx = s * VAULT_X;
  const vault = new THREE.Group();
  world.add(vault);
  block(1.78, 0.36, 3.72, cx, VAULT_Y, 0, PAL.frame, PAL.frameDark, vault);
  const plate = new THREE.Mesh(
    new RoundedBoxGeometry(1.56, 0.06, 3.5, 2, 0.02),
    new THREE.MeshStandardMaterial({ color: C(PAL.stoneLight).lerp(C(PAL.zone[p]), 0.3), roughness: 0.95 })
  );
  plate.position.set(cx, VAULT_Y, 0);
  plate.receiveShadow = true;
  vault.add(plate);
  block(1.4, 0.05, 3.3, cx, VAULT_Y - 0.36, 0, PAL.trim, PAL.trim, vault);
  block(1.26, 0.62, 3.1, cx, VAULT_Y - 0.41, 0, PAL.plinth[0], PAL.plinth[1], vault);
  spike(1.0, 2.6, VAULT_Y - 1.03, 3.4, cx, 0, PAL.plinth[1], PAL.plinth[3], vault);
  const arch = new THREE.Mesh(smallArchGeo, archMat);
  arch.position.set(cx, VAULT_Y - 0.98, 1.55 + 0.004);
  vault.add(arch);

  // kleine Treppe zum Brett
  const innerEdge = s * HALF_W;
  for (let k = 0; k < 3; k++) {
    const w = 0.2;
    const x = innerEdge + s * (0.1 + k * 0.2);
    block(w, 0.12, 0.9, x, -0.1 - k * 0.075, 0, PAL.frame, PAL.frameDark, vault);
  }

  // Obelisken mit Laternen
  for (const z of [-1.55, 1.55]) {
    const x = cx + s * 0.64;
    const g = new THREE.CylinderGeometry(0.045, 0.085, 1.22, 4, 1);
    g.rotateY(Math.PI / 4);
    g.translate(x, VAULT_Y + 0.61, z);
    gradientize(g, PAL.trim, PAL.frameDark, VAULT_Y + 1.22, VAULT_Y);
    const pillar = new THREE.Mesh(g, gradMat);
    pillar.castShadow = true;
    vault.add(pillar);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.16), new THREE.MeshStandardMaterial({ color: C(PAL.trim), roughness: 1 }));
    cap.position.set(x, VAULT_Y + 1.24, z);
    vault.add(cap);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 14), new THREE.MeshBasicMaterial({ color: lampDim.clone(), fog: false }));
    orb.position.set(x, VAULT_Y + 1.36, z);
    vault.add(orb);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: C('#ffd9a8'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, fog: false }));
    halo.position.copy(orb.position);
    halo.scale.setScalar(0.9);
    vault.add(halo);
    lamps[p].push({ orb, halo, phase: Math.random() * 10 });
  }
}

/* ════════════════════════════════════════════════════════════════════
   Atmosphäre: Wolkenmeer, schwebende Inseln, Staub
   ════════════════════════════════════════════════════════════════════ */

function cloudLayer(y, threshold, maxAlpha, scale, speed) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uA: { value: C(PAL.cloudA) }, uB: { value: C(PAL.cloudB) } },
    transparent: true,
    depthWrite: false,
    vertexShader: BASIC_VERT,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uA, uB;
      varying vec3 vWorld;
      ${NOISE}
      void main() {
        vec2 p = vWorld.xz * ${scale.toFixed(3)};
        float n = fbm(p + vec2(uTime * ${speed.toFixed(4)}, uTime * ${(speed * 0.4).toFixed(4)}));
        float n2 = fbm(p * 2.2 - vec2(uTime * ${(speed * 0.7).toFixed(4)}, 0.0) + n);
        float c = smoothstep(${threshold.toFixed(2)}, ${(threshold + 0.38).toFixed(2)}, n * 0.65 + n2 * 0.45);
        float d = length(vWorld.xz * vec2(0.75, 1.0) - vec2(0.0, -3.0));
        float fade = 1.0 - smoothstep(9.0, 28.0, d);
        vec3 col = mix(uB, uA, c * 0.85 + n2 * 0.15);
        gl_FragColor = vec4(col, c * fade * ${maxAlpha.toFixed(2)});
        ${OUT}
      }
    `,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(130, 130).rotateX(-Math.PI / 2), mat);
  m.position.y = y;
  m.renderOrder = -1;
  scene.add(m);
  return mat;
}
const clouds = [cloudLayer(-5.2, 0.32, 0.92, 0.055, 0.012), cloudLayer(-3.4, 0.5, 0.5, 0.08, 0.018)];

function makeIsland(seed, r, depth, decor) {
  const rnd = seeded(seed);
  const g = new THREE.Group();
  const top = new THREE.CylinderGeometry(r, r * 0.94, r * 0.32, 7, 1);
  top.translate(0, -r * 0.16, 0);
  gradientize(top, PAL.frame, PAL.plinth[0], 0, -r * 0.32);
  const bottom = new THREE.ConeGeometry(r * 0.94, depth, 7, 3);
  bottom.rotateX(Math.PI);
  bottom.translate(0, -r * 0.32 - depth / 2, 0);
  const pos = bottom.attributes.position;
  const jitter = new Map();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > -r * 0.32 - 0.01) continue;
    const key = `${pos.getX(i).toFixed(3)},${y.toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!jitter.has(key)) jitter.set(key, 0.78 + rnd() * 0.4);
    const j = jitter.get(key);
    pos.setX(i, pos.getX(i) * j);
    pos.setZ(i, pos.getZ(i) * j);
  }
  gradientize(bottom, PAL.plinth[0], PAL.plinth[3], -r * 0.32, -r * 0.32 - depth);
  g.add(new THREE.Mesh(top, gradMat), new THREE.Mesh(bottom, gradMat));

  if (decor === 'tower') {
    const t = new THREE.CylinderGeometry(r * 0.16, r * 0.2, r * 1.1, 6);
    t.translate(r * 0.2, r * 0.55, -r * 0.1);
    gradientize(t, PAL.trim, PAL.frameDark, r * 1.1, 0);
    const roof = new THREE.ConeGeometry(r * 0.24, r * 0.4, 6);
    roof.translate(r * 0.2, r * 1.3, -r * 0.1);
    gradientize(roof, PAL.plinth[0], PAL.plinth[1], r * 1.5, r * 1.1);
    g.add(new THREE.Mesh(t, gradMat), new THREE.Mesh(roof, gradMat));
  } else if (decor === 'arch') {
    const h = r * 0.8;
    for (const sx of [-1, 1]) {
      const p = new THREE.BoxGeometry(r * 0.16, h, r * 0.16);
      p.translate(sx * r * 0.32, h / 2, 0);
      gradientize(p, PAL.trim, PAL.frameDark, h, 0);
      g.add(new THREE.Mesh(p, gradMat));
    }
    const beam = new THREE.BoxGeometry(r * 0.84, r * 0.14, r * 0.2);
    beam.translate(0, h + r * 0.07, 0);
    gradientize(beam, PAL.trim, PAL.frame, h + r * 0.14, h);
    g.add(new THREE.Mesh(beam, gradMat));
  } else if (decor === 'pyramid') {
    const p = new THREE.ConeGeometry(r * 0.45, r * 0.7, 4);
    p.rotateY(Math.PI / 4);
    p.translate(0, r * 0.35, 0);
    gradientize(p, PAL.trim, PAL.frameDark, r * 0.7, 0);
    g.add(new THREE.Mesh(p, gradMat));
  }
  return g;
}

const islands = [
  { seed: 3, r: 1.5, depth: 3.0, decor: 'tower', pos: [-17, -3.2, -24] },
  { seed: 7, r: 0.9, depth: 1.8, decor: 'pyramid', pos: [-9, -8.5, -38] },
  { seed: 11, r: 1.8, depth: 3.6, decor: 'arch', pos: [18, -4.2, -26] },
  { seed: 19, r: 0.7, depth: 1.4, decor: null, pos: [12, -9.5, -40] },
  { seed: 23, r: 1.0, depth: 2.2, decor: null, pos: [-21, -6.5, -8] },
  { seed: 29, r: 1.1, depth: 2.4, decor: 'pyramid', pos: [22, -5.6, -8] },
].map((d) => {
  const m = makeIsland(d.seed, d.r, d.depth, d.decor);
  m.position.set(...d.pos);
  m.rotation.y = d.seed;
  m.userData = { base: d.pos[1], phase: d.seed * 0.7, spin: (d.seed % 2 ? 1 : -1) * 0.02 };
  scene.add(m);
  return m;
});

const DUST = 170;
const dustGeo = new THREE.BufferGeometry();
{
  const p = new Float32Array(DUST * 3);
  const s = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) {
    p[i * 3] = rand(-10, 10);
    p[i * 3 + 1] = rand(-3, 5);
    p[i * 3 + 2] = rand(-7, 5);
    s[i] = Math.random();
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(s, 1));
}
const dustMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uPixel: { value: renderer.getPixelRatio() }, uColor: { value: C('#fff1df') } },
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */ `
    attribute float aSeed;
    uniform float uTime; uniform float uPixel;
    varying float vA;
    void main() {
      vec3 p = position;
      p.y = -3.0 + mod(p.y + 3.0 + uTime * (0.05 + aSeed * 0.08), 8.0);
      p.x += sin(uTime * 0.15 + aSeed * 6.283) * 0.5;
      p.z += cos(uTime * 0.12 + aSeed * 4.0) * 0.3;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = (20.0 + aSeed * 26.0) * uPixel / -mv.z;
      gl_Position = projectionMatrix * mv;
      float edge = smoothstep(-3.0, -1.8, p.y) * smoothstep(5.0, 3.6, p.y);
      vA = edge * (0.18 + 0.22 * (0.5 + 0.5 * sin(uTime * (0.5 + aSeed) + aSeed * 30.0)));
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; varying float vA;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.0, d);
      gl_FragColor = vec4(uColor * a * vA, a * vA);
    }
  `,
});
scene.add(new THREE.Points(dustGeo, dustMat));

/* ════════════════════════════════════════════════════════════════════
   Markierungen auf den Feldern
   ════════════════════════════════════════════════════════════════════ */

const markerGeo = new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2);
function makeMarker(y) {
  const mat = new THREE.MeshBasicMaterial({ map: TEX.dot, color: C(PAL.ink), transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false });
  const m = new THREE.Mesh(markerGeo, mat);
  m.renderOrder = 2;
  m.userData = { y, op: 0, opT: 0, sc: 1, scT: 1, key: '' };
  board.add(m);
  return m;
}
const baseMarks = [];
const hintMarks = [];
for (let i = 0; i < R.W * R.H; i++) {
  const p = tilePos(i);
  const b = makeMarker(TOP + 0.004);
  b.position.set(p.x, TOP + 0.004, p.z);
  baseMarks.push(b);
  const h = makeMarker(TOP + 0.008);
  h.position.set(p.x, TOP + 0.008, p.z);
  hintMarks.push(h);
}

function setMark(m, key, tex, color, opacity, scale = 1) {
  if (opacity > 0 && m.userData.key !== key) {
    m.material.map = tex;
    m.material.color.set(color);
    m.material.needsUpdate = true;
    m.userData.key = key;
    if (m.userData.op < 0.02) m.userData.sc = scale * 0.6;
  }
  m.userData.opT = opacity;
  m.userData.scT = scale;
}

/* ════════════════════════════════════════════════════════════════════
   Effekte: Staubring, Lichtblitz, Funken, Wellen im Stein
   ════════════════════════════════════════════════════════════════════ */

function dustRing(pos, strength = 1, color = '#fff6ea') {
  const mat = new THREE.MeshBasicMaterial({ map: TEX.ripple, color: C(color), transparent: true, opacity: 0.55 * strength, depthWrite: false, fog: false });
  const m = new THREE.Mesh(markerGeo, mat);
  m.position.set(pos.x, pos.y + 0.012, pos.z);
  m.renderOrder = 3;
  board.add(m);
  tween(0.7, (e) => {
    m.scale.setScalar(0.35 + e * 1.1 * strength);
    mat.opacity = 0.55 * strength * (1 - e);
  }, ease.out).then(() => {
    board.remove(m);
    mat.dispose();
  });
}

function flash(pos, color, size = 1.4, dur = 0.7) {
  const mat = new THREE.SpriteMaterial({ map: TEX.glow, color: C(color), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
  const sp = new THREE.Sprite(mat);
  sp.position.copy(pos);
  scene.add(sp);
  tween(dur, (e) => {
    sp.scale.setScalar(0.2 + e * size);
    mat.opacity = Math.sin(Math.PI * Math.min(1, e * 1.4)) * 0.9 * (1 - e * 0.5);
  }, ease.out).then(() => {
    scene.remove(sp);
    mat.dispose();
  });
}

function sparkle(pos, color = '#ffe6bf', count = 10, spread = 0.6) {
  for (let k = 0; k < count; k++) {
    const mat = new THREE.SpriteMaterial({ map: TEX.glow, color: C(color), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
    const sp = new THREE.Sprite(mat);
    const a = Math.random() * Math.PI * 2;
    const r = rand(0.1, spread);
    const v = new THREE.Vector3(Math.cos(a) * r, rand(0.5, 1.4), Math.sin(a) * r);
    sp.position.copy(pos);
    scene.add(sp);
    const s0 = rand(0.08, 0.18);
    tween(rand(0.8, 1.4), (e) => {
      sp.position.set(pos.x + v.x * e, pos.y + v.y * e - e * e * 0.3, pos.z + v.z * e);
      sp.scale.setScalar(s0 * (1 - e * 0.6));
      mat.opacity = (1 - e) * 0.95;
    }, ease.out, k * 0.02).then(() => {
      scene.remove(sp);
      mat.dispose();
    });
  }
}

const ripples = [];
function ripple(pos, amp = -0.05, speed = 5.5) {
  ripples.push({ x: pos.x, z: pos.z, t: 0, amp, speed });
}
const tileOffset = new Float32Array(R.W * R.H);
function updateRipples(dt) {
  for (let r = ripples.length - 1; r >= 0; r--) {
    ripples[r].t += dt;
    if (ripples[r].t > 2.2) ripples.splice(r, 1);
  }
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    let off = 0;
    for (const rp of ripples) {
      const d = Math.hypot(t.position.x - rp.x, t.position.z - rp.z);
      const front = rp.t * rp.speed;
      off += rp.amp * Math.exp(-Math.pow(d - front, 2) / 0.45) * Math.exp(-rp.t * 1.6) * Math.exp(-d * 0.08);
    }
    tileOffset[i] = off;
    t.position.y = TOP - 0.11 + off;
    baseMarks[i].position.y = baseMarks[i].userData.y + off;
    hintMarks[i].position.y = hintMarks[i].userData.y + off;
  }
}

/* ════════════════════════════════════════════════════════════════════
   Figuren
   ════════════════════════════════════════════════════════════════════ */

const DIM = { 1: { s: 0.36, h: 0.56 }, 2: { s: 0.48, h: 0.8 }, 3: { s: 0.6, h: 1.05 } };
const GEO = { body: {}, pips: {} };
for (const size of [1, 2, 3]) {
  const { s, h } = DIM[size];
  const body = new THREE.ConeGeometry(s / Math.SQRT2, h, 4, 1);
  body.rotateY(Math.PI / 4);
  body.translate(0, h / 2, 0);
  GEO.body[size] = body;

  const r = 0.024 + size * 0.003;
  const yRel = 0.16;
  const y = h * yRel;
  const dist = (s / 2) * (1 - yRel);
  const tilt = Math.atan2(s / 2, h);
  const spacing = r * 2.9;
  const parts = [];
  for (let f = 0; f < 4; f++) {
    for (let k = 0; k < size; k++) {
      const c = new THREE.CircleGeometry(r, 18);
      c.rotateX(-tilt);
      c.translate((k - (size - 1) / 2) * spacing, y, dist + 0.002);
      c.rotateY((f * Math.PI) / 2);
      parts.push(c);
    }
  }
  GEO.pips[size] = mergeGeometries(parts);
}

const PIECE_COL = PAL.piece.map(C);
const PIP_COL = PIECE_COL.map((c) => c.clone().lerp(C('#3f2d45'), 0.42));

const views = new Map();

class PieceView {
  constructor(piece, owner) {
    this.id = piece.id;
    this.size = piece.size;
    this.owner = owner;
    this.ownerT = owner;
    this.tileIdx = -1;
    this.lift = 0;
    this.liftTarget = 0;
    this.glow = 0;
    this.glowTarget = 0;
    this.selected = false;
    this.rotLock = false;

    this.group = new THREE.Group();
    this.inner = new THREE.Group();
    this.group.add(this.inner);
    this.mat = new THREE.MeshStandardMaterial({
      color: PIECE_COL[owner].clone(),
      roughness: 0.88,
      metalness: 0,
      flatShading: true,
      emissive: C(PAL.accent),
      emissiveIntensity: 0,
    });
    this.pipMat = new THREE.MeshStandardMaterial({
      color: PIP_COL[owner].clone(),
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.body = new THREE.Mesh(GEO.body[this.size], this.mat);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.body.userData.view = this;
    this.pips = new THREE.Mesh(GEO.pips[this.size], this.pipMat);
    this.inner.add(this.body, this.pips);
    world.add(this.group);
  }

  update(dt, t) {
    this.ownerT = damp(this.ownerT, this.owner, 3.5, dt);
    this.mat.color.copy(PIECE_COL[0]).lerp(PIECE_COL[1], this.ownerT);
    this.pipMat.color.copy(PIP_COL[0]).lerp(PIP_COL[1], this.ownerT);
    this.lift = damp(this.lift, this.liftTarget, 9, dt);
    const bob = this.selected ? Math.sin(t * 2.6) * 0.035 : 0;
    const rip = this.tileIdx >= 0 ? tileOffset[this.tileIdx] : 0;
    this.inner.position.y = this.lift + bob + rip;
    if (!this.rotLock) {
      if (this.selected) this.inner.rotation.y += dt * 0.9;
      else {
        const q = Math.PI / 2;
        this.inner.rotation.y = damp(this.inner.rotation.y, Math.round(this.inner.rotation.y / q) * q, 5, dt);
      }
    }
    this.glow = damp(this.glow, this.glowTarget, 8, dt);
    this.mat.emissiveIntensity = this.glow;
  }

  dispose() {
    world.remove(this.group);
    this.mat.dispose();
    this.pipMat.dispose();
  }
}

function createView(piece, owner) {
  const v = new PieceView(piece, owner);
  views.set(piece.id, v);
  return v;
}

function squash(v) {
  return tween(0.32, (e, k) => {
    const s = Math.sin(Math.PI * k) * (1 - k);
    v.inner.scale.set(1 + s * 0.12, 1 - s * 0.16, 1 + s * 0.12);
  }, ease.linear).then(() => v.inner.scale.set(1, 1, 1));
}

function wiggle(v) {
  return tween(0.45, (e, k) => {
    v.inner.rotation.z = Math.sin(k * Math.PI * 6) * 0.07 * (1 - k);
  }, ease.linear).then(() => (v.inner.rotation.z = 0));
}

/* ════════════════════════════════════════════════════════════════════
   Spielzustand
   ════════════════════════════════════════════════════════════════════ */

let state = R.newGame(0);
let history = [];
let mode = 'intro'; // intro | play | over
let busy = true;
let selected = -1;
let targets = [];
let hovered = -1;
let names = (() => {
  const n = storeGet('mc.names', DEFAULT_NAMES);
  return Array.isArray(n) && n.length === 2 ? n.map((s, i) => (typeof s === 'string' && s.trim() ? s.slice(0, 18) : DEFAULT_NAMES[i])) : DEFAULT_NAMES.slice();
})();
const zoneGlow = [0, 0];

const viewAt = (i) => {
  const p = state.cells[i];
  return p ? views.get(p.id) : null;
};

function syncTo(s, animate) {
  const seen = new Set();
  const jobs = [];
  const place = (piece, pos, scale, owner, tileIdx) => {
    seen.add(piece.id);
    let v = views.get(piece.id);
    const fresh = !v;
    if (fresh) v = createView(piece, owner);
    v.owner = owner;
    v.tileIdx = tileIdx;
    v.selected = false;
    v.liftTarget = 0;
    v.glowTarget = 0;
    if (fresh || !animate) {
      v.group.position.copy(pos);
      v.group.quaternion.identity();
      if (fresh) v.ownerT = owner;
      if (fresh && animate) {
        v.group.scale.setScalar(0.001);
        jobs.push(tween(0.5, (e) => v.group.scale.setScalar(Math.max(0.001, e * scale)), ease.outBack));
      } else v.group.scale.setScalar(scale);
      return;
    }
    const p0 = v.group.position.clone();
    const s0 = v.group.scale.x;
    if (p0.distanceToSquared(pos) > 1e-6 || Math.abs(s0 - scale) > 1e-4) {
      const h = Math.min(0.25 + p0.distanceTo(pos) * 0.08, 1.2);
      jobs.push(tween(0.65, (e) => {
        v.group.position.lerpVectors(p0, pos, e);
        v.group.position.y += Math.sin(Math.PI * e) * h;
        v.group.scale.setScalar(s0 + (scale - s0) * e);
      }, ease.inOut));
    }
  };
  s.cells.forEach((p, i) => p && place(p, tilePos(i), 1, R.zoneOf(i), i));
  s.captured.forEach((list, pl) => list.forEach((p, k) => place(p, vaultPos(pl, k), VAULT_SCALE, pl, -1)));
  for (const [id, v] of [...views]) {
    if (seen.has(id)) continue;
    views.delete(id);
    if (animate) {
      const s0 = v.group.scale.x;
      jobs.push(tween(0.35, (e) => v.group.scale.setScalar(Math.max(0.001, s0 * (1 - e))), ease.in).then(() => v.dispose()));
    } else v.dispose();
  }
  return Promise.all(jobs);
}

function dropEase(k) {
  if (k < 0.62) {
    const t = k / 0.62;
    return t * t;
  }
  const t = (k - 0.62) / 0.38;
  return 1 - Math.sin(Math.PI * t) * 0.07 * (1 - t);
}

async function deal() {
  const bySize = { 3: [], 2: [], 1: [] };
  state.cells.forEach((p, i) => p && bySize[p.size].push(i));
  const order = [];
  for (const size of [3, 2, 1]) {
    const a = bySize[size].filter((i) => R.zoneOf(i) === 0);
    const b = bySize[size].filter((i) => R.zoneOf(i) === 1).reverse();
    for (let k = 0; k < Math.max(a.length, b.length); k++) {
      if (a[k] !== undefined) order.push(a[k]);
      if (b[k] !== undefined) order.push(b[k]);
    }
  }
  ripple(new THREE.Vector3(0, 0, 0), -0.07, 4);
  const jobs = order.map((i, k) => {
    const piece = state.cells[i];
    const v = createView(piece, R.zoneOf(i));
    v.tileIdx = i;
    const target = tilePos(i);
    const topY = target.y + 3.4;
    v.group.position.set(target.x, topY, target.z);
    v.group.scale.setScalar(0.001);
    let landed = false;
    return tween(0.85, (e, kk) => {
      v.group.position.y = topY + (target.y - topY) * dropEase(kk);
      v.group.scale.setScalar(Math.max(0.001, Math.min(1, kk / 0.4)));
      if (!landed && kk >= 0.62) {
        landed = true;
        sound.drop(k);
        dustRing(target, 0.6);
      }
    }, ease.linear, 0.25 + k * 0.08);
  });
  await Promise.all(jobs);
}

async function clearBoard() {
  const all = [...views.values()];
  views.clear();
  await Promise.all(
    all.map((v, k) => {
      const s0 = v.group.scale.x;
      const y0 = v.group.position.y;
      return tween(0.5, (e) => {
        v.group.scale.setScalar(Math.max(0.001, s0 * (1 - e)));
        v.group.position.y = y0 - e * 0.35;
      }, ease.in, k * 0.022).then(() => v.dispose());
    })
  );
}

/* ════════════════════════════════════════════════════════════════════
   Irrlicht & Laternen (Zugwechsel)
   ════════════════════════════════════════════════════════════════════ */

const wisp = new THREE.Group();
const wispCore = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), new THREE.MeshBasicMaterial({ color: C('#fff4e0'), fog: false }));
const wispHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: C('#ffd8a6'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
wispHalo.scale.setScalar(1.1);
wisp.add(wispCore, wispHalo);
wisp.visible = false;
scene.add(wisp);
let wispToken = 0;

async function wispFly(from, to, dur = 1.0, onArrive) {
  const token = ++wispToken;
  wisp.visible = true;
  const mid = from.clone().lerp(to, 0.5);
  mid.y = Math.max(from.y, to.y) + 1.6;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  await tween(dur, (e, k) => {
    if (token !== wispToken) return;
    a.copy(from).lerp(mid, e);
    b.copy(mid).lerp(to, e);
    wisp.position.copy(a.lerp(b, e));
    const s = 0.6 + Math.sin(Math.PI * k) * 0.5;
    wisp.scale.setScalar(s);
    wispHalo.material.opacity = Math.min(1, k * 4) * (k > 0.85 ? (1 - k) / 0.15 : 1);
    wispCore.material.opacity = wispHalo.material.opacity;
  }, ease.inOut);
  if (token !== wispToken) return;
  wisp.visible = false;
  if (onArrive) onArrive();
}

function setLamps(player) {
  lampTarget[0] = player === 0 ? 1 : 0.12;
  lampTarget[1] = player === 1 ? 1 : 0.12;
}

/* ════════════════════════════════════════════════════════════════════
   Kamera
   ════════════════════════════════════════════════════════════════════ */

const rig = { pitch: 0.4, yaw: 0, distMul: 1.34, tx: 0, ty: 1.7, tz: 0 };
let viewName = 'intro';
let viewFrom = null;
let viewBlend = 1;
let viewDur = 2.6;
let baseDist = 16;
const par = new THREE.Vector2();
const parTarget = new THREE.Vector2();

function viewParams(name, t) {
  switch (name) {
    case 'intro':
      return { pitch: 0.36, yaw: Math.sin(t * 0.05) * 0.16, distMul: 1.38, tx: 0, ty: 1.75, tz: 0 };
    case 'end':
      return { pitch: 0.44, yaw: Math.sin(t * 0.07) * 0.12, distMul: 1.32, tx: 0, ty: 2.5, tz: 0 };
    default:
      return { pitch: 0.68, yaw: 0, distMul: 1.0, tx: 0, ty: 0.3, tz: -0.15 };
  }
}

function setView(name, dur = 2.6) {
  viewFrom = { ...rig };
  viewName = name;
  viewBlend = 0;
  viewDur = dur;
}

function computeBaseDist() {
  const vt = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const ht = vt * camera.aspect;
  baseDist = Math.max(8.35 / ht, 4.6 / vt);
}

function updateCamera(dt) {
  const target = viewParams(viewName, time);
  if (viewBlend < 1) {
    viewBlend = Math.min(1, viewBlend + dt / viewDur);
    const e = ease.inOut(viewBlend);
    for (const k in target) rig[k] = viewFrom[k] + (target[k] - viewFrom[k]) * e;
  } else Object.assign(rig, target);

  par.x = damp(par.x, parTarget.x, 2.2, dt);
  par.y = damp(par.y, parTarget.y, 2.2, dt);
  const dist = baseDist * rig.distMul;
  const yaw = rig.yaw + par.x * 0.03;
  const pitch = rig.pitch + par.y * 0.018 + Math.sin(time * 0.31) * 0.003;
  camera.position.set(
    rig.tx + Math.sin(yaw) * Math.cos(pitch) * dist,
    rig.ty + Math.sin(pitch) * dist,
    rig.tz + Math.cos(yaw) * Math.cos(pitch) * dist
  );
  camera.lookAt(rig.tx, rig.ty, rig.tz);

  bgUniforms.uPar.value.copy(par);
  bgCamera.rotation.set(par.y * 0.008, -par.x * 0.012, 0);
}

/* ════════════════════════════════════════════════════════════════════
   HUD
   ════════════════════════════════════════════════════════════════════ */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const hud = $('#hud');
const controls = $('#controls');
const hintEl = $('#hint');
const toastEl = $('#toast');
const titleEl = $('#title');
const endEl = $('#end');
const rulesEl = $('#rules');
const whoEl = $('.turn .who');
const clockEl = $('.clock');
const nameEls = $$('.player .name');
const scoreEls = $$('.player .num');
const shownScores = [0, 0];

function splitLogo() {
  const el = $('.logo');
  const text = el.textContent;
  el.textContent = '';
  [...text].forEach((ch, i) => {
    const s = document.createElement('span');
    s.textContent = ch === ' ' ? ' ' : ch;
    s.style.setProperty('--i', i);
    el.appendChild(s);
  });
}

function diagram(kind) {
  const N = 5;
  const cs = 18;
  let svg = `<svg viewBox="0 0 ${N * cs} ${N * cs}">`;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      svg += `<rect x="${x * cs}" y="${y * cs}" width="${cs}" height="${cs}" fill="rgba(255,255,255,${(x + y) % 2 ? 0.05 : 0.11})"/>`;
    }
  }
  const c = 2;
  const dots = [];
  const dirs = kind === 'pawn' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : kind === 'drone' ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const range = kind === 'pawn' ? 1 : 2;
  for (const [dx, dy] of dirs) for (let s = 1; s <= range; s++) dots.push([c + dx * s, c + dy * s]);
  if (kind === 'queen') {
    for (const [dx, dy] of dirs) {
      svg += `<line x1="${(c + 0.5) * cs}" y1="${(c + 0.5) * cs}" x2="${(c + 0.5 + dx * 2.35) * cs}" y2="${(c + 0.5 + dy * 2.35) * cs}" stroke="rgba(242,215,166,.45)" stroke-width="1.2"/>`;
    }
  }
  for (const [x, y] of dots) svg += `<circle cx="${(x + 0.5) * cs}" cy="${(y + 0.5) * cs}" r="3" fill="rgba(248,238,228,.85)"/>`;
  const sz = kind === 'pawn' ? 5 : kind === 'drone' ? 6.5 : 8;
  const cx = (c + 0.5) * cs;
  const cy = (c + 0.5) * cs;
  svg += `<path d="M${cx} ${cy - sz} L${cx + sz * 0.85} ${cy + sz * 0.7} L${cx - sz * 0.85} ${cy + sz * 0.7} Z" fill="#f2d7a6"/>`;
  svg += `<path d="M${cx} ${cy - sz} L${cx + sz * 0.85} ${cy + sz * 0.7} L${cx} ${cy + sz * 0.7} Z" fill="#d8b582"/>`;
  return svg + '</svg>';
}

function buildRules() {
  $$('[data-diagram]').forEach((el) => el.insertAdjacentHTML('afterbegin', diagram(el.dataset.diagram)));
}

function renderNames() {
  nameEls.forEach((el, i) => {
    if (document.activeElement !== el) el.textContent = names[i];
  });
}

function updateHUD() {
  renderNames();
  hud.classList.toggle('ended', mode === 'over');
  const active = mode === 'play' ? state.turn : -1;
  $$('.player').forEach((el, i) => el.classList.toggle('active', active === i || (mode === 'over' && state.winner === i)));
  for (const p of [0, 1]) {
    if (shownScores[p] !== state.scores[p]) {
      const up = state.scores[p] > shownScores[p];
      shownScores[p] = state.scores[p];
      scoreEls[p].textContent = state.scores[p];
      if (up) {
        scoreEls[p].classList.remove('bump');
        void scoreEls[p].offsetWidth;
        scoreEls[p].classList.add('bump');
      }
    }
  }
  const whoText = mode === 'over' ? '—' : names[state.turn];
  if (whoEl.dataset.text !== whoText) {
    whoEl.classList.add('swap');
    setTimeout(() => {
      whoEl.textContent = whoText;
      whoEl.style.color = ZONE_CSS[state.turn];
      whoEl.classList.remove('swap');
    }, 260);
    whoEl.dataset.text = whoText;
  } else whoEl.style.color = ZONE_CSS[state.turn];

  if (state.clock && mode === 'play') {
    clockEl.hidden = false;
    const n = state.clock.count;
    clockEl.querySelectorAll('i').forEach((el, k) => el.classList.toggle('on', k < n));
    const left = R.CLOCK_LIMIT - n;
    clockEl.querySelector('.clabel').textContent = left === 1 ? 'Noch 1 Zug ohne Schlagen' : `Noch ${left} Züge ohne Schlagen`;
    clockEl.classList.toggle('late', left <= 2);
  } else clockEl.hidden = true;

  const playing = mode === 'play' && !busy;
  $('[data-act="undo"]').disabled = !playing || history.length === 0;
  $('[data-act="clock"]').disabled = !playing || !!state.clock;
  $('[data-act="clock"]').classList.toggle('lit', !!state.clock && mode === 'play');
  $('[data-act="restart"]').disabled = mode !== 'play' || busy;
  $('[data-act="sound"]').classList.toggle('muted', sound.muted);
}

let hintText = '';
function setHint(text) {
  if (text === hintText) return;
  hintText = text;
  hintEl.textContent = text;
  hintEl.classList.toggle('dim', !text);
}

let toastTimer = 0;
function toast(text, ms = 2600) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

function describeTarget(t) {
  const opp = names[1 - state.turn];
  if (t.type === 'capture') return `Schlagen: ${PIECE_NAME[t.value]} · +${t.value} ${t.value === 1 ? 'Punkt' : 'Punkte'}`;
  if (t.type === 'merge') return `Field Promotion: verschmelzen zur ${PIECE_NAME[t.into]}`;
  if (t.type === 'cross') return `Über den Kanal – die Figur gehört danach ${opp}`;
  return 'Hierhin ziehen';
}

function updateHint() {
  if (mode !== 'play') return setHint('');
  if (busy) return;
  if (selected < 0) return setHint(`${names[state.turn]} · wähle eine Figur in deiner Zone`);
  const t = targets.find((m) => m.to === hovered);
  if (t) return setHint(describeTarget(t));
  if (hovered >= 0 && hovered === R.blockedSquare(state, selected)) return setHint('Kein Zurückweisen: Diese Figur darf nicht sofort auf ihr Ausgangsfeld zurück.');
  setHint(`${PIECE_NAME[state.cells[selected].size]} gewählt · Ziel wählen · Esc hebt auf`);
}

function updateMarkers() {
  const lm = state.lastMove;
  const blocked = selected >= 0 ? R.blockedSquare(state, selected) : -1;
  for (let i = 0; i < tiles.length; i++) {
    const b = baseMarks[i];
    if (i === selected) setMark(b, 'sel', TEX.square, '#fffaf0', 0.95, 1);
    else if (lm && mode !== 'intro' && i === lm.to) setMark(b, 'lastTo', TEX.fill, PAL.ink, 0.13, 1);
    else if (lm && mode !== 'intro' && i === lm.from) setMark(b, 'lastFrom', TEX.square, PAL.ink, 0.22, 0.94);
    else setMark(b, b.userData.key, b.material.map, b.material.color, 0, 1);

    const h = hintMarks[i];
    const t = selected >= 0 ? targets.find((m) => m.to === i) : null;
    const hov = i === hovered;
    if (t) {
      if (t.type === 'capture') setMark(h, 'cap', TEX.ring, PAL.coral, hov ? 1 : 0.78, hov ? 1.06 : 1);
      else if (t.type === 'merge') setMark(h, 'merge', TEX.merge, PAL.teal, hov ? 1 : 0.8, hov ? 1.06 : 1);
      else if (t.type === 'cross') setMark(h, 'cross', TEX.hollow, PAL.ink, hov ? 0.95 : 0.6, hov ? 1.35 : 1);
      else setMark(h, 'move', TEX.dot, PAL.ink, hov ? 0.85 : 0.5, hov ? 1.35 : 1);
    } else if (i === blocked) setMark(h, 'blocked', TEX.cross, PAL.ink, hov ? 0.7 : 0.38, 1);
    else setMark(h, h.userData.key, h.material.map, h.material.color, 0, 1);
  }
}

/* ════════════════════════════════════════════════════════════════════
   Auswahl & Eingabe
   ════════════════════════════════════════════════════════════════════ */

function select(i, moves) {
  const prev = selected >= 0 ? viewAt(selected) : null;
  if (prev) {
    prev.selected = false;
    prev.liftTarget = 0;
    prev.glowTarget = 0;
  }
  selected = i;
  targets = moves;
  const v = viewAt(i);
  if (v) {
    v.selected = true;
    v.liftTarget = 0.3;
    v.glowTarget = 0.14;
  }
  sound.select();
  refreshInteraction();
}

function deselect(silent = false) {
  if (selected < 0) return;
  const v = viewAt(selected);
  if (v) {
    v.selected = false;
    v.liftTarget = 0;
    v.glowTarget = 0;
  }
  selected = -1;
  targets = [];
  if (!silent) sound.deselect();
  refreshInteraction();
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(9, 9);
let pointerDirty = false;

function pick() {
  if (pointer.x > 2) return -1;
  raycaster.setFromCamera(pointer, camera);
  const objs = tiles.slice();
  for (const v of views.values()) if (v.tileIdx >= 0) objs.push(v.body);
  const hit = raycaster.intersectObjects(objs, false)[0];
  if (!hit) return -1;
  const view = hit.object.userData.view;
  return view ? view.tileIdx : hit.object.userData.idx;
}

function refreshInteraction() {
  hovered = mode === 'play' && !busy ? pick() : -1;
  let cursor = false;
  for (const v of views.values()) {
    if (!v.selected) {
      v.liftTarget = 0;
      v.glowTarget = 0;
    }
  }
  if (hovered >= 0) {
    const p = state.cells[hovered];
    if (selected >= 0 && targets.some((m) => m.to === hovered)) cursor = true;
    else if (hovered === selected) cursor = true;
    else if (p && R.zoneOf(hovered) === state.turn) {
      const v = views.get(p.id);
      if (v) {
        v.liftTarget = 0.08;
        v.glowTarget = 0.09;
      }
      cursor = true;
    }
  }
  canvas.style.cursor = cursor ? 'pointer' : 'default';
  updateMarkers();
  updateHint();
}

function onBoardClick() {
  if (mode !== 'play' || busy) return;
  const i = pick();
  hovered = i;
  if (selected >= 0) {
    const mv = targets.find((m) => m.to === i);
    if (mv) return performMove(mv);
    if (i === selected) return deselect();
    if (i >= 0 && i === R.blockedSquare(state, selected)) {
      sound.deny();
      toast('Kein Zurückweisen – diese Figur kam gerade erst herüber.', 2400);
      return;
    }
  }
  const p = i >= 0 ? state.cells[i] : null;
  if (p && R.zoneOf(i) === state.turn) {
    const moves = R.movesFrom(state, i);
    if (moves.length) return select(i, moves);
    sound.deny();
    wiggle(views.get(p.id));
    setHint(`${THIS_PIECE[p.size]} kann gerade nicht ziehen.`);
    return;
  }
  if (p) {
    sound.deny();
    wiggle(views.get(p.id));
    toast(`Diese Figur steht in der Zone von ${names[1 - state.turn]}.`, 2200);
    return;
  }
  deselect();
}

/* ════════════════════════════════════════════════════════════════════
   Züge ausführen
   ════════════════════════════════════════════════════════════════════ */

function flyPiece(v, from, to, dur, arc, newOwner, onFrac, frac) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  const axis = new THREE.Vector3(dz / len, 0, -dx / len);
  let fired = false;
  return tween(dur, (e, k) => {
    v.group.position.set(from.x + dx * e, from.y + (to.y - from.y) * e + Math.sin(Math.PI * e) * arc, from.z + dz * e);
    v.group.quaternion.setFromAxisAngle(axis, Math.sin(Math.PI * 2 * e) * 0.13);
    if (!fired && k >= frac) {
      fired = true;
      if (onFrac) onFrac();
    }
    if (e > 0.5 && v.owner !== newOwner) v.owner = newOwner;
  }, ease.inOut).then(() => v.group.quaternion.identity());
}

async function animateCapture(cv, player, slot, value) {
  sound.capture(value);
  cv.rotLock = true;
  cv.tileIdx = -1;
  const p0 = cv.group.position.clone();
  flash(p0.clone().setY(0.45), '#ffb59a', 1.5);
  await tween(0.32, (e) => {
    cv.group.position.y = p0.y + e * 0.75;
    cv.inner.rotation.y = e * Math.PI * 0.5;
  }, ease.out);
  cv.owner = player;
  const a = cv.group.position.clone();
  const b = vaultPos(player, slot);
  const d = a.distanceTo(b);
  await tween(0.72 + d * 0.035, (e) => {
    cv.group.position.lerpVectors(a, b, e);
    cv.group.position.y += Math.sin(Math.PI * e) * (1.0 + d * 0.07);
    cv.group.scale.setScalar(1 + (VAULT_SCALE - 1) * e);
    cv.inner.rotation.y = Math.PI * 0.5 + e * Math.PI * 1.5;
  }, ease.inOut);
  cv.inner.rotation.y = 0;
  cv.rotLock = false;
  sound.vault();
  sparkle(b.clone().setY(b.y + 0.25), '#ffe3b8', 8, 0.35);
  squash(cv);
}

async function animateMerge(mv, tv, piece, idx) {
  const pos = tilePos(idx);
  sound.merge();
  flash(pos.clone().setY(0.5), '#ffe9c4', 2.0, 0.9);
  ripple(pos, -0.06, 4.5);
  mv.rotLock = true;
  tv.rotLock = true;
  await tween(0.36, (e) => {
    const s = Math.max(0.001, 1 - e);
    mv.group.scale.setScalar(s);
    tv.group.scale.setScalar(s);
    mv.inner.rotation.y = e * 2.4;
    tv.inner.rotation.y = -e * 2.4;
    mv.group.position.y = pos.y + e * 0.25;
  }, ease.in);
  views.delete(mv.id);
  views.delete(tv.id);
  mv.dispose();
  tv.dispose();
  const nv = createView(piece, R.zoneOf(idx));
  nv.tileIdx = idx;
  nv.group.position.copy(pos);
  nv.group.scale.setScalar(0.001);
  sparkle(pos.clone().setY(0.3), '#fff0d2', 14, 0.5);
  await tween(0.65, (e) => nv.group.scale.setScalar(Math.max(0.001, e)), ease.outBack);
  squash(nv);
}

async function performMove(mv) {
  busy = true;
  const res = R.applyMove(state, mv);
  history.push(state);

  const v = viewAt(mv.from);
  const cv = res.captured ? views.get(res.captured.id) : null;
  const tv = res.merged ? views.get(res.merged.target.id) : null;
  selected = -1;
  targets = [];
  hovered = -1;
  v.selected = false;
  v.liftTarget = 0;
  v.glowTarget = 0;
  v.tileIdx = -1;
  for (const m of [...baseMarks, ...hintMarks]) m.userData.opT = 0;
  canvas.style.cursor = 'default';
  setHint('');
  updateHUD();

  const from = v.group.position.clone();
  const to = tilePos(mv.to);
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  const dur = Math.min(0.46 + dist * 0.075, 1.0);
  const arc = 0.3 + dist * 0.11 + (res.crossed ? 0.15 : 0);
  let capJob = null;
  sound.whoosh(dur);

  await flyPiece(v, from, to, dur, arc, R.zoneOf(mv.to), () => {
    if (cv) capJob = animateCapture(cv, res.player, res.captured.slot, res.captured.size);
  }, 0.55);

  v.tileIdx = mv.to;
  sound.land(res.piece.size);
  dustRing(to, 0.9);
  squash(v);
  if (res.crossed) ripple(to, -0.035, 5);
  if (cv) ripple(to, -0.055, 5.5);
  if (res.merged) await animateMerge(v, tv, res.merged.piece, mv.to);
  if (capJob) await capJob;

  state = res.state;
  await syncTo(state, false);
  busy = false;
  afterMove(res);
}

function afterMove(res) {
  if (state.over) {
    endGame();
    return;
  }
  const turnChanged = state.turn !== res.player;
  if (turnChanged) {
    sound.turn();
    setLamps(-1);
    const newTurn = state.turn;
    wispFly(lampCenter(res.player), lampCenter(newTurn), 1.0, () => setLamps(newTurn));
  }
  if (state.passed !== null) toast(`${names[state.passed]} kann nicht ziehen – ${names[state.turn]} ist noch einmal dran.`, 3200);
  if (state.clock) sound.tick(R.CLOCK_LIMIT - state.clock.count);
  updateHUD();
  refreshInteraction();
}

function undo() {
  if (mode !== 'play' || busy || history.length === 0) return;
  deselect(true);
  state = history.pop();
  busy = true;
  sound.ui();
  wispToken++;
  wisp.visible = false;
  setLamps(state.turn);
  updateHUD();
  syncTo(state, true).then(() => {
    busy = false;
    updateHUD();
    refreshInteraction();
  });
}

function callClock() {
  if (mode !== 'play' || busy || state.clock) return;
  history.push(state);
  state = R.callClock(state);
  sound.clockCall();
  toast('Die Uhr läuft – nach sieben Zügen ohne Schlagen endet das Spiel.', 3400);
  updateHUD();
}

/* ════════════════════════════════════════════════════════════════════
   Spielablauf
   ════════════════════════════════════════════════════════════════════ */

let dealing = null;

async function beginRound() {
  const first = Math.random() < 0.5 ? 0 : 1;
  state.turn = first;
  history = [];
  mode = 'play';
  busy = true;
  hud.classList.add('show');
  controls.classList.add('show');
  updateHUD();
  await wait(0.5);
  const origin = new THREE.Vector3(0, 1.4, 0);
  flash(origin, '#ffe1b5', 1.2, 0.8);
  await wait(0.35);
  toast(`Das Los fällt auf ${names[first]}.`, 2600);
  await wispFly(origin, lampCenter(first), 1.2, () => setLamps(first));
  sound.turn();
  busy = false;
  updateHUD();
  refreshInteraction();
}

async function startFromTitle() {
  if (mode !== 'intro') return;
  mode = 'starting';
  sound.init();
  sound.start();
  titleEl.classList.remove('show');
  setView('game', 2.6);
  await dealing;
  await wait(1.2);
  await beginRound();
}

async function newGame() {
  if (busy && mode === 'play') return;
  sound.init();
  sound.start();
  mode = 'starting';
  busy = true;
  deselect(true);
  endEl.classList.remove('show');
  setLamps(-1);
  updateHUD();
  setView('game', 2.0);
  await clearBoard();
  state = R.newGame(0);
  shownScores[0] = shownScores[1] = -1;
  updateHUD();
  await deal();
  await beginRound();
}

async function endGame() {
  mode = 'over';
  busy = true;
  setHint('');
  controls.classList.remove('show');
  updateHUD();
  const w = state.winner;
  await wait(0.7);
  sound.win();
  if (w === 0 || w === 1) {
    lampTarget[w] = 1.6;
    lampTarget[1 - w] = 0.05;
    const c = new THREE.Vector3(w === 0 ? -VAULT_X : VAULT_X, VAULT_Y + 0.4, 0);
    for (let k = 0; k < 4; k++) setTimeout(() => sparkle(c.clone().add(new THREE.Vector3(rand(-0.5, 0.5), 0, rand(-1.4, 1.4))), '#ffe2b0', 14, 0.7), k * 380);
  } else {
    lampTarget[0] = lampTarget[1] = 0.6;
  }
  setView('end', 3.2);

  const headline = endEl.querySelector('.headline');
  headline.textContent = w === 'draw' ? 'Unentschieden' : `${names[w]} gewinnt`;
  headline.style.color = w === 'draw' ? '' : ZONE_CSS[w];
  endEl.querySelector('.s0').textContent = state.scores[0];
  endEl.querySelector('.s1').textContent = state.scores[1];
  let reason = 'Niemand kann mehr ziehen.';
  if (state.endReason === 'empty') {
    const emptied = R.piecesIn(state, 0) === 0 ? 0 : 1;
    reason = `Die Zone von ${names[emptied]} ist leer.`;
    if (state.tiebreak) reason += ' Gleichstand – den Sieg holt, wer das Spiel beendet hat.';
  } else if (state.endReason === 'clock') {
    reason = 'Die Uhr ist abgelaufen – sieben Züge ohne Schlagen.';
  }
  endEl.querySelector('.reason').textContent = reason;
  await wait(1.0);
  endEl.classList.add('show');
  busy = false;
  updateHUD();
}

/* ════════════════════════════════════════════════════════════════════
   Regeln, Ton, Steuerung
   ════════════════════════════════════════════════════════════════════ */

function openRules() {
  rulesEl.classList.add('show');
  sound.ui();
}
function closeRules() {
  rulesEl.classList.remove('show');
}
const rulesOpen = () => rulesEl.classList.contains('show');

function toggleSound() {
  sound.init();
  sound.setMuted(!sound.muted);
  updateHUD();
}

let restartArmed = 0;
function restart(btn) {
  if (mode !== 'play' || busy) return;
  if (Date.now() - restartArmed < 3000) {
    restartArmed = 0;
    btn.classList.remove('armed');
    btn.dataset.tip = 'Neues Spiel';
    newGame();
    return;
  }
  restartArmed = Date.now();
  btn.classList.add('armed');
  btn.dataset.tip = 'Nochmal klicken zum Bestätigen';
  sound.ui();
  setTimeout(() => {
    if (Date.now() - restartArmed >= 2900) {
      btn.classList.remove('armed');
      btn.dataset.tip = 'Neues Spiel';
    }
  }, 3000);
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  const act = btn.dataset.act;
  if (act === 'undo') undo();
  else if (act === 'clock') callClock();
  else if (act === 'rules') openRules();
  else if (act === 'close') closeRules();
  else if (act === 'sound') toggleSound();
  else if (act === 'restart') restart(btn);
});
rulesEl.addEventListener('click', (e) => {
  if (e.target === rulesEl) closeRules();
});
$('#startBtn').addEventListener('click', startFromTitle);
$('#againBtn').addEventListener('click', newGame);

nameEls.forEach((el, i) => {
  el.addEventListener('focus', () => {
    el.contentEditable = 'true';
  });
  el.addEventListener('mousedown', () => {
    el.contentEditable = 'true';
  });
  el.addEventListener('input', () => {
    if (el.textContent.length > 18) {
      el.textContent = el.textContent.slice(0, 18);
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
  });
  el.addEventListener('blur', () => {
    const v = el.textContent.replace(/\s+/g, ' ').trim();
    names[i] = v || DEFAULT_NAMES[i];
    el.contentEditable = 'false';
    storeSet('mc.names', names);
    whoEl.dataset.text = '';
    updateHUD();
    updateHint();
  });
});

window.addEventListener('keydown', (e) => {
  if (e.target.isContentEditable) {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      e.target.blur();
    }
    return;
  }
  if (e.key === 'Escape') {
    if (rulesOpen()) closeRules();
    else deselect();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  } else if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey) {
    toggleSound();
  } else if (e.key === '?' || (e.key === 'ß' && e.shiftKey)) {
    if (rulesOpen()) closeRules();
    else openRules();
  } else if ((e.key === 'Enter' || e.key === ' ') && !rulesOpen()) {
    if (mode === 'intro' && titleEl.classList.contains('show')) {
      e.preventDefault();
      startFromTitle();
    } else if (mode === 'over' && endEl.classList.contains('show')) {
      e.preventDefault();
      newGame();
    }
  }
});

function setPointer(e) {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  parTarget.set(pointer.x, pointer.y);
  pointerDirty = true;
}
canvas.addEventListener('pointermove', setPointer);
canvas.addEventListener('pointerleave', () => {
  pointer.set(9, 9);
  parTarget.set(0, 0);
  pointerDirty = true;
});
canvas.addEventListener('click', (e) => {
  setPointer(e);
  onBoardClick();
});

document.addEventListener('visibilitychange', () => {
  if (!sound.ctx) return;
  if (document.hidden) sound.ctx.suspend();
  else sound.ctx.resume();
});

/* ════════════════════════════════════════════════════════════════════
   Größe & Hauptschleife
   ════════════════════════════════════════════════════════════════════ */

let lastW = 0;
let lastH = 0;
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  lastW = w;
  lastH = h;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  bgCamera.aspect = w / h;
  bgUniforms.uAspect.value = w / h;
  computeBaseDist();
  layoutBackground();
  dustMat.uniforms.uPixel.value = renderer.getPixelRatio() * (h / 900);
}
window.addEventListener('resize', onResize);

const clock = new THREE.Clock();

function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  time += dt;
  if (window.innerWidth !== lastW || window.innerHeight !== lastH) onResize();

  updateTweens(dt);
  updateCamera(dt);
  updateRipples(dt);
  for (const v of views.values()) v.update(dt, time);

  if (pointerDirty && mode === 'play' && !busy) {
    pointerDirty = false;
    const h = pick();
    if (h !== hovered) refreshInteraction();
  }

  for (const list of [baseMarks, hintMarks]) {
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const u = m.userData;
      u.op = damp(u.op, u.opT, 12, dt);
      u.sc = damp(u.sc, u.scT, 12, dt);
      const pulse = list === hintMarks && u.opT > 0 ? 1 + Math.sin(time * 3.2 + i * 0.4) * 0.05 : 1;
      m.material.opacity = u.op;
      m.scale.setScalar(u.sc * pulse);
      m.visible = u.op > 0.003;
    }
  }

  for (const z of [0, 1]) {
    zoneGlow[z] = damp(zoneGlow[z], mode === 'play' && state.turn === z ? 0.075 : 0, 3, dt);
    tileMats[z][0].emissiveIntensity = zoneGlow[z];
    tileMats[z][1].emissiveIntensity = zoneGlow[z];
  }

  for (const p of [0, 1]) {
    lampLevel[p] = damp(lampLevel[p], lampTarget[p], 3.2, dt);
    for (const l of lamps[p]) {
      const flick = 1 + Math.sin(time * 2.3 + l.phase) * 0.06 + Math.sin(time * 5.1 + l.phase * 2) * 0.03;
      const lv = Math.min(lampLevel[p], 1);
      l.orb.material.color.copy(lampDim).lerp(lampBright, lv);
      l.halo.material.opacity = Math.min(1, lampLevel[p] * 0.95) * flick;
      l.halo.scale.setScalar((0.55 + lampLevel[p] * 0.75) * flick);
    }
  }

  const archPulse = 0.42 + Math.sin(time * 0.8) * 0.12;
  archGlowMat.opacity = archPulse;

  waterUniforms.uTime.value = time;
  for (const c of clouds) c.uniforms.uTime.value = time;
  dustMat.uniforms.uTime.value = time;
  bgUniforms.uTime.value = time;
  planetBody.material.uniforms.uTime.value = time;
  moon1.material.uniforms.uTime.value = time;
  planetBody.rotation.y += dt * 0.012;
  for (const isl of islands) {
    isl.position.y = isl.userData.base + Math.sin(time * 0.35 + isl.userData.phase) * 0.18;
    isl.rotation.y += dt * isl.userData.spin;
  }

  nextShoot -= dt;
  if (nextShoot <= 0) {
    spawnShootingStar();
    nextShoot = rand(14, 32);
  }

  renderer.clear();
  renderer.render(bgScene, bgCamera);
  renderer.clearDepth();
  renderer.render(scene, camera);
}

/* ════════════════════════════════════════════════════════════════════
   Start
   ════════════════════════════════════════════════════════════════════ */

splitLogo();
buildRules();
onResize();
updateHUD();
renderer.setAnimationLoop(frame);
requestAnimationFrame(() => {
  $('#fade').classList.add('gone');
  setTimeout(() => titleEl.classList.add('show'), 700);
});
dealing = (async () => {
  await wait(0.9);
  await deal();
  busy = false;
})();

if (new URLSearchParams(location.search).has('debug')) {
  window.__mc = {
    R,
    get state() { return state; },
    set state(s) { state = s; syncTo(state, false); updateHUD(); refreshInteraction(); },
    get busy() { return busy; },
    move: (from, to) => performMove(R.movesFrom(state, from).find((m) => m.to === to)),
    select: (i) => select(i, R.movesFrom(state, i)),
  };
}
