// 시연용 데이터 — 합성 데이터셋 v6.1/v7(qfirst_dataset) 기준. 시나리오 「사출 PoC (사출기 10대)」 자동 검사 21개 PASS.
// 센서값·LOT·이상 점수·검수 수치·지난 이력은 scripts/build_demo_v61.py 가 뽑은 demo-data.json 을 쓴다. 판단 문장·확인 항목은 화면용으로 프론트에서 쓴 것.
import DATA from './demo-data.json'
import type {
  AlertGroup, Equipment, EvidenceStep, Grade, HistoryRecord, Incident, MachineZone, NormalEquipment, QualityInfo, SignalSeries, Snapshot,
} from './types'

export const DEMO_DATE = '2/3'

const PART = { body: '용기 몸체', inner: '속뚜껑', cap: '뚜껑' } as const
const eqp = (n: number, part: keyof typeof PART): Equipment => {
  const id = `EQP-${String(n).padStart(3, '0')}`
  return { id, no: `${n}호기`, name: `${id} · ${PART[part]}`, kind: 'injection', part: PART[part] }
}
export const EQUIPMENT: Record<string, Equipment> = Object.fromEntries(
  ([[1, 'body'], [2, 'inner'], [3, 'cap'], [4, 'inner'], [5, 'body'], [6, 'body'], [7, 'cap'], [8, 'inner'], [9, 'cap'], [10, 'cap']] as const)
    .map(([n, p]) => { const e = eqp(n, p); return [e.id, e] }),
)

/** 라인 지도: 부품별 레인 — 부품 하나를 사출기 여러 대가 나눠 만든다 (3·3·4) */
export const LANES: { label: string; ids: string[] }[] = [
  { label: '용기 몸체', ids: ['EQP-001', 'EQP-005', 'EQP-006'] },
  { label: '속뚜껑', ids: ['EQP-002', 'EQP-004', 'EQP-008'] },
  { label: '뚜껑', ids: ['EQP-003', 'EQP-007', 'EQP-009', 'EQP-010'] },
]

// ── 신호 ─────────────────────────────────
type SnapData = { risk?: string; values: number[]; start: string; end: string; outSince: string | null; score: number; topFeature: string; alarm: string | null; errorCode: string; lot: string }
type Aux = { label: string; reference: number } & Record<Snapshot, number>
type EqData = { aux?: Aux; kind: string; label: string; unit: string; reference: number; threshold: number | null; limits?: number[]; target: number | null; median: number; band: number[]; snapshots: Record<Snapshot, SnapData> }
const EQ = DATA.equipment as unknown as Record<string, EqData>

export function makeSignal(id: string, snap: Snapshot, source: SignalSeries['source'] = ''): SignalSeries {
  const e = EQ[id]
  const s = e.snapshots[snap]
  const digits = 1
  return {
    label: e.label, unit: e.unit, source, reference: e.reference, threshold: e.threshold,
    alarmLimits: e.limits ? { lower: e.limits[0], upper: e.limits[1] } : null,
    band: null, // API v1.0: 평소 범위는 서버가 주지 않을 수 있음. 기준값·알람 한계로 그린다
    domain: [0, 0], // Sparkline이 값·기준값·알람 한계로 계산
    values: s.values.map((v) => +v.toFixed(digits + 1)), startTime: s.start, endTime: s.end, outSince: s.outSince,
  }
}
export const scoreOf = (id: string, snap: Snapshot) => EQ[id].snapshots[snap].score

// ── 품질 ─────────────────────────────────
export const CAUTION = 3 // 주의 기준 % — 이상이면 품질 영향 있음, 미만이면(불량이 있어도) 없음
type QSnap = { inspected: number; defects: number }
const Q = DATA.quality as unknown as Record<string, Partial<Record<Snapshot, QSnap>>>

function qualityOf(id: string, snap: Snapshot, source: string): QualityInfo {
  const q = Q[id]?.[snap]
  const lot = EQ[id]?.snapshots[snap]?.lot
  if (!q || q.inspected === 0) return { impact: null, source, lot }
  const rate = (q.defects / q.inspected) * 100
  return { impact: rate >= CAUTION ? 'yes' : 'no', source, defects: q.defects, inspected: q.inspected, lot }
}

