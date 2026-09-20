// Entity.java → Entity.js (abstract, 1:1 포트)
// 원본: position(vector), xSize, ySize + draw(g) 추상
class Entity {
  constructor(position, xSize, ySize) {
    if (new.target === Entity) {
      throw new Error('Entity는 abstract 클래스입니다.');
    }
    this.position = position;
    this.ySize = ySize;
    this.xSize = xSize;
  }

  // 하위 클래스가 오버라이드 (Graphics2D → CanvasRenderingContext2D)
  draw(ctx) {
    throw new Error('draw()를 오버라이드하세요.');
  }

  getxSize() { return this.xSize; }
  setxSize(xSize) { this.xSize = xSize; }
  getySize() { return this.ySize; }
  setySize(ySize) { this.ySize = ySize; }
  getPosition() { return this.position; }
  setPosition(position) { this.position = position; }
}
window.Entity = Entity;
