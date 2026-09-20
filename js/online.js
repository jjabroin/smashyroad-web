// 온라인 로비 패널: 방 생성/참가·플레이어 목록·출발 (P2P, 호스트 권위)
import { NetRoom, STATE_HZ } from './net.js';
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
  // api: { getCar()->def, getTrack()->def, onStartOnline({room, players, ai, track, myId}), onLobbyClosed() }
  const el = (id) => document.getElementById(id);
  let room = null;
  let checkTimer = 0;

  const peerFactory = (id) => {
    if (!window.Peer) throw new Error('PeerJS CDN 로드 실패');
    return new window.Peer(id, { debug: 0 });
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
    el('lobbyHint').textContent = players.length < 2
      ? '친구에게 코드 4글자를 알려주세요'
      : players.every((p) => p.carId)
        ? '전원 준비 완료!'
        : '차량을 선택해주세요';
  }

  function bindRoomEvents(r) {
    r.onEvent = (ev) => {
      if (ev.type === 'lobby') {
        refreshLobby(ev.players, ev.trackId || api.getTrack().id, r.isHost, r.myId);
      } else if (ev.type === 'start') {
        hide();
        api.onStartOnline({
          room: r,
          players: ev.players,
          ai: ev.ai,
          track: TRACK_DEFS.find((t) => t.id === ev.trackId) || TRACK_DEFS[0],
          myId: r.myId,
        });
      } else if (ev.type === 'error') {
        status(ev.msg);
      } else if (ev.type === 'host-left') {
        status('호스트 연결이 끊겼습니다.');
        setTimeout(() => leave(), 1500);
      }
    };
  }

  el('onlineBtn').addEventListener('click', () => {
    show('home');
    status('');
    el('joinCode').value = '';
  });
  el('onlineClose').addEventListener('click', () => hide());

  el('createBtn').addEventListener('click', async () => {
    status('방 만드는 중...');
    try {
      room = new NetRoom(peerFactory);
      bindRoomEvents(room);
      const code = await room.hostRoom();
      room.setMyCar(api.getCar().id);
      room.setTrack(api.getTrack().id);
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
    status('참가 중...');
    try {
      room = new NetRoom(peerFactory);
      bindRoomEvents(room);
      await room.joinRoom(code, api.getCar().id);
      show('lobby');
      status('');
    } catch (e) {
      status('참가 실패: 방 코드를 확인해주세요.');
      room = null;
    }
  });

  el('startOnlineBtn').addEventListener('click', () => {
    if (!room || !room.isHost) return;
    const players = room.players;
    if (players.length < 2 || !players.every((p) => p.carId)) return;
    // 빈 슬롯은 호스트가 조종하는 AI로 채움 (최대 4대)
    const used = new Set(players.map((p) => p.carId));
    const aiPool = CAR_DEFS.map((d) => d.id).filter((id) => !used.has(id));
    const ai = [];
    while (players.length + ai.length < 4 && aiPool.length > 0) {
      ai.push(aiPool.shift());
    }
    const msg = room.startRace(ai);
    hide();
    api.onStartOnline({
      room,
      players: msg.players,
      ai: msg.ai,
      track: TRACK_DEFS.find((t) => t.id === msg.trackId) || TRACK_DEFS[0],
      myId: room.myId,
    });
  });

  function leave() {
    if (room) {
      room.destroy();
      room = null;
    }
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
    show, hide, backToLobby,
    get room() { return room; },
  };
}
