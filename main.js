import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';

// ---------- renderer / scene ----------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.02, 2000);
camera.position.set(6, 4, 8);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;

// ---------- lights ----------
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xbcd6ff, 0x4a5a32, 0.8);
scene.add(hemi);

const sky = new Sky();
sky.scale.setScalar(1500);
scene.add(sky);
const skyU = sky.material.uniforms;
skyU.skyGain = { value: 0.35 };
sky.material.fragmentShader = 'uniform float skyGain;\n' + sky.material.fragmentShader.replace(
  'gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( retColor * skyGain, 1.0 );');
skyU.turbidity.value = 6; skyU.rayleigh.value = 1.6; skyU.mieCoefficient.value = 0.005; skyU.mieDirectionalG.value = 0.8;

const sunArrow = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), 3, 0xffcc33, 0.5, 0.3);
scene.add(sunArrow);

// ---------- helpers ----------
const grid = new THREE.GridHelper(40, 40, 0x666666, 0x333333);
grid.material.transparent = true; grid.material.opacity = 0.5;
scene.add(grid);
const camMarkers = new THREE.Group();
scene.add(camMarkers);

// ---------- state ----------
const P = {
  model: 'Lite (128k tris)',
  shading: 'Photo (unlit)',
  wireframe: false,
  scale: 1.0,
  albedoBoost: 1.0,
  mode: 'Orbit',
  flySpeed: 2.0,
  fov: 60,
  photo: '—',
  azimuth: 115,
  elevation: 40,
  sunIntensity: 3.0,
  sunKelvin: 5600,
  sunColor: '#ffffff',
  useKelvin: true,
  shadows: true,
  shadowSoftness: 2,
  hemiIntensity: 0.8,
  skyColor: '#bcd6ff',
  groundColor: '#4a5a32',
  background: 'Physical sky',
  bgColor: '#202124',
  exposure: 1.0,
  skyBrightness: 0.35,
  showSunArrow: true,
  showGrid: true,
  showCameras: true,
};

let meta = null;
let model = null;            // THREE.Group of the loaded scan
const modelRoot = new THREE.Group();
scene.add(modelRoot);
const matPairs = [];         // {mesh, unlit, lit}

// ---------- utils ----------
function kelvinToRGB(k) {
  const t = k / 100; let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = v => Math.min(255, Math.max(0, v)) / 255;
  return new THREE.Color(c(r), c(g), c(b));
}

function sunDirection() {
  const az = THREE.MathUtils.degToRad(P.azimuth), el = THREE.MathUtils.degToRad(P.elevation);
  // azimuth 0 = -Z (scene "forward"), increasing clockwise seen from above
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

function updateLights() {
  const d = sunDirection();
  const R = 30 * P.scale;
  sun.position.copy(d).multiplyScalar(R);
  sun.target.position.set(0, 0, 0);
  sun.intensity = P.elevation > -2 ? P.sunIntensity : 0;
  sun.color.copy(P.useKelvin ? kelvinToRGB(P.sunKelvin) : new THREE.Color(P.sunColor));
  sun.castShadow = P.shadows;
  sun.shadow.radius = P.shadowSoftness;
  const s = sun.shadow.camera, ext = 18 * P.scale;
  s.left = -ext; s.right = ext; s.top = ext; s.bottom = -ext; s.near = 0.5; s.far = R * 2.5; s.updateProjectionMatrix();
  hemi.intensity = P.hemiIntensity; hemi.color.set(P.skyColor); hemi.groundColor.set(P.groundColor);
  skyU.sunPosition.value.copy(d);
  sunArrow.position.copy(d).multiplyScalar(4 * P.scale).add(new THREE.Vector3(0, 0.5, 0));
  sunArrow.setDirection(d.clone().negate());
  sunArrow.setLength(3 * P.scale, 0.5 * P.scale, 0.3 * P.scale);
  sunArrow.visible = P.showSunArrow;
  renderer.toneMappingExposure = P.exposure;
  skyU.skyGain.value = P.skyBrightness;
  sky.visible = P.background === 'Physical sky';
  scene.background = P.background === 'Solid colour' ? new THREE.Color(P.bgColor) : null;
}

function applyShading() {
  const lit = P.shading !== 'Photo (unlit)';
  for (const p of matPairs) {
    p.mesh.material = lit ? p.lit : p.unlit;
    p.mesh.material.wireframe = P.wireframe;
    p.lit.color.setScalar(P.albedoBoost);
    p.unlit.color.setScalar(P.albedoBoost);
  }
}

function applyScale() {
  modelRoot.scale.setScalar(P.scale);
  camMarkers.scale.setScalar(P.scale);
  grid.scale.setScalar(P.scale);
  updateLights();
}

// ---------- loading ----------
const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath(import.meta.resolve('three/addons/libs/draco/gltf/'));
loader.setDRACOLoader(draco);
const progressEl = document.getElementById('progress');
const loadingEl = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');

function loadModel(file) {
  loadingEl.classList.remove('done');
  loadingText.textContent = `Loading ${file}…`;
  return new Promise((resolve, reject) => {
    loader.load(`assets/${file}`, gltf => {
      if (model) {
        modelRoot.remove(model);
        model.traverse(o => { if (o.isMesh) { o.geometry.dispose(); } });
        for (const p of matPairs) { p.lit.dispose(); p.unlit.dispose(); }
        matPairs.length = 0;
      }
      model = gltf.scene;
      model.traverse(o => {
        if (!o.isMesh) return;
        if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
        const map = o.material.map || null;
        if (map) { map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = renderer.capabilities.getMaxAnisotropy(); }
        const unlit = new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide, toneMapped: false });
        const lit = new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
        o.castShadow = true; o.receiveShadow = true;
        matPairs.push({ mesh: o, unlit, lit });
      });
      modelRoot.add(model);
      applyShading();
      loadingEl.classList.add('done');
      resolve();
    }, e => {
      if (e.total) progressEl.style.width = `${(100 * e.loaded / e.total).toFixed(1)}%`;
      loadingText.textContent = `Loading ${file}… ${(e.loaded / 1e6).toFixed(1)} MB`;
    }, err => { loadingText.textContent = `Failed to load ${file}: ${err.message || err}`; reject(err); });
  });
}

