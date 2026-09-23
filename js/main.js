// 메인 오케스트레이션: 차고 → 카운트다운 → 경주 → 결과
import * as THREE from 'three';
import { TRACK_DEFS, buildTrack, trackY } from './track.js?v=9';
import {
  CAR_DEFS, makeCarState, stepCar, checkLap, damageWithShield,
  resolveCollisions, collideObstacles, collideWalls, aiInput, progressOf,
} from './race.js?v=9';
import { CAR_BUILDERS } from './voxel.js?v=9';
import { createWorld, gridSlots, ROAD_HALF } from './world.js?v=9';

// 현재 트랙의 도로 반폭 (village 등 좁은 길 대응)
function roadHalf() {
  return (typeof circuit !== 'undefined' && circuit && circuit.roadHalf) || ROAD_HALF;
}
import { createHUD, createInput, createBeeper, setSteerHint, fmtTime } from './hud.js?v=11';
import { createGarage } from './garage.js?v=16';
import { carSnapshot, blendSnapshot, extrapolateRemote, planOnlineGrid, STATE_HZ } from './net.js?v=8';
import { createOnlinePanel } from './online.js?v=9';
import { Board } from './board.js?v=2';
import { SkidTrails } from './skids.js?v=14';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2000);

let circuit = buildTrack(TRACK_DEFS[0]);
let trackDef = TRACK_DEFS[0];
let LAPS = trackDef.laps;
let worldObjs = []; // 현 트랙 월드 오브젝트 (교체 시 제거)
let colliders = []; // 장애물 {x,z,r}
let wallGaps = []; // 벽 틈새(지름길 출입구)
let pads = []; // 부스터 패드 {x,z}
let jumps = []; // 점프대 {x,z}
let itemBoxes = []; // 아이템 박스 {x,z,mesh,takenT}
const mines = new Map(); // id -> {x,z,mesh,armT}
let ITEMS_ON = true;
let timeAttack = false; // 1인 타임어택 모드
let soloTA = false; // 솔로 시작 모드 기억 (다시 달리기용)
// 순위표 단일 진실 원천 (board.js) — 메모리+저장소+공유 병합
const board = new Board((url, opts) => window.mqtt.connect(url, opts));
function loadTARecords() {
  return board.localAll();
}
function bestTARecord(trackId) {
  return board.best(trackId);
}
function saveTARecord(trackId, entry) {
  const { entry: saved, rank } = board.save(trackId, entry);
  return rank;
}
function taBoard(trackId) {
  return board.list(trackId);
}
let pingAcc = 0;

const ITEM_INFO = {
  boost: { emoji: '🚀', name: 'BOOST' },
  shield: { emoji: '🛡️', name: 'SHIELD' },
  mine: { emoji: '💣', name: 'MINE' },
  shock: { emoji: '⚡', name: 'SHOCK' },
};
function rollItem() {
  const r = Math.random();
  if (r < 0.3) return 'boost';
  if (r < 0.55) return 'shield';
  if (r < 0.8) return 'mine';
  return 'shock';
}
function updateItemHUD() {
  const box = document.getElementById('itemBox');
  if (!box) return;
  const c = racers[playerIdx] && racers[playerIdx].car;
  if (!ITEMS_ON || !c || !c.item) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';
  const info = ITEM_INFO[c.item];
  box.textContent = info.emoji;
}

function buildWorldTrack(def) {
  for (const o of worldObjs) scene.remove(o);
  const before = new Set(scene.children);
  const w = createWorld(scene, circuit, def.theme, def.shortcuts || (def.id === 'express' ? 'apex' : null), {
    boosts: def.boosts, jumps: def.jumps, blocks: def.blocks, items: ITEMS_ON,
  });
  colliders = w.colliders;
  wallGaps = w.wallGaps;
  pads = w.pads;
  jumps = w.jumps;
  itemBoxes = w.itemBoxes;
  clearMines();
  worldObjs = scene.children.filter((o) => !before.has(o));
}

function clearMines() {
  for (const [, m] of mines) scene.remove(m.mesh);
  mines.clear();
}

function addMine(m) {
  if (mines.has(m.id) || mines.size >= 14) return;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 1.1, 1.6),
    new THREE.MeshLambertMaterial({ color: 0x222222 })
  );
  const dot = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 1.2, 0.6),
    new THREE.MeshBasicMaterial({ color: 0xff3b30 })
  );
  mesh.add(dot);
  mesh.position.set(m.x, trackY(circuit, circuit.project(m.x, m.z).dist) + 0.55, m.z);
  mesh.castShadow = true;
  scene.add(mesh);
  mines.set(m.id, { x: m.x, z: m.z, mesh, armT: 1.0 });
}

function removeMine(id) {
  const m = mines.get(id);
  if (!m) return;
  scene.remove(m.mesh);
  mines.delete(id);
}
buildWorldTrack(trackDef);

let hud = createHUD(circuit);
const input = createInput(canvas);
const beeper = createBeeper();

function resize() {
  // 풀스크린: 뷰포트 전체 사용
  const cw = window.innerWidth;
  const ch = window.innerHeight;
  renderer.setSize(cw, ch, false);
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  camera.aspect = cw / ch;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// --- 레이저 상태 ---
let racers = []; // {car, mesh, isPlayer, local, ai, name, slot, peerId, smokeAcc}
let phase = 'garage';
let raceTime = 0;
let countdownT = 0;
let playerIdx = 0;
let netAcc = 0;
let syncAcc = 0;
let lastShownItem = null;
let lastBoostT = 0;
let lastTARank = -1;
let lastTAEntry = null;
let onlineCtl = null; // {room, players, ai, track, myId} | null (solo면 null)
let garageCtl = null;
let ghost = null; // {samples, mesh, dur} 고스트 대결용
let recAcc = 0;
const camPos = new THREE.Vector3();
const skids = new SkidTrails(scene);

function clearRacers() {
  for (const r of racers) {
    scene.remove(r.mesh);
    if (r.shieldMesh) scene.remove(r.shieldMesh);
  }
  racers = [];
  clearGhost();
  skids.clear();
}

function clearGhost() {
  if (ghost && ghost.mesh) scene.remove(ghost.mesh);
  ghost = null;
  const d = document.getElementById('deltaBox');
  if (d) d.style.display = 'none';
}

function newShieldMesh() {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(4.6, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0x27e0f5, transparent: true, opacity: 0.28 })
  );
  m.visible = false;
  scene.add(m);
  return m;
}

function buildRace(playerDef, tdef, opts = {}) {
  ITEMS_ON = pendingItems;
  timeAttack = !!opts.timeAttack;
  soloTA = timeAttack;
  if (tdef && tdef.id !== trackDef.id) {
    trackDef = tdef;
    circuit = buildTrack(tdef);
    LAPS = tdef.laps;
    hud = createHUD(circuit);
  }
  clearRacers();
  buildWorldTrack(trackDef);
  const slots = gridSlots(circuit);
  const defs = [playerDef];
  if (!timeAttack) {
    // 타임어택이 아니면 CPU 3대와 경주
    const pool = CAR_DEFS.filter((d) => d.id !== playerDef.id);
    while (defs.length < 4) defs.push(pool[(defs.length - 1) % pool.length]);
  }

  const paces = [1, 0.94, 0.965, 0.92];
  const lanes = [0, 1, -1, 0.5];
  defs.forEach((def, i) => {
    const s = slots[i % slots.length];
    const car = makeCarState(def, s.x, s.z, s.heading);
    car.lapStart = 0;
    const mesh = CAR_BUILDERS[def.id](def.color, def.accent);
    mesh.position.set(s.x, 0, s.z);
    mesh.rotation.y = -s.heading;
    scene.add(mesh);
    racers.push({
      car, mesh,
      isPlayer: i === 0,
      local: true,
      name: i === 0 ? `YOU (${def.name})` : `CPU ${i} (${def.name})`,
      ai: i === 0 ? null : { pace: paces[i % paces.length], lane: lanes[i % lanes.length] },
      slot: i,
      peerId: null,
      smokeAcc: 0,
      shieldMesh: newShieldMesh(),
    });
  });
  playerIdx = 0;
  raceTime = 0;
  spectateIdx = null;
  // 타임어택에선 순위 박스 숨김
  document.getElementById('posBox').style.display = timeAttack ? 'none' : 'block';
  snapCamera(true);
}

