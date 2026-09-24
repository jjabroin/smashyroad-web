// 계정: 가입·로그인·기기 기록 이전·두 기기 통합
// ※ 정적 호스팅이라 서버 검증이 없음 — ID 선점 + PIN 간이 잠금(해시 대조).
//    ID를 아는 누구든 읽을 수 있으니, PIN은 실수·장난 수준의 도용 방지용.
// 기록 통합 원리: entries의 tag를 계정ID로 통일하면 기존 병합 키(tag|total|date)가
// 두 기기 기록을 자동으로 합집합으로 보여줌. 계정 메타는 retained 토픽에 보관.
export const ACCOUNT_KEY = 'blockyracer-account-v1';
const DEVICE_TAG_KEY = 'blockyracer-tag-v1';

export function validAccountId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9]{3,16}$/.test(id);
}

export function validPin(pin) {
  return typeof pin === 'string' && /^\d{4}$/.test(pin);
}

// SHA-256 해시 (SubtleCrypto 미지원 환경은 cyrb53 폴백 — 간이 잠금 수준)
export async function hashPin(pin) {
  const s = 'blockyracer-pin:' + pin;
  try {
    if (window.crypto && window.crypto.subtle) {
      const d = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) { /* 폴백 */ }
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

export function deviceTag() {
  try {
    if (typeof localStorage === 'undefined') return 'GUEST';
    let t = localStorage.getItem(DEVICE_TAG_KEY);
    if (!t) {
      t = 'R' + Math.random().toString(36).slice(2, 6).toUpperCase();
      localStorage.setItem(DEVICE_TAG_KEY, t);
    }
    return t;
  } catch (e) {
    return 'GUEST';
  }
}

export function loadSession() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const s = JSON.parse(localStorage.getItem(ACCOUNT_KEY));
    if (s && typeof s.id === 'string' && validAccountId(s.id)) return s;
  } catch (e) { /* 무시 */ }
  return null;
}

function saveSession(s) {
  try {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(s));
    return true;
  } catch (e) {
    return false;
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(ACCOUNT_KEY);
  } catch (e) { /* 무시 */ }
}

// 순수 함수: 기록 뭉치의 태그를 계정으로 교체 (테스트 가능)
export function retagLists(all, fromTag, toTag, name) {
  let count = 0;
  const out = {};
  for (const tid of Object.keys(all || {})) {
    out[tid] = (all[tid] || []).map((e) => {
      if (e && e.tag === fromTag) {
        count++;
        const n = { ...e, tag: toTag };
        if (name) n.name = name;
        return n;
      }
      return e;
    });
  }
  return { map: out, count };
}

