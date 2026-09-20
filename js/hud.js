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
  function setHp(hp, maxHp) {
    const bar = el('hpFill');
    if (!bar) return;
    const r = Math.max(0, hp / maxHp);
    bar.style.width = `${Math.round(r * 100)}%`;
    bar.style.background = r > 0.5 ? '#3ddc5f' : r > 0.25 ? '#ffb300' : '#ff3b30';
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

  return { drawMinimap, setLap, setTimer, setPos, setSpeed, setHp, message, showResults, hideResults };
}

// 입력: 키보드 + 화면 좌/우 탭 조향 (멀티터치: 양쪽 동시=브레이크/후진)
// L/R 버튼은 시작 전 힌트용 표시물(pointer-events 없음), 실제 입력은 화면 분할 탭
export function createInput(canvas) {
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

  // 화면 탭 조향: 왼쪽 45% = 좌회전, 오른쪽 45% = 우회전, 둘 동시 = 후진
  const touches = new Map(); // pointerId → 'left' | 'right'
  let zoneL = false;
  let zoneR = false;
  const sideOf = (clientX) => {
    const r = canvas.getBoundingClientRect();
    const fx = (clientX - r.left) / r.width;
    if (fx < 0.45) return 'left';
    if (fx > 0.55) return 'right';
    return null;
  };
  const refresh = () => {
    zoneL = false;
    zoneR = false;
    for (const s of touches.values()) {
      if (s === 'left') zoneL = true;
      if (s === 'right') zoneR = true;
    }
  };
  canvas.addEventListener('pointerdown', (e) => {
    const s = sideOf(e.clientX);
    if (s) {
      touches.set(e.pointerId, s);
      refresh();
    }
  });
  const release = (e) => {
    if (touches.delete(e.pointerId)) refresh();
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', release);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function toRaceInput() {
    const left = state.left || zoneL;
    const right = state.right || zoneR;
    const both = (zoneL && zoneR) || state.down;
    return {
      steer: (left ? -1 : 0) + (right ? 1 : 0),
      throttle: both ? 0 : 1, // 자동 가속 (가만히 있어도 전진)
      brake: both ? 1 : 0,
    };
  }
  return { state, toRaceInput };
}

// 시작 전 L/R 힌트 표시/숨김
export function setSteerHint(visible) {
  for (const id of ['btnLeft', 'btnRight']) {
    const b = document.getElementById(id);
    if (b) b.style.display = visible ? 'block' : 'none';
  }
  const h = document.getElementById('zoneHint');
  if (h) h.style.display = visible ? 'none' : 'block';
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
  function thud(vol = 0.3, freq = 90) {
    // 쾅: 저주파 노이즈 버스트 + 피치 하강 사인
    if (muted) return;
    try {
      const a = ac();
      const dur = 0.28;
      const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) {
        ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 2);
      }
      const src = a.createBufferSource();
      src.buffer = buf;
      const lp = a.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 400;
      const g = a.createGain();
      g.gain.value = vol;
      src.connect(lp);
      lp.connect(g);
      g.connect(a.destination);
      src.start();
      const o = a.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq + 60, a.currentTime);
      o.frequency.exponentialRampToValueAtTime(38, a.currentTime + dur);
      const g2 = a.createGain();
      g2.gain.setValueAtTime(vol * 0.8, a.currentTime);
      g2.gain.exponentialRampToValueAtTime(0.01, a.currentTime + dur);
      o.connect(g2);
      g2.connect(a.destination);
      o.start();
      o.stop(a.currentTime + dur);
    } catch (e) { /* 오디오 미지원 무시 */ }
  }
  function sweep() {
    // 부스터: 상승 sweep
    if (muted) return;
    try {
      const a = ac();
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(220, a.currentTime);
      o.frequency.exponentialRampToValueAtTime(880, a.currentTime + 0.5);
      g.gain.setValueAtTime(0.1, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.01, a.currentTime + 0.55);
      o.connect(g);
      g.connect(a.destination);
      o.start();
      o.stop(a.currentTime + 0.55);
    } catch (e) { /* 오디오 미지원 무시 */ }
  }
  return {
    count: () => beep(440, 0.15),
    go: () => beep(880, 0.4),
    finish: () => { beep(660, 0.15); setTimeout(() => beep(880, 0.3), 160); },
    crash: () => thud(0.32, 90),
    land: () => thud(0.18, 70),
    boost: () => sweep(),
    toggle: () => (muted = !muted),
    get muted() { return muted; },
  };
}
