// 서킷 수학 (순수 로직, three.js 의존 없음 → node 테스트 가능)
// 둥근 사각형 폐곡선: 직선 2개 + 반원 2개. 거리 기반 파라미터화.
export function buildCircuit(straight = 260, radius = 75, opts = {}) {
  const { waveAmp = 0, waveK = 2 } = opts;
  const pts = []; // {x, z}
  const push = (x, z) => pts.push({ x, z });

  const hx = straight / 2;
  const samplesPerUnit = 0.35;
  // 1) 윗 직선: (-hx, R) → (hx, R)
  const n1 = Math.max(8, Math.floor(straight * samplesPerUnit));
  for (let i = 0; i < n1; i++) push(-hx + (straight * i) / n1, radius);
  // 2) 오른쪽 반원: 중심 (hx, 0), θ: π/2 → -π/2
  const arcLen = Math.PI * radius;
  const n2 = Math.max(8, Math.floor(arcLen * samplesPerUnit));
  for (let i = 0; i < n2; i++) {
    const t = Math.PI / 2 - (Math.PI * i) / n2;
    push(hx + radius * Math.cos(t), radius * Math.sin(t));
  }
  // 3) 아랫 직선: (hx, -R) → (-hx, -R)
  for (let i = 0; i < n1; i++) push(hx - (straight * i) / n1, -radius);
  // 4) 왼쪽 반원: 중심 (-hx, 0), θ: -π/2 → -3π/2
  for (let i = 0; i < n2; i++) {
    const t = -Math.PI / 2 - (Math.PI * i) / n2;
    push(-hx + radius * Math.cos(t), radius * Math.sin(t));
  }

  applyWave(pts, waveAmp, waveK);
  const c = finalizeCircuit(pts, { amp: opts.hillAmp || 0, k: opts.hillK || 2 });
  c.elev = { amp: opts.hillAmp || 0, k: opts.hillK || 2 };
  return c;
}

// 웨이브 변형: 법선 방향으로 사인 오프셋 (S자 커브)
// ※ 원본 좌표 스냅샷 기준으로 계산 (변형 중인 점을 읽으면 오차 증폭됨)
function applyWave(pts, waveAmp, waveK) {
  const n = pts.length;
  if (waveAmp > 0) {
    const base = pts.map((p) => ({ x: p.x, z: p.z }));
    // 1차 누적거리로 위상 계산
    const tmp = new Array(n + 1).fill(0);
    for (let i = 0; i < n; i++) {
      const a = base[i];
      const b = base[(i + 1) % n];
      tmp[i + 1] = tmp[i] + Math.hypot(b.x - a.x, b.z - a.z);
    }
    const L0 = tmp[n];
    for (let i = 0; i < n; i++) {
      const a = base[(i - 1 + n) % n];
      const b = base[(i + 1) % n];
      const nx = -(b.z - a.z);
      const nz = b.x - a.x;
      const m = Math.hypot(nx, nz) || 1;
      const off = waveAmp * Math.sin((2 * Math.PI * tmp[i] * waveK) / L0);
      pts[i].x = base[i].x + (nx / m) * off;
      pts[i].z = base[i].z + (nz / m) * off;
    }
  }
}

