# Smashy Road Web

원본 Java 게임 **[SmashyRoad](https://github.com/lakshyajain06/SmashyRoad)** (lakshyajain06)를
GitHub Pages에서 바로 돌아가도록 자바스크립트로 1:1 포팅한 탑다운 경찰 체이스 레이싱 게임.

🎮 **플레이:** https://jjabroin.github.io/smashyroad-web/

## 게임 방법

- 차는 자동으로 계속 가속됩니다.
- 경찰차를 피해 오래 살아남을수록 점수가 오릅니다.
- 세게 부딪히면 경찰차를 파괴(+5점)하지만 내구도(HP)도 함께 닳습니다.
- HP가 0이 되면 게임 오버. SPACE나 화면 터치로 재시작.

| 입력 | 동작 |
|---|---|
| ◀ ▶ (A / D) | 좌 / 우 회전 |
| ▼ (S) | 후진 브레이크 |
| SPACE | 게임 오버 후 재시작 |
| 화면 버튼 ◀ ▼ ▶ | 모바일 터치 조작 |

빨간 바(좌상단)는 내구도 HP, 우상단은 Score와 속도입니다.

## 포팅된 원본 모델 (15개)

| JS 파일 | 원본 Java | 살린 내용 |
|---|---|---|
| `js/Vector.js` | `vector.java` | 벡터 연산 |
| `js/Entity.js` | `Entity.java` | 추상 베이스 클래스 |
| `js/NonLivingEntity.js` | `NonLivingEntity.java` | hitBox |
| `js/MapGridSquare.js` | `mapGridSquare.java` | 초록 격자(100px, 원본 색상 동일) |
| `js/GameMap.js` | `map.java` | 60×60 맵, 보이는 격자만 그리기 (※ JS 내장 `Map`과 충돌 방지改名) |
| `js/Particle.js` | `Particle.java` | 회색 연기 / 빨·주·노 폭발 불꽃 |
| `js/ParticleGenerator.js` | `ParticleGenerator.java` | 랜덤 각도 ±10 연기 생성기 |
| `js/LivingEntity.js` | `LivingEntity.java` | 무적 5프레임, 마찰 .3, 회전사각형 선분교차 충돌, 넉백(/1.5 분산) |
| `js/PlayerCar.js` | `playerCar.java` | 드리프트(3/-5), 회전 중 절반 감속, 자동 가속 |
| `js/StandardCar.js` | `standardCar.java` | HP 1000, 최고속도 12, 회색+시안 차체 |
| `js/Cop.js` | `cop.java` | HP 200, 최고속도 14, ±20° 추격 AI, 스턴 60프레임, 잔해 120프레임 |
| `js/SmashyRoadPanel.js` | `SmashyRoadPanel.java` | 1000×700 화면, Score, GAME OVER 오버레이 |
| `js/GameTimer.js` | `GameTimer.java` | 17ms 고정 스텝 (rAF로 재현) |
| `js/SmashyRoadPanelListener.js` | `SmashyRoadPanelListener.java` | 키 입력 (WASD·모바일 터치로 확장) |
| `js/main.js` | `SmashyRoadMain.java` | 캔버스 초기화·반응형 리사이즈 |

## 원본 버그 수정 1건

원본 `GameTimer.calculateScore()`는 `totalScore = 999999999 × (생존초 + 처치)` 라서
1초 만에 경찰이 수백만 대 스폰됩니다.
의도(생존 시간 + 처치 점수)만 살려 `생존초 + 처치점수`로 바꾸고 경찰 상한을 12대로 뒀습니다.

## 로컬에서 실행하기

빌드 과정 없이 정적 파일만으로 동작합니다.

```bash
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000 열기
```

## 배포

`main` 브랜치 → GitHub Pages (Deploy from a branch, /(root))로 배포되어 있습니다.
`main`에 푸시하면 자동 재배포됩니다.

## 크레딧

- 원작: [lakshyajain06/SmashyRoad](https://github.com/lakshyajain06/SmashyRoad)
- 웹 포팅: 이 리포지토리
