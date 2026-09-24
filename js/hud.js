// HUD: 미니맵·랩·타이머·순위·메시지·터치 버튼·효과음 (DOM)
export function fmtTime(sec) {
  if (!isFinite(sec)) return '--.-';
  return sec.toFixed(1);
}

export function createHUD(circuit, shortcuts = []) {
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
    // 지름길 표시 (갈색 점선)
    mctx.lineWidth = 3;
    mctx.strokeStyle = '#b08a5a';
    mctx.setLineDash([4, 3]);
    for (const g of shortcuts) {
      const [x1, y1] = toMap(g.ax, g.az);
      const [x2, y2] = toMap(g.bx, g.bz);
      mctx.beginPath();
      mctx.moveTo(x1, y1);
      mctx.lineTo(x2, y2);
      mctx.stroke();
    }
    mctx.setLineDash([]);
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
    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣'];
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
  const state = { left: false, right: false, up: false, down: false, drift: false, useItem: false };
  const keymap = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ShiftLeft: 'drift', ShiftRight: 'drift', KeyF: 'drift',
  };
  const edgeKeys = { Space: 'useItem', KeyE: 'useItem' };
  window.addEventListener('keydown', (e) => {
    // 코드 입력창 등 타이핑 중엔 게임 키 무시
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const k = keymap[e.code];
    if (k) {
      state[k] = true;
      e.preventDefault();
    }
    if (edgeKeys[e.code]) {
      state.useItem = true;
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
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
    if (window.__layoutEdit) return; // 배치 편집 중엔 조향 무시
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

  // 드리프트 버튼 좌/우 (어느 쪽을 눌러도 동일, 편집 중엔 동작 안 함)
  // 멀티터치 래치 방지: 누른 포인터 ID 집합으로 홀드 판정
  const driftPtrs = new Set();
  const refreshDrift = () => {
    const was = state.drift;
    state.drift = driftPtrs.size > 0;
    for (const id of ['btnDriftL', 'btnDriftR']) {
      const b = document.getElementById(id);
      if (b) b.classList.toggle('active', state.drift);
    }
    void was;
  };
  for (const id of ['btnDriftL', 'btnDriftR']) {
    const driftBtn = document.getElementById(id);
    if (!driftBtn) continue;
    const on = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (window.__layoutEdit) return;
      driftPtrs.add(e.pointerId);
      refreshDrift();
    };
    const off = (e) => {
      if (e) {
        e.preventDefault();
        driftPtrs.delete(e.pointerId);
      } else {
        driftPtrs.clear();
      }
      refreshDrift();
    };
    driftBtn.addEventListener('pointerdown', on);
    driftBtn.addEventListener('pointerup', off);
    driftBtn.addEventListener('pointerleave', off);
    driftBtn.addEventListener('pointercancel', off);
  }
  // 탭 전환·포커스 상실 시 입력 래치 해제 (키·버튼 눌림 stuck 방지)
  const clearAllInput = () => {
    state.left = state.right = state.up = state.down = state.drift = false;
    state.useItem = false;
    driftPtrs.clear();
    touches.clear();
    zoneL = zoneR = false;
    refreshDrift();
  };
  window.addEventListener('blur', clearAllInput);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') clearAllInput();
  });

  // 아이템 사용 버튼 좌/우 (🎁) — 누르면 1회 발동 플래그
  for (const id of ['btnItemL', 'btnItemR']) {
    const itemBtn = document.getElementById(id);
    if (!itemBtn) continue;
    itemBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (window.__layoutEdit) return;
      state.useItem = true;
    });
  }

  function toRaceInput() {
    const left = state.left || zoneL;
    const right = state.right || zoneR;
    const both = (zoneL && zoneR) || state.down;
    return {
      steer: (left ? -1 : 0) + (right ? 1 : 0),
      throttle: both ? 0 : 1, // 자동 가속 (가만히 있어도 전진)
      brake: both ? 1 : 0,
      drift: !!state.drift,
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
  // 엔진: 속도 연동 지속음 (saw + 옥타브 아래 서브 사인 저음 + 로우패스, ratio 0~1)
  // 부스트 ON/OFF는 계단식이 아니라 글라이드:
  // 고음은 빨리 내려오고(bHi) 저음은 천천히 남겨서(bLo) 꺼질 때 상대적으로 낮아지는 느낌
  let engOsc = null;
  let engGain = null;
  let engSub = null;
  let engSubGain = null;
  let bHi = 0;
  let bLo = 0;
  function engine(ratio, boosting) {
    try {
      if (muted) { engineStop(); return; }
      const a = ac();
      if (!engOsc) {
        engOsc = a.createOscillator();
        engOsc.type = 'sawtooth';
        const lp = a.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 900;
        engGain = a.createGain();
        engGain.gain.value = 0;
        engOsc.connect(lp);
        lp.connect(engGain);
        engGain.connect(a.destination);
        engOsc.start();
        // 저음 울림: 한 옥타브 아래 서브 레이어
        engSub = a.createOscillator();
        engSub.type = 'sine';
        engSubGain = a.createGain();
        engSubGain.gain.value = 0;
        engSub.connect(engSubGain);
        engSubGain.connect(a.destination);
        engSub.start();
      }
      const r = Math.max(0, Math.min(1, ratio));
      // 부스트 계수 스무딩 (매 프레임 호출 가정): 켜질 땐 둘 다 빠르게, 꺼질 땐 고음 먼저·저음 나중에
      const t = boosting ? 1 : 0;
      const kHi = boosting ? 0.4 : 0.12;
      const kLo = boosting ? 0.4 : 0.05;
      bHi += (t - bHi) * kHi;
      bLo += (t - bLo) * kLo;
      if (Math.abs(bHi) < 0.001) bHi = 0;
      if (Math.abs(bLo) < 0.001) bLo = 0;
      const f = (60 + r * 170) * (1 + 0.25 * bHi);
      engOsc.frequency.setTargetAtTime(f, a.currentTime, 0.06);
      engGain.gain.setTargetAtTime((0.015 + r * 0.05) * (1 + 0.5 * bHi), a.currentTime, 0.1);
      engSub.frequency.setTargetAtTime(f * 0.5, a.currentTime, 0.06);
      engSubGain.gain.setTargetAtTime((0.02 + r * 0.045) * (1 + 0.7 * bLo), a.currentTime, 0.1);
    } catch (e) { /* 오디오 미지원 무시 */ }
  }
  function engineStop() {
    try {
      if (engOsc) {
        engOsc.stop();
        engOsc.disconnect();
      }
      if (engSub) {
        engSub.stop();
        engSub.disconnect();
      }
    } catch (e) { /* 무시 */ }
    engOsc = null;
    engGain = null;
    engSub = null;
    engSubGain = null;
    bHi = 0;
    bLo = 0;
  }
  // 스키드: 타이어 끽 소리 (amount 0~1 슬립량)
  // 가이드(s&box SkidAudio·bleepsandpops 타이어 파트) 처방:
  // 1) 음높이가 있는 비명 — 순음에 가까운 톤이 몸통 (톱니파 생톤은 버즈만 남고 짜증나짐)
  // 2) 볼륨+피치가 슬립량에 같이 탐 — 살짝 미끄러지면 속삭이고 풀 슬라이드에서 비명
  // 3) 음높이에 느린 워블(LFO) — 끽끽 떨리는 질감
  let skidNodes = null; // {tone, toneGain, noiseGain, filter}
  function skid(amount) {
    try {
      if (muted) amount = 0;
      amount = Math.max(0, Math.min(1, amount || 0));
      const a = ac();
      if (!skidNodes) {
        // 몸통: 삼각파 톤 (생톱니 대비 자극적 고조파 제거)
        const tone = a.createOscillator();
        tone.type = 'triangle';
        tone.frequency.value = 1500;
        const toneGain = a.createGain();
        toneGain.gain.value = 0;
        tone.connect(toneGain);
        toneGain.connect(a.destination);
        tone.start();
        // 질감: 고Q 밴드패스 노이즈 (작게)
        const len = a.sampleRate;
        const buf = a.createBuffer(1, len, a.sampleRate);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
        const src = a.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const bp = a.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1500;
        bp.Q.value = 9;
        const noiseGain = a.createGain();
        noiseGain.gain.value = 0;
        src.connect(bp);
        bp.connect(noiseGain);
        noiseGain.connect(a.destination);
        src.start();
        // 워블: 초당 8회 톤 높이를 ±50Hz 흔듦
        const lfo = a.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 8;
        const lfoGain = a.createGain();
        lfoGain.gain.value = 50;
        lfo.connect(lfoGain);
        lfoGain.connect(tone.frequency);
        lfo.start();
        skidNodes = { tone, toneGain, noiseGain, filter: bp };
      }
      const f = 1300 + amount * 800;
      skidNodes.tone.frequency.setTargetAtTime(f, a.currentTime, 0.05);
      skidNodes.filter.frequency.setTargetAtTime(f, a.currentTime, 0.05);
      skidNodes.toneGain.gain.setTargetAtTime(amount * 0.06, a.currentTime, 0.05);
      skidNodes.noiseGain.gain.setTargetAtTime(amount * 0.03, a.currentTime, 0.05);
    } catch (e) { /* 오디오 미지원 무시 */ }
  }
  return {
    count: () => beep(440, 0.15),
    go: () => beep(880, 0.4),
    finish: () => { beep(660, 0.15); setTimeout(() => beep(880, 0.3), 160); },
    crash: () => thud(0.32, 90),
    land: () => thud(0.18, 70),
    boost: () => sweep(),
    engine,
    engineStop,
    skid,
    toggle: () => {
      muted = !muted;
      if (muted) {
        engineStop();
        skid(false);
      }
      return muted;
    },
    get muted() { return muted; },
  };
}