// 중심선 확정: 누적거리·진행방향·투영·곡률 API 생성 (rounded/spline 공통)
function finalizeCircuit(pts, elev) {
  const n = pts.length;
  const cum = new Array(n + 1).fill(0);
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    cum[i + 1] = cum[i] + Math.hypot(b.x - a.x, b.z - a.z);
  }
  const length = cum[n];
  // 방향 벡터 (수치 미분)
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const m = Math.hypot(dx, dz) || 1;
    pts[i].dx = dx / m;
    pts[i].dz = dz / m;
  }

  function pointAt(d) {
    d = ((d % length) + length) % length;
    // 선형 탐색(이진 탐색으로 교체 가능, n≈800이라 충분)
    let lo = 0;
    let hi = n;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const a = pts[lo];
    const b = pts[(lo + 1) % n];
    const segLen = cum[lo + 1] - cum[lo] || 1;
    const t = (d - cum[lo]) / segLen;
    const dx = a.dx + (b.dx - a.dx) * t;
    const dz = a.dz + (b.dz - a.dz) * t;
    const m = Math.hypot(dx, dz) || 1;
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      dx: dx / m,
      dz: dz / m,
    };
  }

  // 최근접점 투영 → {dist, lateral}
  // perp = (-dz, dx) 기준 좌측이 +lateral
  // ※ 평면 전용: 겹침(입체) 트랙은 projectTracked 사용
  function project(x, z) {
    let best = 0;
    let bestD2 = Infinity;
    for (let i = 0; i < n; i++) {
      const ddx = x - pts[i].x;
      const ddz = z - pts[i].z;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    const p = pts[best];
    const rx = x - p.x;
    const rz = z - p.z;
    // 접선 방향으로 미세 보정
    const along = rx * p.dx + rz * p.dz;
    let dist = cum[best] + along;
    dist = ((dist % length) + length) % length;
    const lateral = rx * -p.dz + rz * p.dx;
    return { dist, lateral };
  }

  // 곡률(lookahead 지점): 0=직선, 클수록 급커브
  function curvatureAt(d, lookahead = 30) {
    const a = pointAt(d);
    const b = pointAt(d + lookahead);
    const dot = Math.max(-1, Math.min(1, a.dx * b.dx + a.dz * b.dz));
    return Math.acos(dot) / lookahead; // rad per unit
  }

  // 입체(겹침) 트랙용 투영: 직전 dist 근처 윈도우 우선 + 전역 3D 폴백
  // - 윈도우(±30): 연속 주행 중 층간 혼동 없음 (다른 층 같은 위치 점은 dist가 멈)
  // - LOST(윈도우 내 25 이내 없음: 리스폰·폭파 등) → 전역 3D 탐색 (y 힌트)
  function wrapDiff(a, b) {
    let d = a - b;
    if (d > length / 2) d -= length;
    if (d < -length / 2) d += length;
    return d;
  }
  function yAt(u) {
    return elevY(elev, Math.max(0, Math.min(1, u / length)));
  }
  function refineAt(idx, x, z) {
    const p = pts[idx];
    const rx = x - p.x;
    const rz = z - p.z;
    const along = rx * p.dx + rz * p.dz;
    let dist = cum[idx] + along;
    dist = ((dist % length) + length) % length;
    const lateral = rx * -p.dz + rz * p.dx;
    return { dist, lateral };
  }
  function projectTracked(x, z, lastDist, yHint) {
    if (lastDist === null || lastDist === undefined || !isFinite(lastDist)) {
      return project3D(x, z, yHint);
    }
    const WIN = 30;
    const LOST = 25;
    let best = -1;
    let bestD2 = Infinity;
    for (let i = 0; i < n; i++) {
      let dd = Math.abs(cum[i] - lastDist);
      if (dd > length / 2) dd = length - dd;
      if (dd > WIN) continue;
      const ddx = x - pts[i].x;
      const ddz = z - pts[i].z;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    if (best < 0 || bestD2 > LOST * LOST) {
      return project3D(x, z, yHint !== undefined ? yHint : yAt(((lastDist % length) + length) % length));
    }
    const r = refineAt(best, x, z);
    // 순간이동급 dist 점프는 기각 (물리적으로 1프레임 25 이상 불가)
    // → 현재 층 높이 힌트로 3D 재탐색 (옆층 오인 영구 고착 방지)
    if (Math.abs(wrapDiff(r.dist, lastDist)) > 25) {
      return project3D(x, z, yAt(((lastDist % length) + length) % length));
    }
    return r;
  }
  // 전역 3D 탐색: 평면거리 + 고도차 (층 분리)
  function project3D(x, z, y) {
    const yy = isFinite(y) ? y : 0;
    let best = 0;
    let bestD2 = Infinity;
    for (let i = 0; i < n; i++) {
      const ddx = x - pts[i].x;
      const ddz = z - pts[i].z;
      const dy = yAt(cum[i]) - yy;
      const d2 = ddx * ddx + ddz * ddz + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    return refineAt(best, x, z);
  }

  return { pts, cum, length, pointAt, project, projectTracked, project3D, curvatureAt, count: n };
}

// 빌리지 손가락: 직선+원호 프리미티브 직접 샘플링 (스플라인 대신, 기하 확정)
// (x, z) 평면을 표준 수학 방향으로 취급. 각도: point = (cx + r cos a, cz + r sin a)
// a 증가 = CCW (진행방향 (-sin a, cos a)), a 감소 = CW (진행방향 (sin a, -cos a))
export function buildVillage(elev) {
  const pts = [];
  const push = (x, z) => pts.push({ x, z });
  const straight = (x1, z1, step = 3) => {
    const last = pts[pts.length - 1];
    const len = Math.hypot(x1 - last.x, z1 - last.z);
    const n = Math.max(1, Math.round(len / step));
    for (let i = 1; i <= n; i++) {
      push(last.x + ((x1 - last.x) * i) / n, last.z + ((z1 - last.z) * i) / n);
    }
  };
  const arc = (cx, cz, r, a0deg, a1deg, stepDeg = 4) => {
    const n = Math.max(2, Math.round(Math.abs(a1deg - a0deg) / stepDeg));
    for (let i = 1; i <= n; i++) {
      const a = ((a0deg + ((a1deg - a0deg) * i) / n) * Math.PI) / 180;
      push(cx + r * Math.cos(a), cz + r * Math.sin(a));
    }
  };
  push(0, 92); // S0, heading +X
  straight(130, 90); // L1
  arc(130, 66, 24, 90, -90); // capR1
  straight(0, 42); // L2
  arc(0, 18, 24, 90, 270); // capL1
  straight(130, -6); // L3
  arc(130, -30, 24, 90, -90); // capR2
  straight(0, -54); // L4
  arc(0, -78, 24, 90, 270); // capL2
  straight(130, -102); // L5
  arc(130, -126, 24, 90, -90); // capR3
  straight(0, -150); // L6
  arc(0, -174, 24, 90, 270); // capL3
  straight(130, -198); // L7
  arc(130, -222, 24, 90, -90); // capR4
  straight(-40, -246); // L8
  straight(-150, -240); // 바깥 서쪽으로
  arc(-150, -195, 45, 270, 180); // 북행으로 커브
  straight(-195, 30); // 서쪽 직선
  arc(-150, 30, 45, 180, 90); // 동쪽으로 커브
  straight(0, 92); // 탑 직선 → S0 합류
  const c = finalizeCircuit(pts, elev || { amp: 0, k: 2 });
  c.elev = elev || { amp: 0, k: 2 };
  return c;
}

// 제어점을 지나는 닫힌 Catmull-Rom 스플라인 서킷
export function buildSplineCircuit(controls, perSeg = 30, elev = null) {
  const m = controls.length;
  const P = (i) => controls[(i + m) % m];
  const pts = [];
  for (let s = 0; s < m; s++) {
    const p0 = P(s - 1), p1 = P(s), p2 = P(s + 1), p3 = P(s + 2);
    for (let j = 0; j < perSeg; j++) {
      const t = j / perSeg;
      const t2 = t * t, t3 = t2 * t;
      pts.push({
        x: 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        z: 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      });
    }
  }
  const c = finalizeCircuit(pts, elev || { amp: 0, k: 2 });
  c.elev = elev || { amp: 0, k: 2 };
  return c;
}

// 고도 프로파일: {amp,k} 사인 (레거시) 또는 {points:[[u,y]..]} 자유 곡선 (입체용)
// smootherstep 보간, 양끝 [0,0]·[1,0] 강제 (랩 이음매 연속)
function normElevPts(pts) {
  const p = (pts || []).map(([u, y]) => [Math.max(0, Math.min(1, u)), y]).sort((a, b) => a[0] - b[0]);
  if (p.length === 0 || p[0][0] > 0) p.unshift([0, 0]);
  if (p[p.length - 1][0] < 1) p.push([1, 0]);
  return p;
}
function elevY(elev, uf) {
  if (!elev) return 0;
  if (elev.points) {
    const p = normElevPts(elev.points);
    const u = Math.max(0, Math.min(1, uf));
    let i = 0;
    while (i < p.length - 2 && u > p[i + 1][0]) i++;
    const [u0, y0] = p[i];
    const [u1, y1] = p[i + 1];
    const t = u1 > u0 ? Math.max(0, Math.min(1, (u - u0) / (u1 - u0))) : 0;
    const s = t * t * t * (t * (t * 6 - 15) + 10);
    return y0 + (y1 - y0) * s;
  }
  if (!elev.amp) return 0;
  return (elev.amp * (1 - Math.cos(2 * Math.PI * elev.k * uf))) / 2;
}

// 고도: 시작/결승선에서 0 + 평탄 (y(0)=0, 기울기 0 보장)
export function trackY(circuit, d) {
  const e = circuit.elev;
  if (!e || (!e.amp && !e.points)) return 0;
  const L = circuit.length;
  const u = (((d % L) + L) % L) / L;
  return elevY(e, u);
}

export function trackSlope(circuit, d) {
  const e = circuit.elev;
  if (!e || (!e.amp && !e.points)) return 0;
  const L = circuit.length;
  const u = (((d % L) + L) % L) / L;
  if (!e.points) {
    return ((e.amp * Math.PI * e.k) / L) * Math.sin((2 * Math.PI * e.k * u) / L);
  }
  const h = 0.002;
  return (elevY(e, u + h) - elevY(e, u - h)) / (2 * h * L);
}

// 트랙9: 나선 타워 (위→아래 1랩 포인트-투-포인트)
// 진입 직선 → 반경 38 helix 9바퀴(15° 간격, 층간 8) → 하단 탈출 → 결승
// 폐곡선 이음매(종점→시점)는 지하+출발 샤프트로 은폐 (주행 안 함)
function track9Points() {
  const pts = [[38, 140], [38, 85], [38, 30]];
  for (let k = 1; k <= 216; k++) {
    const a = (-15 * k * Math.PI) / 180;
    pts.push([+(38 * Math.cos(a)).toFixed(1), +(30 + 38 * Math.sin(a)).toFixed(1)]);
  }
  pts.push([38, -10], [38, -60], [38, 60]);
  return pts;
}

// 트랙 종류 (차고에서 선택)
// hill: 오르막/내리막 {amp, k} · boosts/jumps/blocks: 랩 분율 위치
export const TRACK_DEFS = [
  { id: 'oval', name: '초원 오벌', mode: 'rounded', straight: 260, radius: 75, waveAmp: 0, waveK: 2, theme: 'park', laps: 3,
    hill: { amp: 5, k: 2 }, boosts: [0.25, 0.6], jumps: [0.45], blocks: [0.55] },
  { id: 'wave', name: '사막 웨이브', mode: 'rounded', straight: 230, radius: 70, waveAmp: 20, waveK: 2, theme: 'desert', laps: 3,
    hill: { amp: 6, k: 3 }, boosts: [0.3, 0.7], jumps: [], blocks: [0.45] },
  { id: 'hairpin', name: '도심 헤어핀', mode: 'rounded', straight: 220, radius: 45, waveAmp: 0, waveK: 2, theme: 'city', laps: 3,
    hill: { amp: 4, k: 2 }, boosts: [0.5], jumps: [], blocks: [0.3] },
  {
    id: 'horseshoe', name: '말굽 서킷', mode: 'spline', theme: 'park', laps: 3,
    hill: { amp: 5, k: 2 }, boosts: [0.25, 0.65], jumps: [0.55], blocks: [0.7],
    points: [
      [-140, 44], [0, 50], [140, 44], [174, 22], [174, -22], [140, -44],
      [60, -50], [20, -30], [-20, -30], [-60, -50], [-140, -44], [-174, -22], [-174, 22],
    ],
  },
  {
    id: 'express', name: '대륙 익스프레스', mode: 'spline', theme: 'desert', laps: 2,
    hill: { amp: 7, k: 3 }, boosts: [0.2, 0.5, 0.8], jumps: [0.65], blocks: [0.5],
    points: [
      [-260, 120], [-80, 132], [120, 132], [260, 120], [330, 60], [330, -60],
      [260, -120], [80, -132], [-120, -132], [-260, -120], [-330, -60], [-330, 60],
    ],
  },
  {
    id: 'technical', name: '테크니컬', mode: 'spline', theme: 'city', laps: 3,
    hill: { amp: 6, k: 3 }, boosts: [0.3, 0.7], jumps: [0.4], blocks: [0.2, 0.6],
    points: [
      [-160, 30], [-80, 62], [0, 22], [80, 62], [160, 30], [192, -12],
      [160, -52], [80, -22], [0, -62], [-80, -22], [-160, -52], [-192, -12],
    ],
  },
  {
    id: 'forest', name: '포레스트', mode: 'spline', theme: 'forest', laps: 2,
    hill: { amp: 8, k: 4 }, boosts: [0.35, 0.75], jumps: [0.5, 0.85], blocks: [0.3, 0.65],
    points: [
      [-180, 20], [-120, 70], [-50, 30], [20, 80], [90, 30], [160, 70],
      [210, 20], [190, -40], [120, -10], [50, -60], [-20, -10], [-90, -60],
      [-160, -20], [-200, 0],
    ],
  },
  {
    id: 'village', name: '빌리지 손가락', mode: 'village', theme: 'park', laps: 2,
    hill: { amp: 0, k: 2 }, boosts: [0.3, 0.7], jumps: [0.5], blocks: [0.6],
    roadHalf: 8, shortcuts: [{ d1: 0.306, d2: 0.393 }],
  },
  {
    id: 'track9', name: '트랙9', mode: 'spline', theme: 'city', laps: 1,
    hill: { points: [
      [0, 72], [0.0431, 72],
      [0.1367, 64], [0.2303, 56], [0.3238, 48], [0.4174, 40], [0.5110, 32],
      [0.6046, 24], [0.6982, 16], [0.7917, 8], [0.8853, 0],
      [0.9206, 0], [0.94, -25], [0.985, -25], [1, 72],
    ] },
    overlap3d: true,
    finishU: 0.9206,
    boosts: [0.3, 0.6], jumps: [0.5], blocks: [0.4],
    pillars: true,
    shaft: { x: 38, z: 125, y0: -5, y1: 70, w: 22, d: 50 },
    perSeg: 6,
    points: track9Points(),
  },
];

export function buildTrack(def) {
  let c;
  if (def.mode === 'village') c = buildVillage(def.hill);
  else if (def.mode === 'spline') c = buildSplineCircuit(def.points, def.perSeg || 30, def.hill);
  else c = buildCircuit(def.straight, def.radius, {
    waveAmp: def.waveAmp, waveK: def.waveK,
    hillAmp: def.hill && def.hill.amp, hillK: def.hill && def.hill.k,
  });
  c.roadHalf = def.roadHalf || 11;
  c.hasOverlap = !!def.overlap3d; // 입체(겹침) 트랙: 3D 투영 엔진 사용
  if (def.finishU) c.finishU = def.finishU; // 포인트-투-포인트 종점 (기본 0=시작선)
  return c;
}
