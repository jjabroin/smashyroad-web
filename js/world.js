// three.js 월드: 도로 리본·연석·간트리·장식·조명 (사진 1 스타일)
import * as THREE from 'three';
import { mat } from './voxel.js?v=35aa4d';
import { makeBench, makeLamp, makeTree, makeTireStack, makeGantry, makeCactus, makeRock, makeBuilding } from './voxel.js?v=35aa4d';
import { trackY } from './track.js?v=d88ddf';

export const ROAD_HALF = 11;

function ptSegDistWorld(px, pz, g) {
  const dx = g.bx - g.ax;
  const dz = g.bz - g.az;
  const L2 = dx * dx + dz * dz || 1;
  let t = ((px - g.ax) * dx + (pz - g.az) * dz) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (g.ax + dx * t), pz - (g.az + dz * t));
}

export const THEMES = {
  park: { sky: 0xa8dcf0, ground: 0x7fd08a, patch: 0x74c47f, fog: [260, 800] },
  desert: { sky: 0xf6d9a0, ground: 0xe3c48d, patch: 0xd9b67f, fog: [260, 800] },
  city: { sky: 0xffc98a, ground: 0x8f959d, patch: 0x848a93, fog: [260, 800] },
  forest: { sky: 0xa8d8e8, ground: 0x55a862, patch: 0x4c9a58, fog: [170, 620] },
};

