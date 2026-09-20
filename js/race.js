// 경주 로직: 아케이드 관성 물리 + AI + 랩/순위 + 벽/부스터 (three.js 없음 → node 테스트 가능)
import { trackSlope } from './track.js';
//
// 물리 모델 (관성 체감용 속도벡터 방식):
// - vel 벡터가 실제 이동, heading은 차 머리 방향
// - grip이 낮을수록 vel이 heading을 늦게 따라옴 = 미끄러짐/드리프트
// - 잔디 이탈 시 추가 감속 + 최고속도 제한 (내구도가 높을수록 패널티 감소)

export const CAR_DEFS = [
  {
    id: 'f1',
    name: 'F1',
    grade: '전설',
    color: 0xe23b2e,
    accent: 0xffffff,
    stats: { speed: 5, handling: 4, durability: 2 },
    maxSpeed: 62, accel: 40, brake: 70, reverseMax: 18,
    turnRate: 2.2, grip: 5.2, drag: 0.35,
  },
  {
    id: 'sports',
    name: 'GT SPORTS',
    grade: '레어',
    color: 0xf2f3f5,
    accent: 0x1c2733,
    stats: { speed: 4, handling: 3, durability: 3 },
    maxSpeed: 56, accel: 34, brake: 64, reverseMax: 16,
    turnRate: 2.0, grip: 6.0, drag: 0.4,
  },
  {
    id: 'pickup',
    name: 'PICKUP',
    grade: '일반',
    color: 0x23262b,
    accent: 0x3a3f47,
    stats: { speed: 3, handling: 3, durability: 5 },
    maxSpeed: 50, accel: 30, brake: 60, reverseMax: 15,
    turnRate: 1.9, grip: 6.4, drag: 0.45,
  },
  {
    id: 'truck',
    name: 'TRUCK',
    grade: '일반',
    color: 0x1f4fa8,
    accent: 0xdfe6f2,
    stats: { speed: 3, handling: 2, durability: 5 },
    maxSpeed: 48, accel: 28, brake: 58, reverseMax: 14,
    turnRate: 1.7, grip: 6.8, drag: 0.5,
  },
  {
    id: 'taxi',
    name: 'TAXI',
    grade: '일반',
    color: 0xf2b90c,
    accent: 0x1c2733,
    stats: { speed: 3, handling: 4, durability: 3 },
    maxSpeed: 52, accel: 34, brake: 64, reverseMax: 16,
    turnRate: 2.1, grip: 6.2, drag: 0.4,
  },
  {
    id: 'rally',
    name: 'RALLY',
    grade: '레어',
    color: 0x1f6fd6,
    accent: 0xffffff,
    stats: { speed: 4, handling: 5, durability: 3 },
    maxSpeed: 57, accel: 36, brake: 66, reverseMax: 16,
    turnRate: 2.4, grip: 5.6, drag: 0.38,
  },
  {
    id: 'monster',
    name: 'MONSTER',
    grade: '일반',
    color: 0xe26a1b,
    accent: 0x23262b,
    stats: { speed: 3, handling: 2, durability: 5 },
    maxSpeed: 51, accel: 32, brake: 60, reverseMax: 15,
    turnRate: 1.8, grip: 7.2, drag: 0.45,
  },
  {
    id: 'police',
    name: 'POLICE',
    grade: '레어',
    color: 0xf2f3f5,
    accent: 0x1c2733,
    stats: { speed: 4, handling: 3, durability: 4 },
    maxSpeed: 58, accel: 35, brake: 66, reverseMax: 16,
    turnRate: 2.0, grip: 5.8, drag: 0.4,
  },
];

export function makeCarState(def, x, z, heading) {
  const maxHp = 60 + def.stats.durability * 20;
  return {
    def,
    x, z, heading,
    vx: 0, vz: 0,
    dist: 0,       // 트랙 위 unwrap 거리
    lateral: 0,
    lap: 0,
    sectors: [false, false, false, false],
    finished: false,
    finishTime: 0,
    lapStart: 0,
    lastLap: 0,
    bestLap: Infinity,
    offTrack: false,
    steerVis: 0,   // 렌더용 조향 표시
    steerSm: 0,    // 스무딩된 조향 입력
    maxHp,
    hp: maxHp,
    hitCd: 0,      // 피격 쿨다운(연타 방지)
    out: false,    // 폭파 탈락
    boostT: 0,     // 부스터 잔여 시간
    airT: 0,       // 점프 체공 잔여 시간
    airDur: 0.75,
  };
}

