// 네트워크 순수 함수 (스냅샷·보간·그리드 배치) — 중계/직접 공통 사용
// 경주 데이터는 브라우저끼리 직접 교환. transport 주입식이라 node 테스트 가능.
//
// 메시지 규격:
//  guest→host: {t:'hello', carId} / {t:'car', carId}
//  host→all : {t:'lobby', players:[{id,carId}], trackId}
//  host→all : {t:'start', trackId, players:[{id,carId}], ai:[carId]}
//  any→all  : {t:'state', cars:[스냅샷...]} (host=전 차량, guest=자기 차)
//  host→guest: {t:'deny'}

export const ROOM_PREFIX = 'blockyracer-v1-';
export const STATE_HZ = 20; // 상태 브로드캐스트 (부드러움 개선)

// ICE 설정: STUN 2종 (직접 연결용)
// ※ 공개 무료 TURN 자격증명은 2026년 기준 동작하지 않음 — 통신사망 뒤에서는
//    아래 TURN 키 설정(Metered 무료 가입)으로 중계 자격을 가져와야 함
export const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
  iceCandidatePoolSize: 4,
};

const TURN_STORE_KEY = 'blockyracer-turn-v1';
export function getTurnSettings() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const s = JSON.parse(localStorage.getItem(TURN_STORE_KEY));
    if (s && s.app && s.key) return s;
  } catch (e) { /* 무시 */ }
  return null;
}
export function saveTurnSettings(app, key) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(TURN_STORE_KEY, JSON.stringify({ app, key }));
  } catch (e) { /* 무시 */ }
}

let cachedTurn = null; // {at, iceServers}
export async function resolveRTCConfig() {
  const t = getTurnSettings();
  if (!t) return RTC_CONFIG;
  if (cachedTurn && Date.now() - cachedTurn.at < 5 * 60 * 1000) {
    return { iceServers: [...RTC_CONFIG.iceServers, ...cachedTurn.iceServers] };
  }
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    const app = t.app.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const res = await fetch(
      `https://${app}/api/v1/turn/credentials?apiKey=${encodeURIComponent(t.key)}`,
      { signal: ctrl.signal }
    );
    clearTimeout(to);
    const ice = await res.json();
    if (Array.isArray(ice) && ice.length > 0) {
      cachedTurn = { at: Date.now(), iceServers: ice };
      return { iceServers: [...RTC_CONFIG.iceServers, ...ice] };
    }
  } catch (e) { /* 실패 시 기본값 */ }
  return RTC_CONFIG;
}

function randCode() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

export function carSnapshot(car) {
  return {
    x: +car.x.toFixed(2), z: +car.z.toFixed(2),
    heading: +car.heading.toFixed(3),
    vx: +car.vx.toFixed(2), vz: +car.vz.toFixed(2),
    hp: Math.ceil(car.hp), lap: car.lap, dist: +car.dist.toFixed(1),
    lateral: +car.lateral.toFixed(1),
    finished: car.finished, out: car.out,
    boostT: +(car.boostT || 0).toFixed(2),
    airT: +(car.airT || 0).toFixed(2),
    steerVis: +(car.steerVis || 0).toFixed(2),
    shield: car.shieldT > 0 ? 1 : 0,
  };
}

export function applySnapshot(car, s) {
  car.x = s.x; car.z = s.z; car.heading = s.heading;
  car.vx = s.vx; car.vz = s.vz;
  car.hp = s.hp; car.lap = s.lap; car.dist = s.dist;
  car.lateral = s.lateral;
  car.finished = s.finished; car.out = s.out;
  car.boostT = s.boostT; car.airT = s.airT;
  car.steerVis = s.steerVis;
  if (s.shield !== undefined) car.shieldT = s.shield ? 999 : 0;
}

// 원격 차량 데드레커닝: 스냅샷 사이를 속도로 예측 전진 (끊김 완화)
export function extrapolateRemote(car, dt) {
  car.x += car.vx * dt;
  car.z += car.vz * dt;
}

