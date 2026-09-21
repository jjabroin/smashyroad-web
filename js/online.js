// 온라인 로비 패널: 방 생성/코드 참가·플레이어 목록·출발 (P2P 직접 연결, 호스트 권위)
import { NetRoom, RTC_CONFIG, resolveRTCConfig, getTurnSettings, saveTurnSettings } from './net.js';
import { TRACK_DEFS } from './track.js';
import { CAR_DEFS } from './race.js';

const carNameOf = (id) => {
  const d = CAR_DEFS.find((x) => x.id === id);
  return d ? d.name : '???';
};
const trackNameOf = (id) => {
  const d = TRACK_DEFS.find((x) => x.id === id);
  return d ? d.name : '???';
};

export function createOnlinePanel(api) {
  // api: { getCar()->def, getTrack()->def, onStartOnline({room, players, ai, track, myId, items}), onLobbyClosed(), onRoom(room|null) }
  const el = (id) => document.getElementById(id);
  let room = null;
  let rtcConfig = RTC_CONFIG;

  const peerFactory = (id) => {
    if (!window.Peer) throw new Error('PeerJS CDN 로드 실패');
    return new window.Peer(id, { debug: 0, config: rtcConfig });
  };

  function show(view) {
    el('onlinePanel').style.display = 'flex';
    el('onlineHome').style.display = view === 'home' ? 'block' : 'none';
    el('onlineLobby').style.display = view === 'lobby' ? 'block' : 'none';
  }
  function hide() {
    el('onlinePanel').style.display = 'none';
  }
  function status(msg) {
    el('onlineStatus').textContent = msg;
  }
  function diag(msg) {
    el('netDiag').textContent = msg;
  }

  function refreshLobby(players, trackId, isHost, myId) {
    el('roomCode').textContent = room ? room.code : '----';
    el('lobbyTrack').textContent = 'TRACK: ' + trackNameOf(trackId);
    el('playerList').innerHTML = players
      .map((p, i) => {
        const you = p.id === myId ? ' (YOU)' : '';
        const host = i === 0 ? ' 👑' : '';
        return `<div class="prow${p.id === myId ? ' me' : ''}"><span>P${i + 1}${host}${you}</span><span>${carNameOf(p.carId)}</span></div>`;
      })
      .join('');
    el('startOnlineBtn').style.display = isHost ? 'block' : 'none';
    const ready = players.length >= 2 && players.every((p) => p.carId);
    el('startOnlineBtn').disabled = !ready;
    const itemsBtn = el('itemsBtn');
    const on = !room || room.itemsOn !== false;
    itemsBtn.textContent = `🎁 아이템전: ${on ? 'ON' : 'OFF'}`;
    itemsBtn.disabled = !isHost;
    itemsBtn.style.display = 'block';
    el('lobbyHint').textContent = players.length < 2
      ? '친구에게 코드 4글자를 알려주세요'
      : players.every((p) => p.carId)
        ? '전원 준비 완료!'
        : '차량을 선택해주세요';
  }

  function bindRoomEvents(r) {
    r.onEvent = (ev) => {
      if (ev.type === 'lobby') {
        r.itemsOn = ev.items;
        refreshLobby(ev.players, ev.trackId || api.getTrack().id, r.isHost, r.myId);
      } else if (ev.type === 'start') {
        hide();
        api.onStartOnline({
          room: r, players: ev.players, ai: ev.ai, items: ev.items,
          track: TRACK_DEFS.find((t) => t.id === ev.trackId) || TRACK_DEFS[0],
          myId: r.myId,
        });
      } else if (ev.type === 'error') {
        status(ev.msg);
      } else if (ev.type === 'denied') {
        status('참가 거부됨 (인원 초과 또는 경주 중).');
        setTimeout(() => leave(), 1500);
      } else if (ev.type === 'conn-state') {
        if (ev.state === 'connected' || ev.state === 'completed') diag('');
        else if (ev.state === 'failed') diag('직접 연결 실패 → 중계 시도 중...');
        else if (ev.state === 'disconnected') diag('연결 끊김 감지 → 복구 시도 중...');
        else diag(`연결 중... (${ev.state})`);
      } else if (ev.type === 'net-kind') {
        const label = ev.kind === 'host' ? '같은 네트워크 직접 연결'
          : ev.kind === 'srflx' ? '인터넷 직접 연결'
          : ev.kind === 'relay' ? '중계서버 경유 연결' : `연결 (${ev.kind})`;
        diag('✅ ' + label);
      } else if (ev.type === 'host-left') {
        status('호스트 연결이 끊겼습니다.');
        setTimeout(() => leave(), 1500);
      }
    };
  }

  function openHome() {
    show('home');
    status('');
    diag('');
    el('joinCode').value = '';
    const t = getTurnSettings();
    el('turnApp').value = t ? t.app : '';
    el('turnKey').value = t ? t.key : '';
    el('turnState').textContent = t ? '✅ 중계 키 설정됨' : '미설정 (직접 연결만 시도)';
  }
  el('turnSave').addEventListener('click', () => {
    const app = el('turnApp').value.trim();
    const key = el('turnKey').value.trim();
    if (!app || !key) {
      el('turnState').textContent = '앱 주소와 API 키를 모두 입력하세요.';
      return;
    }
    saveTurnSettings(app, key);
    el('turnState').textContent = '✅ 저장됨 (다음 방 만들기/참가부터 적용)';
  });
  el('onlineClose').addEventListener('click', () => hide());

  el('createBtn').addEventListener('click', async () => {
    status('방 만드는 중...');
    try {
      rtcConfig = await resolveRTCConfig().catch(() => RTC_CONFIG);
      room = new NetRoom(peerFactory);
      bindRoomEvents(room);
      const maxPlayers = +(el('maxPlayers') && el('maxPlayers').value ? el('maxPlayers').value : 4);
      await room.hostRoom({
        maxPlayers,
        trackId: api.getTrack().id,
        carId: api.getCar().id,
        itemsOn: true,
      });
      room.setMyCar(api.getCar().id);
      room.setTrack(api.getTrack().id);
      if (api.onRoom) api.onRoom(room);
      show('lobby');
      status('');
      refreshLobby(room.players, api.getTrack().id, true, room.myId);
    } catch (e) {
      status('방 생성 실패: ' + e.message);
    }
  });

  el('joinBtn').addEventListener('click', async () => {
    const code = el('joinCode').value.trim();
    if (code.length < 4) {
      status('코드 4글자를 입력하세요.');
      return;
    }
    status('참가 중... (최대 30초)');
    try {
      rtcConfig = await resolveRTCConfig().catch(() => RTC_CONFIG);
      room = new NetRoom(peerFactory);
      bindRoomEvents(room);
      await room.joinRoom(code, api.getCar().id);
      if (api.onRoom) api.onRoom(room);
      show('lobby');
      status('');
    } catch (e) {
      status('참가 실패: ' + (e.message === 'host unreachable'
        ? '호스트에 닿지 않습니다. 코드·인터넷 상태를 확인하고 다시 시도해주세요.'
        : e.message));
      if (room) {
        room.destroy();
        room = null;
      }
    }
  });
  el('joinCode').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el('joinBtn').click();
  });

  el('itemsBtn').addEventListener('click', () => {
    if (!room || !room.isHost) return;
    room.itemsOn = room.itemsOn === false;
    room.broadcastLobby();
    refreshLobby(room.players, room.trackId || api.getTrack().id, true, room.myId);
  });

  el('startOnlineBtn').addEventListener('click', () => {
    if (!room || !room.isHost) return;
    const players = room.players;
    if (players.length < 2 || !players.every((p) => p.carId)) return;
    // 1명이면 연습용 AI로 채우고, 2명 이상이면 나머지는 비워둠
    const used = new Set(players.map((p) => p.carId));
    const aiPool = CAR_DEFS.map((d) => d.id).filter((id) => !used.has(id));
    const ai = [];
    if (players.length < 2) {
      while (players.length + ai.length < 4 && aiPool.length > 0) {
        ai.push(aiPool.shift());
      }
    }
    const msg = room.startRace(ai, room.itemsOn !== false);
    hide();
    api.onStartOnline({
      room,
      players: msg.players,
      ai: msg.ai,
      items: msg.items,
      track: TRACK_DEFS.find((t) => t.id === msg.trackId) || TRACK_DEFS[0],
      myId: room.myId,
    });
  });

  function leave() {
    if (room) {
      room.destroy();
      room = null;
    }
    if (api.onRoom) api.onRoom(null);
    hide();
    api.onLobbyClosed();
  }
  el('leaveBtn').addEventListener('click', leave);

  // 로비로 복귀 (경주 종료 후, 이벤트 핸들러도 로비용으로 복귀)
  function backToLobby() {
    if (!room) return;
    bindRoomEvents(room);
    if (room.isHost) {
      room.phase = 'lobby';
      room.broadcastLobby();
    }
    show('lobby');
  }

  return {
    show, hide, backToLobby, openHome,
    get room() { return room; },
  };
}
