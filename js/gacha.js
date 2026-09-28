// 뽑기: 재화(코인)+상자+천장+중복 처리 (가이드식: 등급별 가중치·독립 천장)
// 상태는 소유자(계정ID·기기태그)별 localStorage 보관
export const GACHA_KEY = 'blockyracer-gacha-v1';

export const STARS = { 3: '일반', 4: '레어', 5: '전설' };

export const BOXES = [
  {
    id: 'normal', name: '일반 상자', price: 300, price10: 2700, pity5: 20,
    weights: { 3: 80, 4: 17, 5: 3 },
    coins3: [80, 250], coins4: [350, 700], dup4: 300, dup5: 1000,
    pool4: ['f1shadow', 'gtsgold', 'rallystorm'],
    pool5: ['cometneo', 'monsterking', 'policex'],
  },
  {
    id: 'advanced', name: '고급 상자', price: 800, price10: 7200, pity5: 15,
    weights: { 3: 55, 4: 35, 5: 10 },
    coins3: [150, 400], coins4: [500, 1000], dup4: 300, dup5: 1000,
    pool4: ['f1shadow', 'gtsgold', 'rallystorm'],
    pool5: ['cometneo', 'monsterking', 'policex'],
  },
  {
    id: 'legend', name: '전설 상자', price: 2000, price10: 18000, pity5: 8,
    weights: { 4: 65, 5: 35 },
    coins3: [0, 0], coins4: [800, 1500], dup4: 300, dup5: 1000,
    pool4: ['f1shadow', 'gtsgold', 'rallystorm'],
    pool5: ['cometneo', 'monsterking', 'policex'],
  },
];

export function boxById(id) {
  return BOXES.find((b) => b.id === id) || null;
}

function blankState(owner) {
  return { owner, coins: 0, pity: {}, unlocked: [] };
}

function keyFor(owner) {
  return GACHA_KEY + ':' + owner;
}

function readKey(key) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const s = JSON.parse(localStorage.getItem(key));
    if (s && typeof s === 'object') return s;
  } catch (e) { /* 무시 */ }
  return null;
}

export function loadState(owner) {
  // 구format(단일 키) 이전
  const old = readKey(GACHA_KEY);
  if (old && old.owner) {
    try {
      localStorage.setItem(keyFor(old.owner), JSON.stringify(old));
      localStorage.removeItem(GACHA_KEY);
    } catch (e) { /* 무시 */ }
  }
  const s = readKey(keyFor(owner));
  if (s && s.owner === owner) {
    return {
      owner, coins: Math.max(0, Math.floor(Number(s.coins) || 0)),
      pity: s.pity || {}, unlocked: Array.isArray(s.unlocked) ? s.unlocked : [],
    };
  }
  return blankState(owner);
}

export function saveState(st) {
  try {
    localStorage.setItem(keyFor(st.owner), JSON.stringify(st));
    return true;
  } catch (e) {
    return false;
  }
}

export function addCoins(st, n) {
  st.coins = Math.max(0, Math.floor(Number(st.coins) || 0) + n);
  saveState(st);
  return st.coins;
}

// 단일 뽑기 판정 (순수, 테스트 가능): {tier, pity}
// rand: 0~1 난수 주입
export function rollTier(box, pityCount, rand) {
  if (pityCount >= box.pity5 - 1) return { tier: 5, pity: true };
  const ws = box.weights;
  const total = (ws[3] || 0) + (ws[4] || 0) + (ws[5] || 0);
  let r = rand * total;
  if ((ws[3] || 0) > 0) {
    if ((r -= ws[3]) < 0) return { tier: 3, pity: false };
  }
  if ((ws[4] || 0) > 0) {
    if ((r -= ws[4]) < 0) return { tier: 4, pity: false };
  }
  return { tier: 5, pity: false };
}

function randInt(rand, a, b) {
  return a + Math.floor(rand() * (b - a + 1));
}

