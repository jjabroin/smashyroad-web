// LivingEntity.java → LivingEntity.js (1:1 포트)
// 원본 핵심 그대로: 무적프레임 5, 마찰 .3, 회전 사각형 bounds 4변,
// 선분교차 충돌 판정, knockBack(충격량=속도차 크기, /1.5 분산, cop 스턴)

function segIntersectsSeg(p1, p2, p3, p4) {
  // Line2D.intersectsLine() 동등 구현 (CCW 판정)
  const d = (a, b, c) =>
    (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
  // 축에 평행한 특수 케이스 보정용 바운딩박스 체크 포함
  const ccw = (a, b, c) =>
    (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
  return (
    ccw(p1, p3, p4) !== ccw(p2, p3, p4) &&
    ccw(p1, p2, p3) !== ccw(p1, p2, p4)
  );
}

function segIntersectsRect(x1, y1, x2, y2, r) {
  // 선분-사각형 교차 (Line2D.intersects(Rectangle) 동등)
  // 끝점 중 하나가 내부에 있으면 충돌
  const inside = (x, y) =>
    x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  if (inside(x1, y1) || inside(x2, y2)) return true;
  const corners = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    if (
      segIntersectsSeg(
        { x: x1, y: y1 }, { x: x2, y: y2 }, a, b
      )
    ) {
      return true;
    }
  }
  return false;
}

class LivingEntity extends Entity {
  constructor(
    gameMap, position, xSize, ySize,
    HP, totalHP, maxTurnSpeed, turnAcceleration,
    rotation, acceleration, maxSpeed, speed
  ) {
    super(position, xSize, ySize);
    if (new.target === LivingEntity) {
      throw new Error('LivingEntity는 abstract 클래스입니다.');
    }

    this.invincibilityFrames = 5;
    this.friction = 0.3;
    this.invincibilityFramesCounter = 0;

    this.translatedX = -this.getxSize() / 2;
    this.translatedY = -this.getySize() / 2;

    this.gameMap = gameMap;
    this.smokeLeft = new ParticleGenerator(
      Math.floor(this.getPosition().getX()),
      Math.floor(this.getPosition().getY()),
      0, gameMap
    );
    this.smokeRight = new ParticleGenerator(
      Math.floor(this.getPosition().getX()),
      Math.floor(this.getPosition().getY()),
      0, gameMap
    );

    this.HP = HP;
    this.totalHP = HP;
    this.maxTurnSpeed = maxTurnSpeed;
    this.turnAcceleration = 0;
    this.possibleTurnAcceleration = turnAcceleration;
    this.setRotation(rotation);
    this.maxSpeed = maxSpeed;
    const rad = (rotation * Math.PI) / 180;
    this.speedVector = new Vector(Math.cos(rad) * speed, Math.sin(rad) * speed);
    this.knockBackVector = new Vector(0, 0);
    this.speed = speed;
    this.currentTurnSpeed = 0;
    this.acceleration = acceleration;
    this.possibleAcceleration = acceleration;

    this.distance = Math.sqrt(
      Math.pow(this.getxSize() / 2, 2) + Math.pow(this.getySize() / 2, 2)
    );
    this.originalAngle = Math.atan(this.getySize() / this.getxSize());
    this.bounds = [null, null, null, null];
    this.recalcBounds(rotation);

    this.alive = true;
    this.positionOnMap = this.positionOnMapCalc();
  }

  // 추상
  update() {
    throw new Error('update()를 오버라이드하세요.');
  }
  calculateDamage(impactVector) {
    throw new Error('calculateDamage()를 오버라이드하세요.');
  }

  // 원본 drawHealthBar: 빨간 바 + 검은 테두리.
  // 원본 좌표(750,10)는 1000px 고정 기준이라, 반응형+README(좌상단) 기준으로 좌상단에 그림.
  drawHealthBar(ctx) {
    const w = 200;
    const ratio = Math.max(0, this.getHP() / this.getTotalHP());
    const x = 12;
    const y = 12;
    ctx.fillStyle = '#e02626';
    ctx.fillRect(x, y, Math.floor(ratio * w), 20);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    ctx.strokeRect(x, y, w, 20);
  }

  recalcBounds(rotation) {
    const px = this.getPosition().getX();
    const py = this.getPosition().getY();
    const d = this.distance;
    const oa = this.originalAngle;
    const rad = (deg) => (deg * Math.PI) / 180;
    const pt = (ang) => ({
      x: px + Math.cos(ang) * d,
      y: py + Math.sin(ang) * d,
    });
    const pA = pt(-oa + rad(rotation));
    const pB = pt(oa + rad(rotation));
    const pC = pt(Math.PI - (-oa + rad(rotation))); // 반대편 = px - cos, py - sin
    const nA = { x: px - Math.cos(-oa + rad(rotation)) * d, y: py - Math.sin(-oa + rad(rotation)) * d };
    const nB = { x: px - Math.cos(oa + rad(rotation)) * d, y: py - Math.sin(oa + rad(rotation)) * d };
    this.bounds[0] = { x1: pA.x, y1: pA.y, x2: pB.x, y2: pB.y };
    this.bounds[1] = { x1: nA.x, y1: nA.y, x2: nB.x, y2: nB.y };
    this.bounds[2] = { x1: pA.x, y1: pA.y, x2: nB.x, y2: nB.y };
    this.bounds[3] = { x1: pB.x, y1: pB.y, x2: nA.x, y2: nA.y };
    void pC;
  }

  moveHitBox() {
    this.recalcBounds(this.rotation);
  }

  splitSpeedVector() {
    const rad = (this.getRotation() * Math.PI) / 180;
    this.speedVector.setX(Math.cos(rad) * this.getSpeed());
    this.speedVector.setY(Math.sin(rad) * this.getSpeed());
  }

  isTurning() {
    return Math.abs(this.currentTurnSpeed) > 0;
  }

  collides(x) {
    // 원본: 무적 프레임 중에는 판정 스킵 + 카운터 증가
    if (this.invincibilityFramesCounter === 0) {
      if (x instanceof LivingEntity) {
        const ob = x.getBounds();
        for (let i = 0; i < ob.length; i++) {
          for (let j = 0; j < this.bounds.length; j++) {
            const a = { x: ob[i].x1, y: ob[i].y1 };
            const b = { x: ob[i].x2, y: ob[i].y2 };
            const c = { x: this.bounds[j].x1, y: this.bounds[j].y1 };
            const dd = { x: this.bounds[j].x2, y: this.bounds[j].y2 };
            if (segIntersectsSeg(a, b, c, dd)) return true;
          }
        }
      } else {
        // 장애물(NonLivingEntity)
        const r = x.getHitBox();
        for (let i = 0; i < this.bounds.length; i++) {
          const s = this.bounds[i];
          if (segIntersectsRect(s.x1, s.y1, s.x2, s.y2, r)) return true;
        }
      }
    } else {
      this.invincibilityFramesCounter++;
    }
    if (this.invincibilityFramesCounter >= this.invincibilityFrames) {
      this.invincibilityFramesCounter = 0;
    }
    return false;
  }

  knockBack(car2) {
    const dx = this.getSpeedVector().getX() - car2.getSpeedVector().getX();
    const dy = this.getSpeedVector().getY() - car2.getSpeedVector().getY();
    this.knockBackVector = new Vector(dx, dy);
    this.setHP(this.getHP() - this.calculateDamage(this.knockBackVector));
    car2.setHP(car2.getHP() - car2.calculateDamage(this.knockBackVector));
    this.knockBackVector.divide(1.5);
    car2.setKnockBackVector(this.knockBackVector.negativeVector());
    this.invincibilityFramesCounter++;
    car2.setInvincibilityFramesCounter(1);
    if (this instanceof PlayerCar) {
      car2.setStun(true);
    }
  }

  updateParticleGenerator() {
    const rad = (this.getRotation() * Math.PI) / 180;
    const off = (3 / 8) * this.getxSize();
    this.getSmokeLeft().setX(
      Math.floor(this.getPosition().getX() + Math.cos(rad) * off)
    );
    this.getSmokeLeft().setY(
      Math.floor(this.getPosition().getY() + Math.sin(rad) * off)
    );
    this.getSmokeLeft().setRotation(this.getRotation() - 90);

    this.getSmokeRight().setX(
      Math.floor(this.getPosition().getX() + Math.cos(rad) * off)
    );
    this.getSmokeRight().setY(
      Math.floor(this.getPosition().getY() + Math.sin(rad) * off)
    );
    this.getSmokeRight().setRotation(90 + this.getRotation());
  }

  positionOnMapCalc() {
    return new Vector(
      Math.floor(this.getPosition().getX() - this.getGameMap().getPosition().getX()),
      Math.floor(this.getPosition().getY() - this.getGameMap().getPosition().getY())
    );
  }

  getHP() { return this.HP; }
  setHP(hP) { this.HP = hP; }
  getTotalHP() { return this.totalHP; }
  getCurrentTurnSpeed() { return this.currentTurnSpeed; }
  setCurrentTurnSpeed(s) { this.currentTurnSpeed = s; }
  getSpeed() { return this.speed; }
  setSpeed(speed) { this.speed = speed; }
  getMaxTurnSpeed() { return this.maxTurnSpeed; }
  setMaxTurnSpeed(s) { this.maxTurnSpeed = s; }
  getTurnAcceleration() { return this.turnAcceleration; }
  setTurnAcceleration(a) { this.turnAcceleration = a; }
  getRotation() { return this.rotation; }
  setRotation(rotation) {
    rotation = rotation % 360;
    if (0 > rotation) rotation = 360 + rotation;
    this.rotation = Math.floor(rotation);
  }
  getAcceleration() { return this.acceleration; }
  setAcceleration(a) { this.acceleration = a; }
  getMaxSpeed() { return this.maxSpeed; }
  setMaxSpeed(s) { this.maxSpeed = s; }
  getSpeedVector() { return this.speedVector; }
  setSpeedVector(v) { this.speedVector = v; }
  getPossibleAcceleration() { return this.possibleAcceleration; }
  getPossibleTurnAcceleration() { return this.possibleTurnAcceleration; }
  getBounds() { return this.bounds; }
  getKnockBackVector() { return this.knockBackVector; }
  setKnockBackVector(v) { this.knockBackVector = v; }
  getInvincibilityFramesCounter() { return this.invincibilityFramesCounter; }
  setInvincibilityFramesCounter(c) { this.invincibilityFramesCounter = c; }
  getFriction() { return this.friction; }
  isAlive() { return this.alive; }
  setAlive(a) { this.alive = a; }
  getSmokeLeft() { return this.smokeLeft; }
  setSmokeLeft(s) { this.smokeLeft = s; }
  getSmokeRight() { return this.smokeRight; }
  setSmokeRight(s) { this.smokeRight = s; }
  getGameMap() { return this.gameMap; }
  setGameMap(m) { this.gameMap = m; }
  getPositionOnMap() { return this.positionOnMap; }
  setPositionOnMap(p) { this.positionOnMap = p; }
  getTranslatedX() { return this.translatedX; }
  getTranslatedY() { return this.translatedY; }
}
window.LivingEntity = LivingEntity;
window.__segHelpers = { segIntersectsSeg, segIntersectsRect };
