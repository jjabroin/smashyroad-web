// standardCar.java → StandardCar.js (1:1 포트)
// 원본 스펙: HP 1000, maxTurn 6, turnAccel .3, accel .075, maxSpeed 12, 76x38
// 원본 색상: 차체(50,50,50) + 검정 중앙 + 시안(CYAN) 윈드실드
class StandardCar extends PlayerCar {
  constructor(x, position) {
    const totalHP = 1000;
    const maxTurnSpeed = 6;
    const turnAcceleration = 0.3;
    const acceleration = 0.075;
    const maxSpeed = 12;
    const xSize = 76;
    const ySize = 38;
    super(
      x, position, xSize, ySize, totalHP, totalHP,
      maxTurnSpeed, turnAcceleration, 270,
      acceleration, maxSpeed, 0
    );
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.getPosition().getX(), this.getPosition().getY());
    ctx.rotate((this.getRotation() * Math.PI) / 180);

    if (this.isAlive()) {
      ctx.fillStyle = 'rgb(50,50,50)';
      ctx.fillRect(this.getTranslatedX(), this.getTranslatedY(), this.getxSize(), this.getySize());
      ctx.fillStyle = '#000';
      ctx.fillRect(
        this.getTranslatedX() + (this.getxSize() * 3) / 20,
        this.getTranslatedY(),
        this.getxSize() / 2,
        this.getySize()
      );
      ctx.fillStyle = '#0ff'; // 원본 Color.CYAN
      ctx.fillRect(
        this.getTranslatedX() + (this.getxSize() * 13) / 20,
        this.getTranslatedY() + this.getySize() / 10,
        this.getxSize() / 20,
        (this.getySize() * 8) / 10
      );
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(this.getTranslatedX(), this.getTranslatedY(), this.getxSize(), this.getySize());
    }
    ctx.restore();

    this.drawHealthBar(ctx);

    // 원본: HP 50% 이하 연기, 25% 이하 진한 연기, 사망 시 불꽃
    if (this.getHP() / this.getTotalHP() <= 0.5) {
      if (this.getHP() / this.getTotalHP() <= 0) {
        this.getSmokeLeft().setPause(5);
        this.getSmokeRight().setPause(5);
      } else if (this.getHP() / this.getTotalHP() <= 0.25) {
        this.getSmokeLeft().setPause(20);
        this.getSmokeRight().setPause(20);
      }
      if (this.isAlive()) {
        this.getSmokeLeft().draw(ctx);
        this.getSmokeRight().draw(ctx);
      } else {
        this.getSmokeLeft().drawDead(ctx);
        this.getSmokeRight().drawDead(ctx);
      }
    }
  }
}
window.StandardCar = StandardCar;
