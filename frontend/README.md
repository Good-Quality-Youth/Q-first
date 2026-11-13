# Q-First Frontend

시설 관리 담당자·품질 담당자가 PC에서 쓰는 Q-First 웹 화면입니다. 지금은 가상 데이터(데이터셋 v7)로 동작하며, 백엔드가 나오면 `src/api/index.ts` 안쪽만 API 호출로 바꿉니다.

- 기능 기준: 노션 「[설계] Q-First 기능명세서 v2」
- API 기준: Q-First 프론트–백엔드 API v1.0

## 실행

```bash
cd frontend
npm install
npm run dev          # 개발 서버
npm run build        # dist/ 정적 파일
npm run build:single # dist-single/index.html 한 파일 (미리보기 공유용)
```

`index.html?demo`로 열면 14:00에서 시작하고, 왼쪽 아래 「다음 장면 ▶」로 14:05 검사 결과 도착을 재생합니다. 기본은 14:05 상태입니다.

## 스택

React 19 · Vite 6 · TypeScript · Tailwind CSS v4 · React Router(HashRouter) · three.js(상세 화면 3D)
폰트: Wanted Sans(본문), Saira Semi Condensed(숫자)

## 구조

```
src/
  api/contract.ts     API v1.0 계약 타입 (문서 §3~§5 그대로. 문서가 바뀌면 여기부터 고친다)
  api/types.ts        화면이 쓰는 데이터 형식 (API v1.0으로 옮기는 중)
  api/mock.ts         가상 데이터로 사건·판단·이력을 만드는 곳
  api/demo-data.json  데이터셋 v7에서 뽑은 센서값·품질·지난 이력
  api/index.ts        화면이 부르는 함수 (getBoard, getIncident, saveDecision, saveResult, getHistory)
  components/         공통 UI (신호 그래프, 품질 영향 줄, 설비 그림, 3D, 챗봇 서랍)
  pages/              Board(대시보드) · DetailModal(판단 근거 상세) · Result(점검 결과 입력) · History(이력)
scripts/
  build_demo_v61.py   데이터셋 → demo-data.json
```

## 데이터

- 데이터셋 v7(가상 데이터)만 씁니다. 현업 원본·개인정보는 넣지 않습니다.
- 다시 만들기: `python3 scripts/build_demo_v61.py <데이터셋 폴더>` → `src/api/demo-data.json`
- 시연 시나리오: 사출기 10대, 이상 설비 1·2·3·4호기. 1호기 13:58 점검 착수는 시나리오상 이미 일어난 일이라 초기값으로 둡니다.
- 저장은 메모리에만 됩니다. 새로고침하면 처음 상태로 돌아갑니다.

## 화면 원칙

- **Q-First 판단과 근거 데이터 구분:** 순위·등급·판단 이유에만 「Q-First 판단」 표시와 검정 면(`.ai-surface`)을 씁니다. 센서·검사 같은 기록은 흰 바탕입니다. 근거 경로의 각 단계에는 「기록」과 「Q-First 해석」을 구분해 표시합니다.
- **색은 상태에만:** 비상 빨강 · 예고 파랑 · 품질 영향 앰버 · 정상 초록. AI 판단에 새 색을 쓰지 않습니다.
- **그래프:** 기준값(가는 선)과 기존 알람 상·하한(점선)을 함께 그립니다. 평소 범위는 서버가 줄 때만 띠로 그립니다.
- **누를 수 있는 것만 반응:** 버튼은 호버·누름 피드백(`btn-solid`, `btn-line`, `btn-text`, `btn-light`, `btn-on-dark`, `src/index.css`)을 주고, 태그·칩·배지는 반응하지 않습니다. 카드는 전체를 눌러 상세를 엽니다.
- **원인을 확정하지 않습니다:** 이상이 나타난 곳과 확인 순서까지만 안내합니다.

## 이미지·3D 모델

설비 사진(`photo-inj.webp`, `photo-tcu.webp`, `eqp-sprite.webp`)은 팀에서 AI로 직접 만든 이미지입니다. 실제 제조사 제품 사진은 쓰지 않습니다.

`src/assets/machine.glb`는 사출기 이미지 한 장으로 만든 3D 모델입니다(AI 생성물). 텍스처는 `machine-tex.jpg`(2048px)로 분리했습니다. 이상 부위는 `machineScene.js`의 `ZONE_BOX` 좌표에 반투명 덩어리로 표시합니다. WebGL이 안 되면 사진 + 점으로 대체됩니다.

three.js와 모델·텍스처는 상세 팝업을 처음 열 때만 불러옵니다(첫 화면 JS 약 340KB). 받는 동안에는 사진 + 점이 보입니다.

「확인할 것」 항목의 「위치 보기」를 누르면 3D에서 그 구역을 또렷하게 하고 그쪽으로 시점을 옮깁니다. 구역은 기능 구역(유압·배럴·스크류·금형) 기준이라 설비 모델이 달라도 같은 방식으로 동작하고, 공장별로는 센서·확인 항목 → 구역 연결표와 (원하면) 3D 형상만 바꾸면 됩니다. LOT 검사처럼 설비 밖에서 하는 확인은 위치가 없습니다. 공유용 한 파일 빌드(`build:single`)에서는 모델이 data URI로 함께 들어갑니다.
