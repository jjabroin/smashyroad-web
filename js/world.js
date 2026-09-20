// three.js 월드: 도로 리본·연석·간트리·장식·조명 (사진 1 스타일)
import * as THREE from 'three';
import { mat } from './voxel.js';
import { makeBench, makeLamp, makeTree, makeTireStack, makeGantry, makeCactus, makeRock, makeBuilding } from './voxel.js';

export const ROAD_HALF = 11;

export const THEMES = {
  park: { sky: 0xa8dcf0, ground: 0x7fd08a, patch: 0x74c47f },
  desert: { sky: 0xf6d9a0, ground: 0xe3c48d, patch: 0xd9b67f },
  city: { sky: 0xffc98a, ground: 0x8f959d, patch: 0x848a93 },
};

function ribbonGeometry(circuit, halfW, y) {
  const n = circuit.count;
  const pos = new Float32Array(n * 2 * 3);
  const idx = [];
  for (let i = 0; i < n; i++) {
    const p = circuit.pts[i];
    const px = -p.dz;
    const pz = p.dx;
    pos.set([p.x + px * halfW, y, p.z + pz * halfW], i * 6);
    pos.set([p.x - px * halfW, y, p.z - pz * halfW], i * 6 + 3);
    const a = i * 2;
    const b = i * 2 + 1;
    const c = ((i + 1) % n) * 2;
    const d = ((i + 1) % n) * 2 + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function createWorld(scene, circuit, themeId = 'park') {
  const theme = THEMES[themeId] || THEMES.park;
  const SKY = theme.sky;
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 260, 800);

  // 조명
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3f7a4e, 0.95));
  const sun = new THREE.DirectionalLight(0xfff6e0, 1.6);
  sun.position.set(120, 180, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -160;
  sun.shadow.camera.right = 160;
  sun.shadow.camera.top = 160;
  sun.shadow.camera.bottom = -160;
  sun.shadow.camera.far = 600;
  scene.add(sun);
  scene.add(sun.target);

  const colliders = []; // {x, z, r} — 장애물 충돌 + 대미지용 (간트리·장식 공통)

  // 잔디
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 1400),
    new THREE.MeshLambertMaterial({ color: theme.ground })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(grass);

  // 잔디 질감 패치
  {
    const g = new THREE.BoxGeometry(1, 0.04, 1);
    const m = new THREE.MeshLambertMaterial({ color: theme.patch });
    const inst = new THREE.InstancedMesh(g, m, 60);
    const M = new THREE.Matrix4();
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 60; i++) {
      const x = (rnd() - 0.5) * 640;
      const z = (rnd() - 0.5) * 480;
      const s = 12 + rnd() * 26;
      M.makeScale(s, 1, s * (0.6 + rnd() * 0.8));
      M.setPosition(x, 0.02, z);
      inst.setMatrixAt(i, M);
    }
    inst.receiveShadow = true;
    scene.add(inst);
  }

  // 아스팔트
  const road = new THREE.Mesh(
    ribbonGeometry(circuit, ROAD_HALF, 0.05),
    new THREE.MeshLambertMaterial({ color: 0x41454e })
  );
  road.receiveShadow = true;
  scene.add(road);

  const dummy = new THREE.Object3D();

  // 중앙 흰 점선
  {
    const count = Math.floor(circuit.length / 14);
    const inst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(4, 0.06, 0.55),
      new THREE.MeshLambertMaterial({ color: 0xf4f6f8 }),
      count
    );
    for (let i = 0; i < count; i++) {
      const p = circuit.pointAt(i * 14);
      dummy.position.set(p.x, 0.09, p.z);
      dummy.rotation.set(0, -Math.atan2(p.dz, p.dx), 0);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    scene.add(inst);
  }

  // 노란 가장자리선
  for (const side of [1, -1]) {
    const n = circuit.count;
    const pos = new Float32Array(n * 2 * 3);
    const idx = [];
    const off = ROAD_HALF - 0.9;
    for (let i = 0; i < n; i++) {
      const p = circuit.pts[i];
      const px = -p.dz;
      const pz = p.dx;
      const cx = p.x + px * off * side;
      const cz = p.z + pz * off * side;
      pos.set([cx + px * 0.28, 0.09, cz + pz * 0.28], i * 6);
      pos.set([cx - px * 0.28, 0.09, cz - pz * 0.28], i * 6 + 3);
      const a = i * 2;
      const b = i * 2 + 1;
      const c = ((i + 1) % n) * 2;
      const d = ((i + 1) % n) * 2 + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xf2c230 })));
  }

  // 빨강/흰 연석
  {
    const step = 7;
    const count = Math.floor(circuit.length / step);
    const geo = new THREE.BoxGeometry(3.4, 0.35, 1.6);
    const red = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xd63a2f }), count * 2);
    const white = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xf4f6f8 }), count * 2);
    let ri = 0;
    let wi = 0;
    for (let i = 0; i < count; i++) {
      const p = circuit.pointAt(i * step);
      const ang = -Math.atan2(p.dz, p.dx);
      for (const side of [1, -1]) {
        const useRed = (i + (side > 0 ? 0 : 1)) % 2 === 0;
        dummy.position.set(
          p.x + -p.dz * side * (ROAD_HALF + 1.4),
          0.18,
          p.z + p.dx * side * (ROAD_HALF + 1.4)
        );
        dummy.rotation.set(0, ang, 0);
        dummy.updateMatrix();
        if (useRed) red.setMatrixAt(ri++, dummy.matrix);
        else white.setMatrixAt(wi++, dummy.matrix);
      }
    }
    red.count = ri;
    white.count = wi;
    red.castShadow = white.castShadow = true;
    scene.add(red, white);
  }

  // 스타트 라인(체커) + 간트리
  {
    const p0 = circuit.pointAt(0);
    const ang = -Math.atan2(p0.dz, p0.dx);
    const across = 8;
    for (let i = 0; i < across * 2; i++) {
      const lat = -ROAD_HALF + (i + 0.5) * ((ROAD_HALF * 2) / (across * 2));
      for (let r = 0; r < 2; r++) {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(1.4, 0.07, (ROAD_HALF * 2) / (across * 2)),
          mat((i + r) % 2 ? 0x111111 : 0xffffff)
        );
        const along = r * 1.4 - 0.7;
        m.position.set(
          p0.x + p0.dx * along + -p0.dz * lat,
          0.1,
          p0.z + p0.dz * along + p0.dx * lat
        );
        m.rotation.y = ang;
        scene.add(m);
      }
    }
    const gantry = makeGantry(ROAD_HALF * 2);
    gantry.position.set(p0.x, 0, p0.z);
    gantry.rotation.y = ang + Math.PI / 2;
    scene.add(gantry);
    // 간트리 기둥도 장애물 (도로 양옆)
    for (const s of [-1, 1]) {
      const v = new THREE.Vector3(0, 0, (s * (ROAD_HALF * 2 + 6)) / 2);
      gantry.localToWorld(v);
      colliders.push({ x: v.x, z: v.z, r: 1.4 });
    }
  }

  // 장식: 나무/벤치/가로등/타이어 (트랙 바깥에 배치)
  let seed = 1234567;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const placed = [];
  const registerCollider = (obj) => {
    const box = new THREE.Box3().setFromObject(obj);
    const s = new THREE.Vector3();
    box.getSize(s);
    colliders.push({ x: obj.position.x, z: obj.position.z, r: Math.max(s.x, s.z) / 2 });
  };
  const tryPlace = (obj, minOff, maxOff) => {
    for (let t = 0; t < 24; t++) {
      const d = rnd() * circuit.length;
      const side = rnd() > 0.5 ? 1 : -1;
      const off = minOff + rnd() * (maxOff - minOff);
      const p = circuit.pointAt(d);
      const x = p.x + -p.dz * side * off;
      const z = p.z + p.dx * side * off;
      if (placed.some((q) => Math.hypot(q.x - x, q.z - z) < 18)) continue;
      // 다른 샘플과도 너무 가깝지 않게
      const pr = circuit.project(x, z);
      if (Math.abs(pr.lateral) < ROAD_HALF + 8) continue;
      obj.position.set(x, 0, z);
      obj.rotation.y = rnd() * Math.PI * 2;
      scene.add(obj);
      placed.push({ x, z });
      registerCollider(obj);
      return true;
    }
    return false;
  };
  if (themeId === 'park') {
    for (let i = 0; i < 26; i++) tryPlace(makeTree(), 26, 120);
    for (let i = 0; i < 10; i++) tryPlace(makeBench(), 18, 30);
    for (let i = 0; i < 12; i++) tryPlace(makeLamp(), 16, 24);
    for (let i = 0; i < 8; i++) tryPlace(makeTireStack(), 15, 22);
  } else if (themeId === 'desert') {
    for (let i = 0; i < 22; i++) tryPlace(makeCactus(), 24, 110);
    for (let i = 0; i < 16; i++) tryPlace(makeRock(), 20, 90);
    for (let i = 0; i < 8; i++) tryPlace(makeTireStack(), 15, 22);
  } else {
    for (let i = 0; i < 20; i++) tryPlace(makeBuilding(), 34, 130);
    for (let i = 0; i < 14; i++) tryPlace(makeLamp(), 16, 24);
    for (let i = 0; i < 8; i++) tryPlace(makeTireStack(), 15, 22);
  }

  // 물 + 목재 부두 (공원 테마만, 남쪽 바깥)
  if (themeId === 'park') {
    const water = new THREE.Mesh(
      new THREE.BoxGeometry(700, 0.1, 120),
      new THREE.MeshLambertMaterial({ color: 0x54d6e8 })
    );
    water.position.set(0, -0.4, -260);
    scene.add(water);
    for (let i = 0; i < 14; i++) {
      const plank = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 0.3, 26),
        new THREE.MeshLambertMaterial({ color: 0x8a6b46 })
      );
      plank.position.set(-220 + i * 3.6, 0.1, -212);
      plank.castShadow = plank.receiveShadow = true;
      scene.add(plank);
    }
    for (const px of [-232, -188]) {
      for (const pz of [-202, -222]) {
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.8, 2.4, 0.8),
          new THREE.MeshLambertMaterial({ color: 0x5e4630 })
        );
        post.position.set(px, -0.4, pz);
        scene.add(post);
      }
    }
  }

  return { sun, colliders };
}

// 그리드 슬롯 4대 (2열 × 2행, 스타트라인 뒤)
export function gridSlots(circuit) {
  const slots = [];
  const rows = [
    { back: 10, lat: -4 },
    { back: 10, lat: 4 },
    { back: 19, lat: -4 },
    { back: 19, lat: 4 },
  ];
  for (const r of rows) {
    const p = circuit.pointAt(circuit.length - r.back);
    slots.push({
      x: p.x + -p.dz * r.lat,
      z: p.z + p.dx * r.lat,
      heading: Math.atan2(p.dz, p.dx),
    });
  }
  return slots;
}