// 카메라: 위치·주시점·FOV 모두 지수 댐핑(관성) — 뚝뚝 끊김 방지
const lookSm = new THREE.Vector3();
let shakeT = 0;
function snapCamera(hard, dt = 0.016) {
  const p = racers[focusIdx()].car;
  const spd = Math.hypot(p.vx, p.vz);
  const fx = Math.cos(p.heading);
  const fz = Math.sin(p.heading);
  const back = 26 + spd * 0.18; // 빠를수록 살짝 멀어짐
  const height = 19 + spd * 0.06;
  const baseY = trackY(circuit, p.dist);
  const desired = new THREE.Vector3(p.x - fx * back, baseY + height, p.z - fz * back);
  const lookDes = new THREE.Vector3(p.x + fx * 20, baseY + 2, p.z + fz * 20);
  if (hard) {
    camPos.copy(desired);
    lookSm.copy(lookDes);
  } else {
    camPos.lerp(desired, 1 - Math.exp(-4.0 * dt)); // 위치 관성
    lookSm.lerp(lookDes, 1 - Math.exp(-6.5 * dt)); // 시선 관성
  }
  camera.position.copy(camPos);
  if (shakeT > 0) {
    camera.position.x += (Math.random() - 0.5) * shakeT * 3;
    camera.position.y += (Math.random() - 0.5) * shakeT * 2;
    shakeT -= dt;
  }
  camera.lookAt(lookSm);
  const targetFov = 62 + Math.min(14, spd * 0.16); // 속도감 FOV
  camera.fov += (targetFov - camera.fov) * Math.min(1, 2.5 * dt);
  camera.updateProjectionMatrix();
}

// 드리프트/잔디 먼지 (간단 박스 풀)
const puffPool = [];
{
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.MeshLambertMaterial({ color: 0xcfc8bd, transparent: true, opacity: 0.7 });
  for (let i = 0; i < 90; i++) {
    const mesh = new THREE.Mesh(geo, m.clone());
    mesh.visible = false;
    scene.add(mesh);
    puffPool.push({ mesh, life: 0 });
  }
}
let puffIdx = 0;
const FIRE_COLORS = [0xe25822, 0xf2a007, 0xf2e007, 0x3a3a3a, 0xcfc8bd];
function puff(x, z, color = 0xcfc8bd, big = 1, y = 0.8) {
  const p = puffPool[puffIdx++ % puffPool.length];
  p.mesh.visible = true;
  p.mesh.material.color.setHex(color);
  p.mesh.position.set(x, y, z);
  p.mesh.scale.set(1.4 * big, 1.4 * big, 1.4 * big);
  p.life = 1;
  p.big = big;
}
function updatePuffs(dt) {
  for (const p of puffPool) {
    if (p.life <= 0) continue;
    p.life -= dt * 1.6;
    p.mesh.position.y += dt * 2;
    const b = p.big || 1;
    const s = (1.4 + (1 - p.life) * 2.2) * b;
    p.mesh.scale.set(s, s, s);
    p.mesh.material.opacity = Math.max(0, p.life) * 0.6;
    if (p.life <= 0) p.mesh.visible = false;
  }
}

// 아이템 사용 (로컬 차량)
function useItem(r) {
  if (!r) return;
  const c = r.car;
  if (!c.item || c.out) return;
  const it = c.item;
  c.item = null;
  if (r.isPlayer) updateItemHUD();
  if (it === 'boost') {
    c.boostT = Math.max(c.boostT, 1.3);
    if (r.isPlayer) beeper.boost();
  } else if (it === 'shield') {
    c.shieldT = 6;
    if (r.isPlayer) beeper.count();
  } else if (it === 'mine') {
    const id = `m${Date.now().toString(36)}${Math.floor(Math.random() * 999)}`;
    const mx = c.x - Math.cos(c.heading) * 5;
    const mz = c.z - Math.sin(c.heading) * 5;
    addMine({ id, x: +mx.toFixed(1), z: +mz.toFixed(1) });
    if (r.isPlayer) beeper.count();
  } else if (it === 'shock') {
    // 본인 외 로컬 차량에 즉시 적용 (권위 측 시뮬, 상태로 전파)
    applyShockBlast(r);
    if (r.isPlayer) beeper.boost();
  }
}

// 쇼크: exceptR 외 로컬 차량 전체에 감전 (12 대미지 + 감속)
function applyShockBlast(exceptR) {
  for (const r of racers) {
    if (!r.local || r === exceptR) continue;
    const c = r.car;
    if (c.out || c.finished) continue;
    damageWithShield(c, 12);
    c.vx *= 0.7;
    c.vz *= 0.7;
    c.hitCd = Math.max(c.hitCd, 0.6);
  }
}

// 폭파: 불꽃 버스트 + 메시 숨김
function explode(r) {
  const c = r.car;
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 1 + Math.random() * 5;
    puff(
      c.x + Math.cos(a) * d,
      c.z + Math.sin(a) * d,
      FIRE_COLORS[i % FIRE_COLORS.length],
      1.6
    );
  }
  r.mesh.visible = false;
  beeper.crash();
  const p = racers[playerIdx].car;
  const dp = Math.hypot(c.x - p.x, c.z - p.z);
  if (r.isPlayer) shakeT = 0.7;
  else if (dp < 90) shakeT = Math.max(shakeT, 0.3);
}

function rankKey(r) {
  return r.car.out ? -1 : progressOf(r.car, circuit);
}
function ordSuffix(pos) {
  return pos === 1 ? 'st' : pos === 2 ? 'nd' : pos === 3 ? 'rd' : 'th';
}
function raceOrder() {
  // 완주 차량은 기록순, 미완주는 진행도순, 탈락은 최하위
  return [...racers].sort((a, b) => {
    if (a.car.finished && b.car.finished) return a.car.finishTime - b.car.finishTime;
    if (a.car.finished) return -1;
    if (b.car.finished) return 1;
    return rankKey(b) - rankKey(a);
  });
}

function startCountdown() {
  phase = 'countdown';
  countdownT = 3.0; // 정확히 3초 카운트다운
  lastCount = 3;
  spectateIdx = null;
  autoFinalShown = false;
  playerDone = null;
  recAcc = 0;
  hideFinishBanner();
  // 아이템전 OFF면 아이템 버튼 숨김
  for (const id of ['btnItemL', 'btnItemR']) {
    const b = document.getElementById(id);
    if (b) b.style.display = ITEMS_ON ? 'block' : 'none';
  }
  document.getElementById('hud').style.display = 'block';
  hud.hideResults();
  setSteerHint(true); // 시작 전 반투명 L/R 힌트
  hud.message('3');
  beeper.count();
}

let lastCount = 4;
let lastTs = performance.now();

