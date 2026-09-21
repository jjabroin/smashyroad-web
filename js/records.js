// 공유 타임어택 순위표 — 중계 브로커 retained 토픽에 저장
// records/{trackId} = {list: [{total, best, car, tag, date}]} (최대 5개)
// 오프라인이면 로컬 기록으로 폴백. 동시 발행 충돌은 last-write-wins.
import { RELAY, PUBLIC_RELAY, ROOM_PREFIX } from './relay-config.js';

const TAG_KEY = 'blockyracer-tag-v1';

export function getRacerTag() {
  try {
    if (typeof localStorage === 'undefined') return 'GUEST';
    let t = localStorage.getItem(TAG_KEY);
    if (!t) {
      t = 'R' + Math.random().toString(36).slice(2, 6).toUpperCase();
      localStorage.setItem(TAG_KEY, t);
    }
    return t;
  } catch (e) {
    return 'GUEST';
  }
}

function activeRelay() {
  if (RELAY.url) {
    return {
      url: RELAY.url,
      username: RELAY.username || undefined,
      password: RELAY.password || undefined,
    };
  }
  return PUBLIC_RELAY;
}

export class RecordsBoard {
  constructor(mqttFactory) {
    this.mqttFactory = mqttFactory;
    this.client = null;
    this.cache = {}; // trackId -> list
    this.onUpdate = null; // (trackId) => {}
    this.connected = false;
  }

  topic(trackId) {
    return `${ROOM_PREFIX}records/${trackId}`;
  }

  async connect() {
    if (this.client) return;
    const r = activeRelay();
    const client = await new Promise((resolve, reject) => {
      let c;
      try {
        c = this.mqttFactory(r.url, {
          clientId: 'br-rec-' + Math.random().toString(36).slice(2, 10),
          clean: true,
          connectTimeout: 6000,
          reconnectPeriod: 5000,
          username: r.username,
          password: r.password,
        });
      } catch (e) {
        reject(e);
        return;
      }
      const to = setTimeout(() => reject(new Error('records timeout')), 9000);
      c.on('connect', () => {
        clearTimeout(to);
        resolve(c);
      });
      c.on('error', (e) => {
        clearTimeout(to);
        reject(e || new Error('records error'));
      });
    });
    this.client = client;
    this.connected = true;
    client.on('message', (topic, payload) => {
      try {
        const msg = JSON.parse(payload.toString());
        if (msg && msg.trackId && Array.isArray(msg.list)) {
          this.cache[msg.trackId] = msg.list.slice(0, 5);
          if (this.onUpdate) {
            try { this.onUpdate(msg.trackId); } catch (e) { /* 무시 */ }
          }
        }
      } catch (e) { /* 무시 */ }
    });
    client.on('close', () => {
      this.connected = false;
    });
    await client.subscribe(`${ROOM_PREFIX}records/+`);
  }

  get(trackId) {
    return this.cache[trackId] || null;
  }

  async publish(trackId, entry) {
    // 캐시 병합 후 TOP5 retained 발행
    const cur = (this.cache[trackId] || []).slice();
    cur.push(entry);
    cur.sort((a, b) => a.total - b.total);
    const top = cur.slice(0, 5);
    if (!top.includes(entry)) return top.indexOf(entry); // 순위 밖이면 발행 안 함
    this.cache[trackId] = top;
    if (!this.client) {
      try { await this.connect(); } catch (e) { return top.indexOf(entry); }
    }
    try {
      this.client.publish(
        this.topic(trackId),
        JSON.stringify({ trackId, list: top }),
        { qos: 0, retain: true }
      );
    } catch (e) { /* 오프라인이면 로컬만 */ }
    return top.indexOf(entry);
  }
}
