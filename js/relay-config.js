// 중계 서버 설정 — ★ 본인 계정의 브로커 정보를 여기에 입력 ★
// 공유 타임어택 순위표가 이 서버에 저장됩니다.
//
// 예: HiveMQ Cloud 무료 클러스터 생성 후:
//   url: 'wss://abc123def.s1.eu.hivemq.cloud:8884/mqtt'
//   username: 'mygame'      (클러스터에서 만든 접속 ID)
//   password: 'xxx...'      (접속 비밀번호)
// ※ 한국에서 가장 가까운 리전으로 만들수록 빠릅니다.
export const RELAY = {
  url: 'wss://644892f822434b79ae00f2d89aa3fef0.s1.eu.hivemq.cloud:8884/mqtt',
  username: 'blockyracer',
  password: 'blockyracer',
};

// 위가 비어 있으면 공개 테스트 브로커로 동작합니다.
// ※ 전 기기가 반드시 같은 브로커여야 하므로 대체 전환은 하지 않습니다.
export const PUBLIC_RELAY = { url: 'wss://broker.hivemq.com:8884/mqtt', label: '공개' };

export const ROOM_PREFIX = 'blockyracer/v1/';