// ── 사건 (2/3 13:25~14:15 시연 흐름의 이상 설비 4대) ──────────
type IncDef = {
  id: string; eqp: string; group: AlertGroup
  appearsAt: Snapshot // 이 시점부터 목록에 나타남
  grade: (snap: Snapshot, q: QualityInfo) => Grade
  title: (snap: Snapshot) => string
  headline: (snap: Snapshot) => string // 현장 말: 부위 + 방향 + 기준 대비
  why: (snap: Snapshot) => string
  qualitySource: string
  evidence: (snap: Snapshot, q: QualityInfo) => EvidenceStep[]
  checklist: string[]
  checkZones: (MachineZone | null)[] // 확인 항목별 설비 위치
  detectedAt: string
  alarmAt: string | null // 첫 기존 센서 알람(error_code) 시각 → 이상감지 시작
  zones: MachineZone[] // 도식에서 칠할 부위
  status: Incident['status']; assignee: string | null
}
const v = (id: string, snap: Snapshot) => { const s = EQ[id].snapshots[snap]; return s.values[s.values.length - 1] }
const f1 = (n: number) => n.toFixed(1)
const RISK: Record<string, string> = { HIGH: '높음(HIGH)', CRITICAL: '매우 높음(CRITICAL)' }
/** 기준 대비 차이: +7.7℃ / −8.5MPa */
const dev = (id: string, snap: Snapshot) => { const d = v(id, snap) - EQ[id].reference; return `${d > 0 ? '+' : '−'}${f1(Math.abs(d))}${EQ[id].unit === 'MPa' ? 'MPa' : EQ[id].unit}` }
const pct = (q: QualityInfo) => (q.inspected ? `${f1(((q.defects ?? 0) / q.inspected) * 100)}%` : '')
const qText = (q: QualityInfo) => (q.inspected ? `${q.defects}/${q.inspected}` : '검사 결과 없음')

