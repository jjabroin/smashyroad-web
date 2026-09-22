// 공유 타임어택 순위표 — 중계 브로커 retained 토픽에 저장
// records/{trackId} = {list: [{total, best, car, tag, date}]} (최대 5개)
// 오프라인이면 로컬 기록으로 폴백. 동시 발행 충돌은 last-write-wins.
import { RELAY, PUBLIC_RELAY, ROOM_PREFIX } from './relay-config.js?v=8';

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
    this.onStatus = null; // (connected:boolean) => {}
    this.connected = false;
  }

  topic(trackId) {
    return `${ROOM_PREFIX}records/${trackId}`;
  }

  async connect() {
    if (this.client) return;
    this._setStatus('off');
    const r = activeRelay();
    const cid = 'br-rec-' + Math.random().toString(36).slice(2, 10);
    const client = await new Promise((resolve, reject) => {
      let c;
      try {
        c = this.mqttFactory(r.url, {
          clientId: cid,
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
    this._cid = cid;
    this.connected = true;
    client.on('message', (topic, payload) => {
      if (topic === `${ROOM_PREFIX}loop/${cid}`) {
        this._loopOk = true;
        return;
      }
      try {
        const msg = JSON.parse(payload.toString());
        if (msg && msg.trackId && Array.isArray(msg.list)) {
          // 오염 데이터 방어: total 숫자 + car 문자열만 유지
          const clean = msg.list.filter(
            (e) => e && typeof e.total === 'number' && isFinite(e.total) && typeof e.car === 'string'
          );
          this.cache[msg.trackId] = clean.slice(0, 5);
          if (this.onUpdate) {
            try { this.onUpdate(msg.trackId); } catch (e) { /* 무시 */ }
          }
        }
      } catch (e) { /* 무시 */ }
    });
    client.on('close', () => {
      this.connected = false;
      this.client = null;
      this._verified = false;
      this._setStatus('off');
    });
    try {
      await client.subscribe(`${ROOM_PREFIX}records/+`);
    } catch (e) {
      this._setStatus('off');
      throw e;
    }
    // 루프백 검증: 발행+구독이 모두 통해야 진짜 공유 중
    this._setStatus('conn');
    const ok = await this._loopback();
    this._verified = ok;
    this._setStatus(ok ? 'ok' : 'conn');
    if (!ok) throw new Error('loopback failed');
  }

  _setStatus(st) {
    this._status = st;
    if (this.onStatus) {
      try { this.onStatus(st); } catch (e) { /* 무시 */ }
    }
  }

  _loopback() {
    return new Promise((resolve) => {
      const topic = `${ROOM_PREFIX}loop/${this._cid}`;
      const done = (v) => {
        try { this.client.removeListener('message', handler); } catch (e) { /* 무시 */ }
        resolve(v);
      };
      const to = setTimeout(() => done(false), 4000);
      const handler = (t) => {
        if (t !== topic) return;
        clearTimeout(to);
        done(true);
      };
      try {
        this.client.on('message', handler);
        this.client.subscribe(topic).then(() => {
          try {
            this.client.publish(topic, JSON.stringify({ t: 'ping' }), { qos: 0 });
          } catch (e) {
            clearTimeout(to);
            done(false);
          }
        }).catch(() => {
          clearTimeout(to);
          done(false);
        });
      } catch (e) {
        clearTimeout(to);
        done(false);
      }
    });
  }

  // 미동기화 로컬 기록을 공유 보드에 올림 (순위표 열 때 호출)
  // 로컬 TOP 중 공유 보드에 없는 것을 병합 발행
  async flushPending(getLocal) {
    if (!this.client) {
      try { await this.connect(); } catch (e) { return false; }
    }
    try {
      const tracks = await getLocal();
      for (const trackId of Object.keys(tracks)) {
        const shared = (this.cache[trackId] || []).slice();
        let changed = false;
        for (const e of tracks[trackId] || []) {
          const dup = shared.some(
            (s) => s.tag === e.tag && s.total === e.total && s.date === e.date
          );
          if (!dup) {
            const slim = { ...e };
            delete slim.trail;
            shared.push(slim);
            changed = true;
          }
        }
        if (changed) {
          shared.sort((a, b) => a.total - b.total);
          const top = shared.slice(0, 5);
          this.cache[trackId] = top;
          this.client.publish(
            this.topic(trackId),
            JSON.stringify({ trackId, list: top }),
            { qos: 0, retain: true }
          );
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  get(trackId) {
    return this.cache[trackId] || null;
  }

  // retained 재전송 요청 (순위표 열 때 최신으로)
  async resync() {
    if (!this.client) {
      try { await this.connect(); } catch (e) { return false; }
    }
    try {
      await this.client.subscribe(`${ROOM_PREFIX}records/+`);
      return true;
    } catch (e) {
      return false;
    }
  }

  async publish(trackId, entry) {    // 궤적(trail)은 공유하지 않음 (용량) — 로컬 전용
    const slim = { ...entry };
    delete slim.trail;
    // 캐시 병합 후 TOP5 retained 발행
    const cur = (this.cache[trackId] || []).slice();
    cur.push(slim);
    cur.sort((a, b) => a.total - b.total);
    const top = cur.slice(0, 5);
    if (!top.includes(slim)) return top.indexOf(slim); // 순위 밖이면 발행 안 함
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
