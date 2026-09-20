// playerCar.java → PlayerCar.js (1:1 포트)
// 원본: 드리프트(driftingMaxSpeed=3, slide=-5), 자동 가속, 회전 중 감속(최고속도 절반)
class PlayerCar extends LivingEntity {
  constructor(
    x, position, xSize, ySize, HP, totalHP,
    maxTurnSpeed, turnAcceleration, rotation,
    acceleration, maxSpeed, speed
  ) {
    super(
      x, position, xSize, ySize, HP, totalHP,
      maxTurnSpeed, turnAcceleration, rotation,
      acceleration, maxSpeed, speed
    );
    if (new.target === PlayerCar) {
      throw new Error('PlayerCar는 abstract 클래스입니다.');
    }
    this.driftingMaxSpeed = 3;
    this.amountOfDriftSlide = -5;
    this.alreadyDrifting = false;
    this.switchToDrifting = true;
  }

  update() {
    this.updateParticleGenerator();
    this.controlRotation();
    this.movePlayer();
    this.splitSpeedVector();
    this.controlSpeed();
    this.shiftRotationPointForDrifting();
    this.moveHitBox();
  }

  shiftRotationPointForDrifting() {
    if (this.isDrifting()) {
      this.alreadyDrifting = true;
      this.addDriftSlide();
    } else {
      if (!this.switchToDrifting) this.switchToDrifting = true;
      this.alreadyDrifting = false;
    }
  }

  isDrifting() {
    if (
      Math.abs(this.getCurrentTurnSpeed()) >
        Math.floor((this.getMaxTurnSpeed() * 7) / 8) &&
      (Math.abs(this.getSpeed()) > Math.floor((this.getMaxSpeed() * 3) / 4) ||
        this.alreadyDrifting)
    ) {
      return true;
    }
    return false;
  }

  addDriftSlide() {
    const rot =
      this.getCurrentTurnSpeed() > 0
        ? this.getRotation() + 90
        : this.getRotation() - 90;
    const rad = (rot * Math.PI) / 180;
    const mx = this.getGameMap().getPosition().getX();
    const my = this.getGameMap().getPosition().getY();
    this.getGameMap().setPosition(
      new Vector(
        mx - Math.cos(rad) * this.amountOfDriftSlide,
        my - Math.sin(rad) * this.amountOfDriftSlide
      )
    );
  }

  controlRotation() {
    if (this.isAlive()) {
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

  controlSpeed() {
    // 넉백 마찰 감쇠 (원본 그대로)
    const kb = this.getKnockBackVector();
    if (-this.getFriction() > kb.getX()) kb.setX(kb.getX() + this.getFriction());
    else if (this.getFriction() < kb.getX()) kb.setX(kb.getX() - this.getFriction());
    else kb.setX(0);
    if (-this.getFriction() > kb.getY()) kb.setY(kb.getY() + this.getFriction());
    else if (this.getFriction() < kb.getY()) kb.setY(kb.getY() - this.getFriction());
    else kb.setY(0);

    if (this.isAlive()) {
      if (this.getAcceleration() >= 0) {
        if (this.isDrifting()) {
          if (this.getSpeed() < this.driftingMaxSpeed) {
            this.setSpeed(this.getSpeed() + 3 * this.getAcceleration());
          } else if (this.getSpeed() > this.driftingMaxSpeed) {
            this.setSpeed(this.getSpeed() - 3 * this.getAcceleration());
          }
        } else if (this.isTurning()) {
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
        if (this.getSpeed() > -this.getMaxSpeed() / 2) {
          this.setSpeed(this.getSpeed() + this.getAcceleration());
        } else if (this.getSpeed() < -this.getMaxSpeed() / 2) {
          this.setSpeed(-this.getMaxSpeed() / 2);
        }
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

  movePlayer() {
    // 원본: 배경(맵)을 움직여 차가 달리는 것처럼 표현
    this.getSpeedVector().subtract(this.getKnockBackVector());
    this.getGameMap().getPosition().subtract(this.getSpeedVector());
    this.setPositionOnMap(this.positionOnMapCalc());
  }

  calculateDamage(impactVector) {
    return impactVector.getMagnitude();
  }

  isAlreadyDrifting() { return this.alreadyDrifting; }
  setAlreadyDrifting(b) { this.alreadyDrifting = b; }
}
window.PlayerCar = PlayerCar;