export const INCIDENTS: IncDef[] = [
  {
    id: 'IG-0013', eqp: 'EQP-001', group: 'emergency', appearsAt: '1400', detectedAt: '13:26', alarmAt: '13:33', zones: ['hydraulic', 'barrel'],
    grade: (_s, q) => (q.impact === 'yes' ? 1 : 2),
    title: () => '사출 압력 저하 · 배럴 온도 저하',
    headline: (s) => `사출 압력 낮음 · 기준보다 ${dev('EQP-001', s)} · 배럴 온도도 낮음`,
    why: () => '압력·배럴 온도 동시 이탈 + 치수불량 확인',
    qualitySource: '몸체 LOT',
    evidence: (s, q) => [
      { kind: '기존 센서 알람', at: '13:33', title: `사출 압력 ${f1(v('EQP-001', s))} MPa`, detail: `기준 ${EQ['EQP-001'].reference} · 알람 하한 ${EQ['EQP-001'].threshold} · 압력 저하 알람` },
      { kind: '센서', at: '13:25', title: `배럴 온도 ${f1(EQ['EQP-001'].aux![s])}℃`, detail: `기준 ${f1(EQ['EQP-001'].aux!.reference)} · 사출 압력과 함께 떨어지기 시작` },
      { kind: '검사', at: q.inspected ? '13:58' : undefined, title: `몸체 LOT 치수불량 ${qText(q)}`, detail: q.inspected ? `13:50부터 검수 · ${pct(q)} · 주의 기준 ${CAUTION}% 넘음` : '' },
    ],
    checklist: ['사출 압력·유압 회로 확인', '배럴 히터 밴드·열전대 확인', '같은 몸체 LOT 치수 추가 확인'],
    checkZones: ['hydraulic', 'barrel', null],
    status: 'assigned', assignee: 'OP-002', // inspection_guide.assigned_inspector (13:58 착수)
  },
  {
    id: 'IG-0015', eqp: 'EQP-002', group: 'emergency', appearsAt: '1405', detectedAt: '14:04', alarmAt: '14:04', zones: ['hydraulic'],
    grade: (_s, q) => (q.impact === 'yes' ? 1 : 2),
    headline: (s) => `사출 압력 낮음 · 기준보다 ${dev('EQP-002', s)}`,
    title: () => '사출 압력 급저하', why: () => '알람 · 품질 영향 미확인 · 이상 점수가 더 높음',
    qualitySource: '속뚜껑 LOT',
    evidence: (s) => [
      { kind: '기존 센서 알람', at: '14:04', title: `사출 압력 ${f1(v('EQP-002', s))} MPa`, detail: `기준 ${EQ['EQP-002'].reference} · 알람 하한 ${EQ['EQP-002'].threshold} · 압력 저하 알람` },
      { kind: '검사', title: '속뚜껑 LOT', detail: '품질 영향 미확인 · 검사 결과 없음' },
    ],
    checklist: ['사출 압력·유압 회로 확인', '노즐 막힘 여부 확인', '속뚜껑 LOT 검사 결과 입력 확인'],
    checkZones: ['hydraulic', 'barrel', null], // 노즐은 배럴 끝
    status: 'unassigned', assignee: null,
  },
  {
    id: 'IG-0016', eqp: 'EQP-004', group: 'emergency', appearsAt: '1405', detectedAt: '14:04', alarmAt: '14:04', zones: ['screw'],
    grade: (_s, q) => (q.impact === 'yes' ? 1 : 2),
    headline: (s) => `스크류 회전 흔들림 · 지금 ${f1(v('EQP-004', s))}rpm (기준 ${EQ['EQP-004'].reference})`,
    title: () => '스크류 회전 불안정', why: () => '알람 · 품질 영향 미확인 · 같은 등급에서 점수 다음 순서',
    qualitySource: '속뚜껑 LOT',
    evidence: (s) => [
      { kind: '기존 센서 알람', at: '14:04', title: `스크류 회전 속도 ${f1(v('EQP-004', s))} rpm`, detail: `기준 ${EQ['EQP-004'].reference} · 회전 속도 한계 알람` },
      { kind: '검사', title: '속뚜껑 LOT', detail: '품질 영향 미확인 · 검사 결과 없음' },
    ],
    checklist: ['스크류 구동 모터·벨트 확인', '호퍼 원료 공급 상태 확인', '속뚜껑 LOT 검사 결과 입력 확인'],
    checkZones: ['screw', null, null], // 호퍼는 표시 구역이 없어 위치를 짚지 않는다
    status: 'unassigned', assignee: null,
  },
  {
    id: 'IG-0014', eqp: 'EQP-003', group: 'warning', appearsAt: '1400', detectedAt: '13:41', alarmAt: null, zones: ['barrel'],
    grade: (_s, q) => (q.impact === 'yes' ? 3 : 4), // 14:00 위험도 HIGH → 품질 영향 없으면 4등급
    title: (s) => (s === '1405' ? '배럴 온도 상승 → 뚜껑 표면결함 연결' : '배럴 온도 서서히 상승 · 알람 전'),
    headline: (s) => `배럴 온도 높음 · 기준보다 ${dev('EQP-003', s)} · 알람 전`,
    why: (s) => (s === '1405' ? '알람 전 · 뚜껑 LOT 불량이 이 설비로 연결' : `알람 전 · 위험도 ${RISK[EQ['EQP-003'].snapshots[s].risk ?? 'HIGH'] ?? '높음'}`),
    qualitySource: '뚜껑 LOT',
    evidence: (s, q) => {
      const sig = { kind: 'Q-First 이상 징후', at: '13:41', title: `배럴 온도 ${f1(v('EQP-003', s))}℃`, detail: `기준 ${f1(EQ['EQP-003'].reference)} · 알람 상한 ${f1(EQ['EQP-003'].threshold!)} 아래 · 예고 등재` }
      return s === '1405'
        ? [
            { kind: '검사', at: '14:04', title: `뚜껑 표면결함 ${qText(q)}`, detail: `14:03 생산분 · ${pct(q)} · 주의 기준 ${CAUTION}% 넘음` },
            { kind: 'LOT', at: '14:03', title: `뚜껑 LOT ${q.lot ?? ''}`, detail: '뚜껑 사출기 4대 중 3호기가 만든 LOT' },
            { kind: '대조', title: '7 · 9 · 10호기', detail: '같은 뚜껑을 만드는 설비는 이상 징후 없음' },
            sig,
          ]
        : [sig, { kind: '검사', title: `뚜껑 LOT ${qText(q)}`, detail: '아직 불량 없음' }]
    },
    checklist: ['배럴 히터 밴드·온도 제어 확인', '열전대(온도 센서) 값 확인', '같은 뚜껑 LOT 외관 추가 검사'],
    checkZones: ['barrel', 'barrel', null],
    status: 'unassigned', assignee: null,
  },
]

