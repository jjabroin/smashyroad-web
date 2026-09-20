// ParticleGenerator.java → ParticleGenerator.js (1:1 포트)
// 원본: numOfParticle=100, pause=40, 랜덤 각도 ±10, 투명해지면 제거
class ParticleGenerator {
  constructor(x, y, rotation, gameMap) {
    this.numOfParticle = 100;
    this.pause = 40;
    this.rotation = rotation;
    this.x = x;
    this.y = y;
    this.particles = [];
    this.counter = 0;
    this.gameMap = gameMap;
  }

  draw(ctx) {
    this.update();
    for (let i = 0; i < this.particles.length; i++) {
      this.particles[i].draw(ctx);
    }
  }

  drawDead(ctx) {
    this.update();
    for (let i = 0; i < this.particles.length; i++) {
      this.particles[i].drawDead(ctx);
    }
  }

  update() {
    const ranRot = Math.floor(Math.random() * 21) - 10;
    for (let i = 0; i < this.particles.length; i++) {
      this.particles[i].update();
      if (this.particles[i].getTransparency() <= 0) {
        this.particles.splice(i, 1);
        i--;
      }
    }
    if (this.counter > this.pause) this.counter = 0;
    if (this.counter === 0) {
      if (this.particles.length < this.numOfParticle) {
        const randNum = Math.floor(Math.random() * 6);
        this.particles.push(
          new Particle(this.x, this.y, this.rotation + ranRot, this.gameMap, randNum)
        );
      }
    }
    this.counter++;
  }

  getX() { return this.x; }
  setX(x) { this.x = x; }
  getY() { return this.y; }
  setY(y) { this.y = y; }
  getRotation() { return this.rotation; }
  setRotation(rotation) {
    rotation = rotation % 360;
    if (0 > rotation) rotation = 360 + rotation;
    this.rotation = Math.floor(rotation);
  }
  getPause() { return this.pause; }
  setPause(pause) { this.pause = pause; }
}
window.ParticleGenerator = ParticleGenerator;
