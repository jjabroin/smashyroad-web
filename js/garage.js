// 차고(차량 선택 화면, 사진 2 스타일): 3D 턴테이블 + 스탯바 + 좌우 화살표
import * as THREE from 'three';
import { CAR_DEFS } from './race.js';
import { CAR_BUILDERS, makeDriver } from './voxel.js';

const GRADE_COLOR = { 전설: '#ff5252', 레어: '#4da3ff', 일반: '#9aa4b2' };

export function createGarage(onStart) {
  let idx = 0;
  const canvas = document.getElementById('garageCanvas');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc9a24b); // 사진 2 황금 배경
  scene.fog = new THREE.Fog(0xc9a24b, 30, 80);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  camera.position.set(11, 7.5, 13);
  camera.lookAt(0, 1.2, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a6f35, 1.0));
  const sun = new THREE.DirectionalLight(0xfff6e0, 1.5);
  sun.position.set(8, 14, 6);
  sun.castShadow = true;
  scene.add(sun);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(16, 40),
    new THREE.MeshLambertMaterial({ color: 0xb8933f })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const stand = new THREE.Group();
  scene.add(stand);
  let carMesh = null;
  let driverMesh = null;

  function resize() {
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 380;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  function statBar(v) {
    return `<div class="stat"><i style="width:${v * 20}%"></i></div>`;
  }

  function render(idxNew) {
    idx = (idxNew + CAR_DEFS.length) % CAR_DEFS.length;
    const def = CAR_DEFS[idx];
    if (carMesh) {
      stand.remove(carMesh);
      carMesh = null;
    }
    if (driverMesh) {
      stand.remove(driverMesh);
      driverMesh = null;
    }
    carMesh = CAR_BUILDERS[def.id](def.color, def.accent);
    carMesh.rotation.y = -Math.PI / 2 + 0.5;
    stand.add(carMesh);
    driverMesh = makeDriver();
    driverMesh.position.set(-5.5, 0, 2.5);
    stand.add(driverMesh);

    document.getElementById('carName').textContent = def.name;
    const grade = document.getElementById('carGrade');
    grade.textContent = def.grade;
    grade.style.color = GRADE_COLOR[def.grade] || '#fff';
    document.getElementById('statSpeed').innerHTML = statBar(def.stats.speed);
    document.getElementById('statHandling').innerHTML = statBar(def.stats.handling);
    document.getElementById('statTough').innerHTML = statBar(def.stats.durability);
    document.getElementById('carDots').textContent =
      `${idx + 1} / ${CAR_DEFS.length}`;
  }

  document.getElementById('carPrev').addEventListener('click', () => render(idx - 1));
  document.getElementById('carNext').addEventListener('click', () => render(idx + 1));
  document.getElementById('raceBtn').addEventListener('click', () => {
    onStart(CAR_DEFS[idx]);
  });

  // 키보드 좌우로 차량 변경, Enter로 시작
  window.addEventListener('keydown', function nav(e) {
    if (document.getElementById('garage').style.display === 'none') {
      window.removeEventListener('keydown', nav);
      return;
    }
    if (e.code === 'ArrowLeft') render(idx - 1);
    if (e.code === 'ArrowRight') render(idx + 1);
    if (e.code === 'Enter' || e.code === 'Space') onStart(CAR_DEFS[idx]);
  });

  let raf = 0;
  function loop() {
    raf = requestAnimationFrame(loop);
    stand.rotation.y += 0.008;
    renderer.render(scene, camera);
  }

  resize();
  render(0);
  loop();

  return {
    stop() {
      cancelAnimationFrame(raf);
      renderer.dispose();
    },
  };
}
