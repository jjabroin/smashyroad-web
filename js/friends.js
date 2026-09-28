// 친구: 목록(로컬) + 온라인 상태·차량 프로필·초대 (MQTT retained)
// ※ 서버 없음: presence는 retained + will + 하트비트, 초대는 retained 1회성
import { RELAY, ROOM_PREFIX } from './relay-config.js?v=4fdd2d';

export const FRIENDS_KEY = 'blockyracer-friends-v1';
const HEARTBEAT_MS = 30000;
const ONLINE_TTL_MS = 100000;
const INVITE_TTL_MS = 5 * 60 * 1000;

export function presenceTopic(id) {
  return `${ROOM_PREFIX}presence/${id}`;
}

export function inviteTopic(id) {
  return `${ROOM_PREFIX}invite/${id}`;
}

export function validFriendId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9]{3,16}$/.test(id);
}

export function loadFriends(owner) {
  try {
    if (typeof localStorage === 'undefined') return [];
    const s = JSON.parse(localStorage.getItem(FRIENDS_KEY));
    if (s && s.owner === owner && Array.isArray(s.friends)) {
      return s.friends.filter(validFriendId);
    }
  } catch (e) { /* 무시 */ }
  return [];
}

export function saveFriends(owner, list) {
  try {
    localStorage.setItem(FRIENDS_KEY, JSON.stringify({ owner, friends: list }));
    return true;
  } catch (e) {
    return false;
  }
}

export function isOnline(payload, now) {
  if (!payload || payload.online !== true) return false;
  if (typeof payload.ts !== 'number') return false;
  return now - payload.ts < ONLINE_TTL_MS;
}

export function isInviteFresh(msg, now) {
  if (!msg || typeof msg.code !== 'string' || !msg.from) return false;
  if (typeof msg.ts !== 'number') return false;
  return now - msg.ts < INVITE_TTL_MS;
}

export class FriendNet {
  constructor(mqttFactory) {
    this.mqttFactory = mqttFactory;
    this.client = null;
    this.myId = null;
    this.presence = new Map(); // id -> payload
    this.handlers = new Set();
    this.hbTimer = null;
    this.profile = null; // {name, cars}
  }

  onEvent(fn) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  _emit(ev) {
    for (const fn of [...this.handlers]) {
      try { fn(ev); } catch (e) { /* 무시 */ }
    }
  }

  async _ensureLive() {
    if (this.client) return true;
    try {
      const c = this.mqttFactory(RELAY.url, {
        clientId: 'fr' + Math.random().toString(36).slice(2, 10),
        username: RELAY.username,
        password: RELAY.password,
        reconnectPeriod: 4000,
        connectTimeout: 8000,
        will: this.myId ? {
          topic: presenceTopic(this.myId),
          payload: JSON.stringify({ online: false, ts: Date.now() }),
          qos: 1,
          retain: true,
        } : undefined,
      });
      this.client = c;
      await new Promise((resolve, reject) => {
        let done = false;
        const ok = () => { if (!done) { done = true; resolve(); } };
        const fail = () => { if (!done) { done = true; reject(new Error('conn')); } };
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
      return true;
    } catch (e) {
      this.client = null;
      return false;
    }
  }

  _onMessage(topic, payload) {
    try {
      const msg = JSON.parse(payload.toString());
      if (topic.startsWith(`${ROOM_PREFIX}presence/`)) {
        const id = topic.slice(`${ROOM_PREFIX}presence/`.length);
        if (id) {
          this.presence.set(id, msg);
          this._emit({ type: 'presence', id, payload: msg });
        }
      } else if (this.myId && topic === inviteTopic(this.myId)) {
        if (isInviteFresh(msg, Date.now())) {
          this._emit({ type: 'invite', msg });
        }
      }
    } catch (e) { /* 무시 */ }
  }

  // 로그인: 내 presence 발행 + 내 초대함 구독 + 친구들 구독 + 하트비트
  async login(myId, profile) {
    this.myId = myId;
    this.profile = profile || null;
    const live = await this._ensureLive();
    if (!live) return false;
    try {
      await this._publishPresence(true);
      await this._sub(inviteTopic(myId));
    } catch (e) { /* 무시 */ }
    try {
      if (this.hbTimer) clearInterval(this.hbTimer);
    } catch (e) { /* 무시 */ }
    this.hbTimer = setInterval(() => {
      this._publishPresence(true).catch(() => {});
    }, HEARTBEAT_MS);
    return true;
  }

  async logout() {
    try {
      if (this.hbTimer) clearInterval(this.hbTimer);
    } catch (e) { /* 무시 */ }
    this.hbTimer = null;
    try {
      await this._publishPresence(false);
    } catch (e) { /* 무시 */ }
    this.myId = null;
  }

  async _publishPresence(online) {
    if (!this.client || !this.myId) return false;
    const payload = {
      online, ts: Date.now(),
      name: (this.profile && this.profile.name) || null,
      cars: (this.profile && this.profile.cars) || [],
    };
    return new Promise((resolve) => {
      try {
        this.client.publish(presenceTopic(this.myId), JSON.stringify(payload), { qos: 1, retain: true }, () => resolve(true));
        setTimeout(() => resolve(true), 3000);
      } catch (e) {
        resolve(false);
      }
    });
  }

  async refreshProfile(profile) {
    this.profile = profile || null;
    if (this.myId) {
      try { await this._publishPresence(true); } catch (e) { /* 무시 */ }
    }
  }

  async watch(ids) {
    if (!this.client) return;
    for (const id of ids || []) {
      try {
        await this._sub(presenceTopic(id));
      } catch (e) { /* 무시 */ }
    }
  }

  _sub(topic) {
    return new Promise((resolve) => {
      try {
        const r = this.client.subscribe(topic);
        if (r && typeof r.then === 'function') r.then(() => resolve(true)).catch(() => resolve(false));
        else resolve(true);
      } catch (e) {
        resolve(false);
      }
    });
  }

  async invite(friendId, code) {
    if (!this.client || !this.myId) return false;
    const msg = { from: this.myId, code, ts: Date.now() };
    return new Promise((resolve) => {
      try {
        this.client.publish(inviteTopic(friendId), JSON.stringify(msg), { qos: 1, retain: true }, () => resolve(true));
        setTimeout(() => resolve(true), 3000);
      } catch (e) {
        resolve(false);
      }
    });
  }

  async clearInvite() {
    if (!this.client || !this.myId) return;
    try {
      this.client.publish(inviteTopic(this.myId), '', { qos: 1, retain: true });
    } catch (e) { /* 무시 */ }
  }
}
