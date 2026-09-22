// 드리프트 스키드마크: 뒷바퀴 접지 방향 리본 트레일 (일정 시간 잔상 후 소멸)
import * as THREE from 'three';

export class SkidTrails {
  constructor(scene, maxPts = 220, life = 6, halfW = 0.28) {
    this.scene = scene;
    this.maxPts = maxPts;
    this.life = life;
    this.halfW = halfW;
    this.trails = new Map(); // key -> {mesh, geo, pts:[{x,y,z,dx,dz,age}]}
    this.mat = new THREE.MeshBasicMaterial({
      color: 0x141414,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
  }

  _get(key) {
    let t = this.trails.get(key);
    if (!t) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.maxPts * 2 * 3), 3));
      geo.setDrawRange(0, 0);
      const mesh = new THREE.Mesh(geo, this.mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      t = { mesh, geo, pts: [] };
      this.trails.set(key, t);
    }
    return t;
  }

  // 타이어 접지점 중심 + 진행 방향으로 한 점 추가
  // 이전 점과 멀면(텔레포트/재시작) 리본을 끊음 (brk 플래그)
  addPoint(key, x, y, z, dirX, dirZ) {
    const t = this._get(key);
    const last = t.pts[t.pts.length - 1];
    let brk = false;
    if (last) {
      const dx = x - last.x;
      const dz = z - last.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.36) return;
      if (d2 > 64) brk = true; // 8유닛 이상 점프 = 끊김
    }
    t.pts.push({ x, y, z, dx: dirX, dz: dirZ, age: 0, brk });
    if (t.pts.length > this.maxPts) t.pts.shift();
    this._rebuild(t);
  }

  update(dt) {
    for (const [key, t] of this.trails) {
      let dirty = false;
      for (const p of t.pts) p.age += dt;
      while (t.pts.length > 0 && t.pts[0].age > this.life) {
        t.pts.shift();
        dirty = true;
      }
      if (dirty || t.pts.length > 0) this._rebuild(t);
      t.mesh.visible = t.pts.length >= 2;
    }
  }

  _rebuild(t) {
    const pos = t.geo.attributes.position.array;
    const n = t.pts.length;
    for (let i = 0; i < n; i++) {
      const p = t.pts[i];
      const m = Math.hypot(p.dx, p.dz) || 1;
      const px = (-p.dz / m) * this.halfW;
      const pz = (p.dx / m) * this.halfW;
      pos.set([p.x + px, p.y, p.z + pz], i * 6);
      pos.set([p.x - px, p.y, p.z - pz], i * 6 + 3);
    }
    t.geo.attributes.position.needsUpdate = true;
    // brk 플래그 구간은 삼각형 제외 (끊긴 리본)
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      if (t.pts[i + 1].brk) continue;
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      idx.push(a, b, c, b, d, c);
    }
    t.geo.setIndex(idx);
    t.geo.computeBoundingSphere();
  }

  clear() {
    for (const [, t] of this.trails) {
      this.scene.remove(t.mesh);
      t.geo.dispose();
    }
    this.trails.clear();
  }
}