function ribbonGeometry(circuit, halfW, yFn) {
  const n = circuit.count;
  const pos = new Float32Array(n * 2 * 3);
  const idx = [];
  for (let i = 0; i < n; i++) {
    const p = circuit.pts[i];
    const px = -p.dz;
    const pz = p.dx;
    const y = yFn(circuit.cum[i]);
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

export function createWorld(scene, circuit, themeId = 'park', shortcuts = false, feat = {}) {
  const theme = THEMES[themeId] || THEMES.park;
  const RH = circuit.roadHalf || ROAD_HALF;
  const SKY = theme.sky;
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, theme.fog[0], theme.fog[1]);

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

  // 지형 높이: 트랙 고도를 따라가되 멀어질수록 0으로 (언덕 추종)
  const groundHeightAt = (x, z) => {
    const pr = circuit.project(x, z);
    return trackY(circuit, pr.dist) * Math.exp(-Math.pow(Math.abs(pr.lateral) / 70, 2));
  };
  const registerCollider = (obj) => {
    const box = new THREE.Box3().setFromObject(obj);
    const s = new THREE.Vector3();
    box.getSize(s);
    colliders.push({ x: obj.position.x, z: obj.position.z, r: Math.max(s.x, s.z) / 2 });
  };

  // 잔디 (지형 변위)
  const grassGeo = new THREE.PlaneGeometry(1400, 1400, 100, 100);
  grassGeo.rotateX(-Math.PI / 2);
  {
    const posA = grassGeo.attributes.position;
    for (let i = 0; i < posA.count; i++) {
      posA.setY(i, groundHeightAt(posA.getX(i), posA.getZ(i)));
    }
    grassGeo.computeVertexNormals();
  }
  const grass = new THREE.Mesh(
    grassGeo,
    new THREE.MeshLambertMaterial({ color: theme.ground })
  );
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
      M.setPosition(x, groundHeightAt(x, z) + 0.03, z);
      inst.setMatrixAt(i, M);
    }
    inst.receiveShadow = true;
    scene.add(inst);
  }

  // 아스팔트 (고도 추종)
  const road = new THREE.Mesh(
    ribbonGeometry(circuit, RH, (d) => trackY(circuit, d) + 0.05),
    new THREE.MeshLambertMaterial({ color: 0x41454e })
  );
  road.receiveShadow = true;
  scene.add(road);

  // 고가 지지 기둥 (수직 맵용: 도로가 뜬 곳에 콘크리트 기둥)
  if (feat.pillars) {
    const step = 24;
    const count = Math.floor(circuit.length / step);
    const inst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(7, 1, 7),
      new THREE.MeshLambertMaterial({ color: 0x9aa0a8 }),
      count
    );
    const dm = new THREE.Object3D();
    let placed = 0;
    for (let i = 0; i < count; i++) {
      const d = i * step;
      const p = circuit.pointAt(d);
      const y = trackY(circuit, d);
      if (y < 4) continue;
      dm.position.set(p.x, (y - 0.5) / 2, p.z);
      dm.scale.set(1, Math.max(1, y - 0.5), 1);
      dm.rotation.set(0, 0, 0);
      dm.updateMatrix();
      inst.setMatrixAt(placed++, dm.matrix);
    }
    inst.count = placed;
    scene.add(inst);
  }

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
      dummy.position.set(p.x, trackY(circuit, i * 14) + 0.09, p.z);
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
    const off = RH - 0.9;
    for (let i = 0; i < n; i++) {
      const p = circuit.pts[i];
      const px = -p.dz;
      const pz = p.dx;
      const cx = p.x + px * off * side;
      const cz = p.z + pz * off * side;
      const yy = trackY(circuit, circuit.cum[i]) + 0.09;
      pos.set([cx + px * 0.28, yy, cz + pz * 0.28], i * 6);
      pos.set([cx - px * 0.28, yy, cz - pz * 0.28], i * 6 + 3);
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
          p.x + -p.dz * side * (RH + 1.4),
          trackY(circuit, i * step) + 0.18,
          p.z + p.dx * side * (RH + 1.4)
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
      const lat = -RH + (i + 0.5) * ((RH * 2) / (across * 2));
      for (let r = 0; r < 2; r++) {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(1.4, 0.07, (RH * 2) / (across * 2)),
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
    const gantry = makeGantry(RH * 2 + 8);
    gantry.position.set(p0.x, 0, p0.z);
    gantry.rotation.y = ang; // 도로를 가로지르게 (로컬 Z = 측면 방향)
    scene.add(gantry);
    // 간트리 기둥도 장애물 (도로 양옆, 주행선에서 충분히 벗어남)
    for (const s of [-1, 1]) {
      const v = new THREE.Vector3(0, 0, (s * (RH * 2 + 8)) / 2);
      gantry.localToWorld(v);
      colliders.push({ x: v.x, z: v.z, r: 1.2 });
    }
  }

  // 지름길: 명시 구간([{d1,d2} 분율] 또는 'apex' 1개) — 좁은 복도형
  // wallGaps: 끝점+측면(side) 지정 개구부. crossings: 통과 지점 양측 개방
  const wallGaps = []; // {ax,az,bx,bz,sideA,sideB}
  const corridors = []; // {ax,az,bx,bz,half} 물리 복도
  const chordSegs = []; // 장식물 제외용 [{ax,az,bx,bz}]
  {
    const L = circuit.length;
    let segs = [];
    if (Array.isArray(shortcuts)) {
      segs = shortcuts.map((s) => ({
        dA: (((s.d1 % 1) + 1) % 1) * L,
        dB: (((s.d2 % 1) + 1) % 1) * L,
      }));
    } else if (shortcuts === 'apex') {
      // 트랙당 최대 1개 (오른쪽 끝)
      let bi = 0;
      for (let i = 0; i < circuit.count; i++) {
        if (circuit.pts[i].x > circuit.pts[bi].x) bi = i;
      }
      const dC = circuit.cum[bi];
      segs.push({
        dA: (((dC - 60) % L) + L) % L,
        dB: (((dC + 60) % L) + L) % L,
      });
    }
    const sideOf = (d, dirx, dirz) => {
      // 지름길 진행 방향과 트랙 법선의 내적으로 개구부 측면 결정
      const p = circuit.pointAt(d);
      const dot = dirx * -p.dz + dirz * p.dx;
      if (dot > 0.2) return 1;
      if (dot < -0.2) return -1;
      return 0;
    };
    for (const sg of segs) {
      const A = circuit.pointAt(sg.dA);
      const B = circuit.pointAt(sg.dB);
      const dx = B.x - A.x;
      const dz = B.z - A.z;
      const m = Math.hypot(dx, dz) || 1;
      // 흙길이 손가락 도로 위를 덮지 않게: 양끝을 도로반폭만큼 안쪽으로
      // (잔디 사이만 관통, 아스팔트 위 겹침 제거)
      const RH2 = circuit.roadHalf || ROAD_HALF;
      const inset = Math.min(RH2, m / 2 - 1);
      const ux = dx / m;
      const uz = dz / m;
      const A2 = { x: A.x + ux * inset, z: A.z + uz * inset, dx: A.dx, dz: A.dz };
      const B2 = { x: B.x - ux * inset, z: B.z - uz * inset, dx: B.dx, dz: B.dz };
      drawDirtChord(scene, circuit, A2, B2, sg.dA, sg.dB, 3);
      const sideA = sideOf(sg.dA, ux, uz);
      const sideB = sideOf(sg.dB, -ux, -uz);
      wallGaps.push({ ax: A2.x, az: A2.z, bx: B2.x, bz: B2.z, sideA, sideB });
      corridors.push({ ax: A2.x, az: A2.z, bx: B2.x, bz: B2.z, half: 3.5 });
      chordSegs.push({ ax: A2.x, az: A2.z, bx: B2.x, bz: B2.z });
      // 복도 양옆 낮은 벽 (입구 제외 t=0.08~0.92)
      buildCorridorWalls(scene, circuit, A2, B2, sg.dA, sg.dB, 3.5);
      // 복도가 가로지르는 다른 도로 지점에 틈 (양측 개방)
      for (let i = 0; i < circuit.count; i += 2) {
        const dd = Math.min(
          Math.abs(circuit.cum[i] - sg.dA), Math.abs(circuit.cum[i] - sg.dB),
          L - Math.abs(circuit.cum[i] - sg.dA), L - Math.abs(circuit.cum[i] - sg.dB)
        );
        if (dd < 40) continue;
        const p = circuit.pts[i];
        let md = Infinity;
        for (let k = 0; k <= 8; k++) {
          const x = A2.x + (B2.x - A2.x) * (k / 8);
          const z = A2.z + (B2.z - A2.z) * (k / 8);
          md = Math.min(md, Math.hypot(x - p.x, z - p.z));
        }
        if (md < 7) {
          wallGaps.push({ ax: p.x, az: p.z, bx: p.x, bz: p.z, sideA: 0, sideB: 0 });
        }
      }
    }
  }

  // 가드레일 벽 (양옆 복셀 블록 + 빨강/흰 기둥, 지름길 틈새 제외)
  {
    const off = RH + 2.2; // 물리 LIM과 일치 (범퍼 접촉 시점에 시각 일치)
    const H = 1.1;
    const circDist = (a, b) => {
      const L = circuit.length;
      const d = Math.abs(a - b) % L;
      return Math.min(d, L - d);
    };
    const gapDists = [];
    for (const g of wallGaps) {
      const pa = circuit.project(g.ax, g.az);
      const pb = circuit.project(g.bx, g.bz);
      gapDists.push(pa.dist, pb.dist);
    }
    const wallStep = 3.4;
    const wallCount = Math.floor(circuit.length / wallStep);
    const wallGeo = new THREE.BoxGeometry(3.0, H, 0.7);
    const white = new THREE.InstancedMesh(wallGeo, new THREE.MeshLambertMaterial({ color: 0xf2f5f9 }), wallCount * 2);
    let wi = 0;
    for (let i = 0; i < wallCount; i++) {
      const d = i * wallStep;
      if (gapDists.some((g) => circDist(d, g) < 16)) continue;
      const p = circuit.pointAt(d);
      const y = trackY(circuit, d);
      for (const side of [1, -1]) {
        dummy.position.set(p.x + -p.dz * side * off, y + H / 2, p.z + p.dx * side * off);
        dummy.rotation.set(0, -Math.atan2(p.dz, p.dx), 0);
        dummy.updateMatrix();
        white.setMatrixAt(wi++, dummy.matrix);
      }
    }
    white.count = wi;
    white.castShadow = true;
    white.receiveShadow = true;
    scene.add(white);
    // 기둥 (12유닛 간격, 빨강/흰 교대)
    const step = 12;
    const count = Math.floor(circuit.length / step);
    const posts = [];
    for (let i = 0; i < count; i++) {
      const d = i * step;
      if (gapDists.some((g) => circDist(d, g) < 14)) continue;
      posts.push(d);
    }
    const mkPosts = (color, filter) => {
      const list = posts.filter(filter);
      const inst = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.55, 1.7, 0.55),
        new THREE.MeshLambertMaterial({ color }),
        Math.max(1, list.length * 2)
      );
      let k = 0;
      for (const d of list) {
        const p = circuit.pointAt(d);
        const y = trackY(circuit, d);
        for (const side of [1, -1]) {
          dummy.position.set(p.x + -p.dz * side * off, y + 0.85, p.z + p.dx * side * off);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          inst.setMatrixAt(k++, dummy.matrix);
        }
      }
      inst.count = k;
      inst.castShadow = true;
      scene.add(inst);
    };
    mkPosts(0xd63a2f, (_, i) => i % 2 === 0);
    mkPosts(0xf4f6f8, (_, i) => i % 2 === 1);
  }

  // 부스터 패드 + 점프대 + 도로 장애물 (트랙 정의 분율 위치)
  const pads = [];
  const jumps = [];
  for (const f of feat.boosts || []) {
    const d = (((f % 1) + 1) % 1) * circuit.length;
    const p = circuit.pointAt(d);
    const y = trackY(circuit, d);
    const yaw = -Math.atan2(p.dz, p.dx);
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(7, 0.18, 7),
      new THREE.MeshBasicMaterial({ color: 0x27e0f5 })
    );
    pad.position.set(p.x, y + 0.12, p.z);
    pad.rotation.y = yaw;
    scene.add(pad);
    for (let s = 0; s < 2; s++) {
      const dd = d + 1.8 + s * 1.8;
      const pp = circuit.pointAt(dd);
      const ch = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.2, 5),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      ch.position.set(pp.x, trackY(circuit, dd) + 0.14, pp.z);
      ch.rotation.y = -Math.atan2(pp.dz, pp.dx);
      scene.add(ch);
    }
    pads.push({ x: p.x, z: p.z });
  }
  for (const f of feat.jumps || []) {
    const d = (((f % 1) + 1) % 1) * circuit.length;
    const p = circuit.pointAt(d);
    const grp = new THREE.Group();
    grp.position.set(p.x, trackY(circuit, d), p.z);
    grp.rotation.y = -Math.atan2(p.dz, p.dx);
    const ramp = new THREE.Mesh(
      new THREE.BoxGeometry(7, 0.7, 7),
      new THREE.MeshLambertMaterial({ color: 0xf58a1f })
    );
    ramp.position.y = 0.4;
    ramp.rotation.z = 0.3;
    ramp.castShadow = true;
    grp.add(ramp);
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(7.1, 0.2, 1.4),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    stripe.position.y = 1.15;
    stripe.rotation.z = 0.3;
    grp.add(stripe);
    scene.add(grp);
    jumps.push({ x: p.x, z: p.z });
  }
  {
    let bi = 0;
    for (const f of feat.blocks || []) {
      const d = (((f % 1) + 1) % 1) * circuit.length;
      const p = circuit.pointAt(d);
      const lat = bi % 2 === 0 ? 6.5 : -6.5;
      bi++;
      const stack = makeTireStack();
      stack.position.set(
        p.x + -p.dz * lat,
        trackY(circuit, d),
        p.z + p.dx * lat
      );
      scene.add(stack);
      registerCollider(stack);
    }
  }

  // 아이템 박스 (반투명 시안 큐브, 회전·리스폰은 메인에서)
  const itemBoxes = [];
  if (feat.items !== false) {
    const fracs = [0.15, 0.4, 0.65, 0.9];
    fracs.forEach((f, bi) => {
      const d = f * circuit.length;
      const p = circuit.pointAt(d);
      const lat = bi % 2 === 0 ? 5 : -5;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(3, 3, 3),
        new THREE.MeshBasicMaterial({ color: 0x27e0f5, transparent: true, opacity: 0.75 })
      );
      m.position.set(p.x + -p.dz * lat, trackY(circuit, d) + 2.2, p.z + p.dx * lat);
      scene.add(m);
      itemBoxes.push({ x: m.position.x, z: m.position.z, mesh: m, takenT: 0 });
    });
  }

  // 장식: 나무/벤치/가로등/타이어 (트랙 바깥에 배치)
  let seed = 1234567;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const placed = [];
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
      if (Math.abs(pr.lateral) < RH + 3) continue;
      // 지름길 복도 주변엔 장식물 없음 (주행선 확보)
      let nearChord = false;
      for (const g of chordSegs) {
        if (ptSegDistWorld(x, z, g) < 13) {
          nearChord = true;
          break;
        }
      }
      if (nearChord) continue;
      obj.position.set(x, groundHeightAt(x, z), z);
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
    for (let i = 0; i < 10; i++) tryPlace(makeBench(), 20, 32);
    for (let i = 0; i < 12; i++) tryPlace(makeLamp(), 19, 27);
    for (let i = 0; i < 8; i++) tryPlace(makeTireStack(), 20, 28);
  } else if (themeId === 'desert') {
    for (let i = 0; i < 22; i++) tryPlace(makeCactus(), 24, 110);
    for (let i = 0; i < 16; i++) tryPlace(makeRock(), 22, 90);
    for (let i = 0; i < 8; i++) tryPlace(makeTireStack(), 20, 28);
  } else if (themeId === 'forest') {
    for (let i = 0; i < 64; i++) tryPlace(makeTree(), 15, 70);
    for (let i = 0; i < 12; i++) tryPlace(makeRock(), 16, 50);
    for (let i = 0; i < 6; i++) tryPlace(makeTireStack(), 20, 28);
  } else {
    for (let i = 0; i < 20; i++) tryPlace(makeBuilding(), 34, 130);
    for (let i = 0; i < 14; i++) tryPlace(makeLamp(), 19, 27);
    for (let i = 0; i < 8; i++) tryPlace(makeTireStack(), 20, 28);
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

  return { sun, colliders, wallGaps, corridors, pads, jumps, itemBoxes };
}