export function buildIncidents(snap: Snapshot): Incident[] {
  const visible = INCIDENTS.filter((d) => snap === '1405' || d.appearsAt === '1400')
  const made = visible.map((d) => {
    const q = qualityOf(d.eqp, snap, d.qualitySource)
    const grade = d.grade(snap, q)
    let previousGrade: Grade | undefined
    if (snap === '1405') {
      const q0 = qualityOf(d.eqp, '1400', d.qualitySource)
      const g0 = d.appearsAt === '1400' ? d.grade('1400', q0) : undefined
      if (g0 !== undefined && g0 !== grade) previousGrade = g0
    }
    return {
      id: d.id, equipment: EQUIPMENT[d.eqp], group: d.group, grade, previousGrade, rank: 0,
      title: d.title(snap), headline: d.headline(snap), whyFirst: d.why(snap), detectedAt: d.detectedAt, status: d.status, assignee: d.assignee,
      operation: d.alarmAt ? { status: 'alarm', since: d.alarmAt } : { status: 'running', since: null },
      signal: { ...makeSignal(d.eqp, snap, d.group === 'emergency' ? '기존 센서 알람' : 'Q-First 이상 징후'), mark: d.alarmAt ? { at: d.alarmAt, label: '기존 알람' } : { at: d.detectedAt, label: '예고 등재 · 알람 전' } },
      quality: q, evidence: d.evidence(snap, q), checklist: d.checklist, checklistZones: d.checkZones, zones: d.zones,
    } satisfies Incident
  })
  // 같은 목록 안 정렬: 등급 → 품질 영향 크기 → 이상 점수 → 설비 ID (v4 README 규칙)
  const rate = (i: Incident) => (i.quality.inspected ? (i.quality.defects ?? 0) / i.quality.inspected : 0)
  for (const g of ['emergency', 'warning'] as const) {
    made.filter((x) => x.group === g)
      .sort((a, b) => a.grade - b.grade || rate(b) - rate(a) || scoreOf(b.equipment.id, snap) - scoreOf(a.equipment.id, snap) || a.equipment.id.localeCompare(b.equipment.id))
      .forEach((x, i) => { x.rank = i + 1 })
  }
  return made.sort((a, b) => (a.group === b.group ? a.rank - b.rank : a.group === 'emergency' ? -1 : 1))
}

export function normalIds(snap: Snapshot): string[] {
  const abnormal = new Set(buildIncidents(snap).map((x) => x.equipment.id))
  return Object.keys(EQUIPMENT).filter((id) => !abnormal.has(id))
}

export function buildNormal(id: string, snap: Snapshot): NormalEquipment {
  // 14:04 뚜껑 LOT 불량을 거슬러 올라갈 때 같은 뚜껑 사출기 3대는 대조군으로 확인됨
  const capCheck = snap === '1405' && ['EQP-007', 'EQP-009', 'EQP-010'].includes(id)
  return {
    equipment: EQUIPMENT[id], signal: makeSignal(id, snap),
    isInspectionSource: false,
    operation: { status: 'running', since: null },
    note: capCheck ? '14:04 뚜껑 불량 LOT 대조 · 이 설비 LOT 아님' : undefined,
  }
}

