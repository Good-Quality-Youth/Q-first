/**
 * Q-First 프론트–백엔드 API v1.0 계약 타입 (2026-11-11, 백엔드 확정본)
 *
 * - 이 파일은 API 문서 §3~§5의 타입을 그대로 옮긴 것이다. 문서가 바뀌면 이 파일을 먼저 고친다.
 * - 화면 전용 타입(types.ts)은 이 계약으로 옮기는 중이다. 화면은 이 타입을 받아 표시용으로 바꿔 쓴다.
 * - 경로: /api/v1, JSON camelCase, 시각은 오프셋이 있는 ISO 8601(응답은 UTC `Z`).
 *   표시는 반드시 Board.displayTimeZone으로 변환한다(브라우저 시간대를 쓰지 않는다).
 */

// ── 공통 값 ─────────────────────────────────────────────
export type Time = string
export type Group = 'emergency' | 'warning'
export type Grade = 1 | 2 | 3 | 4 | 5
export type Status = 'open' | 'inProgress' | 'onHold' | 'rejected' | 'done'
export type Outcome = 'found' | 'notFound' | 'unclear'
export type DecisionType = 'start' | 'reject' | 'hold'
export type Action = DecisionType | 'submitResult'
export type Equipment = { id: string; no: string; part: string }
export type Actor = { id: string; name: string }

/** 운영 배지: 점검 중 → 현재 알람 켜짐 → 그 외 순으로 서버가 계산한다 */
export type Operation = {
  status: 'running' | 'alarm' | 'inspecting'
  alarmState: 'active' | 'inactive' | 'notIntegrated' | 'unknown'
  dataState: 'available' | 'unavailable'
  since: Time | null
  startedBy: Actor | null
}

/** 품질 영향. 비율은 0~1. impact가 null이면 집계 세 필드도 null(미확인) */
export type Quality = {
  impact: 'yes' | 'no' | null
  lotIds: string[]
  inspected: number | null
  defects: number | null
  defectRate: number | null
  thresholdRate: number
}

export type Step = { code: string; label: string }
export type Metric = 'injectionPressure' | 'barrelTemperature' | 'screwSpeed' | 'vibration' | 'motorCurrent'

/** 대표 신호. band(평소 범위)는 null일 수 있다 → 화면은 기준값·알람 한계로 그린다 */
export type Signal = {
  metric: Metric
  label: string
  unit: string
  value: number | null
  reference: number | null
  band: { lower: number; upper: number } | null
  alarmLimits: { lower: number | null; upper: number | null } | null
  marks: { kind: 'firstWarning' | 'firstAlarm'; at: Time }[]
}

// ── GET /board ─────────────────────────────────────────
export type Card = {
  incidentId: string
  equipment: Equipment
  revision: number
  workVersion: number
  status: Status
  group: Group
  grade: Grade
  rank: number
  previousGrade: Grade | null
  detectedAt: Time
  headline: string
  rankReason: string
  operation: Operation
  quality: Quality
  firstCheck: Step
  signal: Signal
}

export type Board = {
  boardId: string
  snapshotVersion: number
  asOf: Time
  displayTimeZone: string
  notificationCursor: string
  summary: {
    emergencyCount: number
    warningCount: number
    normalCount: number
    unavailableCount: number
    qualityLinkedCount: number
    workCounts: Record<Status, number>
    firstIncidentId: string | null
    nextIncidentIds: string[]
    qualityLots: {
      lotId: string
      incidentId: string
      suggestion: 'reviewContainment' | 'awaitInspection'
    }[]
  }
  /** 서버가 정렬한 순서 그대로 쓴다. 화면은 재정렬하지 않는다 */
  emergency: Card[]
  warning: Card[]
  normal: { equipment: Equipment; operation: Operation }[]
  unavailable: { equipment: Equipment; operation: Operation }[]
}

// ── GET /incidents/{id}?revision= ──────────────────────
export type Evidence = {
  id: string
  kind: 'sensor' | 'alarm' | 'inspection' | 'lot' | 'comparison' | 'analysis'
  /** record = 기록, compare·derived = Q-First 해석 */
  basis: 'record' | 'compare' | 'derived'
  title: string
  detail: string
  observedAt: Time | null
}

export type Revision = {
  revision: number
  asOf: Time
  group: Group
  grade: Grade
  rank: number | null
  previousGrade: Grade | null
  reason: string
  quality: Quality
}

export type DecisionRecord = { type: DecisionType; reasonCode: string | null; at: Time; by: Actor }
export type ResultRecord = { outcome: Outcome; actionCodes: string[]; memo: string | null; at: Time; by: Actor }

export type Work = {
  status: Status
  workVersion: number
  /** 현재 상태와 권한으로 서버가 계산한 버튼 힌트. 저장 시 서버가 다시 검사한다 */
  allowedActions: Action[]
  startedAt: Time | null
  startedBy: Actor | null
  startedRevision: number | null
  decisions: DecisionRecord[]
  result: ResultRecord | null
}