function buildCameraMarkers() {
  camMarkers.clear();
  const h = 0.25, w = h * Math.tan(THREE.MathUtils.degToRad(meta.fov_vertical_deg / 2)) * 2, a = meta.aspect;
  const corners = [[-w * a / 2, w / 2, -h], [w * a / 2, w / 2, -h], [w * a / 2, -w / 2, -h], [-w * a / 2, -w / 2, -h]];
  const pts = [];
  for (const c of corners) pts.push(0, 0, 0, ...c);
  for (let i = 0; i < 4; i++) pts.push(...corners[i], ...corners[(i + 1) % 4]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xff5566 });
  for (const c of meta.cameras) {
    const l = new THREE.LineSegments(geo, mat);
    l.position.fromArray(c.position);
    l.quaternion.fromArray(c.quaternion);
    l.userData.name = c.name;
    camMarkers.add(l);
  }
}

// ---------- fly controls ----------
const keys = new Set();
let flyLook = null; // {x, y} last pointer while dragging
const euler = new THREE.Euler(0, 0, 0, 'YXZ');

function setMode(mode) {
  P.mode = mode;
  const fly = mode === 'Fly / walk';
  orbit.enabled = !fly;
  document.getElementById('mode-label').textContent = fly ? 'Fly / walk' : 'Orbit';
  document.getElementById('help-orbit').hidden = fly;
  document.getElementById('help-fly').hidden = !fly;
  if (!fly) {
    // put the orbit pivot in front of the camera
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    orbit.target.copy(camera.position).addScaledVector(fwd, 4 * P.scale);
    orbit.update();
  }
  gui.controllersRecursive().forEach(c => c.updateDisplay());
}

addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('.lil-gui')) return;
  const k = e.key.toLowerCase();
  if (k === 'f') { setMode(P.mode === 'Orbit' ? 'Fly / walk' : 'Orbit'); return; }
  keys.add(k);
  if (k === 'shift') keys.add('shift');
});
addEventListener('keyup', e => { keys.delete(e.key.toLowerCase()); if (e.key === 'Shift') keys.delete('shift'); });
addEventListener('blur', () => keys.clear());

renderer.domElement.addEventListener('pointerdown', e => {
  if (P.mode !== 'Fly / walk') return;
  flyLook = { x: e.clientX, y: e.clientY };
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', e => {
  if (!flyLook) return;
  const dx = e.clientX - flyLook.x, dy = e.clientY - flyLook.y;
  flyLook = { x: e.clientX, y: e.clientY };
  euler.setFromQuaternion(camera.quaternion);
  euler.y -= dx * 0.0035; euler.x -= dy * 0.0035;
  euler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, euler.x));
  euler.z = 0;
  camera.quaternion.setFromEuler(euler);
});
renderer.domElement.addEventListener('pointerup', () => { flyLook = null; });
renderer.domElement.addEventListener('wheel', e => {
  if (P.mode !== 'Fly / walk') return;
  e.preventDefault();
  P.flySpeed = Math.min(30, Math.max(0.1, P.flySpeed * (e.deltaY > 0 ? 0.85 : 1.18)));
  gui.controllersRecursive().forEach(c => c.updateDisplay());
}, { passive: false });

