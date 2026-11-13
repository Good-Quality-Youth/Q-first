# 로컬 MVP 실행

저장소 루트에서 실행한다. Docker Desktop과 호스트 Ollama가 필요하다.
기본 모델은 이미 설치된 `qwen3:4b`이며 외부 LLM 키는 사용하지 않는다.

```sh
ollama list
# 모델이 없을 때만: ollama pull qwen3:4b
# Ollama 앱 또는 ollama serve 실행

docker compose up -d --build
```

기본 데이터 위치: 저장소 형제 폴더 `../qfirst-local/data/qfirst_dataset_v8`.
다른 경로라면 `QFIRST_DATASET_PATH` 환경변수로 지정한다. 데이터는 이미지에 복사하지 않는다.

- 웹: http://localhost:18095
- Spring API: http://localhost:18096/api/v1/board
- Python 상태: http://localhost:18097/health
- PostgreSQL: localhost:15432, DB/사용자 qfirst

기본 DB 비밀번호는 로컬 개발용이다. 운영 환경에 재사용하지 않는다.
Ollama 호출 주소는 Docker Desktop의 `host.docker.internal:11434`이다.
Linux에서는 호스트 접근 설정이 추가로 필요할 수 있다.

```sh
docker compose logs --tail=60 backend agent
docker compose restart backend agent
# 서비스만 종료: 데이터 볼륨은 유지됨
docker compose down
```

재시작 후 재생 시각과 조사 작업이 유지된다. 새 데이터셋은 별도의 DB/볼륨을 사용한다.
기존 볼륨을 지우는 `down -v`는 보관된 판단과 조사 이력까지 삭제하므로 기본 절차에 넣지 않는다.
프론트는 실제 API 모드로 빌드하며, 아직 미연결된 점검 쓰기·챗봇을 구현된 것으로 표시하지 않는다.
