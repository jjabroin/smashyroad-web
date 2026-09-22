// 차고 메인메뉴 (사진 스타일): 3D 턴테이블 + 차량/맵/모드 카드 + 서브패널
import * as THREE from 'three';
import { CAR_DEFS } from './race.js?v=8';
import { TRACK_DEFS, buildTrack } from './track.js?v=8';
import { CAR_BUILDERS, makeDriver } from './voxel.js?v=8';

const GRADE_COLOR = { 전설: '#ff5252', 레어: '#4da3ff', 일반: '#9aa4b2' };
const MODE_LABEL = { race: '레이싱', item: '아이템전', ta: '타임어택', online: '온라인' };
const MODE_START = { race: '🏁 시작하기', item: '🎁 시작하기', ta: '⏱ 시작하기', online: '🌐 시작하기' };
const MODES = ['race', 'item', 'ta', 'online'];

export function createGarage(onStart, hooks = {}) {
  let idx = 0;
  let trackIdx = 0;
  let mode = 'race';
  let itemsOn = true;
  const canvas = document.getElementById('garageCanvas');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.shadowMap.enabled = true;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  camera.position.set(11, 7.5, 13);
  camera.lookAt(0, 1.2, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x5a7a96, 1.0));
  const sun = new THREE.DirectionalLight(0xfff6e0, 1.5);
  sun.position.set(8, 14, 6);
  sun.castShadow = true;
  scene.add(sun);

  const podium = new THREE.Mesh(
    new THREE.CylinderGeometry(9, 10, 1.2, 40),
    new THREE.MeshLambertMaterial({ color: 0x3a4a5c })
  );
  podium.position.y = -0.6;
  podium.receiveShadow = true;
  scene.add(podium);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(9, 0.35, 12, 60),
    new THREE.MeshBasicMaterial({ color: 0x27e0f5 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  scene.add(ring);
  // (바닥 없음 — 사진 배경이 그대로 보임, 그림자는 회전판이 받음)

  const stand = new THREE.Group();
  scene.add(stand);
  let carMesh = null;
  let driverMesh = null;

  function resize() {
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 380;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  function statBar(v) {
    return `<div class="stat"><i style="width:${v * 20}%"></i></div>`;
  }

  function refreshCards() {
    document.getElementById('curCar').textContent = CAR_DEFS[idx].name;
    document.getElementById('curTrack').textContent = TRACK_DEFS[trackIdx].name;
    document.getElementById('curMode').textContent = MODE_LABEL[mode];
    document.getElementById('raceBtn').textContent = MODE_START[mode];
  }

  function render(idxNew) {
    idx = (idxNew + CAR_DEFS.length) % CAR_DEFS.length;
    const def = CAR_DEFS[idx];
    if (carMesh) {
      stand.remove(carMesh);
      carMesh = null;
    }
    if (driverMesh) {
      stand.remove(driverMesh);
      driverMesh = null;
    }
    carMesh = CAR_BUILDERS[def.id](def.color, def.accent);
    carMesh.rotation.y = -Math.PI / 2 + 0.5;
    stand.add(carMesh);
    driverMesh = makeDriver();
    driverMesh.position.set(-5.5, 0, 2.5);
    stand.add(driverMesh);

    document.getElementById('carName').textContent = def.name;
    const grade = document.getElementById('carGrade');
    grade.textContent = def.grade;
    grade.style.color = GRADE_COLOR[def.grade] || '#fff';
    document.getElementById('statSpeed').innerHTML = statBar(def.stats.speed);
    document.getElementById('statHandling').innerHTML = statBar(def.stats.handling);
    document.getElementById('statTough').innerHTML = statBar(def.stats.durability);
    document.getElementById('carDots').textContent =
      `${idx + 1} / ${CAR_DEFS.length}`;
    refreshCards();
    if (hooks.onCar) hooks.onCar(CAR_DEFS[idx]);
  }

  function selectTrack(i) {
    trackIdx = (i + TRACK_DEFS.length) % TRACK_DEFS.length;
    refreshCards();
    renderTrackList();
    if (hooks.onTrack) hooks.onTrack(TRACK_DEFS[trackIdx]);
  }

  function setMode(m) {
    if (!MODES.includes(m)) return;
    mode = m;
    // 아이템전 모드에서만 아이템 ON (온라인은 로비 토글 따름)
    if (m !== 'online') setItems(m === 'item');
    refreshCards();
    document.querySelectorAll('#modeList .moderow').forEach((b) => {
      b.classList.toggle('sel', b.dataset.mode === m);
    });
    if (hooks.onMode) hooks.onMode(mode);
  }

  function setItems(on) {
    itemsOn = on;
    if (hooks.onItems) hooks.onItems(itemsOn);
  }

  // --- 서브패널 ---
  const PANELS = ['panelCar', 'panelTrack', 'panelMode', 'panelPlay', 'panelBoard', 'panelHelp'];
  function openPanel(id) {
    for (const p of PANELS) {
      document.getElementById(p).style.display = p === id ? 'block' : 'none';
    }
    if (id === 'panelBoard') renderBoard();
    if (id === 'panelTrack') renderTrackList();
  }
  function closePanels() {
    for (const p of PANELS) {
      document.getElementById(p).style.display = 'none';
    }
  }
  document.querySelectorAll('.pclose').forEach((b) => {
    b.addEventListener('click', () => {
      document.getElementById(b.dataset.p).style.display = 'none';
    });
  });

  document.getElementById('cardCar').addEventListener('click', () => openPanel('panelCar'));
  document.getElementById('cardTrack').addEventListener('click', () => openPanel('panelTrack'));
  document.getElementById('cardMode').addEventListener('click', () => openPanel('panelMode'));
  document.getElementById('onlineRowBtn').addEventListener('click', () => {
    setMode('online');
    openPanel('panelPlay');
  });
  document.getElementById('boardBtn').addEventListener('click', () => openPanel('panelBoard'));
  document.getElementById('helpBtn').addEventListener('click', () => openPanel('panelHelp'));

  document.getElementById('carPrev').addEventListener('click', () => render(idx - 1));
  document.getElementById('carNext').addEventListener('click', () => render(idx + 1));

  // 맵 목록 (미니 프리뷰 + 베스트 기록)
  function drawMini(canvasEl, t) {
    const ctx = canvasEl.getContext('2d');
    const cir = buildTrack(t);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of cir.pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#e8ecf1';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    cir.pts.forEach((p, i) => {
      const x = 8 + ((p.x - minX) / (maxX - minX)) * (canvasEl.width - 16);
      const y = 8 + ((p.z - minZ) / (maxZ - minZ)) * (canvasEl.height - 16);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  }
  function renderTrackList() {
    const box = document.getElementById('trackList');
    box.innerHTML = '';
    TRACK_DEFS.forEach((t, i) => {
      const row = document.createElement('button');
      row.className = 'trackrow' + (i === trackIdx ? ' sel' : '');
      const cv = document.createElement('canvas');
      cv.width = 110;
      cv.height = 70;
      drawMini(cv, t);
      const info = document.createElement('span');
      let best = null;
      if (hooks.getBoard) {
        const b = hooks.getBoard(t.id);
        if (b && b.length > 0) best = b[0];
      }
      info.innerHTML = `<b>${t.name}</b><small>${t.laps}LAP · ${best ? `BEST ${best.total.toFixed(1)}s` : '기록 없음'}</small>`;
      row.appendChild(cv);
      row.appendChild(info);
      row.addEventListener('click', () => {
        selectTrack(i);
        closePanels();
      });
      box.appendChild(row);
    });
  }

  // 모드 목록
  document.querySelectorAll('#modeList .moderow').forEach((b) => {
    b.addEventListener('click', () => {
      setMode(b.dataset.mode);
      closePanels();
    });
  });
  document.getElementById('onlineRowBtn').addEventListener('click', () => {
    openPanel('panelPlay');
  });

  // 순위표 (전 트랙 TOP5)
  function renderBoard() {
    const box = document.getElementById('boardTracks');
    box.innerHTML = '';
    TRACK_DEFS.forEach((t) => {
      const sec = document.createElement('div');
      sec.className = 'bsec';
      const title = document.createElement('div');
      title.className = 'btitle';
      title.textContent = `${t.name} · ${t.laps}LAP`;
      sec.appendChild(title);
      let list = [];
      if (hooks.getBoard) list = hooks.getBoard(t.id) || [];
      if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'bempty';
        empty.textContent = '기록 없음 — 도전!';
        sec.appendChild(empty);
      } else {
        list.slice(0, 5).forEach((e, i) => {
          const row = document.createElement('div');
          row.className = 'brow';
          row.innerHTML = `<span>${i + 1}. ${e.tag ? e.tag + ' · ' : ''}${(e.car || '').toUpperCase()}</span><span>${e.total.toFixed(1)}s</span>`;
          sec.appendChild(row);
        });
      }
      box.appendChild(sec);
    });
  }

  // 시작하기 (모드별 분기)
  function pressStart() {
    if (mode === 'online') {
      openPanel('panelPlay');
      return;
    }
    closePanels();
    document.getElementById('garage').style.display = 'none';
    onStart(CAR_DEFS[idx], TRACK_DEFS[trackIdx], mode);
  }
  document.getElementById('raceBtn').addEventListener('click', pressStart);
  document.getElementById('playSingleBtn').addEventListener('click', () => {
    closePanels();
    document.getElementById('garage').style.display = 'none';
    onStart(CAR_DEFS[idx], TRACK_DEFS[trackIdx], 'race');
  });
  document.getElementById('playMultiBtn').addEventListener('click', () => {
    closePanels();
    if (hooks.onOnline) hooks.onOnline();
  });

  // 키보드: 좌우 차량 변경, Enter 시작
  window.addEventListener('keydown', function nav(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (document.getElementById('garage').style.display === 'none') {
      window.removeEventListener('keydown', nav);
      return;
    }
    if (e.code === 'ArrowLeft') render(idx - 1);
    if (e.code === 'ArrowRight') render(idx + 1);
    if (e.code === 'Enter' || e.code === 'Space') pressStart();
  });

  let raf = 0;
  function loop() {
    raf = requestAnimationFrame(loop);
    stand.rotation.y += 0.008;
    renderer.render(scene, camera);
  }

  resize();
  render(0);
  renderTrackList();
  setMode('race');
  loop();

  return {
    stop() {
      cancelAnimationFrame(raf);
      renderer.dispose();
    },
  };
}
