// 순위표 단일 진실 원천: 로컬+공유 병합, 읽기는 항상 같은 배열에서
// - 메모리(세션) + localStorage + 브로커 retained 3원천 병합
// - list() 하나로 개수·행 모두 생성 (불일치 원천 차단)
import { RecordsBoard, getRacerTag } from './records.js';

const TA_KEY = 'blockyracer-ta-records-v1';
const TAG_KEY = 'blockyracer-tag-v1';

function readStorage() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const s = JSON.parse(localStorage.getItem(TA_KEY));
    if (s && typeof s === 'object') return s;
  } catch (e) { /* 무시 */ }
  return {};
}

function writeStorage(all) {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(TA_KEY, JSON.stringify(all));
    return true;
  } catch (e) {
    return false;
  }
}

function tagOf() {
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

function clean(list) {
  return (list || []).filter(
    (e) => e && typeof e.total === 'number' && isFinite(e.total) && typeof e.car === 'string'
  );
}

function mergeTop(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const e of clean(list)) {
      const k = `${e.tag}|${e.total}|${e.date}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(e);
      }
    }
  }
  out.sort((a, b) => a.total - b.total);
  return out.slice(0, 5);
}

export class Board {
  constructor(mqttFactory) {
    this.net = new RecordsBoard(mqttFactory);
    this.mem = {};
    this.tag = tagOf();
    this.storageOK = true;
    try {
      if (typeof localStorage === 'undefined') this.storageOK = false;
      else {
        localStorage.setItem('__ta_test', '1');
        localStorage.removeItem('__ta_test');
      }
    } catch (e) {
      this.storageOK = false;
    }
    this.onChange = null; // () => {} 데이터 변경 시 (수신/저장)
    this.net.onUpdate = () => this._changed();
    this.net.onStatus = () => this._changed();
  }

  async init() {
    try {
      await this.net.connect();
    } catch (e) { /* 오프라인 시작 허용 */ }
    this._changed();
  }

  _changed() {
    try {
      if (this.onChange) this.onChange();
    } catch (e) { /* 무시 */ }
  }

  localAll() {
    const stored = readStorage();
    const out = {};
    const tids = new Set([...Object.keys(this.mem), ...Object.keys(stored)]);
    for (const tid of tids) {
      out[tid] = mergeTop(this.mem[tid], stored[tid]);
    }
    return out;
  }

  // 단일 읽기 경로: 개수·행·베스트 모두 이 배열에서 파생
  list(trackId) {
    return mergeTop(this.net.get(trackId), (this.localAll()[trackId] || []));
  }

  best(trackId) {
    const l = this.list(trackId);
    return l.length > 0 ? l[0] : null;
  }

  totalCount(trackIds) {
    let n = 0;
    for (const tid of trackIds) n += this.list(tid).length;
    return n;
  }

  save(trackId, { total, best, car, trail }) {
    const entry = {
      total, best: best === undefined ? null : best,
      car, tag: this.tag, date: Date.now(),
    };
    if (trail && trail.length > 1) entry.trail = trail;
    const mem = this.mem[trackId] || (this.mem[trackId] = []);
    mem.push(entry);
    mem.sort((a, b) => a.total - b.total);
    this.mem[trackId] = mem.slice(0, 5);
    const stored = readStorage();
    const sl = stored[trackId] || [];
    sl.push({ ...entry });
    sl.sort((a, b) => a.total - b.total);
    stored[trackId] = sl.slice(0, 5);
    writeStorage(stored);
    const rank = this.list(trackId).findIndex(
      (e) => e.tag === entry.tag && e.total === entry.total && e.date === entry.date
    );
    // 공유 발행 (실패해도 로컬 유지)
    try {
      this.net.publish(trackId, entry).catch(() => {});
    } catch (e) { /* 무시 */ }
    this._changed();
    return { entry, rank };
  }

  ghost(trackId, entry) {
    const all = [...(this.mem[trackId] || []), ...((readStorage()[trackId]) || [])];
    return all.find(
      (e) => e.trail && e.trail.length > 1 && e.tag === entry.tag && e.total === entry.total
    ) || null;
  }

  // 미동기화 로컬 기록을 공유 보드에 올림
  async sync() {
    let ok = true;
    try {
      const local = this.localAll();
      for (const trackId of Object.keys(local)) {
        for (const e of local[trackId]) {
          const slim = { ...e };
          delete slim.trail;
          await this.net.publish(trackId, slim);
        }
      }
    } catch (e) {
      ok = false;
    }
    this._changed();
    return ok && this.net._verified === true;
  }

  // 미동기화 로컬 기록을 공유 보드에 올림 (순위표 열 때 호출)
  async sync() {
    if (!this.net) return false;
    try {
      const local = this.localAll();
      for (const trackId of Object.keys(local)) {
        for (const e of local[trackId]) {
          const slim = { ...e };
          delete slim.trail;
          await this.net.publish(trackId, slim);
        }
      }
      return this.net._verified === true;
    } catch (e) {
      return false;
    }
  }

  get connected() {
    return this.net.connected;
  }

  status() {
    return this.net._status || (this.net.connected ? 'conn' : 'off');
  }

  get loopFail() {
    return this.net._loopFail || null;
  }

  get status() {
    return this.net._status || (this.net.connected ? 'conn' : 'off');
  }

  get loopFail() {
    return this.net._loopFail || null;
  }
}
