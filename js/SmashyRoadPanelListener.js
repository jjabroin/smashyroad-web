// SmashyRoadPanelListener.java → SmashyRoadPanelListener.js (1:1 포트 + WASD/터치 확장)
// 원본: keys 리스트, DOWN=후진가속, RIGHT/LEFT=회전가속(동시입력 시 무시),
// SPACE+게임오버=리셋, keyReleased에서 가속/회전 복구
class SmashyRoadPanelListener {
  constructor(panel, timer) {
    this.panel = panel;
    this.theTimer = timer;
    this.keys = [];
    this.alreadyPressed = false;
    this.paused = false;

    window.addEventListener('keydown', (e) => this.keyPressed(e));
    window.addEventListener('keyup', (e) => this.keyReleased(e));
  }

  codeOf(e) {
    return e.code; // 'ArrowDown', 'KeyS' 등
  }

  keyPressed(e) {
    const key = this.codeOf(e);
    if (
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(key)
    ) {
      e.preventDefault();
    }
    this.alreadyPressed = false;
    for (let i = 0; i < this.keys.length; i++) {
      if (this.keys[i] === key) this.alreadyPressed = true;
    }
    if (!this.alreadyPressed) this.keys.push(key);

    const player = this.panel.getPlayer();
    for (let i = 0; i < this.keys.length; i++) {
      const k = this.keys[i];
      // 원본 VK_DOWN → ArrowDown + KeyS
      if (k === 'ArrowDown' || k === 'KeyS') {
        player.setAcceleration(-1 * player.getPossibleAcceleration());
      }
      // 원본: 좌우 동시입력 시 회전 무시
      const hasRight = this.keys.includes('ArrowRight') || this.keys.includes('KeyD');
      const hasLeft = this.keys.includes('ArrowLeft') || this.keys.includes('KeyA');
      if (!(hasRight && hasLeft)) {
        if (k === 'ArrowRight' || k === 'KeyD') {
          player.setTurnAcceleration(player.getPossibleTurnAcceleration());
        }
        if (k === 'ArrowLeft' || k === 'KeyA') {
          player.setTurnAcceleration(-1 * player.getPossibleTurnAcceleration());
        }
      }
      // 원본: SPACE + 게임오버 → reset
      if (k === 'Space' && this.panel.getTimer().isGameOver()) {
        this.panel.reset();
      }
    }
  }

  keyReleased(e) {
    const key = this.codeOf(e);
    if (this.keys.includes(key)) {
      this.keys.splice(this.keys.indexOf(key), 1);
    }
    const player = this.panel.getPlayer();
    if (key === 'ArrowDown' || key === 'KeyS') {
      player.setAcceleration(player.getPossibleAcceleration());
    }
    if (key === 'ArrowRight' || key === 'KeyD') {
      player.setCurrentTurnSpeed(0);
      player.setTurnAcceleration(0);
    }
    if (key === 'ArrowLeft' || key === 'KeyA') {
      player.setCurrentTurnSpeed(0);
      player.setTurnAcceleration(0);
    }
  }

  // 모바일 터치 버튼용 (원본 키 로직 재사용)
  pressTouch(code) {
    this.keyPressed({ code, preventDefault: () => {} });
  }
  releaseTouch(code) {
    this.keyReleased({ code });
  }
}
window.SmashyRoadPanelListener = SmashyRoadPanelListener;
