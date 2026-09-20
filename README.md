# BLOCKY RACER — 복셀 3D 트랙 경주

🎮 **플레이:** https://jjabroin.github.io/smashyroad-web/

복셀 스타일 3D 서킷에서 4대가 겨루는 3랩 트랙 경주 게임.
차고에서 차를 고르고, 결승선에 먼저 도착하세요.

## 게임 방법

- **차고:** ◀ ▶ 버튼(또는 방향키)으로 차량 변경, Enter 또는 RACE START로 출발
- **경주:** 자동 가속이 기본. 방향키/WASD 또는 화면 L/R 버튼으로 조향
  - ▲: 가속, ▼: 브레이크/후진
  - 잔디로 나가면 감속, 상대와 부딪히면 서로 밀려남(내구도가 높을수록 피해 감소)
- **3랩**을 먼저 완주하면 결과표(순위·기록·베스트랩) 표시

| HUD | 설명 |
|---|---|
| 좌상단 미니맵 | 서킷 전체 + 내 차(빨강) 위치 |
| LAP 1/3 | 현재 랩 |
| 초록 타이머 | 경과 시간(초) |
| 순위 (1st/4) | 실시간 순위 |

## 차량 (차고)

| 차량 | 등급 | 속도 | 핸들링 | 내구도 | 특징 |
|---|---|---|---|---|---|
| F1 | 전설 | 5 | 4 | 2 | 가장 빠름, 미끄러짐 큼 |
| GT SPORTS | 레어 | 4 | 3 | 3 | 밸런스형 |
| PICKUP | 일반 | 3 | 3 | 5 | 충돌·잔디에 강함 |
| TRUCK | 일반 | 3 | 2 | 5 | 묵직하고 안정적 |

## 구조

- `js/track.js` — 서킷 수학(중심선·투영·곡률), three.js 없음
- `js/race.js` — 관성 물리(속도벡터+그립)·AI(퓨어퍼슈트)·랩/순위, three.js 없음
- `js/voxel.js` — 복셀 차량/소품 빌더
- `js/world.js` — 도로·연석·간트리·장식·조명
- `js/garage.js` — 차량 선택 화면(3D 턴테이블)
- `js/hud.js` — 미니맵·타이머·입력·효과음
- `js/main.js` — 카운트다운·게임 루프·카메라
- `classic-2d/` — 이전 2D 포팅 보존
  (원본 [lakshyajain06/SmashyRoad](https://github.com/lakshyajain06/SmashyRoad) Java 15종 1:1 포팅)

## 로컬에서 실행하기

```bash
python3 -m http.server 8000
# http://localhost:8000 열기
```

three.js는 CDN(`cdn.jsdelivr.net`)에서 불러오므로 실행 시 인터넷이 필요합니다.

## 배포

`main` → GitHub Pages (Deploy from a branch, /(root)). 푸시하면 자동 재배포됩니다.
