// 화면과 API가 주고받는 데이터 형식.
// 백엔드와 합의할 때 이 파일이 초안이 된다. 필드 이름은 camelCase, 시각은 "HH:mm" 또는 ISO 문자열.

/** 시연 기준 시각. 14:00 판단 → 14:05 검사 결과 반영 */
export type Snapshot = '1400' | '1405'

/** 비상 = 기존 센서 알람이 울린 것, 예고 = Q-First가 찾은 이상 징후(알람 전) */
export type AlertGroup = 'emergency' | 'warning'

/** 5등급 우선순위 (1 비상+품질 영향 … 5 그 외 예고) */
export type Grade = 1 | 2 | 3 | 4 | 5

/** 품질 영향: 있음 / 없음 / 미확인(검사 결과 아직 없음 = null) */
export type QualityImpact = 'yes' | 'no' | null

/**
 * 설비 운영 상태(operation_status) — 시나리오 문서(11/11) 규칙: 가동 / 이상감지 / 점검중 (정지는 쓰지 않음).
 * 기존 방식(알람·점검)으로만 정해지고 예고 목록 여부와는 무관. 모델 입력에는 쓰지 않는다.
 */
export type OperationStatus = 'running' | 'alarm' | 'inspecting'
export interface Operation {
  status: OperationStatus
  since: string | null // 이 상태가 시작된 시각 HH:mm
}

export type EquipmentKind = 'injection' | 'tcu' | 'inspection'

export interface Equipment {
  id: string // EQP-001 (시스템 코드)
  no: string // 1호기 (현장에서 부르는 이름 · 화면에 크게)
  name: string // EQP-001 · 용기 몸체
  kind: EquipmentKind
  part: string // 용기 몸체
}

export interface SignalSeries {
  label: string // 사출 압력
  unit: string // MPa
  source: '기존 센서 알람' | 'Q-First 이상 징후' | ''
  reference: number // 기준값 (설비 등록표 baseline)
  threshold: number | null // 기존 알람 임계 (가까운 쪽 한 개, 문구용)
  /** 기존 알람 상·하한 (API v1.0 alarmLimits) */
  alarmLimits: { lower: number | null; upper: number | null } | null
  /** 평소 범위. API v1.0에서 null일 수 있음 → 없으면 띠를 그리지 않는다 */
  band: [number, number] | null
  domain: [number, number]
  /** 최근 60분, 1분 간격 값 (61개) */
  values: number[]
  startTime: string // 13:05
  endTime: string // 14:05
  /** 평소 범위를 처음 벗어난 시각 */
  outSince: string | null
  /** 그래프에 세로선으로 표시할 사건 시각 (데이터에 있는 시각): 예고 등재 / 기존 알람 */
  mark?: { at: string; label: string }
}

export interface QualityInfo {
  impact: QualityImpact
  source: string // 몸체 LOT
  defects?: number
  inspected?: number
  lot?: string // 이 설비가 지금 만드는 LOT (예: BODY-LOT-019)
}

export interface EvidenceStep {
  kind: string // 검사 / LOT / 대조 / 센서 / Q-First 이상 징후 / 기존 센서 알람
  /** 그 근거가 생긴 시각 (HH:mm). 없으면 비워 둔다 */
  at?: string
  title: string
  detail: string
}

/** 사출기 도식에서 이상을 표시할 부위 — 대표 센서에서 정함(압력→유압, 배럴 온도→배럴, 스크류 회전→스크류 구동) */
export type MachineZone = 'hydraulic' | 'barrel' | 'screw' | 'mold'

export type IncidentStatus = 'unassigned' | 'assigned' | 'inProgress' | 'rejected' | 'onHold' | 'done'

export interface Incident {
  id: string // INC-1110-001
  equipment: Equipment
  group: AlertGroup
  grade: Grade
  previousGrade?: Grade // 등급이 바뀐 경우 이전 등급
  rank: number // 그룹 안 순위
  title: string
  headline: string // 현장 말 한 줄: "배럴 온도 높음 · 기준보다 +3.7℃"
  whyFirst: string
  detectedAt: string
  status: IncidentStatus
  assignee: string | null
  signal: SignalSeries
  quality: QualityInfo
  evidence: EvidenceStep[]
  checklist: string[]
  /** 확인 항목별 설비 위치 (checklist와 같은 순서). 설비 밖 확인(LOT 검사 등)은 null.
   *  API v1.0은 확인 항목을 코드로 주므로, 연결 시 코드 → 구역 표를 프론트에 둔다 */
  checklistZones: (MachineZone | null)[]
  operation: Operation
  zones: MachineZone[] // 도식에서 칠할 이상 부위
}

export interface NormalEquipment {
  equipment: Equipment
  signal: SignalSeries
  note?: string // LOT 대조 결과 등 보조 설명
  isInspectionSource?: boolean
  operation: Operation
}

export interface BoardSummary {
  emergency: number
  warning: number
  inProgress: number
  normal: number
  qualityLinked: string[] // 품질 영향 있음 설비
  handled: { started: number; onHold: number; rejected: number; total: number }
}

export interface Board {
  snapshot: Snapshot
  asOf: string // 14:05
  summary: BoardSummary
  emergency: Incident[]
  warning: Incident[]
  normal: NormalEquipment[]
}

// ── 점검 결정·결과 ─────────────────────────────

export type DecisionType = 'start' | 'reject' | 'hold'

export interface DecisionInput {
  type: DecisionType
  reason?: string // 반려·보류는 필수
}

export type Outcome = 'found' | 'notFound' | 'unclear' // 이상 발견 / 이상 없음 / 판단 어려움

export interface ResultInput {
  outcome: Outcome
  actions: string[]
  memo: string
}

export interface Revision {
  rev: string // r1
  at: string // 14:00
  label: string // 예고 1위 · 4등급
  detail: string
  basis: string[] // 센서 1 · 검사 1 · LOT 1
}

export interface HistoryRecord {
  id: string
  date: string // 2/3
  time: string // 14:00
  equipment: Equipment
  title: string
  group: AlertGroup
  rank: number
  grade: Grade
  gradeChanged?: boolean
  status: '진행 중' | '이상 발견' | '이상 없음' | '판단 어려움' | '반려' | '보류'
  minutes: number | null
  assignee: string | null
  actions: string[]
  memo: string
  reason?: string
  revisions: Revision[]
}
