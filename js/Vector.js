// vector.java → Vector.js (1:1 포트)
// 원본: x, y + getMagnitude/add/subtract/divide/setVector/afterAdd/negativeVector
class Vector {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  getX() { return this.x; }
  getY() { return this.y; }
  setX(x) { this.x = x; }
  setY(y) { this.y = y; }
  getMagnitude() {
    return Math.sqrt(Math.pow(this.x, 2) + Math.pow(this.y, 2));
  }
  subtract(v2) {
    this.x -= v2.getX();
    this.y -= v2.getY();
  }
  add(v2) {
    this.x += v2.getX();
    this.y += v2.getY();
  }
  divide(c) {
    this.x /= c;
    this.y /= c;
  }
  setVector(v2) {
    this.x = v2.getX();
    this.y = v2.getY();
  }
  afterAdd(v2) {
    return new Vector(this.x + v2.getX(), this.y + v2.getY());
  }
  negativeVector() {
    return new Vector(-1 * this.x, -1 * this.y);
  }
}
window.Vector = Vector;