// 스냅샷 부분 합성 (뚝 끊김 대신 alpha만큼 보정 → 수렴)
export function blendSnapshot(car, s, a) {
  car.x += (s.x - car.x) * a;
  car.z += (s.z - car.z) * a;
  let dh = (s.heading - car.heading) % (Math.PI * 2);
  if (dh > Math.PI) dh -= Math.PI * 2;
  if (dh < -Math.PI) dh += Math.PI * 2;
  car.heading += dh * a;
  car.heading = ((car.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  car.vx += (s.vx - car.vx) * a;
  car.vz += (s.vz - car.vz) * a;
  car.dist += (s.dist - car.dist) * a;
  // 이산 상태는 직접 복사
  car.hp = s.hp; car.lap = s.lap; car.lateral = s.lateral;
  car.finished = s.finished; car.out = s.out;
  car.boostT = s.boostT; car.airT = s.airT;
  car.steerVis = s.steerVis;
  if (s.shield !== undefined) car.shieldT = s.shield ? 999 : 0;
}
// 반환: [{slot, carId, local, isMine, isAI, peerId}]
// ※ 내 슬롯이 없으면 0번을 로컬로 강제 (전체 CPU/동결 방지)
// 온라인 그리드 배치 (순수 함수 → 테스트 가능)
export function planOnlineGrid(players, aiCarIds, myId, isHost) {
  const entries = [];
  players.forEach((pl, i) => {
    const mine = pl.id === myId;
    entries.push({
      slot: i, carId: pl.carId, local: mine, isMine: mine,
      isAI: false, peerId: mine ? null : pl.id,
    });
  });
  aiCarIds.forEach((carId) => {
    entries.push({
      slot: entries.length, carId, local: isHost, isMine: false,
      isAI: true, peerId: null,
    });
  });
  if (!entries.some((e) => e.local) && entries.length > 0) {
    entries[0].local = true;
  }
  return entries;
}

// peerFactory: () => PeerJS 호환 객체 (new Peer(id?))
//   - peer.on('open'|'connection'|'error'|'disconnected')
//   - peer.connect(id) -> conn {on('open'|'data'|'close'|'error'), send, close, peer}
//   - 테스트에선 인메모리 mock 주입
export class NetRoom {
  constructor(peerFactory) {
    this.peerFactory = peerFactory;
    this.peer = null;
    this.isHost = false;
    this.code = null;
    this.myId = null;
    this.hostId = null;
    this.conns = new Map(); // peerId -> conn (host: guests, guest: host)
    this.players = []; // [{id, carId}] 슬롯 순서 (host가 관리)
    this.onEvent = () => {};
    this.phase = 'idle'; // idle|lobby|racing
    this.myCarId = null;
    this.joinedAs = null; // 게스트 최초 참가 id (재접속 인계용)
    this.maxPlayers = 4;
    this.trackId = null;
    this.itemsOn = true;
    this.remoteInputs = new Map(); // guestId -> {input, at} (host 측)
  }

  _emit(ev) {
    try {
      this.onEvent(ev);
    } catch (e) {
      console.error('[net]', e);
    }
  }

  _newPeer(id) {
    return new Promise((resolve, reject) => {
      (async () => {
        let peer;
        try {
          const config = await resolveRTCConfig();
          peer = this.peerFactory(id, config);
        } catch (e) {
          reject(e);
          return;
        }
        const timer = setTimeout(() => reject(new Error('signaling timeout')), 30000);
      peer.on('open', (pid) => {
        clearTimeout(timer);
        const first = !this.peer;
        this.peer = peer;
        this.myId = pid;
        if (!first) this._onReopen();
        resolve(pid);
      });
      peer.on('error', (err) => {
        const type = err && err.type;
        if (type === 'peer-unavailable') {
          this._emit({ type: 'error', msg: '방을 찾을 수 없음: 코드 4글자 + 호스트가 방을 연 상태인지 확인해주세요.' });
        } else if (type === 'webrtc') {
          this._emit({ type: 'error', msg: '이 브라우저는 WebRTC 미지원: 크롬/사파리 앱으로 직접 열어주세요. (카톡 인앱브라우저 등에서는 안 됩니다)' });
        } else if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
          this._emit({ type: 'error', msg: `시그널링 연결 문제(${type}): 인터넷 확인 후 재시도해주세요.` });
        }
      });
      peer.on('disconnected', () => {
        try { peer.reconnect(); } catch (e) { /* 무시 */ }
      });
      })();
    });
  }

  // 재접속 시 (모바일 네트워크 변경 등): 호스트에 다시 인사 + 이전 id 인계
  _onReopen() {
    if (this.isHost || this.phase === 'idle' || !this.joinedAs) return;
    try {
      const conn = this.peer.connect(this.hostId, { reliable: true });
      conn.on('open', () => {
        this.conns.set(this.hostId, conn);
        this._wireConn(conn, this.hostId);
        try { conn.send({ t: 'hello', carId: this.myCarId, re: this.joinedAs }); } catch (e) { /* 무시 */ }
        this.joinedAs = this.myId;
      });
    } catch (e) { /* 무시 */ }
  }

  _wireConn(conn, peerId) {
    conn.on('data', (msg) => this._onData(peerId, msg));
    conn.on('close', () => this._onClose(peerId));
    conn.on('error', () => this._onClose(peerId));
    // 연결 진단: ICE 상태 전이 + 선택된 후보 종류 보고
    try {
      const pc = conn.peerConnection;
      if (pc) {
        pc.addEventListener('iceconnectionstatechange', () => {
          this._emit({ type: 'conn-state', id: peerId, state: pc.iceConnectionState });
        });
        pc.addEventListener('icegatheringstatechange', () => {
          if (pc.iceGatheringState === 'complete') this._reportNetKind(conn, peerId);
        });
      }
    } catch (e) { /* 구형 브라우저 무시 */ }
  }

  async _reportNetKind(conn, peerId) {
    // host=같은망 직접 / srflx=인터넷 직접 / relay=TURN 중계
    try {
      await new Promise((r) => setTimeout(r, 1500));
      const pc = conn.peerConnection;
      if (!pc || !pc.getStats) return;
      const stats = await pc.getStats();
      let kind = '?';
      stats.forEach((s) => {
        if (s.type === 'candidate-pair' && (s.nominated || s.selected)) {
          const local = typeof stats.get === 'function' ? stats.get(s.localCandidateId) : null;
          if (local && local.candidateType) kind = local.candidateType;
        }
      });
      this._emit({ type: 'net-kind', id: peerId, kind });
    } catch (e) { /* 무시 */ }
  }

  async hostRoom({ maxPlayers, trackId, carId, itemsOn } = {}) {
    this.destroy();
    this.isHost = true;
    this.code = randCode();
    this.maxPlayers = maxPlayers || 4;
    this.trackId = trackId || null;
    this.itemsOn = itemsOn !== false;
    this.myCarId = carId || null;
    await this._newPeer(ROOM_PREFIX + this.code);
    this.players = [{ id: this.myId, carId: this.myCarId }];
    this.phase = 'lobby';
    this.peer.on('connection', (conn) => {
      if (this.phase !== 'lobby') {
        // 경주 중 난입 거부
        conn.on('open', () => {
          try { conn.send({ t: 'deny' }); } catch (e) { /* 무시 */ }
          setTimeout(() => { try { conn.close(); } catch (e) { /* 무시 */ } }, 300);
        });
        return;
      }
      conn.on('open', () => {
        this.conns.set(conn.peer, conn);
        this._wireConn(conn, conn.peer);
      });
    });
    return this.code;
  }

  async joinRoom(code, myCarId) {
    this.destroy();
    this.isHost = false;
    this.code = code.trim().toUpperCase();
    this.hostId = ROOM_PREFIX + this.code;
    this.myCarId = myCarId;
    await this._newPeer();
    this.joinedAs = this.myId;
    this.phase = 'lobby';
    const conn = this.peer.connect(this.hostId, { reliable: true });
    // 연결 전 ICE 진행 상황 표시 (호스트 찾음 vs 직접 연결 중 구분)
    try {
      const pc0 = conn.peerConnection;
      if (pc0) {
        pc0.addEventListener('iceconnectionstatechange', () => {
          this._emit({ type: 'conn-state', id: this.hostId, state: pc0.iceConnectionState });
        });
      }
    } catch (e) { /* 구형 브라우저 무시 */ }
    this._emit({ type: 'conn-state', id: this.hostId, state: 'searching' });
    await new Promise((resolve, reject) => {
      let done = false;
      const finish = (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          if (this.peer && this.peer.off) this.peer.off('error', onPeerErr);
          else if (this.peer && this.peer.removeListener) this.peer.removeListener('error', onPeerErr);
        } catch (e) { /* 무시 */ }
        if (err) reject(err);
        else resolve();
      };
      // 다른 망 NAT 뒤에서는 ICE가 안 뚫려 open이 안 옴 → 12초면 실패 확정
      const timer = setTimeout(() => {
        try { conn.close(); } catch (e) { /* 무시 */ }
        finish(new Error('host unreachable'));
      }, 12000);
      // 존재하지 않는 방: 에러가 DataConnection이 아니라 Peer에 옴 → 직접 연결
      const onPeerErr = (err) => {
        if (err && err.type === 'peer-unavailable') finish(new Error('room not found'));
      };
      try { this.peer.on('error', onPeerErr); } catch (e) { /* 무시 */ }
      conn.on('open', () => {
        this.conns.set(this.hostId, conn);
        this._wireConn(conn, this.hostId);
        try { conn.send({ t: 'hello', carId: myCarId }); } catch (e) { /* 무시 */ }
        finish(null);
      });
      conn.on('error', () => finish(new Error('host unreachable')));
      conn.on('close', () => finish(new Error('host unreachable')));
    });
  }

  _onData(peerId, msg) {
    if (!msg || typeof msg.t !== 'string') return;
    if (this.isHost) {
      if (msg.t === 'quit') {
        // 로비로 돌아간 게스트 → AI 인수 대상으로 통지
        this._emit({ type: 'peer-left', id: peerId });
        return;
      }
      if (msg.t === 'req-restart') {
        // 게스트의 재시작 요청 (호스트가 모아서 자동 시작)
        this._emit({ type: 'restart-req', id: peerId });
        return;
      }
      if (msg.t === 'ping') {
        // 핑 응답 (호스트 → 발신자에게 직접)
        const c = this.conns.get(peerId);
        if (c) {
          try { c.send({ t: 'pong', t0: msg.t0 }); } catch (e) { /* 무시 */ }
        }
        return;
      }
      if (msg.t === 'input') {
        // 게스트 입력 수신 (호스트 시뮬용, 1초 지나면 무효)
        this.remoteInputs.set(peerId, { input: msg.input, at: Date.now() });
        return;
      }
      if (msg.t === 'hello' || msg.t === 'car') {
        // 재접속 인계: 이전 id의 슬롯을 새 id로 교체 (중복 참가 방지)
        if (msg.re) {
          const old = this.players.find((x) => x.id === msg.re);
          if (old) old.id = peerId;
          this.conns.delete(msg.re);
        }
        let p = this.players.find((x) => x.id === peerId);
        if (!p) {
          if (this.players.length >= this.maxPlayers) {
            const c = this.conns.get(peerId);
            if (c) {
              try { c.send({ t: 'deny' }); } catch (e) { /* 무시 */ }
            }
            return; // 만원
          }
          p = { id: peerId, carId: msg.carId };
          this.players.push(p);
        } else {
          p.carId = msg.carId;
        }
        this.broadcastLobby();
      }
    } else {
      if (msg.t === 'lobby') {
        this.players = msg.players;
        this.itemsOn = msg.items !== false;
        this._emit({ type: 'lobby', players: this.players, trackId: msg.trackId, items: msg.items });
      } else if (msg.t === 'start') {
        this.phase = 'racing';
        this._emit({ type: 'start', trackId: msg.trackId, players: msg.players, ai: msg.ai, items: msg.items });
      } else if (msg.t === 'state') {
        this._emit({ type: 'state', cars: msg.cars, mines: msg.mines, boxes: msg.boxes, players: msg.players });
      } else if (msg.t === 'deny') {
        this._emit({ type: 'denied' });
      } else if (msg.t === 'sync') {
        if (!this.isHost) this._emit({ type: 'sync', cars: msg.cars });
      } else if (msg.t === 'pong') {
        this._emit({ type: 'pong', rtt: Date.now() - msg.t0 });
      } else if (msg.t === 'mine' || msg.t === 'minehit' || msg.t === 'shock') {
        this._emit({ type: 'game', msg });
      }
    }
    if (msg.t === 'state' && this.isHost) {
      // 권위 구조: 게스트는 입력만 보내므로 state 수신 시 무시
      return;
    }
  }

  _onClose(peerId) {
    this.conns.delete(peerId);
    this.remoteInputs.delete(peerId);
    if (this.isHost) {
      const before = this.players.length;
      this.players = this.players.filter((p) => p.id !== peerId);
      if (this.players.length !== before) {
        if (this.phase === 'lobby') this.broadcastLobby();
        else this._emit({ type: 'peer-left', id: peerId });
      }
    } else if (peerId === this.hostId) {
      this._emit({ type: 'host-left' });
    }
  }

  // ---- host API ----
  setMyCar(carId) {
    this.myCarId = carId;
    const me = this.players.find((p) => p.id === this.myId);
    if (me) me.carId = carId;
    if (this.isHost) this.broadcastLobby();
    else {
      const c = this.conns.get(this.hostId);
      if (c) {
        try { c.send({ t: 'car', carId }); } catch (e) { /* 무시 */ }
      }
    }
  }

  setTrack(trackId) {
    this.trackId = trackId;
    if (this.isHost) this.broadcastLobby();
  }

  broadcastLobby() {
    if (!this.isHost) return;
    const msg = { t: 'lobby', players: this.players, trackId: this.trackId, items: this.itemsOn !== false };
    for (const [, c] of this.conns) {
      try { c.send(msg); } catch (e) { /* 무시 */ }
    }
    this._emit({ type: 'lobby', players: this.players, trackId: this.trackId });
  }

  startRace(aiCarIds, itemsOn = true) {
    if (!this.isHost) return null;
    this.phase = 'racing';
    const msg = { t: 'start', trackId: this.trackId, players: this.players, ai: aiCarIds, items: itemsOn };
    for (const [, c] of this.conns) {
      try { c.send(msg); } catch (e) { /* 무시 */ }
    }
    return msg;
  }

  sendState(cars, mines, boxes, players) {
    const msg = { t: 'state', cars, mines, boxes, players };
    for (const [, c] of this.conns) {
      try { c.send(msg); } catch (e) { /* 무시 */ }
    }
  }

  // 게스트 → 호스트 입력 전송 (권위 구조)
  sendInput(input) {
    if (this.isHost) return;
    const c = this.conns.get(this.hostId);
    if (c) {
      try { c.send({ t: 'input', input }); } catch (e) { /* 무시 */ }
    }
  }

  // 게스트가 경주 → 로비로 빠질 때 (호스트가 AI로 인수)
  quitRace() {
    if (this.isHost) return;
    const c = this.conns.get(this.hostId);
    if (c) {
      try { c.send({ t: 'quit' }); } catch (e) { /* 무시 */ }
    }
  }

  // 핑 (게스트 → 호스트, 2초 간격 호출용)
  pingHost() {
    if (this.isHost) return;
    const c = this.conns.get(this.hostId);
    if (c) {
      try { c.send({ t: 'ping', t0: Date.now() }); } catch (e) { /* 무시 */ }
    }
  }

  // 게스트의 재시작 요청 (결과 화면 "다시 달리기")
  requestRestart() {
    if (this.isHost) return;
    const c = this.conns.get(this.hostId);
    if (c) {
      try { c.send({ t: 'req-restart' }); } catch (e) { /* 무시 */ }
    }
  }

  destroy() {
    try {
      for (const [, c] of this.conns) {
        try { c.close(); } catch (e) { /* 무시 */ }
      }
    } catch (e) { /* 무시 */ }
    this.conns.clear();
    this.remoteInputs.clear();
    try {
      if (this.peer) this.peer.destroy();
    } catch (e) { /* 무시 */ }
    this.peer = null;
    this.players = [];
    this.phase = 'idle';
    this.isHost = false;
  }
}