// double-click: set orbit pivot to surface point
const ray = new THREE.Raycaster();
renderer.domElement.addEventListener('dblclick', e => {
  if (!model) return;
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(modelRoot, true)[0];
  if (hit) { orbit.target.copy(hit.point); orbit.update(); }
});

function updateFly(dt) {
  if (P.mode !== 'Fly / walk') return;
  const v = new THREE.Vector3();
  if (keys.has('w') || keys.has('arrowup')) v.z -= 1;
  if (keys.has('s') || keys.has('arrowdown')) v.z += 1;
  if (keys.has('a') || keys.has('arrowleft')) v.x -= 1;
  if (keys.has('d') || keys.has('arrowright')) v.x += 1;
  if (v.lengthSq()) {
    v.normalize().applyQuaternion(camera.quaternion);
    camera.position.addScaledVector(v, P.flySpeed * P.scale * dt * (keys.has('shift') ? 3 : 1));
  }
  const up = (keys.has('e') ? 1 : 0) - (keys.has('q') ? 1 : 0);
  if (up) camera.position.y += up * P.flySpeed * P.scale * dt * (keys.has('shift') ? 3 : 1);
}

// ---------- photo camera jumps ----------
let tween = null;
function jumpToPhoto(name) {
  const c = meta.cameras.find(c => c.name === name);
  if (!c) return;
  const toPos = new THREE.Vector3().fromArray(c.position).multiplyScalar(P.scale);
  const toQ = new THREE.Quaternion().fromArray(c.quaternion);
  if (P.mode !== 'Fly / walk') setMode('Fly / walk');
  tween = { t: 0, fromPos: camera.position.clone(), fromQ: camera.quaternion.clone(), toPos, toQ,
            fromFov: camera.fov, toFov: meta.fov_vertical_deg };
}
function updateTween(dt) {
  if (!tween) return;
  tween.t = Math.min(1, tween.t + dt / 0.9);
  const k = tween.t < 0.5 ? 2 * tween.t * tween.t : 1 - Math.pow(-2 * tween.t + 2, 2) / 2;
  camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
  camera.quaternion.slerpQuaternions(tween.fromQ, tween.toQ, k);
  camera.fov = THREE.MathUtils.lerp(tween.fromFov, tween.toFov, k);
  camera.updateProjectionMatrix();
  if (tween.t >= 1) { P.fov = Math.round(camera.fov); tween = null; gui.controllersRecursive().forEach(c => c.updateDisplay()); }
}

// ---------- presets ----------
const PRESETS = {
  'Capture (08:39, ~40°)': { elevation: 40, sunKelvin: 5600, sunIntensity: 3.0, hemiIntensity: 0.9, skyColor: '#bcd6ff', groundColor: '#4a5a32', exposure: 1.0, skyBrightness: 0.35 },
  'Midday': { elevation: 75, sunKelvin: 5900, sunIntensity: 3.6, hemiIntensity: 1.0, skyColor: '#cfe2ff', groundColor: '#55663a', exposure: 0.9, skyBrightness: 0.3 },
  'Golden hour': { elevation: 8, sunKelvin: 3200, sunIntensity: 2.4, hemiIntensity: 0.5, skyColor: '#ffd9b0', groundColor: '#3a3324', exposure: 1.4, skyBrightness: 0.8 },
  'Overcast': { elevation: 55, sunKelvin: 6500, sunIntensity: 0.4, hemiIntensity: 1.6, skyColor: '#e6ebf0', groundColor: '#5b6150', exposure: 1.1, skyBrightness: 0.25 },
  'Blue hour': { elevation: -4, sunKelvin: 9000, sunIntensity: 0, hemiIntensity: 0.35, skyColor: '#6f86c9', groundColor: '#1f2433', exposure: 1.6, skyBrightness: 1.5 },
};

// ---------- GUI ----------
const gui = new GUI({ title: 'Backyard scan' });
const fScene = gui.addFolder('Scan');
fScene.add(P, 'model', ['Lite (128k tris)', 'Full (1.5M tris)']).name('Mesh').onChange(v =>
  loadModel(v.startsWith('Full') ? 'scene_full.glb' : 'scene_lite.glb'));
fScene.add(P, 'shading', ['Photo (unlit)', 'Relit']).name('Shading').onChange(applyShading);
fScene.add(P, 'albedoBoost', 0.3, 2, 0.01).name('Texture brightness').onChange(applyShading);
fScene.add(P, 'wireframe').name('Wireframe').onChange(applyShading);
fScene.add(P, 'scale', 0.25, 4, 0.01).name('Scale (× approx. m)').onChange(applyScale);

