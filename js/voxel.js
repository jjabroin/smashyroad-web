// 복셀 차량/소품 빌더 (three.js Box 지오메트리 조립, 사진 1·2 스타일)
import * as THREE from 'three';

const geoCache = new Map();
const matCache = new Map();

export function boxGeo() {
  if (!geoCache.has('unit')) geoCache.set('unit', new THREE.BoxGeometry(1, 1, 1));
  return geoCache.get('unit');
}

export function mat(color) {
  if (!matCache.has(color)) {
    matCache.set(color, new THREE.MeshLambertMaterial({ color }));
  }
  return matCache.get(color);
}

// w,h,d = 크기, x,y,z = 중심 (차량 로컬: +X가 전진 방향, y가 위)
export function part(group, color, w, h, d, x, y, z) {
  const m = new THREE.Mesh(boxGeo(), mat(color));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = true;
  group.add(m);
  return m;
}

function wheels(group, color, positions, r = 0.9, width = 0.8) {
  // 복셀 바퀴: 납작한 박스. 앞바퀴는 조향 피벗 그룹으로 감쌈
  const out = { front: [] };
  for (const [x, z, front] of positions) {
    const pivot = new THREE.Group();
    pivot.position.set(x, r, z);
    const tire = new THREE.Mesh(boxGeo(), mat(color));
    tire.scale.set(r * 1.5, r * 2, width);
    tire.castShadow = true;
    pivot.add(tire);
    const hub = new THREE.Mesh(boxGeo(), mat(0x9aa0a8));
    hub.scale.set(r * 1.54, r * 0.9, width * 1.04);
    pivot.add(hub);
    group.add(pivot);
    if (front) out.front.push(pivot);
  }
  return out;
}

// 빨간 F1 (사진 1 중앙 차량)
export function makeF1(color = 0xe23b2e, accent = 0xffffff) {
  const g = new THREE.Group();
  const dark = 0x141519;
  // 노즈 ~ 콕핏 ~ 리어
  part(g, color, 3.4, 0.55, 1.1, 1.9, 0.75, 0);
  part(g, color, 1.2, 0.5, 0.9, 3.4, 0.7, 0); // 노즈팁
  part(g, accent, 1.25, 0.14, 0.94, 3.4, 0.98, 0);
  part(g, color, 2.6, 0.7, 1.9, -0.4, 0.85, 0); // 사이드포드
  part(g, 0x20242c, 1.3, 0.55, 1.1, 0.1, 1.25, 0); // 콕핏
  part(g, accent, 0.5, 0.6, 0.5, -0.5, 1.35, 0); // 헬멧
  part(g, color, 1.6, 0.6, 1.5, -2.0, 0.9, 0); // 엔진커버
  part(g, accent, 1.62, 0.16, 0.4, -2.0, 1.2, 0); // 스트라이프
  // 프론트 윙 / 리어 윙
  part(g, accent, 0.5, 0.28, 3.4, 3.9, 0.55, 0);
  part(g, color, 0.3, 0.9, 2.6, -2.9, 1.35, 0);
  part(g, color, 1.0, 0.25, 2.6, -3.1, 1.85, 0);
  const w = wheels(g, dark, [[2.6, 1.5, true], [2.6, -1.5, true], [-1.9, 1.7, false], [-1.9, -1.7, false]], 0.85, 0.9);
  g.userData.frontWheels = w.front;
  return g;
}

// 흰 스포츠카
export function makeSports(color = 0xf2f3f5, accent = 0x1c2733) {
  const g = new THREE.Group();
  const dark = 0x141519;
  part(g, color, 5.6, 0.9, 2.6, 0, 0.85, 0);
  part(g, color, 2.2, 0.7, 2.2, 2.6, 0.8, 0); // 보닛
  part(g, accent, 2.0, 0.7, 2.0, -0.2, 1.45, 0); // 캐빈
  part(g, 0x9fd8ef, 1.1, 0.5, 2.02, 0.35, 1.45, 0); // 윈드실드
  part(g, accent, 0.5, 0.5, 2.8, -2.9, 1.3, 0); // 스포일러
  part(g, color, 1.4, 0.35, 2.2, -1.9, 1.35, 0);
  const w = wheels(g, dark, [[1.9, 1.35, true], [1.9, -1.35, true], [-1.9, 1.35, false], [-1.9, -1.35, false]], 0.8, 0.7);
  g.userData.frontWheels = w.front;
  return g;
}

