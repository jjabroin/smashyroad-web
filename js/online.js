// 온라인 로비 패널: 중계 서버 방 목록·생성·참가·출발 (호스트 권위)
import { MqttRoom } from './mqtt-room.js';
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
  let lister = null;

  const mqttFactory = (url, opts) => {
    if (!window.mqtt) throw new Error('MQTT 라이브러리 로드 실패');
    return window.mqtt.connect(url, opts);
  };

  function show(view) {
    el('onlinePanel').style.display = 'flex';
    el('onlineHome').style.display = view === 'home' ? 'block' : 'none';
    el('onlineLobby').style.display = view === 'lobby' ? 'block' : 'none';
  }
  function hide() {
    stopList();
    el('onlinePanel').style.display = 'none';
  }
  function status(msg) {
    el('onlineStatus').textContent = msg;
  }

  function refreshLobby(players, trackId, isHost, myId) {
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
      ? '친구가 들어오길 기다리는 중...'
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
      } else if (ev.type === 'net-down') {
        status('중계 서버 연결이 끊겼습니다. 다시 시도해주세요.');
      } else if (ev.type === 'host-left') {
        status('호스트 연결이 끊겼습니다.');
        setTimeout(() => leave(), 1500);
      }
    };
  }

  // ---- 방 목록 ----
  function stopList() {
    if (lister) {
      try { lister.stop(); } catch (e) { /* 무시 */ }
      lister = null;
    }
  }
  async function startList() {
    stopList();
    el('roomList').innerHTML = '<div class="o-hint">방 찾는 중...</div>';
    el('roomListStatus').textContent = '';
    try {
      lister = await MqttRoom.listRooms(
        mqttFactory,
        (rooms) => {
          if (rooms.length === 0) {
            el('roomList').innerHTML = '<div class="o-hint">열린 방이 없습니다. 방을 만들어보세요!</div>';
            return;
          }
          el('roomList').innerHTML = rooms
            .map((r) => (
              `<button class="roomrow" data-code="${r.code}">` +
              `<span><b>${r.code}</b> · ${trackNameOf(r.track)}</span>` +
              `<span>${r.players}/${r.max}명${r.items === false ? '' : ' 🎁'}</span>` +
              `</button>`
            ))
            .join('');
          el('roomList').querySelectorAll('.roomrow').forEach((b) => {
            b.addEventListener('click', () => joinByRow(b.dataset.code));
          });
        },
        2500,
        (m) => { el('roomListStatus').textContent = m; }
      );
    } catch (e) {
      el('roomList').innerHTML = '<div class="o-hint">중계 서버 연결 실패. 잠시 후 새로고침을 눌러주세요.</div>';
    }
  }

  el('onlineBtn').addEventListener('click', () => {
    show('home');
    status('');
    startList();
  });
  el('refreshRoomsBtn').addEventListener('click', () => startList());
  el('onlineClose').addEventListener('click', () => hide());

  el('createBtn').addEventListener('click', async () => {
    status('방 만드는 중...');
    stopList();
    try {
      room = new MqttRoom(mqttFactory);
      bindRoomEvents(room);
      const maxPlayers = +(el('maxPlayers') && el('maxPlayers').value ? el('maxPlayers').value : 4);
      const code = await room.hostRoom({
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
      startList();
    }
  });

  async function joinByRow(code) {
    status('참가 중...');
    stopList();
    try {
      room = new MqttRoom(mqttFactory);
      bindRoomEvents(room);
      await room.joinRoom({ code }, api.getCar().id);
      if (api.onRoom) api.onRoom(room);
      show('lobby');
      status('');
    } catch (e) {
      status('참가 실패: ' + (e.message === 'no-host'
        ? '방이 닫혔거나 가득 찼습니다. 목록을 새로고침 해주세요.'
        : e.message));
      if (room) {
        room.destroy();
        room = null;
      }
      startList();
    }
  }

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
    // 빈 슬롯은 호스트가 조종하는 AI로 채움
    const used = new Set(players.map((p) => p.carId));
    const aiPool = CAR_DEFS.map((d) => d.id).filter((id) => !used.has(id));
    const ai = [];
    while (players.length + ai.length < 4 && aiPool.length > 0) {
      ai.push(aiPool.shift());
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
    stopList();
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
    show, hide, backToLobby,
    get room() { return room; },
  };
}
