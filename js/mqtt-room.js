// 중계 서버(MQTT) 기반 온라인 룸 — 호스트 권위 구조
// - 방 목록( retained 공지 ), 코드 입력 없음, 방 생성 시 인원수 지정
// - 호스트가 전체 시뮬(물리·충돌·아이템)을 돌리고 20Hz 브로드캐스트 → 전원 동일 화면
// - 게스트는 입력만 전송 + 자기 차 예측 렌더
// mqttFactory: (url, opts) => client
//   client: on('connect'|'message'|'error'|'close'), subscribe(topic), publish(topic, str, {retain}), end()
import { RELAY, FALLBACK_RELAYS, ROOM_PREFIX } from './relay-config.js';

export const STATE_HZ = 20;

function randCode() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}
function randId(pfx) {
  return pfx + Math.random().toString(36).slice(2, 10);
}

function relayList() {
  const list = [];
  if (RELAY.url) {
    list.push({ url: RELAY.url, username: RELAY.username || undefined, password: RELAY.password || undefined, label: 'private' });
  }
  for (const r of FALLBACK_RELAYS) list.push({ ...r, label: 'public' });
  return list;
}

export async function connectRelay(mqttFactory, roomChannel) {
  let lastErr = null;
  for (const r of relayList()) {
    try {
      const client = await new Promise((resolve, reject) => {
        const c = mqttFactory(r.url, {
          clientId: randId('br-'),
          clean: true,
          connectTimeout: 6000,
          reconnectPeriod: 0,
          username: r.username,
          password: r.password,
          will: roomChannel
            ? { topic: roomChannel, payload: JSON.stringify({ t: 'bye', from: '?' }), retain: false }
            : undefined,
        });
        const to = setTimeout(() => reject(new Error('relay timeout: ' + r.url)), 8000);
        c.on('connect', () => {
          clearTimeout(to);
          resolve(c);
        });
        c.on('error', (e) => {
          clearTimeout(to);
          reject(e || new Error('relay error'));
        });
      });
      return { client, relay: r };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('no relay reachable');
}

export class MqttRoom {
  constructor(mqttFactory) {
    this.mqttFactory = mqttFactory;
    this.client = null;    this.isHost = false;
    this.code = null;
    this.roomChannel = null;
    this.myId = null;
    this.hostId = null;
    this.maxPlayers = 4;
    this.players = [];
    this.trackId = null;
    this.itemsOn = true;
    this.myCarId = null;
    this.remoteInputs = new Map(); // guestId -> {input, at} (host 측)
    this.lastHb = new Map(); // id -> ts
    this.onEvent = () => {};
    this.phase = 'idle';
    this.hbTimer = 0;
    this.relayLabel = '';
  }

  _emit(ev) {
    try {
      this.onEvent(ev);
    } catch (e) {
      console.error('[mqtt-room]', e);
    }
  }

  _chan(code) {
    return `${ROOM_PREFIX}room/${code}`;
  }

  _send(obj) {
    if (!this.client || !this.roomChannel) return;
    try {
      if (obj.from === undefined) obj.from = this.myId;
      this.client.publish(this.roomChannel, JSON.stringify(obj), { qos: 0 });
    } catch (e) { /* 무시 */ }
  }

  _wire() {
    this.client.on('message', (topic, payload) => {
      let msg;
      try {
        msg = JSON.parse(payload.toString());
      } catch (e) {
        return;
      }
      this._onMsg(msg);
    });
    this.client.on('error', () => {});
    this.client.on('close', () => {
      if (this.phase !== 'idle') this._emit({ type: 'net-down' });
    });
  }

  _hbLoop() {
    clearInterval(this.hbTimer);
    this.hbTimer = setInterval(() => {
      if (this.phase === 'idle') return;
      this._send({ t: 'hb', from: this.myId });
      const now = Date.now();
      if (this.isHost) {
        // 응답 없는 게스트 정리
        let changed = false;
        for (const [id, at] of this.lastHb) {
          if (id !== this.myId && now - at > 10000) {
            this.lastHb.delete(id);
            this.remoteInputs.delete(id);
            const before = this.players.length;
            this.players = this.players.filter((p) => p.id !== id);
            if (this.players.length !== before) changed = true;
            this._emit({ type: 'peer-left', id });
          }
        }
        if (changed) {
          if (this.phase === 'lobby') this.broadcastLobby();
        }
      } else if (this.hostId) {
        const at = this.lastHb.get(this.hostId) || 0;
        if (at > 0 && now - at > 12000) {
          this._emit({ type: 'host-left' });
        }
      }
    }, 3000);
  }

  _onMsg(msg) {
    if (!msg || typeof msg.t !== 'string') return;
    if (msg.from === this.myId) return; // 자기 메아리 무시
    if (msg.t === 'hb') {
      this.lastHb.set(msg.from, Date.now());
      return;
    }
    if (msg.t === 'bye') {
      this.lastHb.delete(msg.from);
      this.remoteInputs.delete(msg.from);
      if (this.isHost) {
        const before = this.players.length;
        this.players = this.players.filter((p) => p.id !== msg.from);
        if (this.players.length !== before) {
          if (this.phase === 'lobby') this.broadcastLobby();
          else this._emit({ type: 'peer-left', id: msg.from });
        }
      } else if (msg.from === this.hostId) {
        this._emit({ type: 'host-left' });
      } else {
        this._emit({ type: 'peer-left', id: msg.from });
      }
      return;
    }
    if (this.isHost) {
      if (msg.t === 'hello') {
        if (this.phase !== 'lobby') {
          this._send({ t: 'deny', to: msg.from });
          return;
        }
        let p = this.players.find((x) => x.id === msg.from);
        if (!p) {
          if (this.players.length >= this.maxPlayers) {
            this._send({ t: 'deny', to: msg.from });
            return;
          }
          p = { id: msg.from, carId: msg.carId };
          this.players.push(p);
        } else {
          p.carId = msg.carId;
        }
        this.lastHb.set(msg.from, Date.now());
        this.broadcastLobby();
      } else if (msg.t === 'car') {
        const p = this.players.find((x) => x.id === msg.from);
        if (p) {
          p.carId = msg.carId;
          if (this.phase === 'lobby') this.broadcastLobby();
        }
      } else if (msg.t === 'input') {
        this.remoteInputs.set(msg.from, { input: msg.input, at: Date.now() });
      } else if (msg.t === 'req-restart') {
        this._emit({ type: 'restart-req', id: msg.from });
      } else if (msg.t === 'ping') {
        this._send({ t: 'pong', to: msg.from, t0: msg.t0 });
      }
    } else {
      if (msg.t === 'lobby') {
        this.players = msg.players;
        this.itemsOn = msg.items !== false;
        this.trackId = msg.trackId;
        if (msg.host) {
          this.hostId = msg.host;
          this.lastHb.set(msg.host, Date.now());
        }
        if (this._lobbyWait) {
          const w = this._lobbyWait;
          this._lobbyWait = null;
          w(true);
        }
        this._emit({ type: 'lobby', players: this.players, trackId: msg.trackId, items: msg.items });
      } else if (msg.t === 'start') {
        this.phase = 'racing';
        this._emit({ type: 'start', trackId: msg.trackId, players: msg.players, ai: msg.ai, items: msg.items });
      } else if (msg.t === 'state') {
        this._emit({ type: 'state', cars: msg.cars, mines: msg.mines, boxes: msg.boxes, players: msg.players });
      } else if (msg.t === 'deny') {
        if (!msg.to || msg.to === this.myId) {
          this._emit({ type: 'error', msg: '참가 거부됨 (인원 초과 또는 경주 중)' });
        }
      } else if (msg.t === 'pong') {
        if (!msg.to || msg.to === this.myId) {
          this._emit({ type: 'pong', rtt: Date.now() - msg.t0 });
        }
      }
    }
  }

  // ---- 방 목록 ----
  static async listRooms(mqttFactory, onUpdate, waitMs = 2500) {
    const { client } = await connectRelay(mqttFactory, null);
    const rooms = new Map();
    const push = () => {
      const now = Date.now();
      const list = [];
      for (const [code, r] of rooms) {
        if (now - r.ts < 12000 && !r.started) list.push(r);
      }
      onUpdate(list);
    };
    client.on('message', (topic, payload) => {
      try {
        const msg = JSON.parse(payload.toString());
        if (msg && msg.code) {
          rooms.set(msg.code, msg);
          push();
        }
      } catch (e) { /* 무시 */ }
    });
    await client.subscribe(`${ROOM_PREFIX}rooms/+`);
    const timer = setInterval(push, 1000);
    setTimeout(() => onUpdate && push(), waitMs);
    return {
      refresh() {
        rooms.clear();
      },
      stop() {
        clearInterval(timer);
        try { client.end(); } catch (e) { /* 무시 */ }
      },
    };
  }

  // ---- 호스트 ----
  async hostRoom({ maxPlayers, trackId, carId, itemsOn }) {
    this.destroy();
    const { client, relay } = await connectRelay(this.mqttFactory, `${ROOM_PREFIX}room/TMP`);
    this.client = client;
    this.relayLabel = relay.label || '';
    this.isHost = true;
    this.code = randCode();
    this.roomChannel = this._chan(this.code);
    this.myId = 'h-' + randCode() + randCode();
    this.maxPlayers = maxPlayers || 4;
    this.trackId = trackId;
    this.itemsOn = itemsOn !== false;
    this.myCarId = carId;
    this.players = [{ id: this.myId, carId }];
    this.phase = 'lobby';
    this._wire();
    await this.client.subscribe(this.roomChannel);
    this.lastHb.set(this.myId, Date.now());
    this._hbLoop();
    this._announce(false);
    this._announceTimer = setInterval(() => {
      if (this.phase === 'lobby') this._announce(false);
    }, 3000);
    return this.code;
  }

  _announce(started) {
    if (!this.client) return;
    try {
      this.client.publish(
        `${ROOM_PREFIX}rooms/${this.code}`,
        JSON.stringify({
          code: this.code, track: this.trackId, items: this.itemsOn,
          players: this.players.length, max: this.maxPlayers,
          started: !!started, ts: Date.now(),
        }),
        { qos: 0, retain: true }
      );
    } catch (e) { /* 무시 */ }
  }

  _unannounce() {
    if (!this.client || !this.code) return;
    try {
      this.client.publish(`${ROOM_PREFIX}rooms/${this.code}`, '', { qos: 0, retain: true });
    } catch (e) { /* 무시 */ }
  }

  // ---- 게스트 ----
  async joinRoom(roomInfo, carId) {
    this.destroy();
    const { client, relay } = await connectRelay(this.mqttFactory, `${ROOM_PREFIX}room/${roomInfo.code}`);
    this.client = client;
    this.relayLabel = relay.label || '';
    this.isHost = false;
    this.code = roomInfo.code;
    this.roomChannel = this._chan(this.code);
    this.myId = 'g-' + randCode() + randCode();
    this.hostId = null; // lobby 메시지로 확정 (첫 번째 발신자)
    this.myCarId = carId;
    this.phase = 'lobby';
    this._wire();
    await this.client.subscribe(this.roomChannel);
    // 호스트 판별: lobby 메시지의 host 필드 (첫 수신까지 최대 9초 대기)
    const gotLobby = await new Promise((resolve) => {
      const to = setTimeout(() => resolve(false), 9000);
      this._lobbyWait = (ok) => {
        clearTimeout(to);
        resolve(ok);
      };
      this._send({ t: 'hello', carId });
    });
    if (!gotLobby) throw new Error('no-host');
    this._hbLoop();
    return true;
  }

  setMyCar(carId) {
    this.myCarId = carId;
    if (this.isHost) {
      const me = this.players.find((p) => p.id === this.myId);
      if (me) me.carId = carId;
      if (this.phase === 'lobby') this.broadcastLobby();
    } else {
      this._send({ t: 'car', from: this.myId, carId });
    }
  }

  setTrack(trackId) {
    this.trackId = trackId;
    if (this.isHost && this.phase === 'lobby') this.broadcastLobby();
  }

  broadcastLobby() {
    if (!this.isHost) return;
    this._send({
      t: 'lobby', host: this.myId, players: this.players, trackId: this.trackId,
      items: this.itemsOn !== false, max: this.maxPlayers,
    });
    this._emit({ type: 'lobby', players: this.players, trackId: this.trackId, items: this.itemsOn });
  }

  startRace(aiCarIds, itemsOn) {
    if (!this.isHost) return null;
    this.phase = 'racing';
    if (itemsOn !== undefined) this.itemsOn = itemsOn;
    const msg = {
      t: 'start', trackId: this.trackId, players: this.players,
      ai: aiCarIds, items: this.itemsOn !== false,
    };
    this._send(msg);
    this._announce(true); // 목록에서 숨김
    return msg;
  }

  sendState(cars, mines, boxes, players) {
    if (!this.isHost) return;
    this._send({ t: 'state', cars, mines, boxes, players });
  }

  sendInput(input) {
    if (this.isHost) return;
    this._send({ t: 'input', from: this.myId, input });
  }

  pingHost() {
    if (this.isHost) return;
    this._send({ t: 'ping', from: this.myId, t0: Date.now() });
  }

  requestRestart() {
    if (this.isHost) return;
    this._send({ t: 'req-restart', from: this.myId });
  }

  quitRace() {
    // 방 완전 퇴장 (로비 복귀가 아니라 홈으로)
    this._send({ t: 'bye', from: this.myId });
    this.destroy();
  }

  destroy() {
    try {
      if (this.isHost) this._unannounce();
      if (this.phase !== 'idle') this._send({ t: 'bye', from: this.myId });
    } catch (e) { /* 무시 */ }
    clearInterval(this.hbTimer);
    clearInterval(this._announceTimer);
    try {
      if (this.client) this.client.end();
    } catch (e) { /* 무시 */ }
    this.client = null;
    this.players = [];
    this.remoteInputs.clear();
    this.lastHb.clear();
    this.phase = 'idle';
    this.isHost = false;
    this.code = null;
  }
}
