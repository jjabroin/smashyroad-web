// SmashyRoadPanel.java → SmashyRoadPanel.js (1:1 포트)
// 원본: 60x60 맵(-30000,-21000), 중앙 플레이어, cops 리스트,
// reset()=20x20 맵(-10000,-7000), paintComponent()=맵→경찰→플레이어→Score→GAME OVER
class SmashyRoadPanel {
  constructor(width, height) {
    this.width = width;
    this.height = height;

    this.gameMap = new GameMap(new Vector(-30000, -21000), 60, 60, height, width);
    this.player = new StandardCar(this.gameMap, new Vector(width / 2, height / 2));
    this.gameMap.setPlayer(this.player);
    this.cops = [];
    this.timer = null;
  }

  reset() {
    this.gameMap = new GameMap(new Vector(-10000, -7000), 20, 20, this.height, this.width);
    this.player = new StandardCar(this.gameMap, new Vector(this.width / 2, this.height / 2));
    this.gameMap.setPlayer(this.player);
    this.cops = [];
    if (this.timer) this.timer.reset();
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    // 맵 타일 크기를 새 창 크기에 맞춤 (원본은 고정 1000x700)
    this.gameMap.windowHeight = height;
    this.gameMap.windowWidth = width;
    for (let i = 0; i < this.gameMap.grid.length; i++) {
      for (let j = 0; j < this.gameMap.grid[i].length; j++) {
        const sq = this.gameMap.grid[i][j];
        sq.setWindowHeight(height);
        sq.setWindowWidth(width);
        sq.squareSizeX = width;
        sq.squareSizeY = height;
      }
    }
    // 플레이어는 항상 화면 중앙 (원본: width/2, height/2 고정)
    this.player.setPosition(new Vector(width / 2, height / 2));
  }

  // 원본 paintComponent(g)
  paintComponent(ctx) {
    this.gameMap.draw(ctx);
    for (let i = 0; i < this.cops.length; i++) {
      this.cops[i].draw(ctx);
    }
    this.player.draw(ctx);

    // Score (원본: drawString "Score: " + totalScore at 50,50)
    ctx.fillStyle = '#000';
    ctx.font = 'bold 20px SansSerif, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Score: ' + this.timer.getTotalScore(), 50, 50);

    // 속도계 (레이싱 게임용 추가 HUD — 원본 모델 값 그대로 표시)
    ctx.font = 'bold 16px SansSerif, sans-serif';
    ctx.fillText('Speed: ' + Math.abs(this.player.getSpeed()).toFixed(1), 50, 74);

    if (this.timer.isGameOver()) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.textAlign = 'center';
      ctx.font = '32px SansSerif, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText('GAME OVER', this.width / 2, this.height / 2 - 30);
      ctx.font = '18px SansSerif, sans-serif';
      ctx.fillText(
        'Your score was: ' + this.timer.getTotalScore(),
        this.width / 2, this.height / 2 + 10
      );
      ctx.fillText(
        'Press SPACE / Tap to restart',
        this.width / 2, this.height / 2 + 45
      );
      ctx.textAlign = 'left';
    }
  }

  getCops() { return this.cops; }
  getPlayer() { return this.player; }
  getGameMap() { return this.gameMap; }
  setTimer(timer) { this.timer = timer; }
  getTimer() { return this.timer; }
}
window.SmashyRoadPanel = SmashyRoadPanel;
