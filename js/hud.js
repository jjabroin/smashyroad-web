// HUD: 미니맵·랩·타이머·순위·메시지·터치 버튼·효과음 (DOM)
export function fmtTime(sec) {
  if (!isFinite(sec)) return '--.-';
  return sec.toFixed(1);
}

export function createHUD(circuit) {
  const el = (id) => document.getElementById(id);

  // 미니맵 경로 정규화
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of circuit.pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const mapC = el('minimap');
  const mctx = mapC.getContext('2d');
  const toMap = (x, z) => {
    const pad = 12;
    const w = mapC.width - pad * 2;
    const h = mapC.height - pad * 2;
    return [
      pad + ((x - minX) / (maxX - minX)) * w,
      pad + ((z - minZ) / (maxZ - minZ)) * h,
    ];
  };

  function drawMinimap(cars, playerIdx) {
    mctx.clearRect(0, 0, mapC.width, mapC.height);
    mctx.lineWidth = 5;
    mctx.strokeStyle = '#e8ecf1';
    mctx.lineJoin = 'round';
    mctx.beginPath();
    circuit.pts.forEach((p, i) => {
      const [x, y] = toMap(p.x, p.z);
      if (i === 0) mctx.moveTo(x, y);
      else mctx.lineTo(x, y);
    });
    mctx.closePath();
    mctx.stroke();
    cars.forEach((c, i) => {
      const [x, y] = toMap(c.x, c.z);
      mctx.fillStyle = i === playerIdx ? '#ff3b30' : '#222';
      mctx.beginPath();
      mctx.arc(x, y, i === playerIdx ? 5 : 3.5, 0, Math.PI * 2);
      mctx.fill();
      if (i === playerIdx) {
        mctx.strokeStyle = '#fff';
        mctx.lineWidth = 1.5;
        mctx.stroke();
      }
    });
  }

  function setLap(lap, total) {
    el('lapBox').innerHTML = `LAP<br><b>${Math.min(lap + 1, total)}/${total}</b>`;
  }
  function setTimer(sec) {
    el('raceTimer').textContent = fmtTime(sec);
  }
  function setPos(pos, total) {
    const suffix = pos === 1 ? 'st' : pos === 2 ? 'nd' : pos === 3 ? 'rd' : 'th';
    el('posBox').innerHTML = `${pos}<small>${suffix}/${total}</small>`;
  }
  function setSpeed(kmh) {
    el('speedBox').textContent = `${Math.round(kmh)}`;
  }
  function message(text, sub = '', ms = 0) {
    const m = el('centerMsg');
    m.innerHTML = text + (sub ? `<span>${sub}</span>` : '');
    m.style.display = text ? 'block' : 'none';
    if (msgTimer) clearTimeout(msgTimer);
    msgTimer = 0;
    if (ms > 0) {
      msgTimer = setTimeout(() => {
        m.style.display = 'none';
      }, ms);
    }
  }
  let msgTimer = 0;

  function showResults(rows, playerIdx) {
    // rows: [{name, color, totalTime, bestLap, isPlayer}] 순위순
    const medals = ['🥇', '🥈', '🥉', '4️⃣'];
    el('resultRows').innerHTML = rows
      .map(
        (r, i) =>
          `<div class="rrow${r.isPlayer ? ' me' : ''}"><span>${medals[i] || i + 1} ${r.name}</span>` +
          `<span>${fmtTime(r.totalTime)} · Best ${fmtTime(r.bestLap)}</span></div>`
      )
      .join('');
    el('results').style.display = 'flex';
  }
  function hideResults() {
    el('results').style.display = 'none';
  }

  return { drawMinimap, setLap, setTimer, setPos, setSpeed, message, showResults, hideResults };
}

// 입력: 키보드 + L/R 터치 버튼
export function createInput() {
  const state = { left: false, right: false, up: false, down: false };
  const keymap = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
  };
  window.addEventListener('keydown', (e) => {
    const k = keymap[e.code];
    if (k) {
      state[k] = true;
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = keymap[e.code];
    if (k) {
      state[k] = false;
      e.preventDefault();
    }
  });
  const bindHold = (id, name) => {
    const b = document.getElementById(id);
    const on = (e) => { e.preventDefault(); state[name] = true; };
    const off = (e) => { e.preventDefault(); state[name] = false; };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointerleave', off);
    b.addEventListener('pointercancel', off);
  };
  bindHold('btnLeft', 'left');
  bindHold('btnRight', 'right');
  bindHold('btnGas', 'up');
  bindHold('btnBrake', 'down');

  // 사진 1처럼 자동 가속이 기본: 위 키가 없어도 직진 가속
  function toRaceInput() {
    return {
      steer: (state.left ? -1 : 0) + (state.right ? 1 : 0),
      throttle: state.up || (!state.down && autoGas) ? 1 : 0,
      brake: state.down ? 1 : 0,
    };
  }
  let autoGas = true;
  return { state, toRaceInput, setAutoGas: (v) => (autoGas = v) };
}

// WebAudio 효과음 (에셋 없이 카운트다운·골인음)
export function createBeeper() {
  let ctx = null;
  let muted = false;
  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function beep(freq, dur = 0.15, type = 'square', vol = 0.12) {
    if (muted) return;
    try {
      const a = ac();
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.value = vol;
      o.connect(g);
      g.connect(a.destination);
      o.start();
      o.stop(a.currentTime + dur);
    } catch (e) { /* 오디오 미지원 무시 */ }
  }
  return {
    count: () => beep(440, 0.15),
    go: () => beep(880, 0.4),
    finish: () => { beep(660, 0.15); setTimeout(() => beep(880, 0.3), 160); },
    toggle: () => (muted = !muted),
    get muted() { return muted; },
  };
}
