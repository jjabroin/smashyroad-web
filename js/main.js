// 메인 오케스트레이션: 차고 → 카운트다운 → 경주 → 결과
import * as THREE from 'three';
import { buildCircuit } from './track.js';
import {
  CAR_DEFS, makeCarState, stepCar, checkLap,
  resolveCollisions, aiInput, progressOf,
} from './race.js';
import { CAR_BUILDERS } from './voxel.js';
import { createWorld, gridSlots, ROAD_HALF } from './world.js';
import { createHUD, createInput, createBeeper } from './hud.js';
import { createGarage } from './garage.js';

const LAPS = 3;

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2000);

const circuit = buildCircuit(260, 75);
createWorld(scene, circuit);

const hud = createHUD(circuit);
const input = createInput();
const beeper = createBeeper();

function resize() {
  const w = Math.min(window.innerWidth - 12, 1100);
  const h = Math.min(window.innerHeight - 130, 700);
  const cw = Math.max(320, w);
  const ch = Math.max(240, h);
  renderer.setSize(cw, ch, false);
  camera.aspect = cw / ch;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// --- 레이저 상태 ---
let racers = []; // {car, mesh, isPlayer, name, ai}
let phase = 'garage';
let raceTime = 0;
let countdownT = 0;
let playerIdx = 0;
const camPos = new THREE.Vector3();

function clearRacers() {
  for (const r of racers) scene.remove(r.mesh);
  racers = [];
}

function buildRace(playerDef) {
  clearRacers();
  const slots = gridSlots(circuit);
  const defs = [playerDef];
  const pool = CAR_DEFS.filter((d) => d.id !== playerDef.id);
  while (defs.length < 4) defs.push(pool[(defs.length - 1) % pool.length]);

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
      name: i === 0 ? `YOU (${def.name})` : `CPU ${i} (${def.name})`,
      ai: i === 0 ? null : { pace: paces[i % paces.length], lane: lanes[i % lanes.length] },
    });
  });
  playerIdx = 0;
  raceTime = 0;
  snapCamera(true);
}

function snapCamera(hard) {
  const p = racers[playerIdx].car;
  const fx = Math.cos(p.heading);
  const fz = Math.sin(p.heading);
  const desired = new THREE.Vector3(p.x - fx * 26, 19, p.z - fz * 26);
  if (hard) camPos.copy(desired);
  else camPos.lerp(desired, 0.08);
  camera.position.copy(camPos);
  camera.lookAt(p.x + fx * 20, 2, p.z + fz * 20);
}

// 드리프트/잔디 먼지 (간단 박스 풀)
const puffPool = [];
{
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.MeshLambertMaterial({ color: 0xcfc8bd, transparent: true, opacity: 0.7 });
  for (let i = 0; i < 50; i++) {
    const mesh = new THREE.Mesh(geo, m.clone());
    mesh.visible = false;
    scene.add(mesh);
    puffPool.push({ mesh, life: 0 });
  }
}
let puffIdx = 0;
function puff(x, z) {
  const p = puffPool[puffIdx++ % puffPool.length];
  p.mesh.visible = true;
  p.mesh.position.set(x, 0.8, z);
  p.mesh.scale.set(1.4, 1.4, 1.4);
  p.life = 1;
}
function updatePuffs(dt) {
  for (const p of puffPool) {
    if (p.life <= 0) continue;
    p.life -= dt * 1.6;
    p.mesh.position.y += dt * 2;
    const s = 1.4 + (1 - p.life) * 2.2;
    p.mesh.scale.set(s, s, s);
    p.mesh.material.opacity = Math.max(0, p.life) * 0.6;
    if (p.life <= 0) p.mesh.visible = false;
  }
}