const SECTOR = 4;

export function stepCar(car, input, dt, circuit, roadHalf) {
  const d = car.def;
  const snap = circuit.project(car.x, car.z);
  car.offTrack = Math.abs(snap.lateral) > roadHalf;

  const fx = Math.cos(car.heading);
  const fz = Math.sin(car.heading);

  // 전진/후진 속도 성분
  let fwd = car.vx * fx + car.vz * fz;

  if (input.throttle > 0) {
    fwd += d.accel * input.throttle * dt;
  }
  if (input.brake > 0) {
    if (fwd > 1) fwd -= d.brake * input.brake * dt;
    else fwd = Math.max(-d.reverseMax, fwd - d.accel * 0.7 * input.brake * dt);
  }

  // 부스터: 출력 증가
  if (car.boostT > 0) {
    fwd += d.accel * 2.2 * dt;
  }

  // 경사: 오르막 감속 · 내리막 가속
  fwd -= trackSlope(circuit, car.dist) * 40 * dt;

  const tough = d.stats.durability / 5; // 0.4~1
  const hpRatio = car.hp / car.maxHp;
  // HP가 낮을수록 최고속도 저하 (0% → 78%)
  let cap = d.maxSpeed * (0.78 + 0.22 * hpRatio);
  if (car.boostT > 0) cap = Math.max(cap, d.maxSpeed * 1.35);
  if (car.offTrack) cap *= 0.45 + 0.25 * tough;
  if (fwd > cap) {
    // 부스트 중엔 단단한 상한 (무한 가속 방지), 평소엔 부드러운 상한
    fwd = car.boostT > 0 ? cap : cap + (fwd - cap) * Math.exp(-3 * dt);
  }
  // 공기저항
  fwd *= Math.exp(-d.drag * dt);
  if (Math.abs(fwd) < 0.15 && input.throttle === 0 && input.brake === 0) fwd = 0;

  // 조향 스무딩 (꺾는 순간 휙 돌아가는 현상 방지)
  car.steerSm += (input.steer - car.steerSm) * Math.min(1, 7 * dt);
  // 조향 (속도가 있어야 돌아감, 후진 시 반대)
  const spd = Math.abs(fwd);
  const spdFactor = Math.min(1, spd / 18);
  const dirSign = fwd >= 0 ? 1 : -1;
  // 고속일수록 회전 둔화 (저속 민첩 · 고속 안정)
  const highSpeedDamp = 1 / (1 + spd * 0.018);
  const turn =
    car.steerSm * d.turnRate * (0.35 + 0.65 * spdFactor) * highSpeedDamp * dirSign;
  car.heading += turn * dt;
  car.steerVis += (input.steer - car.steerVis) * Math.min(1, 10 * dt);

  // 속도 재조합: grip만큼 heading 방향으로 당김 (관성/드리프트의 핵심)
  const nfx = Math.cos(car.heading);
  const nfz = Math.sin(car.heading);
  const oldFwd = car.vx * fx + car.vz * fz;
  const latX = car.vx - fx * oldFwd;
  const latZ = car.vz - fz * oldFwd;
  const keep = Math.exp(-d.grip * dt);
  car.vx = nfx * fwd + latX * keep;
  car.vz = nfz * fwd + latZ * keep;

  car.x += car.vx * dt;
  car.z += car.vz * dt;

  // 랩/섹터 추적 (unwrap; 역주행·지름길은 섹터 미체크로 무효)
  const now = circuit.project(car.x, car.z);
  let delta = now.dist - snap.dist;
  car.lateral = now.lateral;
  if (delta > circuit.length / 2) delta -= circuit.length;
  if (delta < -circuit.length / 2) delta += circuit.length;
  car.dist += delta;
  const sectorIdx =
    Math.floor((((now.dist % circuit.length) + circuit.length) % circuit.length) /
      (circuit.length / SECTOR)) % SECTOR;
  car.sectors[sectorIdx] = true;
  return now;
}

export function checkLap(car, circuit, lapsToWin, now) {
  const total = Math.floor(car.dist / circuit.length);
  if (total > car.lap && car.sectors.every(Boolean)) {
    car.lap = total;
    const lapTime = now - car.lapStart;
    car.lastLap = lapTime;
    if (lapTime < car.bestLap) car.bestLap = lapTime;
    car.lapStart = now;
    car.sectors = [false, false, false, false];
    if (car.lap >= lapsToWin && !car.finished) {
      car.finished = true;
      car.finishTime = now;
      return 'finished';
    }
    return 'lap';
  }
  return null;
}

