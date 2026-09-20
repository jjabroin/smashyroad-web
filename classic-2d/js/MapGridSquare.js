// mapGridSquare.java → MapGridSquare.js (1:1 포트)
// 원본: lineGridSize=100, 초록 바탕(61,217,102) + 격자선(66,194,99) + obstacles(빈 배열)
class MapGridSquare {
  constructor(row, col, windowHeight, windowWidth, mapPosition) {
    this.lineGridSize = 100;

    this.row = row;
    this.col = col;
    this.windowHeight = windowHeight;
    this.windowWidth = windowWidth;
    this.obstacles = []; // 원본: new NonLivingEntity[0]
    this.position = new Vector(
      mapPosition.getX() + windowWidth * col,
      mapPosition.getY() + windowHeight * row
    );

    this.squareSizeX = windowWidth;
    this.squareSizeY = windowHeight;
  }

  // 원본 update(): 맵 위치 따라 격자 위치 갱신 + 장애물 hitBox 이동
  update(mapPosition) {
    this.position.setX(mapPosition.getX() + this.windowWidth * this.col);
    this.position.setY(mapPosition.getY() + this.windowHeight * this.row);
    for (let i = 0; i < this.obstacles.length; i++) {
      this.getObstacles()[i].setPosition(this.getPosition());
      this.obstacles[i].moveHitBox();
    }
  }

  draw(ctx) {
    ctx.fillStyle = 'rgb(61,217,102)';
    ctx.fillRect(
      Math.floor(this.position.getX()),
      Math.floor(this.position.getY()),
      this.squareSizeX,
      this.squareSizeY
    );
    ctx.strokeStyle = 'rgb(66,194,99)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= this.squareSizeX / this.lineGridSize; i++) {
      const x = Math.floor(this.position.getX()) + i * this.lineGridSize;
      ctx.moveTo(x, Math.floor(this.position.getY()));
      ctx.lineTo(x, Math.floor(this.position.getY()) + this.squareSizeY);
    }
    for (let i = 0; i <= this.squareSizeY / this.lineGridSize; i++) {
      const y = Math.floor(this.position.getY()) + i * this.lineGridSize;
      ctx.moveTo(Math.floor(this.position.getX()), y);
      ctx.lineTo(Math.floor(this.position.getX()) + this.squareSizeX, y);
    }
    ctx.stroke();

    for (let i = 0; i < this.obstacles.length; i++) {
      this.obstacles[i].draw(ctx);
    }
  }

  contains(posOnMap) {
    const x = Math.floor(posOnMap.getX());
    const y = Math.floor(posOnMap.getY());
    if (this.windowWidth * this.col < x && x < this.windowWidth * (this.col + 1)) {
      if (this.windowHeight * this.row < y && y < this.windowHeight * (this.row + 1)) {
        return true;
      }
    }
    return false;
  }

  getPosition() { return this.position; }
  setPosition(position) { this.position = position; }
  getObstacles() { return this.obstacles; }
  setObstacles(obstacles) { this.obstacles = obstacles; }
  getCol() { return this.col; }
  setCol(col) { this.col = col; }
  getRow() { return this.row; }
  setRow(row) { this.row = row; }
  getWindowHeight() { return this.windowHeight; }
  setWindowHeight(h) { this.windowHeight = h; }
  getWindowWidth() { return this.windowWidth; }
  setWindowWidth(w) { this.windowWidth = w; }
}
window.MapGridSquare = MapGridSquare;
