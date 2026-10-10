// 외부 에셋(GLB/HDR/JPG) 로더 + 차량 리그 + 소품 팩토리
// 출처: Kenney(CC0) 차량·소품, Poly Haven(CC0) 하늘, AmbientCG(CC0) 노면
// ※ 로드 실패 시 복셀 폴백(voxel.js)으로 게임이 깨지지 않게
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR_BUILDERS } from './voxel.js?v=4a85b8';

const VPATH = 'assets/models/vehicles/';
const PPATH = 'assets/models/props/';
const GPATH = 'assets/models/ground/';
const SPATH = 'assets/models/sky/';

const gltfLoader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const hdrLoader = new RGBELoader();

// 차량 스펙: file, 목표 전장(기존 복셀 풋프린트 유지 → 물리·충돌 그대로), 전진축 부호, 변형 틴트
export const VEHICLES = {
  f1: { file: 'f1.glb', len: 7.0, fwd: 1 },
  f1shadow: { file: 'f1w.glb', len: 7.0, fwd: 1, tint: 0x2a2e35 },
  sports: { file: 'sports.glb', len: 5.6, fwd: 1 },
  gtsgold: { file: 'sports.glb', len: 5.6, fwd: 1, tint: 0xffc93c },
  pickup: { file: 'pickup.glb', len: 6.4, fwd: 1, tint: 0x4a4a52 },
  truck: { file: 'truck.glb', len: 7.5, fwd: 1, tint: 0x2f6fd6 },
  taxi: { file: 'taxi.glb', len: 5.4, fwd: 1 },
  rally: { file: 'rally.glb', len: 5.2, fwd: 1 },
  rallystorm: { file: 'rally.glb', len: 5.2, fwd: 1, tint: 0x14e0d0 },
  monster: { file: 'monster.glb', len: 7.2, fwd: -1 },
  monsterking: { file: 'monster.glb', len: 7.2, fwd: -1, tint: 0xd63a2f },
  police: { file: 'police.glb', len: 5.4, fwd: 1 },
  policex: { file: 'police.glb', len: 5.4, fwd: 1, tint: 0x2f6bff },
  comet: { file: 'comet.glb', len: 6.4, fwd: 1 },
  cometneo: { file: 'comet.glb', len: 6.4, fwd: 1, tint: 0x27e0f5 },
};

// 소품 스펙: file, 균일 스케일 또는 [x,y,z]
export const PROPS = {
  tree: { file: 'tree.glb', s: 3 },
  pine: { file: 'pine.glb', s: 3.5 },
  cactus: { file: 'cactus.glb', s: 4.5 },
  rock: { file: 'rock.glb', s: 3.5 },
  rock2: { file: 'rock2.glb', s: 3 },
  bench: { file: 'bench.glb', s: [8, 3, 8] },
  lamp: { file: 'lamp.glb', s: 9 },
  flag: { file: 'flag.glb', s: 5 },
  billboard: { file: 'billboard.glb', s: 8 },
  wheel: { file: 'wheel.glb', s: 2 },
  gantry: { file: 'gantry.glb', s: 1 },
  startplate: { file: 'startplate.glb', s: 1 },
  'building-a': { file: 'building-a.glb', s: 1 },
  'building-b': { file: 'building-b.glb', s: 1 },
  'skyscraper-a': { file: 'skyscraper-a.glb', s: 1 },
  'skyscraper-b': { file: 'skyscraper-b.glb', s: 1 },
};

const templateCache = new Map(); // url -> gltf.scene (원본, 복제용)
const fixedColors = new Set(); // sRGB 보정済 정점색
const skyCache = new Map();
const groundCache = new Map();