const fCam = gui.addFolder('Camera');
fCam.add(P, 'mode', ['Orbit', 'Fly / walk']).name('Mode').onChange(setMode);
fCam.add(P, 'flySpeed', 0.1, 30, 0.1).name('Fly speed (m/s)');
fCam.add(P, 'fov', 15, 110, 1).name('Field of view').onChange(v => { camera.fov = v; camera.updateProjectionMatrix(); });
let photoCtrl = null;
fCam.add({ reset() { resetView(); } }, 'reset').name('Reset view');

const fSun = gui.addFolder('Sun');
fSun.add(P, 'azimuth', 0, 360, 1).name('Direction (°)').onChange(updateLights);
fSun.add(P, 'elevation', -10, 90, 0.5).name('Height (°)').onChange(updateLights);
fSun.add(P, 'sunIntensity', 0, 10, 0.05).name('Intensity').onChange(updateLights);
fSun.add(P, 'useKelvin').name('Use colour temp.').onChange(updateLights);
fSun.add(P, 'sunKelvin', 1800, 12000, 50).name('Colour temp. (K)').onChange(updateLights);
fSun.addColor(P, 'sunColor').name('Colour').onChange(v => { P.useKelvin = false; updateLights(); gui.controllersRecursive().forEach(c => c.updateDisplay()); });
fSun.add(P, 'shadows').name('Shadows').onChange(updateLights);
fSun.add(P, 'shadowSoftness', 0, 8, 0.1).name('Shadow softness').onChange(updateLights);

const fAmb = gui.addFolder('Ambient & sky');
fAmb.add(P, 'hemiIntensity', 0, 4, 0.01).name('Ambient intensity').onChange(updateLights);
fAmb.addColor(P, 'skyColor').name('Sky colour').onChange(updateLights);
fAmb.addColor(P, 'groundColor').name('Ground bounce').onChange(updateLights);
fAmb.add(P, 'background', ['Physical sky', 'Solid colour']).name('Background').onChange(updateLights);
fAmb.addColor(P, 'bgColor').name('Background colour').onChange(updateLights);
fAmb.add(P, 'skyBrightness', 0, 2, 0.01).name('Sky brightness').onChange(updateLights);
fAmb.add(P, 'exposure', 0.1, 4, 0.01).name('Exposure').onChange(updateLights);

const fPre = gui.addFolder('Lighting presets');
for (const [name, vals] of Object.entries(PRESETS)) {
  fPre.add({ go() { Object.assign(P, vals); P.useKelvin = true; if (P.shading === 'Photo (unlit)') { P.shading = 'Relit'; applyShading(); } updateLights(); gui.controllersRecursive().forEach(c => c.updateDisplay()); } }, 'go').name(name);
}

const fHelp = gui.addFolder('Helpers');
fHelp.add(P, 'showSunArrow').name('Sun arrow').onChange(updateLights);
fHelp.add(P, 'showGrid').name('Grid (1 m)').onChange(v => grid.visible = v);
fHelp.add(P, 'showCameras').name('Photo cameras').onChange(v => camMarkers.visible = v);
fHelp.close();
if (innerWidth < 700) gui.close();   // phones: start with the panel collapsed

function resetView() {
  setMode('Orbit');
  const b0 = new THREE.Vector3().fromArray(meta.bounds_min), b1 = new THREE.Vector3().fromArray(meta.bounds_max);
  const c = b0.clone().add(b1).multiplyScalar(0.5 * P.scale);
  const size = b1.clone().sub(b0).length() * P.scale;
  camera.fov = P.fov = 60; camera.updateProjectionMatrix();
  camera.position.set(c.x + size * 0.45, c.y + size * 0.45, c.z + size * 0.65);
  orbit.target.copy(c); orbit.update();
  gui.controllersRecursive().forEach(x => x.updateDisplay());
}

// ---------- main ----------
const posEl = document.getElementById('pos');
const _tmp = new THREE.Vector3();
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  updateTween(dt);
  updateFly(dt);
  if (P.mode === 'Orbit' && !tween) orbit.update();
  for (const m of camMarkers.children) m.visible = m.getWorldPosition(_tmp).distanceTo(camera.position) > 0.6 * P.scale;
  const p = camera.position, s = P.scale;
  posEl.textContent = `x ${(p.x / s).toFixed(2)}  y ${(p.y / s).toFixed(2)}  z ${(p.z / s).toFixed(2)} m · fov ${camera.fov.toFixed(0)}°`;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

(async () => {
  meta = await (await fetch('assets/cameras.json')).json();
  buildCameraMarkers();
  const names = ['—', ...meta.cameras.map(c => c.name)];
  photoCtrl = fCam.add(P, 'photo', names).name('Jump to photo').onChange(v => v !== '—' && jumpToPhoto(v));
  updateLights();
  await loadModel('scene_lite.glb');
  resetView();
  frame();
  window.__viewer = { THREE, scene, camera, P, renderer, setMode, jumpToPhoto };
})();
