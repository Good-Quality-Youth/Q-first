# Q-First 실제 탐지·조사 재생 백엔드

v8 원본 센서를 Python 통계 탐지기에 보내 사건을 만들고, 원본 LOT 검사를 연결해 등급을 계산한다. LangGraph + 로컬 Ollama 조사 결과를 비동기로 받아 점검 안내에 반영한다. fixture의 예고·점검 문구를 반환하는 구현이 아니다.

## 로컬 실행

권장 실행은 저장소 루트의 `docker compose up -d --build`이며 [실행 안내](../deploy/README.md)를 참고한다. 웹은 http://localhost:18095 이다.

프로세스를 따로 실행할 때는 `docker compose up -d postgres`로 DB를 먼저 시작한다. agent/README.md에 따라 Ollama와 Python API(18094)를 실행한다. 이어 저장소 루트에서:

```sh
mvn -f backend/pom.xml package
java -jar backend/target/qfirst-replay-0.1.0-SNAPSHOT.jar --qfirst.demo.enabled=true --qfirst.dataset.path=../qfirst-local/data/qfirst_dataset_v8
```

다른 터미널:

```sh
npm --prefix frontend ci
VITE_QFIRST_REPLAY_API=1 npm --prefix frontend run dev -- --host 127.0.0.1 --port 15173
```

브라우저: http://127.0.0.1:15173/?demo . Spring은 루프백 18091, Vite가 `/api/v1`을 전달한다. Python URL은 `qfirst.agent.url`로 지정하며 로컬만 허용한다. 재시작해도 재생 시각·판단·조사 이력을 유지한다. 초기 재생 테스트는 별도 빈 DB를 사용한다. 실행 중인 JAR를 재빌드하지 말고 백엔드를 먼저 종료한다.

이 PC의 Maven 기본 mirror와 로컬 캐시 출처가 달라 빌드 오류가 나면 올바른 Maven settings를 지정한다. 코드에는 사용자별 settings를 넣지 않는다.

## 이번에 실제로 연결된 범위

- 현황판/사건 상세/60분 원본 센서 차트/등급 변경 알림/시간순 재생
- 통계 탐지기의 실제 예고 시각, 기존 알람에 의한 동일 사건의 비상 이동
- 실제 LOT 검사 도착에 따른 품질 집계·5등급 판단
- 신규 예고 및 기존 비상 알람 조사 등록, 로컬 LLM 도구 선택, 읽기 전용 근거 조회
- `running → completed/failed`, 기본 안내와 조사 안내 비교, 근거 ID 연결
- 늦은 예고 조사 결과가 새 비상 조사 결과를 덮어쓰지 않도록 조사 ID 대조
- 판단 revision 보존, 화면 갱신 snapshotVersion, 재생 Idempotency-Key/expectedStep 검증

등급 산정은 규칙이다. 조회된 품질 영향과 기존 알람으로 계산하고 조사 완료 자체는 순위를 바꾸지 않는다. 에이전트 결과는 등록 시점의 cutoff를 유지하며 과거 조사에는 기준 시각을 표시한다.

아직 연결하지 않은 점검 쓰기·일반 이력 화면·챗봇은 실연동 모드에서 차단/숨김 처리했다. 화면 목업 모드(`VITE_QFIRST_REPLAY_API` 미설정)는 팀 프로토타입 그대로 남는다. 실연동 결과와 목업 기능을 혼동하지 않기 위한 구분이다. PostgreSQL 저장·영속 작업 큐·재시작 복구는 연결했다. 운영 인증·권한과 고가용성 구성은 아직 구현 전이다.

## API (개발용 추가)

- `GET /api/v1/board`
- `GET /api/v1/incidents/{id}?revision=N`
- `GET /api/v1/equipment/{id}/series?asOf=<UTC ISO>` — 실제 원본 61점, 미래 요청 거부
- `GET /api/v1/notifications?after=N-0`
- `POST /api/v1/demo/replay/next` — body: boardId, expectedStep; header: Idempotency-Key

Python 내부 API는 `/detect`, `/investigations/run`이다. Spring 조사 워커가 PostgreSQL 큐를 선점해 Python을 호출하고 결과를 저장한다. 별도의 게시 폴링이 1.5초마다 DB 결과를 확인한다. 프론트는 board를 10초마다 조회한다. 큐 등록과 판단 저장은 한 트랜잭션이다. 상세 결정은 [ADR-004](../docs/architecture/ADR-004-local-durable-execution.md)에 기록했다.

## 실제 값과 시연

| 단계 | EQP-003 실제 상태 |
|---|---|
| 13:41 | 아직 예고 없음; 탐지기가 최초 확인한 시각은 13:43 |
| 14:00 | 예고 4등급, 검사 0/17, 온도 212.42°C |
| 14:05 | 예고 3등급, 검사 1/22, 온도 212.54°C |
| 14:15 | 비상 1등급, 검사 2/32, 온도 214.27°C, 새 비상 조사 |
| 14:15 조사 완료 | 순위 유지, 실제 조회 근거로 점검 안내 구체화 |

14:05의 첫 불량 검사 원천 시각은 14:04이다. 재생을 14:05까지 진행할 때 도착한다. 실제 예고는 13:43으로 32분 선행하지만 정상 변동 5구간의 오경보는 탐지기 v1에서 5건(복귀 직후 발생 포함), v2에서 0건이었다. 시연 제외 24개 이상은 모두 탐지했으며 그중 11개는 1~4분 지연됐다. v8을 확인하며 튜닝한 개발 결과이므로 독립 평가가 아니다. 탐지 성능이 검증됐다는 뜻이 아니다. 상세 평가·제약은 agent/README.md 참고.

## 통합 검증

초기화된 별도 Spring 인스턴스에서 실행한다. 로컬 LLM도 필요하다.

```sh
java -jar backend/target/qfirst-replay-0.1.0-SNAPSHOT.jar --server.port=18093 --qfirst.demo.enabled=true --qfirst.dataset.path=../qfirst-local/data/qfirst_dataset_v8
python3 backend/scripts/check_replay.py --base-url http://127.0.0.1:18093/api/v1
```

실제 조사 완료를 기다리고 이전 판단 불변·미래 근거 차단·등급 유지·기본/조사 안내·멱등성을 검증한다. 실행에서 얻은 5장면 응답과 상세 JSON은 `backend/var/live-scenes/`에 저장한다(Git 제외). 팀원에게 전달할 예시는 이 실행 결과를 사용할 수 있으며 기존 fixture와 탐지 시각·분모가 다르다.