function loadGLB(url) {
  if (templateCache.has(url)) return templateCache.get(url);
  const p = new Promise((resolve) => {
    gltfLoader.load(url, (g) => {
      try {
        // Standard → Lambert 통일 (기존 복셀 룩 + 모바일 성능)
        // map·정점색·투명·양면 유지
        if (g.scene) {
          g.scene.traverse((o) => {
            if (o.isMesh) {
              // 정점색 sRGB→linear 보정 (wash-out 방지)
              try {
                const ca = o.geometry && o.geometry.attributes.color;
                if (ca && !fixedColors.has(ca)) {
                  fixedColors.add(ca);
                  const c = new THREE.Color();
                  for (let i = 0; i < ca.count; i++) {
                    c.setRGB(ca.getX(i), ca.getY(i), ca.getZ(i), THREE.SRGBColorSpace);
                    ca.setXYZ(i, c.r, c.g, c.b);
                  }
                  ca.needsUpdate = true;
                }
              } catch (e) { /* 무시 */ }
              const ms = Array.isArray(o.material) ? o.material : [o.material];
              const conv = ms.map((m) => {
                if (!m || !m.isMeshStandardMaterial) return m;
                const l = new THREE.MeshLambertMaterial({
                  map: m.map || null,
                  color: new THREE.Color(0xffffff),
                  transparent: m.transparent || false,
                  opacity: m.opacity !== undefined ? m.opacity : 1,
                  side: m.side !== undefined ? m.side : THREE.FrontSide,
                  alphaTest: m.alphaTest || 0,
                });
                // GLTF 단색(baseColorFactor)이 sRGB 그대로 들어오므로 linear로 보정
                try {
                  if (m.color) l.color.copy(m.color).convertSRGBToLinear();
                } catch (e) {
                  if (m.color) l.color.copy(m.color);
                }
                if (m.vertexColors || (o.geometry && o.geometry.attributes.color)) l.vertexColors = true;
                return l;
              });
              o.material = Array.isArray(o.material) ? conv : conv[0];
            }
          });
        }
      } catch (e) { /* 무시 */ }
      resolve(g.scene || null);
    }, undefined, () => resolve(null));
  });
  templateCache.set(url, p);
  return p;
}

function isFrontWheel(name, z, centerZ, fwd) {
  const n = (name || '').toLowerCase();
  if (n.includes('front')) return true;
  if (n.includes('back') || n.includes('rear')) return false;
  const m = n.match(/wheel-([fb])[lr]/);
  if (m) return m[1] === 'f';
  return (z - centerZ) * fwd > 0;
}

// GLB 차량 → 게임 리그 (래퍼 회전으로 +X 전진, 앞바퀴 조향 피벗, 전륜 스핀)
// userData: frontWheels[](조향, 기존 코드 호환), spinWheels[](구름), wheelR(반지름)
export async function rigVehicleAsync(id) {
  const spec = VEHICLES[id];
  if (!spec) return null;
  const tpl = await loadGLB(VPATH + spec.file);
  if (!tpl) return null;
  try {
    const root = tpl.clone(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    if (!(size.z > 0)) return null;
    const s = spec.len / size.z;
    const frontWheels = [];
    const spinWheels = [];
    let wheelR = 0.5 * s;
    const wheelNodes = [];
    root.traverse((o) => {
      if (o.isMesh && /wheel/i.test(o.name)) wheelNodes.push(o);
    });
    for (const wn of wheelNodes) {
      const wb = new THREE.Box3().setFromObject(wn);
      const ws = new THREE.Vector3();
      wb.getSize(ws);
      wheelR = Math.max(ws.y, ws.z) / 2;
      const pivot = new THREE.Group();
      pivot.position.copy(wn.position);
      pivot.userData.steer = true;
      const spin = new THREE.Group();
      spin.userData.spin = true;
      wn.position.set(0, 0, 0);
      if (wn.parent) wn.parent.remove(wn);
      pivot.add(spin);
      spin.add(wn);
      root.add(pivot);
      spinWheels.push(spin);
      if (isFrontWheel(wn.name, pivot.position.z, center.z, spec.fwd)) frontWheels.push(pivot);
    }
    wheelR *= s;
    root.position.set(-center.x, -box.min.y, -center.z);
    const scaler = new THREE.Group();
    scaler.add(root);
    scaler.scale.setScalar(s);
    const wrap = new THREE.Group();
    wrap.add(scaler);
    wrap.rotation.y = spec.fwd * Math.PI / 2; // 모델 +Z(또는 -Z) → 게임 +X
    wrap.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    if (spec.tint !== undefined) {
      const t = new THREE.Color(spec.tint);
      const seen = new Set();
      wrap.traverse((o) => {
        if (o.isMesh && o.material && !seen.has(o.material)) {
          seen.add(o.material);
          o.material = o.material.clone();
          if (o.material.color) o.material.color.multiply(t);
        }
      });
    }
    wrap.userData.frontWheels = frontWheels;
    wrap.userData.spinWheels = spinWheels;
    wrap.userData.wheelR = wheelR;
    wrap.userData.glb = true;
    return wrap;
  } catch (e) {
    return null;
  }
}

const rigCache = new Map(); // id -> rigged template (복제용)
export async function preloadVehicles() {
  await Promise.all(Object.keys(VEHICLES).map(async (id) => {
    if (rigCache.has(id)) return;
    const r = await rigVehicleAsync(id);
    if (r) rigCache.set(id, r);
  }));
}

// 동기 차량 생성 (프리로드된 GLB 복제, 없으면 복셀 폴백)
export function buildCar(id, color, accent) {
  const tpl = rigCache.get(id);
  if (tpl) {
    const c = tpl.clone(true);
    // 복제본의 피벗 참조 재수집 (clone은 userData 배열을 공유하므로)
    const fw = [];
    const sw = [];
    c.traverse((o) => {
      if (o.userData && o.userData.steer) fw.push(o);
      if (o.userData && o.userData.spin) sw.push(o);
    });
    c.userData.frontWheels = fw.length ? fw : [];
    c.userData.spinWheels = sw.length ? sw : [];
    c.userData.wheelR = tpl.userData.wheelR;
    c.userData.glb = true;
    return c;
  }
  const fn = CAR_BUILDERS[id] || CAR_BUILDERS.sports;
  const g = fn(color, accent);
  g.userData.spinWheels = [];
  g.userData.wheelR = 1;
  return g;
}

// 소품 프리로드 + 동기 복제 (min-y 정규화로 지면 밀착)
const propMeta = new Map(); // kind -> {tpl, yOff}
export async function preloadProps() {
  await Promise.all(Object.keys(PROPS).map(async (kind) => {
    try {
      const tpl = await loadGLB(PPATH + PROPS[kind].file);
      if (!tpl) return;
      const box = new THREE.Box3().setFromObject(tpl);
      propMeta.set(kind, { tpl, yOff: -box.min.y });
    } catch (e) { /* 무시 */ }
  }));
}

export function propMesh(kind) {
  const meta = propMeta.get(kind);
  if (!meta) return null;
  const c = meta.tpl.clone(true);
  const s = PROPS[kind].s;
  const sy = Array.isArray(s) ? s[1] : s;
  if (Array.isArray(s)) c.scale.set(s[0], s[1], s[2]);
  else c.scale.setScalar(s);
  c.position.y = meta.yOff * sy;
  c.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });
  // 호출자가 position을 자유롭게 덮어쓸 수 있게 오프셋 래퍼로 반환
  const wrap = new THREE.Group();
  wrap.add(c);
  wrap.userData.inner = c;
  return wrap;
}

