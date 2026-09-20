// GameTimer.java → GameTimer.js (1:1 포트, rAF 구동)
// 원본: 17ms Swing Timer, secInGame+=0.017, 충돌관리, cop 생성/삭제, 점수, 게임오버
//
// ★ 원본 버그 수정 (주석으로 명시):
//   원본 calculateScore(): totalScore = 999999999 * ((int)sec + killScore)
//   → 1초 만에 10억점, calculateNumberOfCops()=1+totalScore/20 → 경찰 수백만 대.
//   웹 포팅에서는 의도(생존시간+처치)를 살려 totalScore = floor(sec) + killScore,
//   경찰 수 = 1 + floor(totalScore/20), 상한 MAX_COPS.
class GameTimer {
  constructor(panel) {
    this.panel = panel;
    this.secInGame = 0;
    this.totalScore = 0;
    this.killScore = 0;
    this.gameOver = false;
    this.numberOfCops = 0;
    this.MAX_COPS = 12;
    this.acc = 0; // rAF 델타 누적
    this.lastTs = 0;
    this.running = false;
    this.step = 17 / 1000; // 원본 17ms 고정 스텝
    this._boundLoop = (ts) => this.loop(ts);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTs = performance.now();
    requestAnimationFrame(this._boundLoop);
  }

  pauseTimer() {
    this.running = false;
  }

  unpauseTimer() {
    if (!this.running) this.start();
  }

  loop(ts) {
    if (!this.running) return;
    let dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    if (dt > 0.1) dt = 0.1; // 탭 전환 복귀 시 폭주 방지
    this.acc += dt;
    // 고정 스텝으로 원본과 동일한 물리 재현
    while (this.acc >= this.step) {
      this.actionPerformed();
      this.acc -= this.step;
    }
    this.panel.paintComponent(this.panel.ctx);
    requestAnimationFrame(this._boundLoop);
  }

  // 원본 actionPerformed(e) — 순서 그대로
  actionPerformed() {
    this.panel.getPlayer().update();
    this.panel.getGameMap().update();
    for (let i = 0; i < this.panel.getCops().length; i++) {
      this.panel.getCops()[i].update();
    }
    this.manageCollisions();
    this.killCopWithZeroHealth();
    this.deleteNecessaryCops();

    this.secInGame += 0.017;
    this.calculateNumberOfCops();
    this.manageActualNumberOfCops();

    if (this.panel.getPlayer().getHP() <= 0) {
      this.panel.getPlayer().setAlive(false);
      this.gameOver = true;
    }
    if (!this.gameOver) {
      this.calculateScore();
    }
  }

  killCopWithZeroHealth() {
    const cops = this.panel.getCops();
    for (let i = 0; i < cops.length; i++) {
      if (cops[i].isAlive() && cops[i].getHP() <= 0) {
        this.killScore += cops[i].getScorevalue(); // 원본: scoreValue 5
        cops[i].setAlive(false);
      }
    }
  }

  deleteNecessaryCops() {
    const cops = this.panel.getCops();
    for (let i = 0; i < cops.length; i++) {
      if (cops[i].isShouldDelete()) {
        cops.splice(i, 1);
        i--;
      }
    }
  }

  manageCollisions() {
    const cops = this.panel.getCops();
    // 플레이어 vs 경찰 (원본 그대로)
    for (let i = 0; i < cops.length; i++) {
      if (this.panel.getPlayer().collides(cops[i])) {
        this.panel.getPlayer().knockBack(cops[i]);
      }
    }
    // 경찰 vs 경찰 (원본 그대로)
    for (let i = 0; i < cops.length; i++) {
      for (let j = i + 1; j < cops.length; j++) {
        if (cops[i].collides(cops[j])) {
          cops[i].knockBack(cops[j]);
        }
      }
    }
  }

  manageActualNumberOfCops() {
    if (this.panel.getCops().length < this.numberOfCops) {
      this.createRandomCop();
    }
  }

  createRandomCop() {
    // 원본: 랜덤 각도로 1000px 거리에서 스폰, 반대 방향을 바라봄
    const rot = Math.floor(Math.random() * 361);
    const rad = (rot * Math.PI) / 180;
    const pos = new Vector(Math.cos(rad) * 1000, Math.sin(rad) * 1000);
    // 원본은 화면좌표 기준 스폰 → 웹에서는 플레이어(화면 중앙) 기준 오프셋으로 변환
    const px = this.panel.getPlayer().getPosition().getX();
    const py = this.panel.getPlayer().getPosition().getY();
    const screenPos = new Vector(px + pos.getX(), py + pos.getY());
    this.panel.getCops().push(
      new Cop(screenPos, 180 + rot, this.panel.getPlayer(), this.panel.getGameMap())
    );
  }

  calculateScore() {
    // 수정됨: 원본 999999999*... 대신 생존초 + 처치점수
    this.totalScore = Math.floor(this.secInGame) + this.killScore;
  }

  reset() {
    this.totalScore = 0;
    this.secInGame = 0;
    this.killScore = 0;
    this.gameOver = false;
    this.numberOfCops = 0;
    this.acc = 0;
  }

  calculateNumberOfCops() {
    // 수정됨: 상한 추가로 폭주 방지 (원본 식의 의도만 유지)
    this.numberOfCops = Math.min(
      this.MAX_COPS,
      1 + Math.floor(this.totalScore / 20)
    );
  }

  getsecInGame() { return this.secInGame; }
  setsecInGame(s) { this.secInGame = s; }
  getTotalScore() { return this.totalScore; }
  setTotalScore(s) { this.totalScore = s; }
  isGameOver() { return this.gameOver; }
  setGameOver(b) { this.gameOver = b; }
}
window.GameTimer = GameTimer;
