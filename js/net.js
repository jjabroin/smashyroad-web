// 네트워크 순수 함수 (스냅샷·보간·그리드 배치) — 중계/직접 공통 사용
// 경주 데이터는 브라우저끼리 직접 교환 (WebRTC DataChannel).
// 시그널링(offer/answer/ICE)은 동작 확인된 MQTT 브로커 경유 (js/sig.js) — PeerJS 미사용.
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
// local = 이 기기에서 시뮬하는 차량 (호스트는 권위 시뮬이라 게스트 포함, 게스트는 자기 차만)
// ※ 내 슬롯이 없으면 0번을 로컬로 강제 (전체 CPU/동결 방지)
// 온라인 그리드 배치 (순수 함수 → 테스트 가능)
export function planOnlineGrid(players, aiCarIds, myId, isHost) {
  const entries = [];
  players.forEach((pl, i) => {
    const mine = pl.id === myId;
    entries.push({
      slot: i, carId: pl.carId, local: mine || isHost, isMine: mine,
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

// mqttFactory: (url, opts) => mqtt 연결 객체 (main.js와 동일한 주입식)
// 순수 함수(스냅샷·그리드)는 node 테스트 가능, 전송부(NetRoom)는 브라우저 WebRTC 필요
import { MqttSig, checkRoom, HOST_TAG } from './sig.js?v=dev';

// 네이티브 DataChannel → 기존 conn 인터페이스 래퍼
// {peer, send(obj), close(), on('open'|'data'|'close'|'error'), peerConnection}
class RawConn {
  constructor(id, pc, chan) {
    this.peer = id;
    this.peerConnection = pc;
    this._chan = chan;
    this._handlers = { open: [], data: [], close: [], error: [] };
    try {
      chan.onopen = () => this._fire('open');
      chan.onmessage = (ev) => {
        let msg = null;
        try {
          msg = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
        } catch (e) { /* 무시 */ }
        if (msg) this._fire('data', msg);
      };
      chan.onclose = () => this._fire('close');
      chan.onerror = () => this._fire('error');
    } catch (e) { /* 무시 */ }
  }
  on(ev, fn) {
    if (this._handlers[ev]) this._handlers[ev].push(fn);
    return this;
  }
  _fire(ev, arg) {
    for (const fn of [...(this._handlers[ev] || [])]) {
      try { fn(arg); } catch (e) { /* 무시 */ }
    }
  }
  send(obj) {
    try {
      if (this._chan && this._chan.readyState === 'open') {
        this._chan.send(JSON.stringify(obj));
      }
    } catch (e) { /* 무시 */ }
  }
  close() {
    try { if (this._chan) this._chan.close(); } catch (e) { /* 무시 */ }
    try { if (this.peerConnection) this.peerConnection.close(); } catch (e) { /* 무시 */ }
  }
}

export class NetRoom {
  constructor(mqttFactory) {
    this.mqttFactory = mqttFactory;
    this.sig = null;
    this.rtcConfig = RTC_CONFIG;
    this.pcs = new Map(); // guestId/hostId -> RTCPeerConnection
    this.aliveTimer = null;
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

  _newPC() {
    try {
      return new RTCPeerConnection(this.rtcConfig);
    } catch (e) {
      this._emit({ type: 'error', msg: '이 브라우저는 WebRTC 미지원: 크롬/사파리 앱으로 직접 열어주세요. (카톡 인앱브라우저 등에서는 안 됩니다)' });
      throw e;
    }
  }

  _closePC(id) {
    try {
      const pc = this.pcs.get(id);
      if (pc) {
        try { pc.close(); } catch (e) { /* 무시 */ }
      }
    } catch (e) { /* 무시 */ }
    this.pcs.delete(id);
  }

  _iceToSig(pc, to) {
    try {
      pc.onicecandidate = (ev) => {
        if (ev && ev.candidate && this.sig) {
          try {
            this.sig.send(to, 'ice', { candidate: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate });
          } catch (e) { /* 무시 */ }
        }
      };
    } catch (e) { /* 무시 */ }
  }

  // 재접속 시 (모바일 네트워크 변경 등): 새 id로 다시 offer + 이전 id 인계
  _onReopen() {
    if (this.isHost || this.phase === 'idle' || !this.joinedAs) return;
    this._guestConnect(this.joinedAs).catch(() => {});
  }

  // 게스트 연결 본체 (re: 이전 id 인계 시 전달)
  async _guestConnect(re) {
    if (!this.sig) throw new Error('host unreachable');
    if (re) {
      const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      let s = 'G';
      for (let i = 0; i < 7; i++) s += abc[Math.floor(Math.random() * abc.length)];
      this.myId = s;
    }
    if (this._offSig) {
      try { this._offSig(); } catch (e) { /* 무시 */ }
      this._offSig = null;
    }
    const pc = this._newPC();
    this._closePC(this.hostId);
    this.pcs.set(this.hostId, pc);
    this._iceToSig(pc, HOST_TAG);
    let chan = null;
    try {
      chan = pc.createDataChannel('game');
    } catch (e) {
      throw new Error('host unreachable');
    }
    const conn = new RawConn(this.hostId, pc, chan);
    this._emit({ type: 'conn-state', id: this.hostId, state: 'searching' });
    const opened = new Promise((resolve, reject) => {
      let done = false;
      const finish = (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };
      const timer = setTimeout(() => {
        try { conn.close(); } catch (e) { /* 무시 */ }
        finish(new Error('host unreachable'));
      }, 15000);
      conn.on('open', () => {
        this.conns.set(this.hostId, conn);
        this._wireConn(conn, this.hostId);
        try {
          const hello = { t: 'hello', carId: this.myCarId };
          if (re) hello.re = re;
          conn.send(hello);
        } catch (e) { /* 무시 */ }
        finish(null);
      });
      conn.on('error', () => finish(new Error('host unreachable')));
      conn.on('close', () => finish(new Error('host unreachable')));
    });
    this._offSig = this.sig.onSignal((msg) => {
      if (msg.to !== this.sig.sid || msg.from !== HOST_TAG) return;
      try {
        if (msg.kind === 'answer' && msg.sdp) {
          pc.setRemoteDescription(new RTCSessionDescription(msg.sdp)).catch(() => {});
        } else if (msg.kind === 'ice' && msg.candidate) {
          pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
        }
      } catch (e) { /* 무시 */ }
    });
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sig.send(HOST_TAG, 'offer', { sdp: pc.localDescription });
    } catch (e) {
      throw new Error('host unreachable');
    }
    await opened;
    if (re) this.joinedAs = this.myId;
  }

  _wireConn(conn, peerId) {
    conn.on('data', (msg) => this._onData(peerId, msg));
    conn.on('close', () => this._onClose(peerId));
    conn.on('error', () => this._onClose(peerId));
    // 게스트: 네트워크 변경 등으로 끊기면 4초 후 재접속 (이전 id 인계)
    try {
      const pcx = conn.peerConnection;
      if (pcx && !this.isHost) {
        let rt = null;
        pcx.addEventListener('connectionstatechange', () => {
          try {
            const st = pcx.connectionState;
            if (st === 'failed' || st === 'disconnected' || st === 'closed') {
              if (!rt) {
                rt = setTimeout(() => {
                  rt = null;
                  try { this._onReopen(); } catch (e) { /* 무시 */ }
                }, 4000);
              }
            } else if (st === 'connected') {
              if (rt) { clearTimeout(rt); rt = null; }
            }
          } catch (e) { /* 무시 */ }
        });
      }
    } catch (e) { /* 무시 */ }
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
    this.myId = 'H' + this.code;
    try {
      this.rtcConfig = await resolveRTCConfig();
    } catch (e) {
      this.rtcConfig = RTC_CONFIG;
    }
    this.sig = new MqttSig(this.mqttFactory);
    await this.sig.open(this.code);
    this.sig.sid = HOST_TAG; // 호스트 수신 태그 고정 (게스트 offer의 to와 일치)
    await this.sig.publishAlive();
    try {
      if (this.aliveTimer) clearInterval(this.aliveTimer);
    } catch (e) { /* 무시 */ }
    this.aliveTimer = setInterval(() => {
      try { if (this.sig) this.sig.publishAlive(); } catch (e) { /* 무시 */ }
    }, 30000);
    this.players = [{ id: this.myId, carId: this.myCarId }];
    this.phase = 'lobby';
    this._offSig = this.sig.onSignal((msg) => this._onHostSignal(msg));
    return this.code;
  }

  _onHostSignal(msg) {
    if (!this.isHost || msg.to !== HOST_TAG) return;
    const guestId = msg.from;
    try {
      if (msg.kind === 'ice' && msg.candidate) {
        const pc = this.pcs.get(guestId);
        if (pc) pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
        return;
      }
      if (msg.kind !== 'offer' || !msg.sdp) return;
      const deny = this.phase !== 'lobby' || this.players.length >= this.maxPlayers;
      this._closePC(guestId);
      const pc = this._newPC();
      this.pcs.set(guestId, pc);
      this._iceToSig(pc, guestId);
      try {
        pc.ondatachannel = (ev) => {
          const conn = new RawConn(guestId, pc, ev.channel);
          conn.on('open', () => {
            this.conns.set(guestId, conn);
            this._wireConn(conn, guestId);
            if (deny) {
              try { conn.send({ t: 'deny' }); } catch (e) { /* 무시 */ }
              setTimeout(() => { try { conn.close(); } catch (e) { /* 무시 */ } }, 300);
            }
          });
        };
      } catch (e) { /* 무시 */ }
      pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
        .then(() => pc.createAnswer())
        .then((ans) => pc.setLocalDescription(ans))
        .then(() => {
          if (this.sig) this.sig.send(guestId, 'answer', { sdp: pc.localDescription });
        })
        .catch(() => {
          this._closePC(guestId);
        });
    } catch (e) { /* 무시 */ }
  }

  async joinRoom(code, myCarId) {
    this.destroy();
    this.isHost = false;
    this.code = code.trim().toUpperCase();
    this.hostId = 'H' + this.code;
    this.myCarId = myCarId;
    const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let g = 'G';
    for (let i = 0; i < 7; i++) g += abc[Math.floor(Math.random() * abc.length)];
    this.myId = g;
    // 방 존재 확인 (없으면 즉시 실패 — 15초 대기 없음)
    let found = null;
    try {
      found = await checkRoom(this.mqttFactory, this.code);
    } catch (e) {
      found = { found: false, error: true };
    }
    if (!found || !found.found) {
      if (found && found.error) throw new Error('relay unreachable');
      throw new Error('room not found');
    }
    try {
      this.rtcConfig = await resolveRTCConfig();
    } catch (e) {
      this.rtcConfig = RTC_CONFIG;
    }
    this.sig = new MqttSig(this.mqttFactory);
    try {
      await this.sig.open(this.code);
    } catch (e) {
      throw new Error('relay unreachable');
    }
    this.joinedAs = this.myId;
    this.phase = 'lobby';
    await this._guestConnect(null);
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
    const items = this.itemsOn !== false;
    const msg = { t: 'lobby', players: this.players, trackId: this.trackId, items };
    for (const [, c] of this.conns) {
      try { c.send(msg); } catch (e) { /* 무시 */ }
    }
    this._emit({ type: 'lobby', players: this.players, trackId: this.trackId, items });
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
      for (const [, pc] of this.pcs) {
        try { pc.close(); } catch (e) { /* 무시 */ }
      }
    } catch (e) { /* 무시 */ }
    this.pcs.clear();
    try {
      if (this.aliveTimer) clearInterval(this.aliveTimer);
    } catch (e) { /* 무시 */ }
    this.aliveTimer = null;
    if (this._offSig) {
      try { this._offSig(); } catch (e) { /* 무시 */ }
      this._offSig = null;
    }
    try {
      if (this.sig) {
        const s = this.sig;
        if (this.isHost) {
          try { s.clearAlive(); } catch (e) { /* 무시 */ }
        }
        // clear 전송이 브로커에 닿도록 지연 종료 (유령방 방지)
        setTimeout(() => { try { s.close(); } catch (e) { /* 무시 */ } }, 800);
      }
    } catch (e) { /* 무시 */ }
    this.sig = null;
    this.players = [];
    this.phase = 'idle';
    this.isHost = false;
  }
}