function startCountdown() {
  phase = 'countdown';
  countdownT = 3.999;
  document.getElementById('hud').style.display = 'block';
  hud.hideResults();
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
      hud.message('GO!', '', 900);
      beeper.go();
    }
    snapCamera(false);
    renderer.render(scene, camera);
    return;
  }

  if (phase !== 'racing') {
    renderer.render(scene, camera);
    return;
  }

  raceTime += dt;
  const p = racers[playerIdx].car;

  // 플레이어 입력 (자동 가속 ON: 사진 1처럼 가만히 있어도 전진)
  const pin = input.toRaceInput();

  // AI 입력
  const pProg = progressOf(p, circuit);
  const inputs = racers.map((r) =>
    r.isPlayer
      ? pin
      : aiInput(r.car, circuit, ROAD_HALF, dt, pProg, progressOf(r.car, circuit), r.ai)
  );

  // 물리 + 랩
  racers.forEach((r, i) => {
    if (r.car.finished) return;
    stepCar(r.car, inputs[i], dt, circuit, ROAD_HALF);
    const ev = checkLap(r.car, circuit, LAPS, raceTime);
    if (r.isPlayer) {
      if (ev === 'lap') {
        if (r.car.lap === LAPS - 1) hud.message('FINAL LAP', '', 1500);
        else hud.message(`LAP ${r.car.lap + 1}`, '', 1200);
        beeper.count();
      } else if (ev === 'finished') {
        onPlayerFinish();
      }
    }
  });
  resolveCollisions(racers.map((r) => r.car));

  // 메시 싱크 + 먼지
  for (const r of racers) {
    const c = r.car;
    r.mesh.position.set(c.x, 0, c.z);
    r.mesh.rotation.y = -c.heading;
    const fw = r.mesh.userData.frontWheels || [];
    for (const w of fw) w.rotation.y = -c.steerVis * 0.45;
    const latV = Math.abs(c.vx * -Math.sin(c.heading) + c.vz * Math.cos(c.heading));
    if ((latV > 14 || c.offTrack) && Math.hypot(c.vx, c.vz) > 12 && Math.random() < 0.5) {
      puff(c.x - Math.cos(c.heading) * 3, c.z - Math.sin(c.heading) * 3);
    }
  }
  updatePuffs(dt);

  // 카메라
  snapCamera(false);
  // 태양·그림자 범위를 플레이어 따라 이동
  const sun = scene.getObjectByProperty('type', 'DirectionalLight');
  if (sun) {
    sun.position.set(p.x + 120, 180, p.z + 60);
    sun.target.position.set(p.x, 0, p.z);
    sun.target.updateMatrixWorld();
  }

  // HUD
  hud.drawMinimap(racers.map((r) => r.car), playerIdx);
  hud.setLap(p.lap, LAPS);
  hud.setTimer(raceTime);
  const order = [...racers].sort(
    (a, b) => progressOf(b.car, circuit) - progressOf(a.car, circuit)
  );
  hud.setPos(order.indexOf(racers[playerIdx]) + 1, racers.length);
  hud.setSpeed(Math.hypot(p.vx, p.vz) * 3.4);

  renderer.render(scene, camera);
}

function onPlayerFinish() {
  phase = 'done';
  beeper.finish();
  const order = [...racers].sort(
    (a, b) => progressOf(b.car, circuit) - progressOf(a.car, circuit)
  );
  const pos = order.indexOf(racers[playerIdx]) + 1;
  hud.message(pos === 1 ? '🏆 WINNER!' : `${pos}nd FINISH`, '', 2000);
  hud.showResults(
    order.map((r) => ({
      name: r.name,
      totalTime: r.car.finished ? r.car.finishTime : raceTime,
      bestLap: r.car.bestLap,
      isPlayer: r.isPlayer,
    })),
    playerIdx
  );
}

// 버튼들
document.getElementById('restartBtn').addEventListener('click', () => {
  buildRace(racers[playerIdx].car.def);
  startCountdown();
});
document.getElementById('garageBtn').addEventListener('click', () => {
  document.getElementById('hud').style.display = 'none';
  document.getElementById('garage').style.display = 'flex';
  hud.hideResults();
  phase = 'garage';
});
document.getElementById('muteBtn').addEventListener('click', (e) => {
  const m = beeper.toggle();
  e.target.textContent = m ? '🔇' : '🔊';
});

// 부트: 차고 → 레이스
createGarage((def) => {
  document.getElementById('garage').style.display = 'none';
  buildRace(def);
  startCountdown();
});
requestAnimationFrame((t) => {
  lastTs = t;
  loop(t);
});