function loop(ts) {
  requestAnimationFrame(loop);
  let dt = (ts - lastTs) / 1000;
  lastTs = ts;
  if (dt > 0.06) dt = 0.06;

  // 폭파 연출: 2.5초간 불꽃을 보여준 뒤 성적표
  if (phase === 'wreck-anim') {
    wreckTimer -= dt;
    updatePuffs(dt);
    snapCamera(false, dt);
    renderer.render(scene, camera);
    if (wreckTimer <= 0) enterFinishedWrecked();
    return;
  }

  if (phase === 'countdown') {
    countdownT -= dt;
    const c = Math.ceil(countdownT);
    if (c !== lastCount && c >= 1) {
      lastCount = c;
      hud.message(String(c));
      beeper.count();
    }
    if (countdownT <= 0) {
      phase = 'racing';
      for (const r of racers) r.car.lapStart = 0;
      setSteerHint(false); // 시작하면 L/R 힌트 제거 (화면 탭 조향)
      hud.message('GO!', '', 900);
      beeper.go();
    }
    snapCamera(false, dt);
    renderer.render(scene, camera);
    return;
  }

  if (phase !== 'racing' && phase !== 'finished') {
    renderer.render(scene, camera);
    return;
  }

  raceTime += dt;
  const p = racers[playerIdx].car;

  // 플레이어 입력 (자동 가속 ON: 사진 1처럼 가만히 있어도 전진)
  const pin = input.toRaceInput();

  // AI 입력 (로컬 AI만, 원격은 스냅샷)
  // 권위: 솔로/호스트가 전체 시뮬, 게스트는 자기 차만 예측
  const simAuthority = !onlineCtl || onlineCtl.room.isHost;
  const DUMMY = { steer: 0, throttle: 0, brake: 0, drift: false };
  const pProg = progressOf(p, circuit);
  const inputs = racers.map((r) => {
    // 피니시한 내 차는 CPU가 인계 (관전), 관전 중 미완주 내 차는 정지
    if (r.isPlayer && !r.car.finished) return spectateIdx == null ? pin : DUMMY;
    if (r.ai) {
      if (!r.local) return DUMMY;
      return aiInput(r.car, circuit, roadHalf(), dt, pProg, progressOf(r.car, circuit), r.ai);
    }
    // 호스트가 보는 게스트 차량: 수신된 입력으로 시뮬
    if (simAuthority && onlineCtl) {
      const st = onlineCtl.room.remoteInputs.get(r.peerId);
      if (st && Date.now() - st.at < 1000) return st.input;
    }
    return DUMMY;
  });

  // 게스트 차량의 아이템 사용 엣지 (호스트가 소비)
  if (simAuthority && onlineCtl && onlineCtl.room.isHost) {
    for (const r of racers) {
      if (r.local && !r.isPlayer && !r.ai && !r.car.out && !r.car.finished) {
        const st = onlineCtl.room.remoteInputs.get(r.peerId);
        const u = !!(st && st.input && st.input.useItem);
        if (u && !r.lastUseItem) useItem(r);
        r.lastUseItem = u;
      }
    }
  }

  // 부스터/점프 타이머 + 패드 트리거 (시뮬 대상만)
  // 호스트: 전원 스텝 / 게스트: 자기 차만 예측 스텝
  const simAll = !onlineCtl || onlineCtl.room.isHost;
  for (const r of racers) {
    const c = r.car;
    if (c.out || (!simAll && !r.isPlayer)) continue;
    if (c.boostT > 0) c.boostT -= dt;
    const wasAir = c.airT > 0;
    if (c.airT > 0) c.airT -= dt;
    if (wasAir && c.airT <= 0 && phase === 'racing') {
      beeper.land();
      for (let k = 0; k < 6; k++) {
        puff(c.x + (Math.random() - 0.5) * 4, c.z + (Math.random() - 0.5) * 4, 0xcfc8bd, 1);
      }
    }
    if (c.finished) continue;
    // 드리프트 미니 터보 (플레이어만 차지, 버튼을 놓으면 발사)
    if (r.isPlayer) {
      const fwdSpd = c.vx * Math.cos(c.heading) + c.vz * Math.sin(c.heading);
      const held = !!pin.drift && Math.abs(fwdSpd) > 8;
      if (c.driftHeld && !held) {
        if ((c.driftCharge || 0) > 0.4) {
          c.boostT = Math.max(c.boostT, Math.min(1.5, 0.5 + c.driftCharge));
          beeper.boost();
          hud.message('MINI TURBO!', '', 700);
        }
        c.driftCharge = 0;
      }
      c.driftHeld = held;
      if (!held) c.driftCharge = 0;
    }
    for (const pd of pads) {
      const dx = c.x - pd.x;
      const dz = c.z - pd.z;
      if (dx * dx + dz * dz < 49 && c.boostT <= 0) {
        c.boostT = 1.3;
        if (r.isPlayer) beeper.boost();
      }
    }
    for (const j of jumps) {
      const dx = c.x - j.x;
      const dz = c.z - j.z;
      if (dx * dx + dz * dz < 49 && c.airT <= 0) {
        c.airT = c.airDur;
      }
    }
  }

  // 아이템 박스 회전·리스폰 + 줍기 (권위 측만: 솔로/호스트)
  if (ITEMS_ON) {
    for (const b of itemBoxes) {
      if (b.takenT > 0) {
        b.takenT -= dt;
        if (b.takenT <= 0) b.mesh.visible = true;
      } else {
        b.mesh.rotation.y += dt * 2;
      }
    }
    if (simAuthority) {
    for (const r of racers) {
      const c = r.car;
      if (!r.local || c.out || c.finished || c.item) continue;
      for (const b of itemBoxes) {
        if (b.takenT > 0) continue;
        const dx = c.x - b.x;
        const dz = c.z - b.z;
        if (dx * dx + dz * dz < 20) {
          c.item = rollItem();
          b.takenT = 5;
          b.mesh.visible = false;
          if (r.isPlayer) {
            beeper.count();
            updateItemHUD();
          }
          break;
        }
      }
    }
    }
  }

  // 아이템 사용 (엣지 트리거 소비, 권위 측만)
  if (input.state.useItem) {
    input.state.useItem = false;
    if (ITEMS_ON && simAuthority && (phase === 'racing' || phase === 'finished')) {
      useItem(racers[playerIdx]);
    }
  }

  // 지뢰 움직임·기폭 (권위 측만: 로컬 차량 피격 판정)
  if (simAuthority) {
  for (const [id, m] of mines) {
    m.armT -= dt;
    m.mesh.rotation.y += dt * 4;
    for (const r of racers) {
      const c = r.car;
      if (!r.local || c.out || c.finished) continue;
      const dx = c.x - m.x;
      const dz = c.z - m.z;
      if (dx * dx + dz * dz < 16 && m.armT <= 0) {
        damageWithShield(c, 25);
        c.hitCd = Math.max(c.hitCd, 0.6);
        c.vx *= 0.6;
        c.vz *= 0.6;
        removeMine(id);
        if (r.isPlayer) {
          beeper.crash();
          shakeT = Math.max(shakeT, 0.4);
        }
        break;
      }
    }
  }
  } else {
    for (const [, m] of mines) {
      m.armT -= dt;
      m.mesh.rotation.y += dt * 4;
    }
  }

  // 물리 + 랩 (시뮬 대상만; 탈락 제외, 완주 차량은 쿨다운 주행 계속)
  racers.forEach((r, i) => {
    if (r.car.out || (!simAll && !r.isPlayer)) return;
    stepCar(r.car, inputs[i], dt, circuit, roadHalf());
    if (r.car.finished) return;
    const ev = checkLap(r.car, circuit, LAPS, raceTime);
    if (r.isPlayer) {
      if (ev === 'lap') {
        if (r.car.lap === LAPS - 1) hud.message('FINAL LAP', '', 1500);
        else hud.message(`LAP ${r.car.lap + 1}`, '', 1200);
        beeper.count();
      } else if (ev === 'finished') {
        onLocalFinish();
      }
    }
  });

  // 차량끼리 + 벽 + 장애물 충돌 (대미지 포함, 점프 중엔 장애물 통과)
  let impact = resolveCollisions(
    racers.map((r) => r.car),
    dt
  );
  for (const r of racers) {
    if (r.car.out || r.car.finished) continue;
    impact = Math.max(
      impact,
      collideWalls(r.car, circuit, roadHalf(), { gaps: wallGaps }, dt)
    );
    if (r.car.airT <= 0) {
      impact = Math.max(impact, collideObstacles(r.car, colliders, dt));
    }
  }
  if (impact > 8) {
    beeper.crash();
    shakeT = Math.max(shakeT, Math.min(0.45, impact * 0.015));
  }
  // 새로 탈락한 차량 폭파 연출 (플레이어는 연출 후 성적표)
  for (const r of racers) {
    if (r.car.out && r.mesh.visible) {
      explode(r);
      if (r.isPlayer) onPlayerWrecked();
    }
  }
  if (phase !== 'racing' && phase !== 'finished') {
    updatePuffs(dt);
    renderer.render(scene, camera);
    return;
  }

  // 고스트용 궤적 기록 (TA 솔로, 5Hz)
  if (timeAttack && !onlineCtl && phase === 'racing') {
    const pc = racers[playerIdx] && racers[playerIdx].car;
    if (pc && !pc.out && !pc.finished) {
      recAcc += dt;
      if (recAcc >= 0.2) {
        recAcc = 0;
        pc.trail.push({
          t: +raceTime.toFixed(2), d: +pc.dist.toFixed(1),
          x: +pc.x.toFixed(1), z: +pc.z.toFixed(1), h: +pc.heading.toFixed(3),
        });
      }
    }
  }

  // 고스트 재생 + 실시간 차이
  if (ghost && timeAttack && (phase === 'racing' || phase === 'finished')) {
    updateGhost();
  }

  // 메시 싱크 + 먼지 (고도 + 점프 + 경사 피치 반영)
  // 호스트·솔로는 전원 직접 렌더, 게스트는 자기 차만 직접 + 타인은 보간
  const renderDirectAll = !onlineCtl || onlineCtl.room.isHost;
  for (const r of racers) {
    const c = r.car;
    if (c.shieldT > 0 && r.local) c.shieldT -= dt;
    if (r.shieldMesh) {
      r.shieldMesh.visible = c.shieldT > 0 && !c.out;
      if (r.shieldMesh.visible) {
        r.shieldMesh.position.copy(r.mesh.position);
      }
    }
    if (!renderDirectAll && !r.isPlayer) {
      // 원격 차량: 데드레커닝 예측 + 스냅샷으로 부드럽게 보간
      extrapolateRemote(c, dt);
      const k = 1 - Math.exp(-14 * dt);
      const ty =
        trackY(circuit, c.dist) +
        (c.airT > 0 ? Math.sin(Math.PI * (1 - c.airT / c.airDur)) * 3.2 : 0);
      r.mesh.position.x += (c.x - r.mesh.position.x) * k;
      r.mesh.position.y += (ty - r.mesh.position.y) * k;
      r.mesh.position.z += (c.z - r.mesh.position.z) * k;
      const want = -c.heading;
      const cur = r.mesh.rotation.y;
      const dh = ((want - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      r.mesh.rotation.y = cur + dh * k;
      r.mesh.rotation.z = 0;
    } else {
      const baseY = trackY(circuit, c.dist);
      let airY = 0;
      // 차체 피치: 진행 방향 경사를 따름 (언덕에 묻히지 않게)
      const fx = Math.cos(c.heading);
      const fz = Math.sin(c.heading);
      const yA = trackY(circuit, circuit.project(c.x + fx * 3.5, c.z + fz * 3.5).dist);
      const yB = trackY(circuit, circuit.project(c.x - fx * 3.5, c.z - fz * 3.5).dist);
      let pitch = Math.atan2(yA - yB, 7);
      if (c.airT > 0) {
        // 점프 포물선: 이륙각 → 착지각
        airY = Math.sin(Math.PI * (1 - c.airT / c.airDur)) * 3.2;
        const kk = 1 - c.airT / c.airDur;
        pitch = 0.32 * (1 - kk) + pitch * kk;
      }
      r.mesh.position.set(c.x, baseY + airY, c.z);
      r.mesh.rotation.y = -c.heading;
      r.mesh.rotation.z = pitch;
    }
    const fw = r.mesh.userData.frontWheels || [];
    for (const w of fw) w.rotation.y = -c.steerVis * 0.45;
    const latV = Math.abs(c.vx * -Math.sin(c.heading) + c.vz * Math.cos(c.heading));
    const my = r.mesh.position.y;
    if ((latV > 14 || c.offTrack || c.drifting) && Math.hypot(c.vx, c.vz) > 12 && Math.random() < 0.6) {
      puff(c.x - Math.cos(c.heading) * 3, c.z - Math.sin(c.heading) * 3, 0xcfc8bd, 1, my);
    }
    // 부스트 불꽃 (차량 뒤쪽 배기)
    if (c.boostT > 0 && !c.out && Math.random() < 0.8) {
      puff(
        c.x - Math.cos(c.heading) * 3.6 + (Math.random() - 0.5) * 1.6,
        c.z - Math.sin(c.heading) * 3.6 + (Math.random() - 0.5) * 1.6,
        Math.random() < 0.5 ? 0xf2a007 : 0xe25822,
        1.3,
        my
      );
    }
    // 스키드마크 (드리프트+회전 중, 지면 접촉 시만)
    if (
      c.drifting && !c.out && c.airT <= 0 &&
      Math.abs(c.steerSm || 0) > 0.25 &&
      Math.hypot(c.vx, c.vz) > 10
    ) {
      const fx = Math.cos(c.heading);
      const fz = Math.sin(c.heading);
      const cx = c.x - fx * 2.2;
      const cz = c.z - fz * 2.2;
      const wy = trackY(circuit, c.dist) + 0.15;
      skids.addPoint(r.slot + 'L', cx + -fz * 1.3, wy, cz + fx * 1.3, fx, fz);
      skids.addPoint(r.slot + 'R', cx - -fz * 1.3, wy, cz - fx * 1.3, fx, fz);
    }
    if (!c.out && c.hp < c.maxHp * 0.6) {
      r.smokeAcc = (r.smokeAcc || 0) + dt * (c.hp < c.maxHp * 0.25 ? 26 : 10);
      while (r.smokeAcc >= 1) {
        r.smokeAcc -= 1;
        let col = 0x8a8a8a;
        if (c.hp < c.maxHp * 0.25) {
          const roll = Math.random();
          col = roll < 0.3 ? 0xe25822 : roll < 0.55 ? 0x3a3a3a : 0x8a8a8a;
        }
        puff(
          c.x - Math.cos(c.heading) * 2 + (Math.random() - 0.5) * 2.5,
          c.z - Math.sin(c.heading) * 2 + (Math.random() - 0.5) * 2.5,
          col,
          1,
          r.mesh.position.y
        );
      }
    } else {
      r.smokeAcc = 0;
    }
  }
  updatePuffs(dt);

  // 카메라
  snapCamera(false, dt);
  // 태양·그림자 범위를 플레이어 따라 이동
  const sun = scene.getObjectByProperty('type', 'DirectionalLight');
  const fp = racers[focusIdx()].car;
  if (sun) {
    sun.position.set(fp.x + 120, 180, fp.z + 60);
    sun.target.position.set(fp.x, 0, fp.z);
    sun.target.updateMatrixWorld();
  }

  // HUD (피니시 후에도 라이브 갱신)
  hud.drawMinimap(racers.map((r) => r.car), playerIdx);
  hud.setLap(p.lap, LAPS);
  hud.setTimer(raceTime);
  hud.setHp(p.hp, p.maxHp);
  const order = raceOrder();
  hud.setPos(order.indexOf(racers[playerIdx]) + 1, racers.length);
  // 관전 대상이 폭파됐으면 다음으로
  if (spectateIdx != null && (!racers[spectateIdx] || racers[spectateIdx].car.out)) {
    spectateNext();
  }
  // 성적표 라이브 갱신 + 전원 종료 시 자동 표시
  if (phase === 'finished') {
    refreshTick++;
    const visible = document.getElementById('results').style.display !== 'none';
    if (visible && refreshTick % 30 === 0) {
      if (timeAttack && playerDone === 'finished') refreshTAResults();
      else hud.showResults(currentStandings(), playerIdx);
    }
    if (!autoFinalShown && document.getElementById('results').style.display === 'none') {
      const others = racers.filter((r) => !r.isPlayer);
      if (others.length === 0 || others.every((r) => r.car.finished || r.car.out)) {
        autoFinalShown = true;
        onRaceEnd(playerDone || 'finished');
      }
    }
  }
  const spdNow = Math.hypot(p.vx, p.vz);
  hud.setSpeed(spdNow * 3.4);
  // 속도 비네팅 (빠를수록 화면 가장자리 압박감)
  const vig = document.getElementById('speedVig');
  if (vig) vig.style.opacity = Math.max(0, Math.min(0.85, (spdNow - 28) / 45)).toFixed(2);

  // 온라인 동기화 (20Hz)
  // - 호스트: 전체 시뮬 결과(차량+지뢰+박스+명단) 브로드캐스트
  // - 게스트: 입력만 전송, 나머지는 호스트 스냅샷으로 수렴
  if (onlineCtl) {
    const room = onlineCtl.room;
    netAcc += dt;
    if (netAcc >= 1 / STATE_HZ) {
      netAcc = 0;
      if (room.isHost) {
        const all = [];
        for (const r of racers) all.push({ slot: r.slot, ...carSnapshot(r.car) });
        const minesArr = [...mines.entries()].map(([id, m]) => ({
          id, x: +m.x.toFixed(1), z: +m.z.toFixed(1),
        }));
        const boxesArr = itemBoxes.map((b) => (b.takenT > 0 ? 1 : 0));
        const playersArr = onlineCtl.players.map((pl) => pl.id);
        room.sendState(all, minesArr, boxesArr, playersArr);
      } else {
        room.sendInput({ ...pin, useItem: !!input.state.useItem });
        input.state.useItem = false;
      }
    }
    // 핑 (게스트만 2초 간격, 호스트는 HOST 표시)
    const box = document.getElementById('pingBox');
    if (box) {
      box.style.display = 'block';
      if (onlineCtl.room.isHost) box.textContent = 'HOST';
      else {
        pingAcc += dt;
        if (pingAcc >= 2) {
          pingAcc = 0;
          onlineCtl.room.pingHost();
        }
      }
    }
  } else {
    const box = document.getElementById('pingBox');
    if (box) box.style.display = 'none';
  }

  // 스키드마크 aging (경주 중 계속)
  skids.update(dt);

  renderer.render(scene, camera);
}

let wreckTimer = 0;
let refreshTick = 0;
let spectateIdx = null; // null이면 내 차 시점
function onPlayerWrecked() {
  phase = 'wreck-anim';
  wreckTimer = 2.5;
  hud.message('💥 WRECKED!', '', 0);
}

let autoFinalShown = false;
let playerDone = null; // 'finished' | 'wrecked' | null
let lastBannerTitle = '';
let lastBannerSub = '';

function currentStandings() {
  const order = raceOrder();
  return order.map((r) => ({
    name: r.name + (r.car.out ? ' (OUT)' : ''),
    totalTime: r.car.finished ? r.car.finishTime : r.car.out ? Infinity : raceTime,
    bestLap: r.car.bestLap,
    isPlayer: r.isPlayer,
  }));
}

// 고스트 대결 시작 (TA, 선택한 기록의 궤적과 레이스)
function startGhostRace(trackId, entry) {
  const tdef = TRACK_DEFS.find((t) => t.id === trackId) || TRACK_DEFS[0];
  const carDef = pendingCar || CAR_DEFS[0];
  document.getElementById('garage').style.display = 'none';
  buildRace(carDef, tdef, { timeAttack: true });
  const gdef = CAR_DEFS.find((x) => x.id === entry.car) || carDef;
  const mesh = CAR_BUILDERS[gdef.id](gdef.color, gdef.accent);
  mesh.traverse((o) => {
    if (o.isMesh) {
      o.material = o.material.clone();
      o.material.transparent = true;
      o.material.opacity = 0.45;
      o.castShadow = false;
    }
  });
  mesh.visible = false;
  scene.add(mesh);
  ghost = { samples: entry.trail };
  ghost.mesh = mesh;
  startCountdown();
}

function ghostSampleAt(t) {
  const s = ghost.samples;
  if (!s || s.length === 0) return null;
  if (t <= s[0].t) return s[0];
  for (let i = 1; i < s.length; i++) {
    if (s[i].t >= t) {
      const a = s[i - 1];
      const b = s[i];
      const k = (t - a.t) / Math.max(0.001, b.t - a.t);
      return {
        d: a.d + (b.d - a.d) * k,
        x: a.x + (b.x - a.x) * k,
        z: a.z + (b.z - a.z) * k,
        h: a.h + (b.h - a.h) * k,
      };
    }
  }
  return null;
}

function updateGhost() {
  const d = document.getElementById('deltaBox');
  const g = ghostSampleAt(raceTime);
  if (!g) {
    ghost.mesh.visible = false;
    if (d) d.style.display = 'none';
    return;
  }
  ghost.mesh.visible = true;
  ghost.mesh.position.set(g.x, trackY(circuit, g.d) + 0.1, g.z);
  ghost.mesh.rotation.y = -g.h;
  const p = racers[playerIdx].car;
  const dm = g.d - p.dist;
  if (d) {
    d.style.display = 'block';
    d.textContent = (dm >= 0 ? '+' : '') + dm.toFixed(0) + 'm';
    d.style.color = dm >= 0 ? '#ff6b6b' : '#5dff5d';
  }
}

function onLocalFinish() {
  phase = 'finished';
  playerDone = 'finished';
  const me = racers[playerIdx];
  // 내 차는 CPU에게 인계 + 자동 관전 (결과표로 나가기 전까지)
  me.ai = { pace: 0.95, lane: 0 };
  spectateIdx = playerIdx;
  const order = raceOrder();
  const pos = order.indexOf(me) + 1;
  beeper.finish();
  if (timeAttack) {
    const rawTrail = me.car.trail || [];
    const trail = [];
    for (let i = 0; i < rawTrail.length; i += 2) {
      const s = rawTrail[i];
      trail.push({ t: s.t, d: s.d, x: s.x, z: s.z, h: s.h });
    }
    lastTARank = saveTARecord(trackDef.id, {
      total: +me.car.finishTime.toFixed(1),
      best: isFinite(me.car.bestLap) ? +me.car.bestLap.toFixed(1) : null,
      car: me.car.def.id,
      trail,
    });
    lastTAEntry = {
      tag: board.tag,
      total: +me.car.finishTime.toFixed(1),
    };
    hud.message('🏁 FINISH!', '', 1500);
    showFinishBanner(
      '⏱ TIME ATTACK',
      `TOTAL ${me.car.finishTime.toFixed(1)}s · BEST ${fmtTime(me.car.bestLap)} · 역대 ${lastTARank + 1}위`
    );
  } else {
    hud.message(`🏆 ${pos}${ordSuffix(pos)}!`, '', 1500);
    showFinishBanner(`🏁 ${pos}${ordSuffix(pos)} FINISH`, `기록 ${raceTime.toFixed(1)}s`);
  }
  updateSpectateUI();
}

function enterFinishedWrecked() {
  phase = 'finished';
  playerDone = 'wrecked';
  const lead = raceOrder().find((r) => !r.isPlayer && !r.car.out);
  spectateIdx = lead ? racers.indexOf(lead) : null;
  showFinishBanner('💥 WRECKED!', '관전 모드로 전환');
  updateSpectateUI();
}

function taResultRows() {
  const board = taBoard(trackDef.id);
  return board.map((e) => ({
    name: `${e.tag ? e.tag + ' · ' : ''}${(e.car || '').toUpperCase()} ${e.total.toFixed(1)}s${
      lastTAEntry && e.tag === lastTAEntry.tag && e.total === lastTAEntry.total ? ' 🆕' : ''
    }`,
    totalTime: e.total,
    bestLap: e.best === null || e.best === undefined ? Infinity : e.best,
    isPlayer: !!(lastTAEntry && e.tag === lastTAEntry.tag && e.total === lastTAEntry.total),
  }));
}

function setResultSyncMsg(msg) {
  const m = document.getElementById('resultSyncMsg');
  if (m) m.textContent = msg;
}

function refreshTAResults() {
  hud.showResults(taResultRows(), playerIdx);
}

// 미동기화 기록을 공유 보드에 올리고 결과표 새로고침
function syncRecordsToBoard() {
  setResultSyncMsg('공유 중...');
  board.sync().then((ok) => {
    setResultSyncMsg(
      ok ? '🌐 공유 완료' : '📴 공유 실패 — 내 기록만 표시'
    );
    if (document.getElementById('results').style.display !== 'none' && timeAttack) {
      refreshTAResults();
    }
  }).catch(() => {
    setResultSyncMsg('📴 공유 실패 — 내 기록만 표시');
  });
}

function onRaceEnd(reason) {
  // 성적표 표시 (경주는 뒤에서 계속 진행 — 라이브 갱신)
  const order = raceOrder();
  const pos = order.indexOf(racers[playerIdx]) + 1;
  if (reason === 'wrecked') {
    hud.message('💥 WRECKED!', '차량이 폭파됐습니다', 2500);
  } else {
    beeper.finish();
    hud.message(pos === 1 ? '🏆 WINNER!' : `${pos}${ordSuffix(pos)} FINISH`, '', 2000);
  }
  if (timeAttack && reason === 'finished') {
    // 타임어택 순위표 (공유 보드 우선, 내 기록 🆕) + 공유 재시도
    refreshTAResults();
    syncRecordsToBoard();
  } else {
    hud.showResults(currentStandings(), playerIdx);
  }
}

function showFinishBanner(title, sub) {
  lastBannerTitle = title;
  lastBannerSub = sub;
  document.getElementById('finishTitle').textContent = title;
  document.getElementById('finishSub').textContent = sub;
  document.getElementById('finishBanner').style.display = 'block';
  updateSpectateUI();
}
function hideFinishBanner() {
  document.getElementById('finishBanner').style.display = 'none';
}
function updateSpectateUI() {
  const watching = spectateIdx != null && racers[spectateIdx] && !racers[spectateIdx].car.out;
  const finished = playerDone != null;
  document.getElementById('specBtn').style.display = watching ? 'none' : 'inline-block';
  document.getElementById('specNextBtn').style.display = watching ? 'inline-block' : 'none';
  // 피니시 후엔 CPU 인계라 내 차로 복귀 불가
  document.getElementById('specExitBtn').style.display = watching && !finished ? 'inline-block' : 'none';
  if (watching) {
    document.getElementById('finishTitle').textContent = `👁 관전 중: ${racers[spectateIdx].name}`;
  } else if (lastBannerTitle) {
    document.getElementById('finishTitle').textContent = lastBannerTitle;
    document.getElementById('finishSub').textContent = lastBannerSub;
  }
}
function spectateNext() {
  const cands = racers.map((r, i) => i).filter((i) => i !== playerIdx && !racers[i].car.out);
  if (cands.length === 0) return;
  const cur = spectateIdx == null ? -1 : cands.indexOf(spectateIdx);
  spectateIdx = cands[(cur + 1) % cands.length];
  updateSpectateUI();
}
function focusIdx() {
  if (spectateIdx != null && racers[spectateIdx] && !racers[spectateIdx].car.out) return spectateIdx;
  return playerIdx;
}

// 버튼들
document.getElementById('restartBtn').addEventListener('click', () => {
  if (onlineCtl) {
    // 온라인: 호스트만 재시작 가능, 게스트는 대기
    if (onlineCtl.room.isHost) {
      const msg = onlineCtl.room.startRace(onlineCtl.ai);
      startOnlineRace({
        room: onlineCtl.room, players: msg.players, ai: msg.ai,
        track: onlineCtl.track, myId: onlineCtl.room.myId,
      });
    }
    return;
  }
  buildRace(racers[playerIdx].car.def, trackDef, { timeAttack: soloTA });
  startCountdown();
});
document.getElementById('garageBtn').addEventListener('click', () => {
  if (onlineCtl) {
    backToOnlineLobby();
    return;
  }
  hideFinishBanner();
  document.getElementById('hud').style.display = 'none';
  document.getElementById('garage').style.display = 'flex';
  hud.hideResults();
  setSteerHint(false);
  if (garageCtl && garageCtl.refreshTracks) garageCtl.refreshTracks();
  phase = 'garage';
});
document.getElementById('muteBtn').addEventListener('click', (e) => {
  const m = beeper.toggle();
  e.target.textContent = m ? '🔇' : '🔊';
});
document.getElementById('fsBtn').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
});
// 미니맵 탭 → 하단 메뉴 토글
document.getElementById('minimap').addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  document.querySelector('.hud-menu').classList.toggle('open');
});
// 피니시 배너 버튼
document.getElementById('specBtn').addEventListener('click', () => spectateNext());
document.getElementById('specNextBtn').addEventListener('click', () => spectateNext());
document.getElementById('specExitBtn').addEventListener('click', () => {
  spectateIdx = null;
  updateSpectateUI();
});
document.getElementById('finishResultBtn').addEventListener('click', () => {
  hideFinishBanner();
  onRaceEnd(playerDone || 'finished');
});
document.getElementById('resultClose').addEventListener('click', () => {
  hud.hideResults();
  setResultSyncMsg('');
});
document.getElementById('resultSync').addEventListener('click', () => {
  if (timeAttack) {
    refreshTAResults();
    syncRecordsToBoard();
  } else {
    setResultSyncMsg('타임어택 기록만 공유됩니다');
  }
});