// 계정 패널 UI (DOM 직접 조작, garage 서브패널 안에 렌더)
// api: { board, onIdentity(tag, name), refresh() }
export function createAccountPanel(api) {
  const el = (id) => document.getElementById(id);
  const board = api.board;

  function session() {
    return loadSession();
  }

  function render() {
    const s = session();
    const st = el('accStatus');
    if (st) {
      st.textContent = s
        ? `✅ ${s.name} (${s.id}) 로그인 중`
        : '📴 로그인 안 됨 — 기록은 이 기기에만 저장됩니다';
    }
    for (const [id, show] of [['accLogout', !!s], ['accMerge', !!s], ['accPull', !!s]]) {
      const b = el(id);
      if (b) b.style.display = show ? 'block' : 'none';
    }
    for (const id of ['accSignup', 'accLogin']) {
      const b = el(id);
      if (b) b.style.display = s ? 'none' : 'block';
    }
  }

  function msg(t) {
    const m = el('accMsg');
    if (m) m.textContent = t;
  }

  function inputs() {
    return {
      id: (el('accId').value || '').trim(),
      name: (el('accName').value || '').trim().slice(0, 12),
      pin: (el('accPin').value || '').trim(),
    };
  }

  async function applyIdentity(s) {
    board.setIdentity(s ? s.id : deviceTag(), s ? s.name : null);
    if (api.onIdentity) {
      try { await api.onIdentity(board.tag, board.name); } catch (e) { /* 무시 */ }
    }
    if (api.refresh) {
      try { api.refresh(); } catch (e) { /* 무시 */ }
    }
    render();
  }

  el('accSignup').addEventListener('click', async () => {
    const { id, name, pin } = inputs();
    if (!validAccountId(id)) { msg('ID는 영문·숫자 3~16자입니다.'); return; }
    if (!name) { msg('표시 이름을 입력하세요.'); return; }
    if (!validPin(pin)) { msg('PIN 4자리를 입력하세요.'); return; }
    msg('확인 중...');
    try {
      const found = await board.net.fetchAccount(id);
      if (!found.ok && found.reason !== 'notfound') { msg('온라인 연결이 필요합니다.'); return; }
      if (found.ok) { msg('이미 사용 중인 ID입니다. 로그인하세요.'); return; }
      const pinHash = await hashPin(pin);
      const meta = {
        id, name, pinHash,
        devices: [deviceTag()],
        updatedAt: Date.now(),
      };
      const pub = await board.net.publishAccount(meta);
      if (!pub) { msg('계정 발행 실패 — 인터넷 확인 후 재시도.'); return; }
      // 신원 먼저 전환 후 이전 (순서 중요: migrateTag는 현 신원으로 옮김)
      saveSession({ id, name, pinHash, deviceTag: deviceTag(), createdAt: Date.now() });
      await applyIdentity(loadSession());
      // 이 기기 기록을 계정으로 이전 + 기기 잔재 삭제 (브라우저엔 계정 기록만)
      const res = board.migrateTag(deviceTag());
      await board.sync().catch(() => {});
      msg(res.moved > 0
        ? `가입 완료! 기기 기록 ${res.moved}개를 계정으로 옮기고 기기 기록은 삭제했습니다.`
        : '가입 완료!');
    } catch (e) {
      msg('가입 실패: ' + ((e && e.message) || e));
    }
  });

  el('accLogin').addEventListener('click', async () => {
    const { id, pin } = inputs();
    if (!validAccountId(id)) { msg('ID는 영문·숫자 3~16자입니다.'); return; }
    if (!validPin(pin)) { msg('PIN 4자리를 입력하세요.'); return; }
    msg('확인 중...');
    try {
      const found = await board.net.fetchAccount(id);
      if (found.ok) {
        const pinHash = await hashPin(pin);
        if (found.meta.pinHash && found.meta.pinHash !== pinHash) {
          msg('PIN이 다릅니다.');
          return;
        }
        const devs = Array.isArray(found.meta.devices) ? found.meta.devices : [];
        if (!devs.includes(deviceTag())) devs.push(deviceTag());
        const meta = { ...found.meta, devices: devs.slice(-10), updatedAt: Date.now() };
        await board.net.publishAccount(meta).catch(() => {});
        saveSession({
          id, name: found.meta.name || id, pinHash,
          deviceTag: deviceTag(), createdAt: found.meta.createdAt || Date.now(),
        });
        await applyIdentity(loadSession());
        const pulled = board.pullAccount();
        // 이 기기에 남은 기기 기록도 계정으로 귀속 + 삭제
        const res = board.migrateTag(deviceTag());
        await board.sync().catch(() => {});
        const parts = ['로그인!'];
        if (pulled > 0) parts.push(`다른 기기 기록 ${pulled}개를 가져왔습니다.`);
        if (res.moved > 0) parts.push(`이 기기 기록 ${res.moved}개를 계정으로 옮기고 삭제했습니다.`);
        if (pulled === 0 && res.moved === 0) parts.push('(합칠 기록이 없습니다)');
        msg(parts.join(' '));
      } else if (found.reason === 'offline') {
        // 오프라인: 이 기기에 저장된 세션과 대조
        const s = session();
        if (s && s.id === id) {
          const pinHash = await hashPin(pin);
          if (s.pinHash && s.pinHash !== pinHash) { msg('PIN이 다릅니다.'); return; }
          await applyIdentity(s);
          const res = board.migrateTag(deviceTag());
          msg(res.moved > 0
            ? `오프라인 로그인 (기기 기록 ${res.moved}개를 계정으로 옮겼습니다)`
            : '오프라인 로그인 (이 기기 기록만 표시)');
        } else {
          msg('오프라인에서는 이 기기에서 쓰던 계정만 로그인됩니다.');
        }
      } else {
        msg('없는 ID입니다. 회원가입하세요.');
      }
    } catch (e) {
      msg('로그인 실패: ' + ((e && e.message) || e));
    }
  });

  el('accLogout').addEventListener('click', async () => {
    clearSession();
    await applyIdentity(null);
    msg('로그아웃 — 이제 기록은 이 기기 태그로 저장됩니다.');
  });

  el('accMerge').addEventListener('click', async () => {
    const s = session();
    if (!s) return;
    const res = board.migrateTag(deviceTag());
    await board.sync().catch(() => {});
    if (api.refresh) {
      try { api.refresh(); } catch (e) { /* 무시 */ }
    }
    msg(res.moved > 0
      ? `기기 기록 ${res.moved}개를 ${s.id} 계정으로 합치고 삭제했습니다.`
      : '합칠 기기 기록이 없습니다.');
  });

  el('accPull').addEventListener('click', async () => {
    const pulled = board.pullAccount();
    await board.sync().catch(() => {});
    if (api.refresh) {
      try { api.refresh(); } catch (e) { /* 무시 */ }
    }
    msg(pulled > 0 ? `다른 기기 기록 ${pulled}개를 가져왔습니다.` : '가져올 기록이 없습니다.');
  });

  return { render, session };
}
