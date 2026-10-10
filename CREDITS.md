# 3D 에셋 출처 (CREDITS)

게임 내 모든 3D 모델·노면 텍스처·하늘은 아래 무료 에셋을 사용했습니다.
직접 모델링한 복셀 코드(`js/voxel.js`)는 오프라인 폴백으로만 남습니다.

## 차량·소품·건물 — Kenney (https://kenney.nl)
- 제작자: Kenney Vleugels
- 라이선스: **CC0 1.0 Universal** (상업 이용·수정·재배포 가능, 표기 불필요)
- 사용 팩:
  - Car Kit (세단·스포츠·픽업·박스트럭·택시·경찰·랠리·미래형 + 분리 바퀴)
  - Racing Kit (F1형 레이스카·가드레일·연석·스타트 게이트·깃발·빌보드)
  - Toy Car Kit (몬스터트럭)
  - Nature Kit (나무·소나무·선인장·바위)
  - City Kit Commercial (빌딩·고층빌딩)
  - City Kit Roads (가로등)
  - Furniture Kit (벤치)
- 파일: `assets/models/vehicles/*.glb`, `assets/models/props/*.glb`
- Uso: 원본 GLB 그대로 사용 (외부 `Textures/colormap.png` 참조만 같은 폴더명으로 정리)

## 하늘 HDRI — Poly Haven (https://polyhaven.org)
- 라이선스: **CC0 1.0 Universal**
- 사용 파일 (`assets/models/sky/`):
  - `park.hdr` — kloppenheim_06_puresky → 공원·숲·빌리지
  - `desert.hdr` — kloofendal_43d_clear → 사막
  - `city.hdr` — qwantani_dusk_2 → 도심 석양
- 작가 표기는 Poly Haven 각 에셋 페이지 기준

## 노면 텍스처 — ambientCG (https://ambientcg.com)
- 제작자: Lennart Demes
- 라이선스: **CC0 1.0 Universal**
- 사용 (`assets/models/ground/`, 512px 리사이즈):
  - `asphalt.jpg` — Asphalt015 (아스팔트)
  - `grass.jpg` — Grass005 (잔디)
  - `sand.jpg` — Ground060 (조개껍질 모래)

## 교체하지 않은 요소 (이유)
- 드라이버 피규어·지뢰·실드·먼지/불꽃·스키드마크·아이템박스·부스터/점프 이펙트:
  게임플레이 마커·이펙트라 기능 유지가 우선. 동일 스타일 CC0 대체 없음.
- 중앙선·가장자리선·연석 포스트·복도벽·기둥·튜브·끝단벽·물/부두:
  트랙 스플라인 추종 구조물이라 에셋 교체 불가 (형상은 유지, 노면만 텍스처 적용).
- 조명·안개·카메라: 렌더 설정이라 교체 대상 아님.