// ---- 온라인 ----
let pendingCar = null;
let pendingTrack = null;
let pendingItems = true;
let onlinePanel = null;
let lobbyRoom = null; // 로비 단계의 방 (차·맵 변경 전파용)

function startOnlineRace(info) {
  onlineCtl = {
    room: info.room, players: info.players, ai: info.ai,
    track: info.track, myId: info.myId, restartReqs: new Set(),
    items: info.items !== false,
  };
  info.room.onEvent = onRaceNetEvent;
  document.getElementById('garage').style.display = 'none';
  buildRaceOnline(info);
  startCountdown();
  netAcc = 0;
}

function buildRaceOnline(info) {
  const tdef = info.track;
  ITEMS_ON = info.items !== false;
  timeAttack = false;
  document.getElementById('posBox').style.display = 'block';
  trackDef = tdef;
  circuit = buildTrack(tdef);
  LAPS = tdef.laps;
  hud = createHUD(circuit);
  clearRacers();
  buildWorldTrack(trackDef);
  const slots = gridSlots(circuit);
  const mySlot = info.players.findIndex((pl) => pl.id === info.myId);
  playerIdx = mySlot;
  const defOf = (carId) => CAR_DEFS.find((d) => d.id === carId) || CAR_DEFS[0];
  // 방어적 슬롯 매핑 (내 차가 없으면 0번 강제 로컬 — 전체 CPU 방지)
  const plan = planOnlineGrid(info.players, info.ai, info.myId, info.room.isHost);
  const entries = plan.map((e) => {
    const def = defOf(e.carId);
    const aiIdx = e.slot - info.players.length;
    return {
      def,
      local: e.local,
      ai: !e.isAI
        ? null
        : e.local
          ? { pace: [0.94, 0.965, 0.92][aiIdx % 3], lane: [1, -1, 0.5][aiIdx % 3] }
          : null,
      slot: e.slot,
      peerId: e.peerId,
      name: e.isAI ? `CPU (${def.name})` : (e.isMine ? 'YOU' : `P${e.slot + 1}`) + ` (${def.name})`,
    };
  });
  entries.forEach((e, i) => {
    const s = slots[i % slots.length];
    const car = makeCarState(e.def, s.x, s.z, s.heading);
    car.lapStart = 0;
    const mesh = CAR_BUILDERS[e.def.id](e.def.color, e.def.accent);
    mesh.position.set(s.x, 0, s.z);
    mesh.rotation.y = -s.heading;
    scene.add(mesh);
    racers.push({
      car, mesh, isPlayer: e.slot === mySlot,
      local: e.local, ai: e.ai, name: e.name,
      slot: e.slot, peerId: e.peerId, smokeAcc: 0, shieldMesh: newShieldMesh(),
    });
  });
  raceTime = 0;
  spectateIdx = null;
  snapCamera(true);
}

