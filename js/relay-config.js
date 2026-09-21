// 중계 서버 설정 — ★ 본인 계정의 브로커 정보를 여기에 입력 ★
// 모든 사용자는 이 서버로 자동 연결됩니다 (따로 입력할 것 없음).
//
// 예: HiveMQ Cloud 무료 클러스터 생성 후:
//   url: 'wss://abc123def.s1.eu.hivemq.cloud:8884/mqtt'
//   username: 'mygame'      (클러스터에서 만든 접속 ID)
//   password: 'xxx...'      (접속 비밀번호)
// ※ 한국에서 가장 가까운 리전으로 만들수록 빠릅니다.
export const RELAY = {
  url: '',
  username: '',
  password: '',
};

// 위가 비어 있으면 공개 테스트 브로커로 동작 (느릴 수 있음, 인원 제한 가능)
export const FALLBACK_RELAYS = [
  { url: 'wss://broker.hivemq.com:8884/mqtt' },
  { url: 'wss://broker.emqx.io:8084/mqtt' },
];

export const ROOM_PREFIX = 'blockyracer/v1/';