// n연차 실행 → 결과 배열 (코인 차감·천장·해금 포함)
export function pull(st, boxId, count, rand) {
  const box = boxById(boxId);
  if (!box) return { ok: false, reason: 'no-box', results: [] };
  const price = count >= 10 ? box.price10 : box.price * count;
  if (Math.floor(Number(st.coins) || 0) < price) return { ok: false, reason: 'no-coins', results: [] };
  st.coins -= price;
  const results = [];
  const n = count >= 10 ? 10 : 1;
  for (let i = 0; i < n; i++) {
    const pityCount = st.pity[boxId] | 0;
    const { tier, pity } = rollTier(box, pityCount, rand());
    let res;
    if (tier === 5) {
      st.pity[boxId] = 0;
      const unowned = box.pool5.filter((id) => !st.unlocked.includes(id));
      if (unowned.length > 0) {
        const id = unowned[Math.floor(rand() * unowned.length)];
        st.unlocked.push(id);
        res = { kind: 'car', carId: id, stars: 5, dup: false, pity };
      } else {
        res = { kind: 'coins', amount: box.dup5, stars: 5, dup: true, pity };
        st.coins += box.dup5;
      }
    } else if (tier === 4) {
      st.pity[boxId] = pityCount + 1;
      const unowned = box.pool4.filter((id) => !st.unlocked.includes(id));
      if (unowned.length > 0 && rand() < 0.45) {
        const id = unowned[Math.floor(rand() * unowned.length)];
        st.unlocked.push(id);
        res = { kind: 'car', carId: id, stars: 4, dup: false, pity: false };
      } else if (unowned.length === 0 && rand() < 0.45) {
        res = { kind: 'coins', amount: box.dup4, stars: 4, dup: true, pity: false };
        st.coins += box.dup4;
      } else {
        const amount = randInt(rand, box.coins4[0], box.coins4[1]);
        res = { kind: 'coins', amount, stars: 4, dup: false, pity: false };
        st.coins += amount;
      }
    } else {
      st.pity[boxId] = pityCount + 1;
      const amount = randInt(rand, box.coins3[0], box.coins3[1]);
      res = { kind: 'coins', amount, stars: 3, dup: false, pity: false };
      st.coins += amount;
    }
    results.push(res);
  }
  saveState(st);
  return { ok: true, results, coins: st.coins };
}

export function isUnlocked(st, carId, carDef) {
  if (!carDef || !carDef.locked) return true;
  return st.unlocked.includes(carId);
}

// 기기 저장분을 계정으로 합치기 (로그인 시 1회, 중복 방지 위해 기기는 비움)
export function migrateToAccount(devOwner, accOwner) {
  if (!devOwner || !accOwner || devOwner === accOwner) return { coins: 0, cars: 0 };
  try {
    if (typeof localStorage === 'undefined') return { coins: 0, cars: 0 };
    const s = readKey(keyFor(devOwner));
    if (!s || s.owner !== devOwner) return { coins: 0, cars: 0 };
    const a = readKey(keyFor(accOwner));
    const acc = a && a.owner === accOwner ? a : blankState(accOwner);
    const coins = Math.max(0, Math.floor(Number(s.coins) || 0));
    acc.coins = Math.max(0, Math.floor(Number(acc.coins) || 0)) + coins;
    if (!Array.isArray(acc.unlocked)) acc.unlocked = [];
    let cars = 0;
    for (const id of s.unlocked || []) {
      if (!acc.unlocked.includes(id)) {
        acc.unlocked.push(id);
        cars++;
      }
    }
    if (!acc.pity) acc.pity = {};
    for (const [k, v] of Object.entries(s.pity || {})) {
      acc.pity[k] = Math.max(acc.pity[k] | 0, v | 0);
    }
    localStorage.setItem(keyFor(accOwner), JSON.stringify(acc));
    localStorage.setItem(keyFor(devOwner), JSON.stringify(blankState(devOwner)));
    return { coins, cars };
  } catch (e) {
    return { coins: 0, cars: 0 };
  }
}
