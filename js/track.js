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
  return finalizeCircuit(pts);
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
function finalizeCircuit(pts) {
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

  return { pts, cum, length, pointAt, project, curvatureAt, count: n };
}

// 제어점을 지나는 닫힌 Catmull-Rom 스플라인 서킷
export function buildSplineCircuit(controls, perSeg = 30) {
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
  return finalizeCircuit(pts);
}

// 트랙 종류 (차고에서 선택)
export const TRACK_DEFS = [
  { id: 'oval', name: '초원 오벌', mode: 'rounded', straight: 260, radius: 75, waveAmp: 0, waveK: 2, theme: 'park', laps: 3 },
  { id: 'wave', name: '사막 웨이브', mode: 'rounded', straight: 230, radius: 70, waveAmp: 20, waveK: 2, theme: 'desert', laps: 3 },
  { id: 'hairpin', name: '도심 헤어핀', mode: 'rounded', straight: 220, radius: 45, waveAmp: 0, waveK: 2, theme: 'city', laps: 3 },
  {
    id: 'horseshoe', name: '말굽 서킷', mode: 'spline', theme: 'park', laps: 3,
    points: [
      [-140, 44], [0, 50], [140, 44], [174, 22], [174, -22], [140, -44],
      [60, -50], [20, -30], [-20, -30], [-60, -50], [-140, -44], [-174, -22], [-174, 22],
    ],
  },
  {
    id: 'express', name: '대륙 익스프레스', mode: 'spline', theme: 'desert', laps: 2,
    points: [
      [-260, 120], [-80, 132], [120, 132], [260, 120], [330, 60], [330, -60],
      [260, -120], [80, -132], [-120, -132], [-260, -120], [-330, -60], [-330, 60],
    ],
  },
  {
    id: 'technical', name: '테크니컬', mode: 'spline', theme: 'city', laps: 3,
    points: [
      [-160, 30], [-80, 62], [0, 22], [80, 62], [160, 30], [192, -12],
      [160, -52], [80, -22], [0, -62], [-80, -22], [-160, -52], [-192, -12],
    ],
  },
];

export function buildTrack(def) {
  if (def.mode === 'spline') return buildSplineCircuit(def.points, def.perSeg || 30);
  return buildCircuit(def.straight, def.radius, { waveAmp: def.waveAmp, waveK: def.waveK });
}
