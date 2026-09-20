// Particle.java → Particle.js (1:1 포트)
// 원본 상수: speed=3, deceleration=.1, angularVelocity=7, angVelDec=.1,
// size=7(+1씩 증가), transparency=255(-7씩 감소)
// draw()=회색 연기, drawDead()=불꽃(빨/주/노) — 원본 Color 그대로
class Particle {
  constructor(x, y, rotation, gameMap, colorNum) {
    this.speed = 3;
    this.deceleration = 0.1;
    this.angularVelocity = 7;
    this.angVelDec = 0.1;
    this.size = 7;
    this.sizeIncrease = 1;
    this.transparencyDec = 7;
    this.transparency = 255;

    this.gameMap = gameMap;
    this.x = x;
    this.y = y;
    this.position = this.positionOnMap();

    this.forceRotation = rotation;
    this.rotation = rotation;
    this.speedV = new Vector(
      Math.cos((rotation * Math.PI) / 180) * this.speed,
      Math.sin((rotation * Math.PI) / 180) * this.speed
    );
    this.colorNum = colorNum;
  }

  update() {
    this.controlSpeed();
    this.controlRotation();
    this.splitSpeedVector();
    this.move();
    this.size += this.sizeIncrease;
    this.makeTransparent();
  }

  getRotation() { return this.rotation; }
  setRotation(rotation) {
    rotation = rotation % 360;
    if (0 > rotation) rotation = 360 + rotation;
    this.rotation = Math.floor(rotation);
  }
  splitSpeedVector() {
    this.speedV.setX(Math.cos((this.forceRotation * Math.PI) / 180) * this.speed);
    this.speedV.setY(Math.sin((this.forceRotation * Math.PI) / 180) * this.speed);
  }
  controlSpeed() {
    if (this.speed > this.deceleration) this.speed -= this.deceleration;
    else if (this.speed < -this.deceleration) this.speed += this.deceleration;
    else this.speed = 0;
  }
  controlRotation() {
    if (this.angularVelocity > this.angVelDec) this.angularVelocity -= this.angVelDec;
    else if (this.angularVelocity < -this.angVelDec) this.angularVelocity += this.angVelDec;
    else this.angularVelocity = 0;
    this.rotation += this.angularVelocity;
  }
  move() {
    this.position.add(this.speedV);
    this.x = Math.floor(this.gameMap.getPosition().getX() + this.position.getX());
    this.y = Math.floor(this.gameMap.getPosition().getY() + this.position.getY());
  }
  makeTransparent() {
    if (this.transparency > 0) this.transparency -= this.transparencyDec;
  }

  // 회색 연기 (원본 61,61,61)
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate((this.getRotation() * Math.PI) / 180);
    ctx.fillStyle = `rgba(61,61,61,${Math.max(0, this.transparency) / 255})`;
    ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
    ctx.restore();
  }

  // 폭발 불꽃 (원본: 0=빨강 222,51,24 / 1=주황 237,126,36 / 2=노랑 237,195,57)
  drawDead(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate((this.getRotation() * Math.PI) / 180);
    const a = Math.max(0, this.transparency) / 255;
    if (this.colorNum === 0) ctx.fillStyle = `rgba(222,51,24,${a})`;
    else if (this.colorNum === 1) ctx.fillStyle = `rgba(237,126,36,${a})`;
    else if (this.colorNum === 2) ctx.fillStyle = `rgba(237,195,57,${a})`;
    else ctx.fillStyle = `rgba(61,61,61,${a})`;
    ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
    ctx.restore();
  }

  getTransparency() { return this.transparency; }
  setTransparency(t) { this.transparency = t; }
  positionOnMap() {
    return new Vector(
      this.x - this.gameMap.getPosition().getX(),
      this.y - this.gameMap.getPosition().getY()
    );
  }
}
window.Particle = Particle;
