// 순위표 단일 진실 원천: 로컬+공유 병합, 읽기는 항상 같은 배열에서
// - 메모리(세션) + localStorage + 브로커 retained 3원천 병합
// - list() 하나로 개수·행 모두 생성 (불일치 원천 차단)
// - 신원(identity): 로그인 시 계정ID, 로그아웃 시 기기 태그. 기록의 tag가 신원.
import { RecordsBoard, getRacerTag, slimEntry } from './records.js?v=560122';
import { retagLists } from './accounts.js?v=7e6ad7';

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
    this.deviceTag = this.tag; // 이 브라우저 고유 태그 (신원 전환 후에도 유지)
    this.name = null; // 로그인 시 계정 표시 이름 (entries의 name으로 발행)
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

  // 신원 전환 (로그인·로그아웃): 세션 메모리 비우고 태그 교체
  setIdentity(tag, name) {
    this.tag = tag;
    this.name = name || null;
    this.mem = {};
    this._changed();
  }

  // 저장소+메모리 전체 (무필터 TOP5) — 내 기록 탭 전용
  localAllRaw() {
    const stored = readStorage();
    const out = {};
    const tids = new Set([...Object.keys(this.mem), ...Object.keys(stored)]);
    for (const tid of tids) {
      out[tid] = mergeTop(this.mem[tid], stored[tid]);
    }
    return out;
  }

  localAll() {
    const stored = readStorage();
    const out = {};
    const tids = new Set([...Object.keys(this.mem), ...Object.keys(stored)]);
    for (const tid of tids) {
      // 한 기기·다계정 전환 대비: 현 신원 기록만 (발행·개수용)
      const mine = (l) => (l || []).filter((e) => e && e.tag === this.tag);
      out[tid] = mergeTop(mine(this.mem[tid]), mine(stored[tid]));
    }
    return out;
  }

  // 단일 읽기 경로: 개수·행·베스트 모두 이 배열에서 파생
  list(trackId) {
    return mergeTop(this.net.get(trackId), (this.localAll()[trackId] || []));
  }

  // 내 기록 (공유 계정분 + 이 기기 전체)
  // 경주 후 결과 화면(전체 집계)에 나온 내 기록이 여기 빠지면 안 됨:
  // 미이전 기기 기록도 포함 (합치기 전 과도기). 필터 후 병합이라 TOP5 잘림 없음.
  listMine(trackId) {
    const shared = ((this.net.get(trackId)) || []).filter((e) => e && e.tag === this.tag);
    const keep = (l) => (l || []).filter((e) => e && (e.tag === this.tag || e.tag === this.deviceTag));
    const stored = readStorage();
    return mergeTop(shared, keep(this.mem[trackId]), keep(stored[trackId]));
  }

  // 원천별 개수 (진단·표시용)
  sources(trackIds) {
    let shared = 0;
    let local = 0;
    try {
      for (const tid of trackIds) {
        const s = this.net.get(tid);
        if (s) shared += s.length;
        const l = this.localAll()[tid];
        if (l) local += l.length;
      }
    } catch (e) { /* 무시 */ }
    return { shared, local };
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
    if (this.name) entry.name = this.name;
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
    // 공유 발행 (실패해도 로컬 유지, 테스트 트랙은 발행 안 함)
    if (!trackId.startsWith('__')) {
      try {
        this.net.publish(trackId, entry).catch(() => {});
      } catch (e) { /* 무시 */ }
    }
    this._changed();
    return { entry, rank };
  }

  ghost(trackId, entry) {
    const all = [...(this.mem[trackId] || []), ...((readStorage()[trackId]) || [])];
    return all.find(
      (e) => e.trail && e.trail.length > 1 && e.tag === entry.tag && e.total === entry.total
    ) || null;
  }

  // 기기 태그 기록을 현 신원(계정)으로 이전 + 기기 잔재 삭제
  // (브라우저엔 계정 기록만 남김. 반환 {moved, purged})
  migrateTag(fromTag) {
    const none = { moved: 0, purged: 0 };
    if (!fromTag || fromTag === this.tag) return none;
    const stored = readStorage();
    const r1 = retagLists(this.mem, fromTag, this.tag, this.name);
    const r2 = retagLists(stored, fromTag, this.tag, this.name);
    // 소탕: 혹시 남은 fromTag 기록 삭제 (이전漏れ 방지)
    const sweep = (list) => {
      const kept = [];
      let n = 0;
      for (const e of list || []) {
        if (e && e.tag === fromTag) n++;
        else kept.push(e);
      }
      return { kept, n };
    };
    let purged = 0;
    for (const tid of Object.keys(r1.map)) {
      const s = sweep(r1.map[tid]);
      r1.map[tid] = s.kept;
      purged += s.n;
    }
    this.mem = r1.map;
    for (const tid of Object.keys(r2.map)) {
      const s = sweep(r2.map[tid]);
      const sl = (s.kept || []).slice();
      sl.sort((a, b) => a.total - b.total);
      r2.map[tid] = sl.slice(0, 5);
      purged += s.n;
    }
    writeStorage(r2.map);
    // 이전된 기록을 공유에도 반영 (best-effort)
    try {
      for (const tid of Object.keys(r1.map)) {
        for (const e of r1.map[tid] || []) {
          if (e.tag === this.tag && !tid.startsWith('__')) {
            this.net.publish(tid, e).catch(() => {});
          }
        }
      }
    } catch (e) { /* 무시 */ }
    this._changed();
    return { moved: r1.count + r2.count, purged };
  }

  // 공유 보드에서 내 계정 기록을 끌어와 세션에 합침 (두 기기 통합)
  pullAccount() {
    let count = 0;
    try {
      const tids = new Set([
        ...Object.keys(this.mem),
        ...Object.keys(readStorage()),
        ...Object.keys(this.net.cache || {}),
      ]);
      for (const tid of tids) {
        const shared = (this.net.get(tid) || []).filter((e) => e && e.tag === this.tag);
        if (shared.length === 0) continue;
        const cur = (this.mem[tid] || []).slice();
        const seen = new Set(cur.map((e) => `${e.tag}|${e.total}|${e.date}`));
        for (const e of shared) {
          const k = `${e.tag}|${e.total}|${e.date}`;
          if (!seen.has(k)) {
            seen.add(k);
            cur.push({ ...e });
            count++;
          }
        }
        cur.sort((a, b) => a.total - b.total);
        this.mem[tid] = cur.slice(0, 5);
      }
    } catch (e) { /* 무시 */ }
    if (count > 0) this._changed();
    return count;
  }

  // 미동기화 로컬 기록을 공유 보드에 올림 (순위표 열 때 호출)
  async sync() {
    if (!this.net) return false;
    try {
      const local = this.localAll();
      for (const trackId of Object.keys(local)) {
        for (const e of local[trackId]) {
          await this.net.publish(trackId, slimEntry(e));
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

  get status() {
    return this.net._status || (this.net.connected ? 'conn' : 'off');
  }

  get loopFail() {
    return this.net._loopFail || null;
  }
}