// 차량 간 충돌: 원 충돌 → 밀어내기 + 속도 교환 + 대미지 (아케이드 범프)
// 반환값: 이번 프레임 최대 충돌 세기 (효과음·카메라 셰이크용)
export function resolveCollisions(cars, dt) {
  const R = 3.5; // 차체 길이 7 기준: 옆칸(8) 오판 방지, 앞뒤 접촉 시점에 판정
  let maxImpact = 0;
  for (const c of cars) {
    if (c.hitCd > 0) c.hitCd -= dt;
  }
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      if (a.out || b.out) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.001 && d < R * 2) {
        const nx = dx / d;
        const nz = dz / d;
        const overlap = R * 2 - d;
        a.x -= nx * overlap * 0.5;
        a.z -= nz * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.z += nz * overlap * 0.5;
        // 법선 방향 속도 교환 (확실히 부딪히는 느낌 + 내구도가 높을수록 감속 적음)
        const avn = a.vx * nx + a.vz * nz;
        const bvn = b.vx * nx + b.vz * nz;
        const rel = avn - bvn;
        if (rel > 0) {
          maxImpact = Math.max(maxImpact, rel);
          const dampA = 0.85 + 0.1 * (a.def.stats.durability / 5);
          const dampB = 0.85 + 0.1 * (b.def.stats.durability / 5);
          a.vx -= nx * rel * dampA;
          a.vz -= nz * rel * dampA;
          b.vx += nx * rel * dampB;
          b.vz += nz * rel * dampB;
          // 대미지 (쿨다운 중이 아닐 때만, 양쪽 다 입음)
          if (rel > 8) {
            const dmg = rel * 0.55;
            if (a.hitCd <= 0) {
              a.hp -= dmg;
              a.hitCd = 0.6;
              if (a.hp <= 0) {
                a.hp = 0;
                a.out = true;
              }
            }
            if (b.hitCd <= 0) {
              b.hp -= dmg;
              b.hitCd = 0.6;
              if (b.hp <= 0) {
                b.hp = 0;
                b.out = true;
              }
            }
          }
        }
      }
    }
  }
  return maxImpact;
}

// 장애물 충돌: 원 vs 원 → 밀어내기 + 반사 + 대미지 (반환: 최대 임팩트)
export function collideObstacles(car, colliders, dt) {
  if (car.out) return 0;
  const R = 2.4; // 차체 중심 기준: 시각적 접촉 시점에 판정 (과민 반응 방지)
  let maxImpact = 0;
  for (let k = 0; k < colliders.length; k++) {
    const o = colliders[k];
    const dx = car.x - o.x;
    const dz = car.z - o.z;
    const rr = R + o.r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr || d2 < 0.0001) continue;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const nz = dz / d;
    // 밀어내기
    car.x = o.x + nx * rr;
    car.z = o.z + nz * rr;
    // 법선 속도 반사 (탄성 0.4)
    const vn = car.vx * nx + car.vz * nz;
    if (vn < 0) {
      const spd = Math.hypot(car.vx, car.vz);
      maxImpact = Math.max(maxImpact, -vn);
      car.vx -= 1.4 * vn * nx;
      car.vz -= 1.4 * vn * nz;
      if (spd > 12 && car.hitCd <= 0) {
        car.hp -= spd * 0.35;
        car.hitCd = 0.6;
        if (car.hp <= 0) {
          car.hp = 0;
          car.out = true;
        }
      }
    }
  }
  return maxImpact;
}

// 가드레일 벽: 카트라이더처럼 트랙 이탈 불가, 박으면 감속 (+강타 시 대미지)
// ※ 앞/뒤 범퍼 2점 판정 — 무게중심 원판정이 아니라 닿는 점 기준으로 밀어냄
// walls = { gaps: [{ax,az,bx,bz}] } (gaps: 지름길 틈새, 여기선 벽 없음)
export function ptSegDist(px, pz, g) {
  const dx = g.bx - g.ax;
  const dz = g.bz - g.az;
  const L2 = dx * dx + dz * dz || 1;
  let t = ((px - g.ax) * dx + (pz - g.az) * dz) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (g.ax + dx * t), pz - (g.az + dz * t));
}