// 타이어 더미 (휠 3단 적재, 복셀 makeTireStack 대체)
export function tireStackMesh() {
  const g = new THREE.Group();
  const ys = [0, 0.8, 1.6];
  for (const y of ys) {
    const w = propMesh('wheel');
    if (!w) return null;
    w.userData.inner.rotation.z = Math.PI / 2; // 액슬 수직으로 눕힘
    w.position.y = y;
    g.add(w);
  }
  return g;
}

// 그룹 범위 서브지오메트리 (정점 리맵 포함)
function subGeo(geo, start, count) {
  const g = new THREE.BufferGeometry();
  const idx = geo.index;
  const end = Math.min(start + count, idx ? idx.count : geo.attributes.position.count);
  const used = new Map();
  const order = [];
  const getNew = (old) => {
    let ni = used.get(old);
    if (ni === undefined) {
      ni = order.length;
      used.set(old, ni);
      order.push(old);
    }
    return ni;
  };
  if (idx) {
    const nIdx = end - start;
    const NewIdx = idx.array.constructor === Uint32Array ? Uint32Array : Uint16Array;
    const narr = new NewIdx(nIdx);
    for (let i = 0; i < nIdx; i++) narr[i] = getNew(idx.array[start + i]);
    g.setIndex(new THREE.BufferAttribute(narr, 1));
  } else {
    for (let i = start; i < end; i++) getNew(i);
  }
  for (const name of Object.keys(geo.attributes)) {
    const attr = geo.attributes[name];
    const narr = new attr.array.constructor(order.length * attr.itemSize);
    for (let i = 0; i < order.length; i++) {
      for (let k = 0; k < attr.itemSize; k++) {
        narr[i * attr.itemSize + k] = attr.array[order[i] * attr.itemSize + k];
      }
    }
    g.setAttribute(name, new THREE.BufferAttribute(narr, attr.itemSize));
  }
  return g;
}

