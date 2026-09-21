// P2P 온라인 (WebRTC DataChannel, PeerJS=시그널링 only)
// 경주 데이터는 브라우저끼리 직접 교환. transport 주입식이라 node 테스트 가능.
//
// 메시지 규격:
//  guest→host: {t:'hello', carId} / {t:'car', carId}
//  host→all : {t:'lobby', players:[{id,carId}], trackId}
//  host→all : {t:'start', trackId, players:[{id,carId}], ai:[carId]}
//  any→all  : {t:'state', cars:[스냅샷...]} (host=전 차량, guest=자기 차)
//  host→guest: {t:'deny'}

export const ROOM_PREFIX = 'blockyracer-v1-';
export const STATE_HZ = 15;

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

// 온라인 그리드 배치 (순수 함수 → 테스트 가능)
// 반환: [{slot, carId, local, isMine, isAI, peerId}]
// ※ 내 슬롯이 없으면 0번을 로컬로 강제 (전체 CPU/동결 방지)
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
      const peer = this.peerFactory(id);
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
          this._emit({ type: 'error', msg: '방 코드를 확인해주세요.' });
        } else if (type === 'network' || type === 'server-error' || type === 'socket-error') {
          this._emit({ type: 'error', msg: '시그널링 서버 연결 실패. 인터넷을 확인해주세요.' });
        }
      });
      peer.on('disconnected', () => {
        try { peer.reconnect(); } catch (e) { /* 무시 */ }
      });
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
  }

  async hostRoom() {
    this.destroy();
    this.isHost = true;
    this.code = randCode();
    await this._newPeer(ROOM_PREFIX + this.code);
    this.players = [{ id: this.myId, carId: null }];
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
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('host unreachable')), 30000);
      conn.on('open', () => {
        clearTimeout(timer);
        this.conns.set(this.hostId, conn);
        this._wireConn(conn, this.hostId);
        try { conn.send({ t: 'hello', carId: myCarId }); } catch (e) { /* 무시 */ }
        resolve();
      });
      conn.on('error', () => {
        clearTimeout(timer);
        reject(new Error('host unreachable'));
      });
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
      if (msg.t === 'hello' || msg.t === 'car') {
        // 재접속 인계: 이전 id의 슬롯을 새 id로 교체 (중복 참가 방지)
        if (msg.re) {
          const old = this.players.find((x) => x.id === msg.re);
          if (old) old.id = peerId;
          this.conns.delete(msg.re);
        }
        let p = this.players.find((x) => x.id === peerId);
        if (!p) {
          if (this.players.length >= 4) return; // 만원
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
        this._emit({ type: 'start', trackId: msg.trackId, players: msg.players, ai: msg.ai });
      } else if (msg.t === 'state') {
        this._emit({ type: 'state', from: msg.from || peerId, cars: msg.cars });
      } else if (msg.t === 'deny') {
        this._emit({ type: 'error', msg: '이미 경주 중인 방입니다.' });
      } else if (msg.t === 'pong') {
        this._emit({ type: 'pong', rtt: Date.now() - msg.t0 });
      } else if (msg.t === 'mine' || msg.t === 'minehit' || msg.t === 'shock') {
        this._emit({ type: 'game', msg });
      }
    }
    if (msg.t === 'state' && this.isHost) {
      // host도 guest 상태를 받음 + 다른 게스트에게 중계 (스타 토폴로지)
      this._emit({ type: 'state', from: peerId, cars: msg.cars });
      for (const [id, c] of this.conns) {
        if (id === peerId) continue;
        try { c.send({ t: 'state', from: peerId, cars: msg.cars }); } catch (e) { /* 무시 */ }
      }
      return;
    }
    // 게임 이벤트 중계 (지뢰·쇼크): 발신자 제외 전원에게
    if (this.isHost && (msg.t === 'mine' || msg.t === 'minehit' || msg.t === 'shock')) {
      this._emit({ type: 'game', msg });
      for (const [id, c] of this.conns) {
        if (id === peerId) continue;
        try { c.send(msg); } catch (e) { /* 무시 */ }
      }
    }
  }

  _onClose(peerId) {
    this.conns.delete(peerId);
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

  sendState(cars) {
    const msg = { t: 'state', cars };
    for (const [, c] of this.conns) {
      try { c.send(msg); } catch (e) { /* 무시 */ }
    }
  }

  sendToHost(cars) {
    const c = this.conns.get(this.hostId);
    if (c) {
      try { c.send({ t: 'state', cars }); } catch (e) { /* 무시 */ }
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

  // 게임 이벤트 (지뢰·쇼크): host=브로드캐스트+로컬 반영, guest=호스트 경유
  sendGameEvent(msg) {
    if (this.isHost) {
      this._emit({ type: 'game', msg: { ...msg, from: this.myId } });
      for (const [, c] of this.conns) {
        try { c.send(msg); } catch (e) { /* 무시 */ }
      }
    } else {
      const c = this.conns.get(this.hostId);
      if (c) {
        try { c.send({ ...msg, from: this.myId }); } catch (e) { /* 무시 */ }
      }
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
    try {
      if (this.peer) this.peer.destroy();
    } catch (e) { /* 무시 */ }
    this.peer = null;
    this.players = [];
    this.phase = 'idle';
    this.isHost = false;
  }
}