const WALL_LIM = 2.2; // 도로 반폭 + 여유 (차체 반폭 1.8 고려)
const BUMPER = 3.4; // 앞/뒤 범퍼 거리

export function collideWalls(car, circuit, roadHalf, walls, dt) {
  if (car.out || !walls) return 0;
  const LIM = roadHalf + WALL_LIM;
  const hx = Math.cos(car.heading);
  const hz = Math.sin(car.heading);
  let contact = false;
  // 앞·뒤 범퍼가 벽을 넘었으면 차체를 밀어냄
  for (const s of [BUMPER, -BUMPER]) {
    const fx = car.x + hx * s;
    const fz = car.z + hz * s;
    const snap = circuit.project(fx, fz);
    if (Math.abs(snap.lateral) <= LIM) continue;
    let inGap = false;
    for (const g of walls.gaps) {
      if (ptSegDist(fx, fz, g) < 13) {
        inGap = true;
        break;
      }
    }
    if (inGap) continue;
    const p = circuit.pointAt(snap.dist);
    const sgn = snap.lateral > 0 ? 1 : -1;
    const pen = Math.abs(snap.lateral) - LIM;
    car.x -= -p.dz * sgn * pen;
    car.z -= p.dx * sgn * pen;
    contact = true;
  }
  if (!contact) return 0;
  // 속도 응답 (중앙 기준): 법선은 튕기고, 접선은 감속 (긁힘 감속)
  const snap = circuit.project(car.x, car.z);
  const p = circuit.pointAt(snap.dist);
  const sgn = snap.lateral > 0 ? 1 : -1;
  const px = -p.dz;
  const pz = p.dx;
  const vn = (car.vx * px + car.vz * pz) * sgn; // 바깥 방향 +
  const vt = car.vx * p.dx + car.vz * p.dz;
  let impact = 0;
  if (vn > 0) {
    impact = vn;
    const bounced = -vn * 0.35;
    car.vx = p.dx * vt * 0.93 + px * sgn * bounced;
    car.vz = p.dz * vt * 0.93 + pz * sgn * bounced;
    if (vn > 18 && car.hitCd <= 0) {
      car.hp -= (vn - 15) * 0.5;
      car.hitCd = 0.6;
      if (car.hp <= 0) {
        car.hp = 0;
        car.out = true;
      }
    }
  } else {
    car.vx *= Math.exp(-1.5 * dt);
    car.vz *= Math.exp(-1.5 * dt);
  }
  return impact;
}

// AI: 퓨어퍼슈트(전방 목표점 추적) + 커브 감속 + 러버밴딩
export function aiInput(car, circuit, roadHalf, dt, playerProgress, aiProgress, ai) {
  const lookahead = 22 + Math.hypot(car.vx, car.vz) * 0.55;
  const snap = circuit.project(car.x, car.z);
  const target = circuit.pointAt(snap.dist + lookahead);
  // 목표 lateral: 코너 바깥→안쪽 (단순화: 직선 중앙, 커브 안쪽)
  const curv = circuit.curvatureAt(snap.dist + 10, 25);
  const dstLat = Math.max(-1, Math.min(1, -ai.lane * 3 - curv * 40));
  const tx = target.x + -target.dz * dstLat;
  const tz = target.z + target.dx * dstLat;

  const hx = Math.cos(car.heading);
  const hz = Math.sin(car.heading);
  const dx = tx - car.x;
  const dz = tz - car.z;
  const cross = hx * dz - hz * dx;
  const dot = hx * dx + hz * dz;
  let steer = Math.max(-1, Math.min(1, cross * 0.12));
  if (dot < -2) steer = cross >= 0 ? 1 : -1;

  // 목표 속도: 커브 + 러버밴딩
  let targetSpeed = car.def.maxSpeed * (1 - Math.min(0.45, curv * 26));
  const diff = playerProgress - aiProgress; // +면 플레이어가 앞섬
  targetSpeed *= 1 + Math.max(-0.06, Math.min(0.08, diff * 0.0004));
  targetSpeed *= ai.pace;

  const spd = car.vx * hx + car.vz * hz;
  const input = { steer, throttle: 0, brake: 0 };
  if (spd < targetSpeed) input.throttle = 1;
  else if (spd > targetSpeed + 4) input.brake = 0.6;
  return input;
}

export function progressOf(car, circuit) {
  return car.lap * circuit.length + Math.max(0, car.dist - car.lap * circuit.length);
}
