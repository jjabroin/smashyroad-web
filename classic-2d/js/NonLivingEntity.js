// NonLivingEntity.java → NonLivingEntity.js (1:1 포트)
// 원본: Rectangle hitBox, Color color, moveHitBox(), fill(hitBox)
class NonLivingEntity extends Entity {
  constructor(position, xSize, ySize, color) {
    super(position, xSize, ySize);
    this.hitBox = {
      x: Math.floor(position.getX()),
      y: Math.floor(position.getY()),
      w: xSize,
      h: ySize,
    };
    this.color = color; // css color 문자열
  }

  moveHitBox() {
    this.hitBox.x = Math.floor(this.getPosition().getX());
    this.hitBox.y = Math.floor(this.getPosition().getY());
  }

  draw(ctx) {
    ctx.fillStyle = this.color;
    ctx.fillRect(this.hitBox.x, this.hitBox.y, this.hitBox.w, this.hitBox.h);
  }

  getHitBox() { return this.hitBox; }
  setHitBox(hitBox) { this.hitBox = hitBox; }
}
window.NonLivingEntity = NonLivingEntity;