// 지름길 복도 양옆 벽 (입구 t=0.08~0.92만, 낮게)
function buildCorridorWalls(scene, circuit, A, B, dA, dB, half) {
  const dx = B.x - A.x;
  const dz = B.z - A.z;
  const m = Math.hypot(dx, dz) || 1;
  const px = -dz / m;
  const pz = dx / m;
  const yA = trackY(circuit, dA);
  const yB = trackY(circuit, dB);
  const H = 0.9;
  const off = half + 0.3;
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xd8b25c, side: THREE.DoubleSide });
  for (const side of [1, -1]) {
    const SEG = 8;
    const t0 = 0.08;
    const t1 = 0.92;
    const pos = [];
    const idx = [];
    for (let i = 0; i <= SEG; i++) {
      const t = t0 + ((t1 - t0) * i) / SEG;
      const x = A.x + dx * t + px * side * off;
      const z = A.z + dz * t + pz * side * off;
      const y = yA + (yB - yA) * t;
      pos.push(x, y, z, x, y + H, z);
      if (i < SEG) {
        const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, wallMat);
    mesh.castShadow = true;
    scene.add(mesh);
  }
}

// 두 점 사이 직선 흙 리본 (지름길 표시)
function drawDirtChord(scene, circuit, A, B, dA, dB, halfW) {
  const SEG = 10;
  const yA = trackY(circuit, dA);
  const yB = trackY(circuit, dB);
  const pos = new Float32Array((SEG + 1) * 2 * 3);
  const idx = [];
  const dx = B.x - A.x;
  const dz = B.z - A.z;
  const m = Math.hypot(dx, dz) || 1;
  const px = (-dz / m) * halfW;
  const pz = (dx / m) * halfW;
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    const x = A.x + dx * t;
    const z = A.z + dz * t;
    const y = yA + (yB - yA) * t + 0.07;
    pos.set([x + px, y, z + pz], i * 6);
    pos.set([x - px, y, z - pz], i * 6 + 3);
    if (i < SEG) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xb08a5a }));
  mesh.receiveShadow = true;
  scene.add(mesh);
}

// 그리드 슬롯 6대 (3열 × 2행, 스타트라인 뒤)
export function gridSlots(circuit) {
  const slots = [];
  const rows = [
    { back: 10, lat: -4 },
    { back: 10, lat: 4 },
    { back: 19, lat: -4 },
    { back: 19, lat: 4 },
    { back: 28, lat: -4 },
    { back: 28, lat: 4 },
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