// GLB 프리미티브 합성 → 단일 지오메트리 (InstancedMesh용, 정점색 베이크)
export async function bakedGeometry(url) {
  const tpl = await loadGLB(url);
  if (!tpl) return null;
  try {
    const geos = [];
    tpl.updateMatrixWorld(true);
    tpl.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const groups = o.geometry.groups && o.geometry.groups.length
        ? o.geometry.groups
        : [{ start: 0, count: Infinity, materialIndex: 0 }];
      for (const gr of groups) {
        const cnt = Math.min(gr.count, (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) - gr.start);
        if (!(cnt > 0)) continue;
        const g = o.geometry.index ? subGeo(o.geometry, gr.start, cnt) : o.geometry.clone();
        g.applyMatrix4(o.matrixWorld);
        const col = (mats[gr.materialIndex] || mats[0] || {}).color;
        const n = g.attributes.position.count;
        const arr = new Float32Array(n * 3);
        const cc = col ? [col.r, col.g, col.b] : [1, 1, 1];
        for (let i = 0; i < n; i++) {
          arr[i * 3] = cc[0];
          arr[i * 3 + 1] = cc[1];
          arr[i * 3 + 2] = cc[2];
        }
        g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        // 머지 호환: 노멀·uv 보장
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!g.attributes.uv) {
          g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
        }
        geos.push(g);
      }
    });
    if (!geos.length) return null;
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose && g !== merged && g.dispose());
    return merged;
  } catch (e) {
    return null;
  }
}

export function vertexColorMaterial() {
  return new THREE.MeshLambertMaterial({ vertexColors: true });
}

// 정적 인스턴싱 지오메트리 (가드레일·연석): 프리로드 시 1회 베이크+중심 정규화
const staticGeos = new Map();
export async function preloadStatic() {
  const jobs = [
    ['guard', PPATH + 'guard.glb', 0.5, -0.06],
    ['curbRed', PPATH + 'curbRed.glb', 0.125, -0.06],
    ['curbWhite', PPATH + 'curbWhite.glb', 0.125, -0.06],
  ];
  await Promise.all(jobs.map(async ([key, url, cx, cz]) => {
    try {
      const g = await bakedGeometry(url);
      if (g) {
        g.translate(-cx, 0, -cz);
        staticGeos.set(key, g);
      }
    } catch (e) { /* 무시 */ }
  }));
}

export function staticGeo(key) {
  return staticGeos.get(key) || null;
}

// 빌딩 (4종 랜덤, 목표 높이로 균일 스케일)
const BUILDINGS = [
  { kind: 'building-a', h: 1.29 },
  { kind: 'building-b', h: 1.29 },
  { kind: 'skyscraper-a', h: 2.88 },
  { kind: 'skyscraper-b', h: 2.88 },
];
export function buildingMesh() {
  const b = BUILDINGS[(Math.random() * BUILDINGS.length) | 0];
  const meta = propMeta.get(b.kind);
  if (!meta) return null;
  const h = 10 + Math.random() * 14;
  const c = meta.tpl.clone(true);
  c.scale.setScalar(h / b.h);
  c.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return c;
}

// 스타트 게이트 (오버헤드 라이트 아치: 스팬=도로폭+8)
export function gateMesh(span) {
  const meta = propMeta.get('gantry');
  if (!meta) return null;
  const inner = meta.tpl.clone(true);
  inner.rotation.y = Math.PI / 2; // 스팬을 Z(도로 가로)로
  const wrap = new THREE.Group();
  wrap.add(inner);
  wrap.scale.set(3, 10, span / 1.26);
  wrap.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return wrap;
}

// 스타트 플레이트 (도로폭 맞춤)
export function startPlateMesh(roadWidth) {
  const meta = propMeta.get('startplate');
  if (!meta) return null;
  const c = meta.tpl.clone(true);
  c.scale.set(roadWidth / 1.26, 1.5, 1.5);
  c.traverse((o) => {
    if (o.isMesh) o.receiveShadow = true;
  });
  return c;
}

// 노면 텍스처 (asphalt/grass/sand)
export function groundTexture(kind) {
  if (groundCache.has(kind)) return groundCache.get(kind);
  const p = new Promise((resolve) => {
    texLoader.load(GPATH + kind + '.jpg', (t) => {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      resolve(t);
    }, undefined, () => resolve(null));
  });
  groundCache.set(kind, p);
  return p;
}

// 테마 하늘 (HDR 이콰이렉트, lazy)
const SKY_BY_THEME = { park: 'park.hdr', forest: 'park.hdr', desert: 'desert.hdr', city: 'city.hdr' };
export function skyTexture(themeId) {
  const file = SKY_BY_THEME[themeId] || 'park.hdr';
  if (skyCache.has(file)) return skyCache.get(file);
  const p = new Promise((resolve) => {
    hdrLoader.load(SPATH + file, (t) => {
      t.mapping = THREE.EquirectangularReflectionMapping;
      resolve(t);
    }, undefined, () => resolve(null));
  });
  skyCache.set(file, p);
  return p;
}

export async function preloadModels() {
  await Promise.all([preloadVehicles(), preloadProps(), preloadStatic()]);
  await Promise.all([groundTexture('asphalt'), groundTexture('grass'), groundTexture('sand')]);
}
