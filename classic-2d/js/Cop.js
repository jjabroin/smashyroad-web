// cop.java → Cop.js (1:1 포트)
// 원본 스펙: HP 200, maxTurn 2, turnAccel .3, accel .055, maxSpeed 14(플레이어보다 빠름!),
// 76x38, scoreValue 5, stun 60프레임, deathTime 120프레임
// 원본 색상: 짙은 파랑(2,37,110)+흰 중앙+검정 창문+빨강/하늘 사이렌
class Cop extends LivingEntity {
  constructor(position, rotation, car, gameMap) {
    const totalHP = 200;
    const maxTurnSpeed = 2;
    const turnAcceleration = 0.3;
    const acceleration = 0.055;
    const maxSpeed = 14;
    const copXSize = 76;
    const copYSize = 38;
    super(
      gameMap, position, copXSize, copYSize, totalHP, totalHP,
      maxTurnSpeed, turnAcceleration, rotation,
      acceleration, maxSpeed, 10
    );
    this.scoreValue = 5;
    this.stunTime = 60;
    this.stun = false;
    this.stunCounter = 0;
    this.deathTime = 120;
    this.shouldDelete = false;
    this.deadCounter = 0;
    this.player = car;
  }

  update() {
    if (!this.isAlive()) this.deadCounter++;
    if (this.deadCounter >= this.deathTime) this.shouldDelete = true;
    this.updateParticleGenerator();
    this.controlRotation();
    this.moveCop();
    this.splitSpeedVector();
    this.controlSpeed();
    this.moveHitBox();
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.getPosition().getX(), this.getPosition().getY());
    ctx.rotate((this.getRotation() * Math.PI) / 180);

    if (this.isAlive()) {
      ctx.fillStyle = 'rgb(2,37,110)';
      ctx.fillRect(this.getTranslatedX(), this.getTranslatedY(), this.getxSize(), this.getySize());
      ctx.fillStyle = '#fff';
      ctx.fillRect(
        Math.floor(this.getTranslatedX() + this.getxSize() / 4),
        this.getTranslatedY(),
        this.getxSize() / 2,
        this.getySize()
      );
      ctx.fillStyle = '#000';
      ctx.fillRect(
        Math.floor(this.getTranslatedX() + (this.getxSize() * 5) / 8),
        this.getTranslatedY() + (this.getySize() * 2) / 20,
        this.getxSize() / 8,
        (this.getySize() * 17) / 20
      );
      ctx.fillStyle = '#f00'; // 원본 Color.RED 사이렌
      ctx.fillRect(
        Math.floor(this.getTranslatedX() + (this.getxSize() * 6) / 16),
        this.getTranslatedY() + (this.getySize() * 2) / 20,
        this.getxSize() / 8,
        (this.getySize() * 17) / 40
      );
      ctx.fillStyle = 'rgb(20,180,245)'; // 원본 하늘색 사이렌
      ctx.fillRect(
        Math.floor(this.getTranslatedX() + (this.getxSize() * 6) / 16),
        this.getTranslatedY() + (this.getySize() * 21) / 40,
        this.getxSize() / 8,
        (this.getySize() * 17) / 40
      );
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(this.getTranslatedX(), this.getTranslatedY(), this.getxSize(), this.getySize());
    }
    ctx.restore();

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

  angleToCar() {
    let angle =
      (Math.atan2(
        this.player.getPosition().getY() - this.getPosition().getY(),
        this.player.getPosition().getX() - this.getPosition().getX()
      ) *
        180) /
      Math.PI;
    angle = Math.floor(angle) % 360;
    if (0 > angle) angle = 360 + angle;
    return angle;
  }

  // -1 좌회전, 0 직진, 1 우회전 (±20도 데드존 — 원본 그대로)
  directionToTurn() {
    let shifted = this.angleToCar() - this.getRotation();
    while (-180 > shifted) shifted += 360;
    while (180 < shifted) shifted -= 360;
    if (shifted > 20) return 1;
    else if (shifted < -20) return -1;
    else return 0;
  }

  moveCop() {
    this.getSpeedVector().subtract(this.getKnockBackVector());
    this.getPositionOnMap().add(this.getSpeedVector());
    this.setPosition(
      new Vector(
        this.getGameMap().getPosition().getX() + this.getPositionOnMap().getX(),
        this.getGameMap().getPosition().getY() + this.getPositionOnMap().getY()
      )
    );
  }

  controlSpeed() {
    const kb = this.getKnockBackVector();
    if (-this.getFriction() > kb.getX()) kb.setX(kb.getX() + this.getFriction());
    else if (this.getFriction() < kb.getX()) kb.setX(kb.getX() - this.getFriction());
    else kb.setX(0);
    if (-this.getFriction() > kb.getY()) kb.setY(kb.getY() + this.getFriction());
    else if (this.getFriction() < kb.getY()) kb.setY(kb.getY() - this.getFriction());
    else kb.setY(0);

    if (this.isAlive()) {
      if (!this.stun) {
        if (this.isTurning()) {
          if (this.getSpeed() < this.getMaxSpeed() / 2) {
            this.setSpeed(this.getSpeed() + this.getAcceleration());
          } else if (this.getSpeed() > this.getMaxSpeed() / 2) {
            this.setSpeed(this.getSpeed() - this.getAcceleration());
          }
        } else {
          if (this.getSpeed() < this.getMaxSpeed()) {
            this.setSpeed(this.getSpeed() + this.getAcceleration());
          } else if (this.getSpeed() > this.getMaxSpeed()) {
            this.setSpeed(this.getMaxSpeed());
          }
        }
      } else {
        this.stunCounter++;
        if (this.getSpeed() > this.getAcceleration()) {
          this.setSpeed(this.getSpeed() - this.getAcceleration());
        }
      }
      if (this.stunCounter >= this.stunTime) {
        this.stunCounter = 0;
        this.stun = false;
      }
    } else {
      if (this.getSpeed() > this.getAcceleration()) {
        this.setSpeed(this.getSpeed() - this.getAcceleration());
      } else if (this.getSpeed() < -this.getAcceleration()) {
        this.setSpeed(this.getSpeed() + this.getAcceleration());
      } else {
        this.setSpeed(0);
      }
    }
  }

  controlRotation() {
    if (this.isAlive()) {
      if (this.directionToTurn() === -1) {
        this.setTurnAcceleration(-this.getPossibleTurnAcceleration());
      } else if (this.directionToTurn() === 1) {
        this.setTurnAcceleration(this.getPossibleTurnAcceleration());
      } else {
        this.setCurrentTurnSpeed(0);
        this.setTurnAcceleration(0);
      }

      this.setRotation(this.getRotation() + this.getCurrentTurnSpeed());

      if (Math.abs(this.getCurrentTurnSpeed()) < this.getMaxTurnSpeed()) {
        this.setCurrentTurnSpeed(
          this.getCurrentTurnSpeed() + this.getTurnAcceleration()
        );
      } else if (this.getCurrentTurnSpeed() > this.getMaxTurnSpeed()) {
        this.setCurrentTurnSpeed(this.getMaxTurnSpeed());
      } else if (this.getCurrentTurnSpeed() < -this.getMaxTurnSpeed()) {
        this.setCurrentTurnSpeed(-this.getMaxTurnSpeed());
      }
    }
  }

  calculateDamage(impactVector) {
    return impactVector.getMagnitude();
  }

  getScorevalue() { return this.scoreValue; }
  isStun() { return this.stun; }
  setStun(s) { this.stun = s; }
  isShouldDelete() { return this.shouldDelete; }
  setShouldDelete(b) { this.shouldDelete = b; }
}
window.Cop = Cop;
