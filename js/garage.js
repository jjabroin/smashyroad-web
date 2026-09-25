// 차고 메인메뉴 (사진 스타일): 3D 턴테이블 + 차량/맵/모드 카드 + 서브패널
import * as THREE from 'three';
import { CAR_DEFS } from './race.js?v=3d5ad3';
import { TRACK_DEFS, buildTrack } from './track.js?v=88d572';
import { CAR_BUILDERS, makeDriver } from './voxel.js?v=35aa4d';

const GRADE_COLOR = { 전설: '#ff5252', 레어: '#4da3ff', 일반: '#9aa4b2' };
const MODE_LABEL = { race: '레이싱', item: '아이템전', ta: '타임어택', online: '온라인' };
const MODE_START = { race: '🏁 시작하기', item: '🎁 시작하기', ta: '⏱ 시작하기', online: '🌐 시작하기' };
const MODES = ['race', 'item', 'ta', 'online'];

export function createGarage(onStart, hooks = {}) {
  // 온라인 진입 추적: 예외 나면 조용히 묻히지 않게 화면에 표시 (원인 확정용 진단)
  function traceOnline(step, show) {
    try {
      const d = document.getElementById('diagBox');
      if (d) {
        d.innerHTML += `<br>ONLINE TRACE: ${String(step).replace(/</g, '&lt;')}`;
        if (show) d.style.display = 'block';
      }
    } catch (e) { /* 무시 */ }
  }
  function exOnline(where, e) {
    traceOnline(`EX @${where}: ${(e && e.message) || e}`, true);
    try {
      alert(`온라인 선택 오류(${where}): ${String((e && e.message) || e).slice(0, 200)}`);
    } catch (_) { /* 무시 */ }
  }
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
  camera.position.set(12, 4.6, 15);
  camera.lookAt(0, 2.4, 0); // 도로 원근에 맞춰 눕히고 차를 아래에 배치

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
  const PANELS = ['panelCar', 'panelTrack', 'panelMode', 'panelBoard', 'panelHelp', 'panelAccount'];
  function openPanel(id) {
    closePanels();
    const e = document.getElementById(id);
    if (e) e.style.display = 'block';
    if (id === 'panelBoard') {
      renderBoard();
      if (hooks.onBoardOpen) hooks.onBoardOpen();
    }
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
    try {
      traceOnline('row-click');
      setMode('online');
      traceOnline('setMode-ok');
      closePanels();
      traceOnline('closePanels-ok');
      if (hooks.onOnline) hooks.onOnline();
      traceOnline('onOnline-ok');
    } catch (e) { exOnline('row', e); }
  });
  document.getElementById('boardBtn').addEventListener('click', () => openPanel('panelBoard'));
  document.getElementById('accBtn').addEventListener('click', () => {
    openPanel('panelAccount');
    if (hooks.onAccountOpen) hooks.onAccountOpen();
  });
  document.getElementById('boardRefresh').addEventListener('click', () => {
    renderBoard();
    if (hooks.onBoardOpen) hooks.onBoardOpen();
  });
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


  // 순위표 (전 트랙 TOP5) — 전체/내 기록 탭
  let boardMineOnly = false;
  function paintBoardTabs() {
    const a = document.getElementById('boardTabAll');
    const m = document.getElementById('boardTabMine');
    if (a) a.classList.toggle('sel', !boardMineOnly);
    if (m) m.classList.toggle('sel', boardMineOnly);
  }
  document.getElementById('boardTabAll').addEventListener('click', () => {
    boardMineOnly = false;
    paintBoardTabs();
    renderBoard();
  });
  document.getElementById('boardTabMine').addEventListener('click', () => {
    boardMineOnly = true;
    paintBoardTabs();
    renderBoard();
  });
  function renderBoard() {
    paintBoardTabs();
    const box = document.getElementById('boardTracks');
    box.innerHTML = '';
    let totalRows = 0;
    let whyShown = false; // 상태 문구는 첫 빈 칸에만 (도배 방지)
    const loggedIn = hooks.isLoggedIn ? hooks.isLoggedIn() : false;
    TRACK_DEFS.forEach((t) => {
      const sec = document.createElement('div');
      sec.className = 'bsec';
      const title = document.createElement('div');
      title.className = 'btitle';
      let list = [];
      try {
        list = hooks.getBoard ? hooks.getBoard(t.id, boardMineOnly) || [] : [];
      } catch (e) { list = []; }
      totalRows += list.length;
      title.textContent = `${t.name} · ${t.laps}LAP · ${list.length}개`;
      sec.appendChild(title);
      if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'bempty';
        empty.textContent = boardMineOnly
          ? (loggedIn ? '내 기록 없음 — 달리거나 기기 기록을 합치세요' : '내 기록 없음 — 👤 계정에서 로그인하면 보입니다')
          : '기록 없음 — 도전!';
        sec.appendChild(empty);
        try {
          if (!whyShown && window.__recStatus) {
            whyShown = true;
            const why = document.createElement('div');
            why.className = 'bempty';
            why.textContent = window.__recStatus;
            sec.appendChild(why);
          }
        } catch (e) { /* 무시 */ }
      } else {
        list.slice(0, 5).forEach((e, i) => {
          let row = null;
          try {
            row = document.createElement('div');
            row.className = 'brow';
            const gh = hooks.getGhost ? hooks.getGhost(t.id, e) : null;
            row.innerHTML = `<span>${i + 1}. ${e.name || e.tag ? (e.name || e.tag) + ' · ' : ''}${(e.car || '').toUpperCase()}</span><span>${e.total.toFixed(1)}s</span>`;
            if (gh && hooks.onGhost) {
              row.style.cursor = 'pointer';
              row.title = '이 기록과 대결!';
              const vb = document.createElement('button');
              vb.className = 'ghostbtn';
              vb.textContent = '👻 대결';
              vb.addEventListener('click', (ev) => {
                ev.stopPropagation();
                hooks.onGhost(t.id, gh);
              });
              row.appendChild(vb);
            }
          } catch (err) { row = null; }
          if (row) sec.appendChild(row);
          else {
            totalRows--;
            const bad = document.createElement('div');
            bad.className = 'bempty';
            bad.textContent = '깨진 기록 1개 (표시 생략)';
            sec.appendChild(bad);
          }
        });
      }
      box.appendChild(sec);
    });
    // 개수 확정: 화면에 그린 것과 동일한 숫자를 상태줄에 (따로 세서 어긋나는 구조 제거)
    try {
      if (hooks.onBoardCounts) hooks.onBoardCounts(totalRows, boardMineOnly);
    } catch (e) { /* 무시 */ }
    // 진단 푸터 (문제 보고 시 원인 특정용)
    try {
      if (hooks.getBoardDiag) {
        const d = hooks.getBoardDiag();
        const f = document.createElement('div');
        f.className = 'bempty';
        f.textContent = `diag tag=${d.tag} mem=${d.mem} stored=${d.stored} shared=${d.shared}`;
        box.appendChild(f);
      }
    } catch (e) { /* 무시 */ }
    try {
      if (hooks.onBoardRendered) hooks.onBoardRendered(totalRows);
    } catch (e) { /* 무시 */ }
  }

  // 시작하기 (모드별 분기: 온라인은 바로 방 만들기 화면)
  function pressStart() {
    if (mode === 'online') {
      try {
        traceOnline('start-click mode=online');
        closePanels();
        if (hooks.onOnline) hooks.onOnline();
        traceOnline('onOnline-ok');
      } catch (e) { exOnline('start', e); }
      return;
    }
    closePanels();
    document.getElementById('garage').style.display = 'none';
    onStart(CAR_DEFS[idx], TRACK_DEFS[trackIdx], mode);
  }
  document.getElementById('raceBtn').addEventListener('click', pressStart);

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
    refreshBoard() {
      if (document.getElementById('panelBoard').style.display !== 'none') renderBoard();
    },
    isBoardMineOnly() {
      return boardMineOnly;
    },
    refreshTracks() {
      // 기록 도착 시 목록의 BEST 표시 갱신 (차고가 열려 있을 때)
      if (document.getElementById('garage').style.display === 'none') return;
      if (document.getElementById('panelTrack').style.display !== 'none') renderTrackList();
      const t = TRACK_DEFS[trackIdx];
      const best = hooks.getBoard ? (hooks.getBoard(t.id) || [])[0] : null;
      const bb = document.getElementById('trackBest');
      if (bb) {
        bb.textContent = best
          ? `⏱ BEST ${best.total.toFixed(1)}s (${(best.car || '').toUpperCase()}${best.tag ? ' · ' + best.tag : ''})`
          : '⏱ 기록 없음 — 도전!';
      }
    },
  };
}
