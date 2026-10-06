// MQTT 시그널링: WebRTC offer/answer/ICE를 동작 확인된 MQTT 브로커로 교환
// ※ PeerJS 클라우드(0.peerjs.com)가 일부 망·Safari에서 하트비트 사망하므로 자체 시그널링으로 대체
// 토픽: blockyracer/v1/sig/<CODE> (offer/answer/ice, to로 수신자 지정)
//       blockyracer/v1/room/<CODE> (호스트 생존 retained: {alive:1, ts})
import { RELAY, ROOM_PREFIX } from './relay-config.js?v=4fdd2d';

export const HOST_TAG = 'HOST';
export const sigTopic = (code) => `${ROOM_PREFIX}sig/${code}`;
export const roomTopic = (code) => `${ROOM_PREFIX}room/${code}`;
// 호스트가 죽은 뒤 남는 retained를 유령방으로 오인하지 않기 위한 유효기간
export const ALIVE_TTL_MS = 90000;

function rand(n) {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < n; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

export class MqttSig {
  constructor(mqttFactory) {
    this.mqttFactory = mqttFactory;
    this.client = null;
    this.code = null;
    this.sid = 'S' + rand(7);
    this.handlers = new Set();
  }

  onSignal(fn) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  _emit(msg) {
    for (const fn of [...this.handlers]) {
      try { fn(msg); } catch (e) { /* 무시 */ }
    }
  }

  async open(code) {
    this.code = code;
    const url = RELAY.url;
    const opts = {
      clientId: 'sg' + Math.random().toString(36).slice(2, 10),
      username: RELAY.username,
      password: RELAY.password,
      reconnectPeriod: 4000,
      connectTimeout: 8000,
    };
    let c;
    try {
      c = this.mqttFactory(url, opts);
    } catch (e) {
      throw new Error('relay unreachable');
    }
    this.client = c;
    await new Promise((resolve, reject) => {
      let done = false;
      const ok = () => { if (!done) { done = true; resolve(); } };
      const fail = () => { if (!done) { done = true; reject(new Error('relay unreachable')); } };
      try {
        c.on('connect', ok);
        c.on('error', fail);
      } catch (e) { fail(); }
      setTimeout(fail, 9000);
    });
    try {
      c.on('message', (t, payload) => this._onMessage(t, payload));
      c.on('error', () => {});
    } catch (e) { /* 무시 */ }
    await new Promise((resolve) => {
      try {
        const r = c.subscribe(sigTopic(code));
        if (r && typeof r.then === 'function') r.then(() => resolve(true)).catch(() => resolve(false));
        else resolve(true);
      } catch (e) {
        resolve(false);
      }
    });
    return this.sid;
  }

  _onMessage(topic, payload) {
    try {
      if (topic !== sigTopic(this.code)) return;
      const msg = JSON.parse(payload.toString());
      if (!msg || msg.to !== this.sid) return;
      if (!msg.from || typeof msg.kind !== 'string') return;
      this._emit(msg);
    } catch (e) { /* 무시 */ }
  }

  send(to, kind, data) {
    if (!this.client) return false;
    try {
      const env = Object.assign({ from: this.sid, to, kind }, data || {});
      this.client.publish(sigTopic(this.code), JSON.stringify(env), { qos: 1, retain: false });
      return true;
    } catch (e) {
      return false;
    }
  }

  async publishAlive(name) {
    if (!this.client) return false;
    return new Promise((resolve) => {
      try {
        const payload = JSON.stringify({ alive: 1, ts: Date.now(), name: name || null });
        this.client.publish(roomTopic(this.code), payload, { qos: 1, retain: true }, () => resolve(true));
        setTimeout(() => resolve(true), 3000);
      } catch (e) {
        resolve(false);
      }
    });
  }

  async clearAlive() {
    if (!this.client) return;
    try {
      this.client.publish(roomTopic(this.code), '', { qos: 1, retain: true });
    } catch (e) { /* 무시 */ }
  }

  close() {
    try {
      if (this.client) this.client.end(true);
    } catch (e) { /* 무시 */ }
    this.client = null;
    this.handlers.clear();
  }
}

// 방 존재 확인 (1회성): retained alive가 있고 신선하면 found
export async function checkRoom(mqttFactory, code, timeoutMs) {
  const wait = timeoutMs || 3500;
  let c = null;
  try {
    c = mqttFactory(RELAY.url, {
      clientId: 'ck' + Math.random().toString(36).slice(2, 10),
      username: RELAY.username,
      password: RELAY.password,
      reconnectPeriod: 0,
      connectTimeout: 8000,
    });
  } catch (e) {
    return { found: false, error: true };
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      try { c.end(true); } catch (e) { /* 무시 */ }
      resolve(r);
    };
    const timer = setTimeout(() => finish({ found: false }), wait);
    try {
      c.on('connect', () => {
        try { c.subscribe(roomTopic(code)); } catch (e) { /* 무시 */ }
      });
      c.on('message', (t, payload) => {
        if (t !== roomTopic(code)) return;
        try {
          const s = payload.toString();
          if (!s) {
            clearTimeout(timer);
            finish({ found: false });
            return;
          }
          const msg = JSON.parse(s);
          if (msg && msg.alive === 1 && typeof msg.ts === 'number') {
            clearTimeout(timer);
            if (Date.now() - msg.ts < ALIVE_TTL_MS) finish({ found: true, ts: msg.ts });
            else finish({ found: false, stale: true });
          }
        } catch (e) { /* 무시 */ }
      });
      c.on('error', () => {
        clearTimeout(timer);
        finish({ found: false, error: true });
      });
    } catch (e) {
      clearTimeout(timer);
      finish({ found: false, error: true });
    }
  });
}