/** 판단 이력 (시점별) — 중간발표용으로 프론트에서 정해 둠. 최종 전 판단 이력 표로 교체 */
export const REVISIONS: Record<string, (HistoryRecord['revisions'][number] & { snap: Snapshot })[]> = {
  'IG-0014': [
    { snap: '1400', rev: 'r1', at: '13:41', label: '예고 1위 · 4등급', detail: '배럴 온도 서서히 상승 · 예고 기준 넘음 · 기존 알람 전 · 위험도 HIGH 이상', basis: ['센서 1'] },
    { snap: '1405', rev: 'r2', at: '14:05', label: '예고 1위 · 4등급 → 3등급', detail: '14:04 뚜껑 LOT 표면결함 1/24(4.2%)가 3호기로 연결 → 품질 영향 있음', basis: ['센서 1', '검사 1', 'LOT 1'] },
  ],
  'IG-0013': [
    { snap: '1400', rev: 'r1', at: '13:26', label: '예고 · 이상 징후', detail: '13:25부터 사출 압력·배럴 온도 동시 저하', basis: ['센서 2'] },
    { snap: '1400', rev: 'r2', at: '13:33', label: '비상 1위 · 2등급', detail: '압력 저하 알람 · 몸체 LOT 검사 결과 없음', basis: ['센서 2'] },
    { snap: '1400', rev: 'r3', at: '13:58', label: '비상 1위 · 2등급 → 1등급', detail: '몸체 LOT 치수불량 3/25(12%)가 이 설비로 연결 → 품질 영향 있음 · 13:58 점검 착수', basis: ['센서 2', '검사 1', 'LOT 1'] },
  ],
  'IG-0015': [{ snap: '1405', rev: 'r1', at: '14:04', label: '비상 2위 · 2등급', detail: '사출 압력 급저하 · 속뚜껑 LOT 검사 결과 없음', basis: ['센서 1'] }],
  'IG-0016': [{ snap: '1405', rev: 'r1', at: '14:04', label: '비상 3위 · 2등급', detail: '스크류 회전 불안정 · 속뚜껑 LOT 검사 결과 없음 · 2호기와 같은 등급, 점수 다음', basis: ['센서 1'] }],
}

/** 지난 이력: v6.1 inspection_guide 중 시연 구간(2/3 13:00) 전에 끝난 점검 */
export const PAST_HISTORY: HistoryRecord[] = DATA.pastHistory.map((h) => ({
  id: h.id, date: h.date, time: h.time, equipment: EQUIPMENT[h.equipment], title: h.title,
  group: h.group as AlertGroup, rank: 1, grade: h.grade as Grade, gradeChanged: h.grade !== h.initialGrade,
  status: h.result as HistoryRecord['status'], minutes: h.minutes, assignee: h.assignee,
  actions: [h.action], memo: '',
  revisions: [
    { rev: 'r1', at: h.time, label: `${h.group === 'emergency' ? '비상' : '예고'} · ${h.initialGrade}등급`, detail: `${h.title} · 처음 판단`, basis: ['센서 1'] },
    ...(h.grade !== h.initialGrade ? [{ rev: 'r2', at: h.gradeAt, label: `${h.initialGrade}등급 → ${h.grade}등급`, detail: h.quality === 'DEFECT' || h.quality === 'CAUTION' ? `품질 영향 있음 · 불량 ${(Number(h.qualityRate) * 100).toFixed(1)}% (${h.qualityN}개 검수)` : '판단 갱신', basis: ['센서 1', '검사 1'] }] : []),
  ],
}))

/** 결과 입력 화면의 선택지 (v4 action_taken 한국어 이름표 기준) */
export const ACTION_OPTIONS: Record<string, { label: string; often?: boolean }[]> = {
  injection: [{ label: '사출 압력 조정', often: true }, { label: '노즐 막힘 제거', often: true }, { label: '냉각 채널 청소' }, { label: '유압 밸브 씰 교체' }, { label: '배럴 히터 밴드 교체' }, { label: '열전대 교체' }, { label: '스크류 구동부 정비' }, { label: '조치 없음' }],
  tcu: [{ label: '냉각수 필터 청소', often: true }, { label: '냉각 밸브 수리', often: true }, { label: '설정값 재보정' }, { label: '온도 센서 재보정' }, { label: '히터 교체' }, { label: '조치 없음' }],
}
export const MEMO_CHIPS: Record<string, string[]> = {
  injection: ['노즐 막힘', '냉각 채널 막힘', '유압 씰 마모', '교체 필요', '다음 교대 재확인', '부품 발주'],
  tcu: ['필터 막힘', '냉각 밸브 불량', '유량 회복 확인', '다음 교대 재확인', '부품 발주'],
}
export const REASONS = {
  reject: ['오탐 · 정상 범위', '이미 조치됨', '중복 알림', '다른 설비가 원인'],
  hold: ['생산 중 · 정지 불가', '인력 부족', '부품·공구 대기', '다음 교대로 넘김'],
}