function onRaceNetEvent(ev) {
  if (!onlineCtl) return;
  const room = onlineCtl.room;
  if (ev.type === 'state') {
    for (const s of ev.cars) {
      const r = racers[s.slot];
      if (!r) continue;
      // 자기 차는 예측 + 부드러운 보정, 타인 차는 스냅샷 추종
      blendSnapshot(r.car, s, r.isPlayer ? 0.3 : 0.45);
    }
    // 지뢰·박스 동기화 (호스트가 진실)
    if (ev.mines) {
      const seen = new Set();
      for (const m of ev.mines) {
        seen.add(m.id);
        if (!mines.has(m.id)) {
          addMine(m);
          const mm = mines.get(m.id);
          if (mm) mm.armT = 0;
        }
      }
      for (const id of [...mines.keys()]) {
        if (!seen.has(id)) removeMine(id);
      }
    }
    if (ev.boxes) {
      ev.boxes.forEach((t, i) => {
        if (itemBoxes[i]) {
          itemBoxes[i].takenT = t ? 5 : 0;
          itemBoxes[i].mesh.visible = !t;
        }
      });
    }
    // 탈락자 감지 (명단에서 사라짐)
    if (ev.players) {
      for (const r of racers) {
        if (r.peerId && !ev.players.includes(r.peerId) && !r.car.out) {
          r.car.out = true;
          hud.message('상대 연결 끊김', '', 2000);
        }
      }
    }
    // 인벤토리·부스트 동기화 표시
    const me = racers[playerIdx];
    if (me) {
      const it = me.car.item || null;
      if (it !== lastShownItem) {
        lastShownItem = it;
        updateItemHUD();
      }
      if (me.car.boostT > 0 && lastBoostT <= 0) beeper.boost();
      lastBoostT = me.car.boostT;
    }
  } else if (ev.type === 'peer-left') {
    const r = racers.find((x) => x.peerId === ev.id);
    if (r && !r.car.out && !r.car.finished) {
      if (room.isHost) {
        // 호스트가 AI로 인수 (경주 계속)
        r.ai = { pace: 0.93, lane: 0 };
        r.local = true;
        r.peerId = null;
        r.name = `CPU (${r.car.def.name})`;
        hud.message('연결 끊김 — CPU가 이어받음', '', 2000);
      } else {
        r.car.out = true;
        hud.message('상대 연결 끊김', '', 2000);
      }
    }
  } else if (ev.type === 'host-left') {
    hud.message('호스트 연결 종료', '', 2000);
    setTimeout(() => {
      if (onlineCtl) onlineCtl.room.destroy();
      onlineCtl = null;
      document.getElementById('hud').style.display = 'none';
      document.getElementById('garage').style.display = 'flex';
      hud.hideResults();
      phase = 'garage';
    }, 2000);
  } else if (ev.type === 'lobby') {
    backToOnlineLobby();
  } else if (ev.type === 'start') {
    startOnlineRace({
      room, players: ev.players, ai: ev.ai, items: ev.items,
      track: TRACK_DEFS.find((t) => t.id === ev.trackId) || TRACK_DEFS[0],
      myId: room.myId,
    });
  } else if (ev.type === 'error') {
    hud.message(ev.msg, '', 2000);
  } else if (ev.type === 'pong') {
    const box = document.getElementById('pingBox');
    if (box) {
      box.style.display = 'block';
      box.textContent = `${Math.round(ev.rtt)}ms`;
    }
  } else if (ev.type === 'restart-req') {
    // 게스트 재시작 요청: 전원 모이면 호스트가 자동 시작
    if (onlineCtl && onlineCtl.room.isHost && (phase === 'finished' || phase === 'done')) {
      onlineCtl.restartReqs.add(ev.id);
      const guests = onlineCtl.players.filter((pl) => pl.id !== onlineCtl.room.myId);
      const n = onlineCtl.restartReqs.size;
      hud.message(`재시작 요청 ${n}/${guests.length}`, '', 1500);
      if (guests.length > 0 && n >= guests.length) onlineRestart();
    }
  }
}