// 검정 픽업 (사진 1 우상단)
export function makePickup(color = 0x23262b, accent = 0x3a3f47) {
  const g = new THREE.Group();
  const dark = 0x0e0f12;
  part(g, color, 2.6, 1.1, 2.7, 1.6, 1.15, 0); // 캡
  part(g, 0x9fd8ef, 0.9, 0.7, 2.4, 2.0, 1.35, 0); // 유리
  part(g, accent, 3.0, 0.9, 2.7, -1.4, 1.0, 0); // 적재함
  part(g, dark, 2.9, 0.25, 2.5, -1.4, 1.5, 0); // 적재함 내부
  part(g, color, 0.7, 0.5, 2.75, 3.0, 0.75, 0); // 범퍼
  const w = wheels(g, dark, [[2.0, 1.45, true], [2.0, -1.45, true], [-1.6, 1.45, false], [-1.6, -1.45, false]], 0.95, 0.8);
  g.userData.frontWheels = w.front;
  return g;
}

// 파랑 트럭
export function makeTruck(color = 0x1f4fa8, accent = 0xdfe6f2) {
  const g = new THREE.Group();
  const dark = 0x141519;
  part(g, color, 2.2, 1.9, 2.7, 2.4, 1.55, 0); // 캡
  part(g, 0x9fd8ef, 0.8, 0.8, 2.5, 2.7, 1.9, 0);
  part(g, accent, 0.5, 0.4, 2.0, 3.55, 0.9, 0); // 그릴
  part(g, accent, 4.6, 2.2, 2.8, -1.4, 1.7, 0); // 화물칸
  part(g, color, 4.62, 0.4, 2.82, -1.4, 2.6, 0);
  const w = wheels(g, dark, [[2.4, 1.45, true], [2.4, -1.45, true], [-1.2, 1.45, false], [-1.2, -1.45, false], [-2.6, 1.45, false], [-2.6, -1.45, false]], 0.95, 0.8);
  g.userData.frontWheels = w.front;
  return g;
}

export const CAR_BUILDERS = { f1: makeF1, sports: makeSports, pickup: makePickup, truck: makeTruck };

// 복셀 드라이버 (차고 전시용)
export function makeDriver(shirt = 0xc9a227, pants = 0x23262b, skin = 0xf0c8a0) {
  const g = new THREE.Group();
  part(g, pants, 0.9, 1.1, 0.6, 0, 0.55, 0);
  part(g, 0x141519, 1.0, 0.3, 0.7, 0, 0.15, 0);
  part(g, shirt, 1.0, 1.2, 0.7, 0, 1.7, 0);
  part(g, skin, 0.45, 1.0, 0.45, -0.75, 1.6, 0);
  part(g, skin, 0.45, 1.0, 0.45, 0.75, 1.6, 0);
  part(g, skin, 0.8, 0.8, 0.8, 0, 2.7, 0);
  part(g, 0x2b2b2b, 0.9, 0.5, 0.9, 0, 3.25, 0); // 모자/헤어
  return g;
}

// --- 트랙 사이드 소품 ---
export function makeBench() {
  const g = new THREE.Group();
  const wood = 0x2b2b2b;
  part(g, wood, 0.5, 0.15, 3.2, 0, 1.0, 0);
  part(g, wood, 0.15, 1.1, 3.2, -0.35, 1.5, 0);
  part(g, wood, 0.4, 1.0, 0.3, 0, 0.5, 1.4);
  part(g, wood, 0.4, 1.0, 0.3, 0, 0.5, -1.4);
  return g;
}

export function makeLamp() {
  const g = new THREE.Group();
  part(g, 0x2b2b33, 0.35, 6.5, 0.35, 0, 3.25, 0);
  part(g, 0x2b2b33, 1.6, 0.3, 0.3, 0.7, 6.4, 0);
  part(g, 0xffe9a3, 0.5, 0.35, 0.5, 1.4, 6.25, 0);
  return g;
}

export function makeTree() {
  const g = new THREE.Group();
  part(g, 0x6b4a2f, 0.9, 2.2, 0.9, 0, 1.1, 0);
  part(g, 0x2f9e5f, 2.6, 1.8, 2.6, 0, 3.0, 0);
  part(g, 0x37b56c, 1.8, 1.2, 1.8, 0, 4.2, 0);
  return g;
}

export function makeTireStack() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    part(g, 0x1c1e24, 1.6, 0.6, 1.6, 0, 0.3 + i * 0.62, 0);
    part(g, 0xe23b2e, 1.62, 0.18, 1.62, 0, 0.55 + i * 0.62, 0);
  }
  return g;
}

// 스타트 간트리 (기둥 + 체커보드 배너)
export function makeGantry(roadWidth) {
  const g = new THREE.Group();
  const w = roadWidth + 6;
  part(g, 0x3a3f47, 1.2, 9, 1.2, 0, 4.5, -w / 2);
  part(g, 0x3a3f47, 1.2, 9, 1.2, 0, 4.5, w / 2);
  part(g, 0x23262b, 1.0, 1.6, w, 0, 8.6, 0);
  // 체커보드
  const n = 12;
  for (let i = 0; i < n; i++) {
    part(g, i % 2 ? 0x111111 : 0xffffff, 1.04, 0.75, w / n, 0, 8.25 + (i % 2) * 0.0, -w / 2 + (w / n) * (i + 0.5));
  }
  return g;
}
