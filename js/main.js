// SmashyRoadMain.java → main.js (1:1 포트)
// 원본: 1000x700 JFrame + SmashyRoadPanel + GameTimer + Listener 연결
(function main() {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  function fitCanvas() {
    // 원본 1000x700 비율을 유지하되 화면에 맞춤
    const maxW = Math.min(window.innerWidth - 16, 1000);
    const maxH = Math.min(window.innerHeight - 120, 700);
    const scale = Math.min(maxW / 1000, maxH / 700);
    canvas.width = Math.floor(1000 * scale);
    canvas.height = Math.floor(700 * scale);
    canvas.style.width = canvas.width + 'px';
    canvas.style.height = canvas.height + 'px';
    if (window.__smashPanel) {
      window.__smashPanel.ctx = ctx;
      window.__smashPanel.resize(canvas.width, canvas.height);
    }
  }

  const smashPanel = new SmashyRoadPanel(1000, 700);
  smashPanel.ctx = ctx;
  window.__smashPanel = smashPanel;

  const smashTimer = new GameTimer(smashPanel);
  smashPanel.setTimer(smashTimer);

  const listener = new SmashyRoadPanelListener(smashPanel, smashTimer);
  window.__smashListener = listener;

  fitCanvas();
  window.addEventListener('resize', fitCanvas);

  // 시작 오버레이
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('startBtn');
  startBtn.addEventListener('click', () => {
    overlay.style.display = 'none';
    canvas.focus();
    smashTimer.start();
  });

  // 게임오버 후 탭/클릭으로 재시작 (원본 SPACE와 동일)
  canvas.addEventListener('pointerdown', () => {
    if (smashTimer.isGameOver()) {
      smashPanel.reset();
      smashTimer.unpauseTimer();
    }
  });

  // 모바일 터치 버튼 연결
  const bindHold = (id, code) => {
    const el = document.getElementById(id);
    if (!el) return;
    const down = (e) => {
      e.preventDefault();
      listener.pressTouch(code);
    };
    const up = (e) => {
      e.preventDefault();
      listener.releaseTouch(code);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('pointercancel', up);
  };
  bindHold('btnLeft', 'ArrowLeft');
  bindHold('btnRight', 'ArrowRight');
  bindHold('btnDown', 'ArrowDown');

  // 첫 프레임 미리 그리기 (시작 전 배경)
  smashPanel.paintComponent(ctx);
})();
