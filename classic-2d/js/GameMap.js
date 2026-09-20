// map.java → GameMap.js (1:1 포트, 클래스명만 Map→GameMap: JS 내장 Map과 충돌 방지)
// 원본: position, windowHeight/Width, grid[y][x], player
// createMap/update/draw(rowsForPlayer/colsForPlayer로 보이는 2x2 격자만 그리기)
class GameMap {
  constructor(position, xGrids, yGrids, windowHeight, windowWidth) {
    this.position = position;
    this.windowHeight = windowHeight;
    this.windowWidth = windowWidth;
    this.grid = [];
    for (let i = 0; i < yGrids; i++) {
      this.grid.push(new Array(xGrids));
    }
    this.player = null;
    this.createMap();
  }

  createMap() {
    for (let i = 0; i < this.grid.length; i++) {
      for (let j = 0; j < this.grid[i].length; j++) {
        this.grid[i][j] = new MapGridSquare(
          i, j, this.windowHeight, this.windowWidth, this.position
        );
      }
    }
  }

  update() {
    for (let i = 0; i < this.grid.length; i++) {
      for (let j = 0; j < this.grid[i].length; j++) {
        this.grid[i][j].update(this.position);
      }
    }
  }

  draw(ctx) {
    const rows = this.rowsForPlayer();
    const cols = this.colsForPlayer();
    for (let i = 0; i < rows.length; i++) {
      for (let j = 0; j < cols.length; j++) {
        const r = rows[i];
        const c = cols[j];
        // 원본은 경계 체크 없음 → 웹에서는 클램프(맵 밖으로 나가도 크래시 방지)
        if (r >= 0 && r < this.grid.length && c >= 0 && c < this.grid[0].length) {
          this.grid[r][c].draw(ctx);
        } else {
          // 맵 밖: 같은 초록색으로 채워 무한 주행처럼 보이게
          ctx.fillStyle = 'rgb(61,217,102)';
          ctx.fillRect(
            Math.floor(this.position.getX()) + c * this.windowWidth,
            Math.floor(this.position.getY()) + r * this.windowHeight,
            this.windowWidth,
            this.windowHeight
          );
        }
      }
    }
  }

  rowsForPlayer() {
    const rows = new Array(2);
    rows[0] = Math.floor(
      (this.player.getPositionOnMap().getY() - this.windowHeight / 2) / this.windowHeight
    );
    rows[1] = Math.floor(
      (this.player.getPositionOnMap().getY() + this.windowHeight / 2) / this.windowHeight
    );
    return rows;
  }

  colsForPlayer() {
    const cols = new Array(2);
    cols[0] = Math.floor(
      (this.player.getPositionOnMap().getX() - this.windowWidth / 2) / this.windowWidth
    );
    cols[1] = Math.floor(
      (this.player.getPositionOnMap().getX() + this.windowWidth / 2) / this.windowWidth
    );
    return cols;
  }

  getPosition() { return this.position; }
  setPosition(position) { this.position = position; }
  getPlayer() { return this.player; }
  setPlayer(player) { this.player = player; }
  getGrid() { return this.grid; }
}
window.GameMap = GameMap;