function backToOnlineLobby() {
  if (!onlineCtl) return;
  if (onlineCtl.room.isHost) {
    onlineCtl.room.phase = 'lobby';
    onlineCtl.room.broadcastLobby();
  } else {
    try { onlineCtl.room.quitRace(); } catch (e) { /* 무시 */ }
  }
  hideFinishBanner();
  phase = 'garage';
  hud.hideResults();
  document.getElementById('hud').style.display = 'none';
  document.getElementById('garage').style.display = 'flex';
  if (garageCtl && garageCtl.refreshTracks) garageCtl.refreshTracks();
  if (onlinePanel) onlinePanel.backToLobby();
}

// 결과 화면 버튼 오버라이드 (온라인에선 로비/재시작 흐름)
function onlineRestart() {
  const ctl = onlineCtl;
  if (!ctl) return;
  const msg = ctl.room.startRace(ctl.ai, ctl.items);
  ctl.restartReqs = new Set();
  startOnlineRace({
    room: ctl.room, players: msg.players, ai: msg.ai,
    track: ctl.track, myId: ctl.room.myId,
  });
}
window.__raceAgain = () => {
  if (onlineCtl) {
    // 온라인: 호스트가 시작, 게스트는 요청만 (전원 요청 시 자동 시작)
    if (onlineCtl.room.isHost) onlineRestart();
    else {
      onlineCtl.room.requestRestart();
      hud.message('호스트 대기 중…', '', 2000);
    }
  } else {
    document.getElementById('restartBtn').click();
  }
};
window.__raceChange = () => {
  if (onlineCtl) backToOnlineLobby();
  else document.getElementById('garageBtn').click();
};