export type IncidentDetail = {
  incidentId: string
  equipment: Equipment
  detectedAt: Time
  /** 선택한 revision의 판단 (미지정이면 최신) */
  judgment: Revision
  /** 번호 내림차순 */
  revisions: Revision[]
  evidence: Evidence[]
  checklist: Step[]
  signal: Signal
  zones: ('hydraulic' | 'barrel' | 'screw' | 'mold')[]
  defectTypes: string[]
  /** operation·work는 조회 시점의 현재 값 (과거 판단과 분리해 표시) */
  operation: Operation
  work: Work
}

// ── GET /incidents/{id}/series?revision=&metric= ───────
/** 최근 60분, 1분 간격 61개 슬롯, 시간 오름차순. 결측은 null */
export type Series = Signal & {
  incidentId: string
  revision: number
  from: Time
  to: Time
  points: { at: Time; value: number | null }[]
}

// ── POST /incidents/{id}/decision, /result ─────────────
// 두 요청 모두 Idempotency-Key 헤더(동작마다 새 UUID, 같은 요청 재시도 시 같은 키)와 expectedVersion 필수
export type DecisionRequest =
  | { type: 'start'; expectedVersion: number; judgmentRevision: number }
  | { type: 'hold' | 'reject'; expectedVersion: number; reasonCode: string }

export type ResultRequest = {
  expectedVersion: number
  outcome: Outcome
  /** 하나 이상. NO_ACTION은 단독, OTHER는 memo 필수 */
  actionCodes: string[]
  memo?: string | null
}

/** 초기 코드 목록 (API v1.0 §4). 라벨은 프론트가 매핑하고, 목록 변경은 백엔드와 함께 관리한다 */
export const HOLD_REASONS = ['PRODUCTION_RUNNING', 'STAFF_UNAVAILABLE', 'PARTS_PENDING', 'NEXT_SHIFT'] as const
export const REJECT_REASONS = ['FALSE_ALARM', 'ALREADY_HANDLED', 'DUPLICATE', 'OTHER_EQUIPMENT'] as const
export const ACTION_CODES = ['NO_ACTION', 'HEATER_BAND_REPLACED', 'THERMOCOUPLE_REPLACED', 'CONTROLLER_ADJUSTED', 'NOZZLE_CHECK_RING_REPLACED', 'OTHER'] as const
export type HoldReason = (typeof HOLD_REASONS)[number]
export type RejectReason = (typeof REJECT_REASONS)[number]
export type ActionCode = (typeof ACTION_CODES)[number]

// ── GET /incidents (이력) ──────────────────────────────
export type IncidentHistory = {
  items: {
    incidentId: string
    equipment: Equipment
    detectedAt: Time
    title: string
    latestRevision: number
    group: Group
    grade: Grade
    gradeChanged: boolean
    status: Status
    outcome: Outcome | null
    reasonCode: string | null
    actionCodes: string[]
    memo: string | null
    /** 착수~완료 정수 분(내림). 미완료면 null */
    minutes: number | null
  }[]
  /** 페이지 자르기 전 필터 결과의 집계 */
  counts: {
    total: number
    open: number
    inProgress: number
    onHold: number
    rejected: number
    done: number
    found: number
    notFound: number
    unclear: number
  }
  nextCursor: string | null
}

// ── GET /notifications?after= ──────────────────────────
export type NotificationPage = {
  items: {
    id: string
    type: 'newIncident' | 'gradeChanged'
    incidentId: string
    revision: number
    at: Time
    equipment: Equipment
    group: Group
    fromGrade: Grade | null
    toGrade: Grade
    message: string
    firstCheck: Step
  }[]
  nextCursor: string
  hasMore: boolean
}

// ── POST /chat ─────────────────────────────────────────
export type ChatRequest = { question: string; incidentId?: string; revision?: number }

export type ChatResponse = {
  /** 저장된 근거가 없으면 false (HTTP 200). 모델·조회 장애는 503 */
  answerable: boolean
  judgment: string
  points: string[]
  basis: {
    kind: string
    label: string
    incidentId: string | null
    revision: number | null
    evidenceId: string | null
  }[]
  asOf: Time
}

// ── 오류 ───────────────────────────────────────────────
export type ErrorCode =
  | 'INVALID_REQUEST' | 'REASON_REQUIRED' | 'INVALID_OPTION'
  | 'UNAUTHENTICATED' | 'FORBIDDEN'
  | 'INCIDENT_NOT_FOUND' | 'REVISION_NOT_FOUND' | 'METRIC_NOT_FOUND'
  | 'WORK_VERSION_CONFLICT' | 'INVALID_TRANSITION' | 'NOT_STARTED' | 'IDEMPOTENCY_KEY_REUSED'
  | 'CURSOR_EXPIRED'
  | 'RATE_LIMITED' | 'SERVICE_UNAVAILABLE'

/** 프론트 분기는 code로만 한다 */
export type ApiError = { error: { code: ErrorCode; message: string } }