// ---- 버튼 레이아웃 (위치·크기, 브라우저 저장) ----
window.__layoutEdit = false;
const LAYOUT_KEY = 'blockyracer-layout-v1';
const DEFAULT_LAYOUT = {
  driftL: { x: 0.07, y: 0.78 }, driftR: { x: 0.93, y: 0.78 },
  itemL: { x: 0.07, y: 0.6 }, itemR: { x: 0.93, y: 0.6 },
  driftSize: 84, itemSize: 64,
};
let layout = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(LAYOUT_KEY));
    if (s && typeof s === 'object') return { ...DEFAULT_LAYOUT, ...s };
  } catch (e) { /* 무시 */ }
  return { ...DEFAULT_LAYOUT };
})();
function saveLayout() {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch (e) { /* 무시 */ }
}
function applyLayout() {
  const defs = [
    ['btnDriftL', layout.driftL, layout.driftSize, 'DRIFT'],
    ['btnDriftR', layout.driftR, layout.driftSize, 'DRIFT'],
    ['btnItemL', layout.itemL, layout.itemSize, '🎁'],
    ['btnItemR', layout.itemR, layout.itemSize, '🎁'],
  ];
  for (const [id, pos, size, label] of defs) {
    const b = document.getElementById(id);
    if (!b) continue;
    b.style.left = pos.x * 100 + '%';
    b.style.top = pos.y * 100 + '%';
    b.style.width = size + 'px';
    b.style.height = size + 'px';
    b.style.fontSize = Math.round(size * (label === 'DRIFT' ? 0.2 : 0.42)) + 'px';
  }
  document.body.classList.toggle('editing', window.__layoutEdit);
  const card = document.getElementById('layoutCard');
  if (card) card.style.display = window.__layoutEdit ? 'block' : 'none';
  const sd = document.getElementById('sizeDrift');
  if (sd) sd.value = layout.driftSize;
  const si = document.getElementById('sizeItem');
  if (si) si.value = layout.itemSize;
}
const LAYOUT_BTNS = { btnDriftL: 'driftL', btnDriftR: 'driftR', btnItemL: 'itemL', btnItemR: 'itemR' };
for (const [id, key] of Object.entries(LAYOUT_BTNS)) {
  const b = document.getElementById(id);
  if (!b) continue;
  b.addEventListener('pointerdown', (e) => {
    if (!window.__layoutEdit) return;
    e.preventDefault();
    e.stopPropagation();
    try { b.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    const move = (ev) => {
      layout[key].x = Math.max(0.03, Math.min(0.97, ev.clientX / window.innerWidth));
      layout[key].y = Math.max(0.05, Math.min(0.95, ev.clientY / window.innerHeight));
      applyLayout();
    };
    const up = () => {
      b.removeEventListener('pointermove', move);
      b.removeEventListener('pointerup', up);
      b.removeEventListener('pointercancel', up);
      saveLayout();
    };
    b.addEventListener('pointermove', move);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  });
}
document.getElementById('layoutBtn').addEventListener('click', () => {
  window.__layoutEdit = !window.__layoutEdit;
  applyLayout();
});
document.getElementById('layoutDone').addEventListener('click', () => {
  window.__layoutEdit = false;
  applyLayout();
});
document.getElementById('layoutReset').addEventListener('click', () => {
  layout = { ...DEFAULT_LAYOUT };
  saveLayout();
  applyLayout();
});
document.getElementById('sizeDrift').addEventListener('input', (e) => {
  layout.driftSize = +e.target.value;
  saveLayout();
  applyLayout();
});
document.getElementById('sizeItem').addEventListener('input', (e) => {
  layout.itemSize = +e.target.value;
  saveLayout();
  applyLayout();
});
applyLayout();

// 공유 타임어택 순위표 (단일 진실 원천 board.js, 인스턴스는 상단에서 생성)
function updateBoardSync() {
  const b = document.getElementById('boardSync');
  if (b) {
    const st = board.status;
    let n = 0;
    let ns = 0;
    let nl = 0;
    try {
      for (const t of TRACK_DEFS) n += taBoard(t.id).length;
      const src = board.sources(TRACK_DEFS.map((t) => t.id));
      ns = src.shared;
      nl = src.local;
    } catch (e) { /* 무시 */ }
    let msg = st === 'ok'
      ? '🌐 전원과 공유 중'
      : st === 'conn'
        ? '📡 서버 연결됨 (동기화 확인 중...' +
          (board.loopFail ? ' 실패:' + board.loopFail : '') + ')'
        : '📴 내 기록만 표시 (오프라인)';
    msg += ` · 보이는 기록 ${n}개 (공유 ${ns} · 내 기기 ${nl})`;
    if (!board.storageOK) msg += ' · 이 브라우저 저장 불가(이번 실행만 표시)';
    b.textContent = msg;
    try {
      window.__recStatus = msg;
    } catch (e) { /* 무시 */ }
  }
}
function refreshGarageBest() {
  if (document.getElementById('garage').style.display !== 'none' && pendingTrack) {
    const best = bestTARecord(pendingTrack.id);
    const bb = document.getElementById('trackBest');
    if (bb) {
      bb.textContent = best
        ? `⏱ BEST ${best.total.toFixed(1)}s (${(best.car || '').toUpperCase()}${best.tag ? ' · ' + best.tag : ''})`
        : '⏱ 기록 없음 — 도전!';
    }
  }
  if (garageCtl) {
    garageCtl.refreshBoard();
    if (garageCtl.refreshTracks) garageCtl.refreshTracks();
  }
}
board.onChange = () => {
  updateBoardSync();
  if (garageCtl) refreshGarageBest();
};
try {
  board.init().catch(() => {});
} catch (e) { /* MQTT 미지원 환경 무시 */ }
updateBoardSync();

// ?selftest=board — 브라우저 내 E2E 자가진단 (동기 실행, 결과는 타이틀+화면)
try {
  const __q = new URLSearchParams(location.search);
  if (__q.get('selftest') === 'board') {
    const out = [];
    const ok = (name, cond, extra) => out.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' ' + extra : ''}`);
    try {
      board.save('__selftest__', { total: 999.1, best: 99.1, car: 'f1' });
      board.save('__selftest__', { total: 999.2, best: 99.2, car: 'taxi' });
      const l = board.list('__selftest__');
      ok('save-list', l.length === 2, `n=${l.length}`);
      ok('count-rows-match', l.length === board.list('__selftest__').length, `n=${l.length}`);
      const g = board.ghost('__selftest__', { tag: board.tag, total: 999.1 });
      ok('ghost-miss(absent trail)', g === null);
      delete board.mem['__selftest__'];
      try {
        const stored = JSON.parse(localStorage.getItem('blockyracer-ta-records-v1') || '{}');
        delete stored['__selftest__'];
        localStorage.setItem('blockyracer-ta-records-v1', JSON.stringify(stored));
      } catch (e) { /* 무시 */ }
      ok('cleanup', board.list('__selftest__').length === 0);
    } catch (e) {
      out.push('FAIL exception ' + (e && e.message));
    }
    try { document.title = 'SELFTEST ' + (out.some((x) => x.startsWith('FAIL')) ? 'FAIL' : 'PASS'); } catch (e) {}
    try {
      let d = document.getElementById('selftestOut');
      if (!d) {
        d = document.createElement('div');
        d.id = 'selftestOut';
        d.style.cssText = 'position:fixed;top:0;left:0;z-index:999;background:#000;color:#0f0;padding:10px;font:12px monospace;white-space:pre;';
        document.body.appendChild(d);
      }
      d.textContent = out.join('\n');
    } catch (e) {}
  }
} catch (e) { /* 무시 */ }

// 부트: 차고 → 레이스 (솔로) / 온라인 패널
const APP_VERSION = '20260922-01';
// 기기 내 진단 로그 (버전 5연타로 표시)
const dbgLogArr = [];
function dbgLog(m) {
  try {
    dbgLogArr.push(`${new Date().toLocaleTimeString()} ${m}`);
    if (dbgLogArr.length > 30) dbgLogArr.shift();
  } catch (e) { /* 무시 */ }
}
try {
  window.addEventListener('error', (e) => dbgLog(`ERR:${e.message || e.type}`));
  window.addEventListener('unhandledrejection', (e) => dbgLog(`REJ:${e.reason && e.reason.message ? e.reason.message : e.reason}`));
  // 포커스 복귀 시 보드 열려 있으면 다시 그림 (탭 복원 등 대응)
  const refocus = () => {
    try {
      if (garageCtl && document.getElementById('panelBoard').style.display !== 'none') {
        dbgLog('refocus rerender');
        garageCtl.refreshBoard();
      }
    } catch (e) { /* 무시 */ }
  };
  window.addEventListener('focus', refocus);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refocus();
  });
} catch (e) { /* 무시 */ }
function renderDiag() {
  const d = document.getElementById('diagBox');
  if (!d) return;
  let cacheInfo = '';
  try {
    const cc = board.net.cache || {};
    cacheInfo = Object.keys(cc).map((k) => `${k}:${(cc[k] || []).length}`).join(' ') || '(empty)';
  } catch (e) { cacheInfo = 'n/a'; }
  let memInfo = '';
  try {
    const mm = board.mem || {};
    memInfo = Object.keys(mm).map((k) => `${k}:${(mm[k] || []).length}`).join(' ') || '(empty)';
  } catch (e) { memInfo = 'n/a'; }
  d.innerHTML =
    `<b>DIAG ${APP_VERSION}</b> <button id="diagClose">✕</button><br>` +
    `mqtt:${typeof window.mqtt}<br>` +
    `storage:${board.storageOK}<br>` +
    `rec: conn=${board.connected} verified=${!!board.net._verified} status=${board.net._status} fail=${board.net._loopFail || '-'}<br>` +
    `cache: ${cacheInfo}<br>` +
    `mem: ${memInfo}<br>` +
    dbgLogArr.slice(-12).join('<br>');
  const c = document.getElementById('diagClose');
  if (c) c.addEventListener('click', () => { d.style.display = 'none'; });
}
try {
  let taps = [];
  const av = document.getElementById('appVer');
  if (av) {
    av.style.cursor = 'pointer';
    av.addEventListener('click', () => {
      const now = Date.now();
      taps = taps.filter((t) => now - t < 3000);
      taps.push(now);
      if (taps.length >= 5) {
        taps = [];
        const d = document.getElementById('diagBox');
        if (d) {
          renderDiag();
          d.style.display = d.style.display === 'none' ? 'block' : 'none';
        }
      }
    });
  }
} catch (e) { /* 무시 */ }
try {
  const av = document.getElementById('appVer');
  if (av) av.textContent = 'v' + APP_VERSION;
} catch (e) { /* 무시 */ }
try {
  fetch('version.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((v) => {
      if (v && v.version && v.version !== APP_VERSION) {
        const b = document.getElementById('updateBanner');
        if (b) b.style.display = 'flex';
      }
    })
    .catch(() => {});
} catch (e) { /* 무시 */ }
document.getElementById('updateReload').addEventListener('click', () => {
  location.reload();
});
onlinePanel = createOnlinePanel({
  getCar: () => pendingCar || CAR_DEFS[0],
  getTrack: () => pendingTrack || TRACK_DEFS[0],
  onStartOnline: (info) => startOnlineRace(info),
  onLobbyClosed: () => {
    onlineCtl = null;
    lobbyRoom = null;
  },
  onRoom: (room) => {
    lobbyRoom = room;
  },
  onOnline: () => {
    if (onlinePanel) onlinePanel.openHome();
  },
  onBoardOpen: () => {
    // 순위표 열 때: 미동기화 병합 → 새로고침
    updateBoardSync();
    board.sync()
      .catch(() => false)
      .then(() => {
        updateBoardSync();
        if (garageCtl) garageCtl.refreshBoard();
      });
  },
  getBoard: (trackId) => taBoard(trackId),
  getGhost: (trackId, entry) => {
    const list = loadTARecords()[trackId] || [];
    return list.find((e) => e.trail && e.trail.length > 1 && e.tag === entry.tag && e.total === entry.total) || null;
  },
  onGhost: (trackId, entry) => startGhostRace(trackId, entry),
  onBoardRendered: (n) => {
    dbgLog(`board rendered rows=${n}`);
  },
});
garageCtl = createGarage(
  (def, track, mode) => {
    document.getElementById('garage').style.display = 'none';
    buildRace(def, track, { timeAttack: mode === 'ta' });
    startCountdown();
  },
  {
    onCar: (def) => {
      pendingCar = def;
      const r = (onlineCtl && onlineCtl.room) || lobbyRoom;
      if (r) r.setMyCar(def.id);
    },
    onItems: (on) => {
      pendingItems = on;
    },
    onTrack: (def) => {
      pendingTrack = def;
      const r = (onlineCtl && onlineCtl.room) || lobbyRoom;
      if (r && r.isHost) r.setTrack(def.id);
      const best = bestTARecord(def.id);
      const b = document.getElementById('trackBest');
      if (b) {
        b.textContent = best
          ? `⏱ BEST ${best.total.toFixed(1)}s (${(best.car || '').toUpperCase()}${best.tag ? ' · ' + best.tag : ''})`
          : '⏱ 기록 없음 — 도전!';
      }
    },
  }
);
requestAnimationFrame((t) => {
  lastTs = t;
  loop(t);
});
