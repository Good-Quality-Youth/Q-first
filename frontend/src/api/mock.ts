// 시연용 데이터 — 합성 데이터셋 v8(qfirst_dataset_v8) 기준. 시나리오 「사출 PoC (사출기 10대)」 자동 검사 23개 PASS.
// 센서값·LOT·이상 점수·검수 수치·지난 이력은 scripts/build_demo.py 가 뽑은 demo-data.json 을 쓴다. 판단 문장·확인 항목은 화면용으로 프론트에서 쓴 것.
import DATA from './demo-data.json'
import type {
  AlertGroup, CheckView, Equipment, EvidenceStep, Grade, HistoryRecord, Incident, InvestigationView, MachineZone, NormalEquipment, QualityInfo, SignalSeries, Snapshot,
} from './types'

/** 데이터 스냅숏: 14:15 두 장면(조사 중·완료)은 같은 데이터 시각 */
type DataSnap = '1341' | '1400' | '1405' | '1415'
const D = (s: Snapshot): DataSnap => (s === '1415a' || s === '1415b' ? '1415' : s)

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

// ── 신호 ─────────────────────────────────
type SnapData = { risk?: string; values: number[]; start: string; end: string; outSince: string | null; score: number; topFeature: string; alarm: string | null; errorCode: string; lot: string }
type Aux = { label: string; reference: number } & Record<DataSnap, number>
type EqData = { aux?: Aux; kind: string; label: string; unit: string; reference: number; threshold: number | null; limits?: number[]; target: number | null; median: number; band: number[]; snapshots: Record<DataSnap, SnapData> }
const EQ = DATA.equipment as unknown as Record<string, EqData>

function makeSignal(id: string, snap: Snapshot, source: SignalSeries['source'] = ''): SignalSeries {
  const e = EQ[id]
  const s = e.snapshots[D(snap)]
  const digits = 1
  return {
    label: e.label, unit: e.unit, source, reference: e.reference, threshold: e.threshold,
    alarmLimits: e.limits ? { lower: e.limits[0], upper: e.limits[1] } : null,
    band: null, // API v1.0: 평소 범위는 서버가 주지 않을 수 있음. 기준값·알람 한계로 그린다
    domain: [0, 0], // Sparkline이 값·기준값·알람 한계로 계산
    values: s.values.map((v) => +v.toFixed(digits + 1)), startTime: s.start, endTime: s.end, outSince: s.outSince,
  }
}
const scoreOf = (id: string, snap: Snapshot) => EQ[id].snapshots[D(snap)].score

// ── 품질 ─────────────────────────────────
export const CAUTION = 3 // 주의 기준 % — 이상이면 품질 영향 있음, 미만이면(불량이 있어도) 없음
type QSnap = { inspected: number; defects: number }
const Q = DATA.quality as unknown as Record<string, Partial<Record<DataSnap, QSnap>>>

function qualityOf(id: string, snap: Snapshot, source: string): QualityInfo {
  const q = Q[id]?.[D(snap)]
  const lot = EQ[id]?.snapshots[D(snap)]?.lot
  if (!q || q.inspected === 0) return { impact: null, source, lot }
  const rate = (q.defects / q.inspected) * 100
  return { impact: rate >= CAUTION ? 'yes' : 'no', source, defects: q.defects, inspected: q.inspected, lot }
}

// ── 시연 장면 (API v1.1 재생 step 순서) ─────────────────
export const SCENES: { id: Snapshot; time: string; label: string }[] = [
  { id: '1341', time: '13:41', label: '첫 예고' },
  { id: '1400', time: '14:00', label: '품질 영향 없음' },
  { id: '1405', time: '14:05', label: 'LOT 검사 결과 반영' },
  { id: '1415a', time: '14:15', label: '기존 비상 알람 · 조사 중' },
  { id: '1415b', time: '14:15', label: '조사 완료' },
]
export const sceneOf = (s: Snapshot) => SCENES.find((x) => x.id === s)!
const ORDER = SCENES.map((x) => x.id)
export const atOrAfter = (s: Snapshot, t: Snapshot) => ORDER.indexOf(s) >= ORDER.indexOf(t)
/** 비교할 앞 장면. 14:15 조사 완료는 같은 시각의 조사 중 장면이 아니라 그 앞(14:05)과 비교한다 */
const prevScene = (s: Snapshot): Snapshot | null => (s === '1415b' ? '1405' : ORDER[ORDER.indexOf(s) - 1] ?? null)

// ── 사건 (2/3 13:25~14:15 시연 흐름의 이상 설비 4대, ID는 데이터셋 v8 inspection_guide) ──────────
type IncDef = {
  id: string; eqp: string
  appearsAt: Snapshot // 이 장면부터 목록에 나타남
  group: (s: Snapshot) => AlertGroup
  alarmAt: (s: Snapshot) => string | null // 첫 기존 센서 알람(error_code) 시각 → 이상감지 시작
  grade: (s: Snapshot, q: QualityInfo, g: AlertGroup) => Grade
  title: (s: Snapshot) => string
  headline: (s: Snapshot) => string // 현장 말: 부위 + 방향 + 기준 대비
  why: (s: Snapshot) => string
  qualitySource: string
  evidence: (s: Snapshot, q: QualityInfo) => EvidenceStep[]
  checks: (s: Snapshot, q: QualityInfo) => CheckView[]
  investigation: (s: Snapshot) => InvestigationView | null
  detectedAt: string
  zones: MachineZone[] // 도식에서 칠할 부위
  status: Incident['status']; assignee: string | null
}
const v = (id: string, s: Snapshot) => { const x = EQ[id].snapshots[D(s)]; return x.values[x.values.length - 1] }
const f1 = (n: number) => n.toFixed(1)
/** 기준 대비 차이: +7.7℃ / −8.5MPa */
const dev = (id: string, s: Snapshot) => { const d = v(id, s) - EQ[id].reference; return `${d > 0 ? '+' : '−'}${f1(Math.abs(d))}${EQ[id].unit}` }
const pct = (q: QualityInfo) => (q.inspected ? `${f1(((q.defects ?? 0) / q.inspected) * 100)}%` : '')
const qText = (q: QualityInfo) => (q.inspected ? `${q.defects}/${q.inspected}` : '검사 결과 없음')
const hi = (id: string) => f1(EQ[id].limits![1])
const lo = (id: string) => f1(EQ[id].limits![0])
/** 기본 확인 항목 (데이터셋 inspection_guide.check_items를 화면용으로 나눈 것). 코드는 API v1.1 CheckItem.code 기준 */
const base = (items: [string, string, MachineZone | null][]): CheckView[] =>
  items.map(([code, label, zone]) => ({ code, label, baseline: null, refined: false, evidenceIds: [], zone }))
/** 조사로 구체화: 같은 code의 기본 안내는 baseline으로 남긴다(API v1.1 source: investigation) */
const refine = (checks: CheckView[], code: string, label: string, evidenceIds: string[]): CheckView[] =>
  checks.map((c) => (c.code === code ? { ...c, baseline: c.label, label, refined: true, evidenceIds } : c))
const inv = (status: InvestigationView['status'], trigger: InvestigationView['trigger']): InvestigationView =>
  ({ status, trigger, label: status === 'running' ? 'Q-First 조사 중' : status === 'completed' ? '조사 완료' : '조사 실패 · 기본 안내 유지' })

const INCIDENTS: IncDef[] = [
  {
    id: 'IG-0014', eqp: 'EQP-001', appearsAt: '1341', detectedAt: '13:26', zones: ['hydraulic', 'barrel'],
    group: () => 'emergency', alarmAt: () => '13:33',
    grade: (_s, q) => (q.impact === 'yes' ? 1 : 2),
    title: () => '사출 압력 저하 · 배럴 온도 저하',
    headline: (s) => `사출 압력 낮음 · 기준보다 ${dev('EQP-001', s)} · 배럴 온도도 낮음`,
    why: (s) => (s === '1341' ? '압력·배럴 온도 동시 이탈 · 몸체 LOT 검사 결과 아직 없음' : '압력·배럴 온도 동시 이탈 + 치수불량 확인'),
    qualitySource: '몸체 LOT',
    evidence: (s, q) => [
      { id: 'EV-001-ALARM', kind: '기존 센서 알람', at: '13:33', title: `사출 압력 ${f1(v('EQP-001', s))} MPa`, detail: `기준 ${EQ['EQP-001'].reference} · 알람 하한 ${lo('EQP-001')} · 압력 저하 알람` },
      { id: 'EV-001-TEMP', kind: '센서', at: '13:25', title: `배럴 온도 ${f1(EQ['EQP-001'].aux![D(s)])}℃`, detail: `기준 ${f1(EQ['EQP-001'].aux!.reference)} · 사출 압력과 함께 떨어지기 시작` },
      q.inspected
        ? { id: 'EV-001-QC', kind: '검사', at: '13:58', title: `몸체 LOT 치수불량 ${qText(q)}`, detail: `13:53~13:56 검수 · ${pct(q)} · 주의 기준 ${CAUTION}% 넘음` }
        : { id: 'EV-001-LOT', kind: 'LOT', title: `몸체 LOT ${q.lot ?? ''}`, detail: '검사 결과 아직 없음 · 품질 영향 미확인' },
    ],
    checks: () => base([['PRESSURE_CHECK', '사출 압력·유압 회로 확인', 'hydraulic'], ['BARREL_HEATING', '배럴 히터 밴드·열전대 확인', 'barrel'], ['LOT_EXTRA', '같은 몸체 LOT 치수 추가 확인', null]]),
    investigation: () => null, // 백엔드 fixture(v1.1) 기준: 13:33 알람은 시연 시작 전이라 조사 기록 없음
    status: 'assigned', assignee: 'OP-001', // 데이터셋 v8 inspection_guide IG-0014 (13:58 착수, 주간조)
  },
  {
    id: 'IG-0016', eqp: 'EQP-002', appearsAt: '1405', detectedAt: '14:04', zones: ['hydraulic'],
    group: () => 'emergency', alarmAt: () => '14:04',
    grade: (_s, q) => (q.impact === 'yes' ? 1 : 2),
    headline: (s) => `사출 압력 낮음 · 기준보다 ${dev('EQP-002', s)}`,
    title: () => '사출 압력 급저하',
    why: (s) => (atOrAfter(s, '1415a') ? '알람 · 속뚜껑 LOT 불량 0건(기준 미만)' : '알람 · 품질 영향 미확인 · 이상 점수가 더 높음'),
    qualitySource: '속뚜껑 LOT',
    evidence: (s, q) => [
      { id: 'EV-002-ALARM', kind: '기존 센서 알람', at: '14:04', title: `사출 압력 ${f1(v('EQP-002', s))} MPa`, detail: `기준 ${EQ['EQP-002'].reference} · 알람 하한 ${lo('EQP-002')} · 압력 저하 알람` },
      q.inspected
        ? { id: 'EV-002-QC', kind: '검사', title: `속뚜껑 LOT 검사 ${qText(q)}`, detail: '불량 0건 · 기준 미만(품질 영향 없음)' }
        : { id: 'EV-002-LOT', kind: '검사', title: '속뚜껑 LOT', detail: '품질 영향 미확인 · 검사 결과 없음' },
    ],
    checks: () => base([['PRESSURE_CHECK', '사출 압력·유압 회로 확인', 'hydraulic'], ['NOZZLE', '노즐 막힘 여부 확인', 'barrel'], ['LOT_RESULT', '속뚜껑 LOT 검사 결과 입력 확인', null]]),
    investigation: () => null,
    status: 'unassigned', assignee: null,
  },
  {
    id: 'IG-0017', eqp: 'EQP-004', appearsAt: '1405', detectedAt: '14:04', zones: ['screw'],
    group: () => 'emergency', alarmAt: () => '14:04',
    grade: (_s, q) => (q.impact === 'yes' ? 1 : 2),
    headline: (s) => `스크류 회전 흔들림 · 지금 ${f1(v('EQP-004', s))}rpm (기준 ${EQ['EQP-004'].reference})`,
    title: () => '스크류 회전 불안정',
    why: (s) => (atOrAfter(s, '1415a') ? '알람 · 속뚜껑 LOT 불량 0건 · 같은 등급에서 점수 다음 순서' : '알람 · 품질 영향 미확인 · 같은 등급에서 점수 다음 순서'),
    qualitySource: '속뚜껑 LOT',
    evidence: (s, q) => [
      { id: 'EV-004-ALARM', kind: '기존 센서 알람', at: '14:04', title: `스크류 회전 속도 ${f1(v('EQP-004', s))} rpm`, detail: `기준 ${EQ['EQP-004'].reference} · 회전 속도 한계 알람` },
      q.inspected
        ? { id: 'EV-004-QC', kind: '검사', title: `속뚜껑 LOT 검사 ${qText(q)}`, detail: '불량 0건 · 기준 미만(품질 영향 없음)' }
        : { id: 'EV-004-LOT', kind: '검사', title: '속뚜껑 LOT', detail: '품질 영향 미확인 · 검사 결과 없음' },
    ],
    checks: () => base([['SCREW_DRIVE', '스크류 구동 모터·벨트 확인', 'screw'], ['HOPPER', '호퍼 원료 공급 상태 확인', null], ['LOT_RESULT', '속뚜껑 LOT 검사 결과 입력 확인', null]]),
    investigation: () => null,
    status: 'unassigned', assignee: null,
  },
  {
    id: 'IG-0015', eqp: 'EQP-003', appearsAt: '1341', detectedAt: '13:41', zones: ['barrel'],
    group: (s) => (atOrAfter(s, '1415a') ? 'emergency' : 'warning'),
    alarmAt: (s) => (atOrAfter(s, '1415a') ? '14:15' : null),
    grade: (_s, q, g) => (g === 'emergency' ? (q.impact === 'yes' ? 1 : 2) : q.impact === 'yes' ? 3 : 4), // 예고 위험도 HIGH 이상 → 품질 영향 없으면 4등급
    title: (s) => (s === '1341' || s === '1400' ? '배럴 온도 서서히 상승 · 알람 전' : s === '1405' ? '배럴 온도 상승 → 뚜껑 표면결함 연결' : '배럴 온도 알람 · 뚜껑 표면결함 연결'),
    headline: (s) => (atOrAfter(s, '1415a') ? `배럴 온도 알람 · 기준보다 ${dev('EQP-003', s)}` : `배럴 온도 높음 · 기준보다 ${dev('EQP-003', s)} · 알람 전`),
    why: (s) => ({
      '1341': '알람 전 · 뚜껑 LOT 검사 결과 아직 없음',
      '1400': '알람 전 · 뚜껑 LOT 불량 0건(기준 미만)',
      '1405': '알람 전 · 뚜껑 LOT 불량이 이 설비로 연결',
      '1415a': '기존 알람 · 뚜껑 LOT 불량 연결 · 1호기보다 불량률 낮아 다음 순서',
      '1415b': '기존 알람 · 뚜껑 LOT 불량 연결 · 1호기보다 불량률 낮아 다음 순서',
    })[s],
    qualitySource: '뚜껑 LOT',
    evidence: (s, q) => {
      const sig: EvidenceStep = { id: 'EV-003-1341', kind: 'Q-First 이상 징후', at: '13:41', title: `배럴 온도 ${f1(v('EQP-003', '1341'))}℃`, detail: `기준 ${f1(EQ['EQP-003'].reference)} · 알람 상한 ${hi('EQP-003')} 아래 · 예고 등재` }
      const lot: EvidenceStep = { id: 'EV-003-LOT', kind: 'LOT', at: '13:30', title: `뚜껑 LOT ${q.lot ?? ''}`, detail: '뚜껑 사출기 4대 중 3호기가 13:30부터 만든 LOT' }
      const cmp: EvidenceStep = { id: 'EV-003-CMP', kind: '대조', title: '7 · 9 · 10호기', detail: '같은 뚜껑을 만드는 설비는 이상 징후 없음' }
      if (s === '1341') return [sig, { ...lot, detail: '검사 결과 아직 없음 · 품질 영향 미확인' }]
      if (s === '1400') return [{ id: 'EV-003-QC', kind: '검사', at: '14:00', title: `뚜껑 LOT 검사 ${qText(q)}`, detail: '예고 이후 생산분 · 불량 0건 · 기준 미만(품질 영향 없음)' }, lot, sig]
      if (s === '1405') return [{ id: 'EV-003-QC', kind: '검사', at: '14:04', title: `뚜껑 표면결함 ${qText(q)}`, detail: `예고 이후 생산분 · ${pct(q)} · 주의 기준 ${CAUTION}% 넘음` }, lot, cmp, sig]
      return [
        { id: 'EV-003-ALARM', kind: '기존 센서 알람', at: '14:15', title: `배럴 온도 ${f1(v('EQP-003', s))}℃`, detail: `알람 상한 ${hi('EQP-003')} 넘음 · 온도 알람` },
        { id: 'EV-003-QC', kind: '검사', at: '14:10', title: `뚜껑 표면결함 ${qText(q)}`, detail: `14:04 · 14:10 기록 · ${pct(q)} · 주의 기준 ${CAUTION}% 넘음` },
        lot, cmp, sig,
      ]
    },
    checks: (s, q) => {
      const c = base([['BARREL_HEATING', '배럴 히터 밴드·온도 제어 확인', 'barrel'], ['THERMOCOUPLE', '열전대(온도 센서) 값 확인', 'barrel'], ['LOT_EXTRA', '같은 뚜껑 LOT 외관 추가 검사', null]])
      const ref = f1(EQ['EQP-003'].reference)
      // 신규 예고 조사 결과(14:00·14:05): 예고 근거 구간을 먼저 대조하게 좁힌다
      if (s === '1400' || s === '1405') return refine(c, 'BARREL_HEATING', `13:41 예고 구간의 배럴 온도(${f1(v('EQP-003', '1341'))}℃, 기준 ${ref}℃)를 먼저 대조한 뒤 배럴 히터 밴드·온도 제어를 확인하세요`, ['EV-003-1341'])
      // 비상 알람 조사 결과(14:15 조사 완료): 온도 추이와 LOT 불량 기록을 함께 대조하게 좁힌다
      if (s === '1415b') return refine(c, 'BARREL_HEATING', `13:41~14:15 배럴 온도 추이(${f1(v('EQP-003', '1341'))} → ${f1(v('EQP-003', s))}℃)와 ${q.lot ?? '뚜껑 LOT'}의 14:04·14:10 표면결함 기록을 대조한 뒤 배럴 히터 밴드·온도 제어를 확인하세요`, ['EV-003-1341', 'EV-003-ALARM', 'EV-003-QC', 'EV-003-LOT'])
      return c // 조사 중에는 기본 안내 (API v1.1: 조사 결과가 나오기 전 기존 지침 유지)
    },
    investigation: (s) => ({
      '1341': inv('running', '신규 예고'), '1400': inv('completed', '신규 예고'), '1405': inv('completed', '신규 예고'),
      '1415a': inv('running', '기존 비상 알람'), '1415b': inv('completed', '기존 비상 알람'),
    })[s],
    status: 'unassigned', assignee: null,
  },
]

function made(d: IncDef, s: Snapshot) {
  const q = qualityOf(d.eqp, s, d.qualitySource)
  const g = d.group(s)
  return { q, g, grade: d.grade(s, q, g) }
}

export function buildIncidents(snap: Snapshot): Incident[] {
  const list = INCIDENTS.filter((d) => atOrAfter(snap, d.appearsAt)).map((d) => {
    const { q, g, grade } = made(d, snap)
    const p = prevScene(snap)
    const before = p && atOrAfter(p, d.appearsAt) ? made(d, p) : null
    const alarmAt = d.alarmAt(snap)
    return {
      id: d.id, equipment: EQUIPMENT[d.eqp], group: g, grade, rank: 0,
      previousGrade: before && before.grade !== grade ? before.grade : undefined,
      previousGroup: before && before.g !== g ? before.g : undefined,
      title: d.title(snap), headline: d.headline(snap), whyFirst: d.why(snap), detectedAt: d.detectedAt, status: d.status, assignee: d.assignee,
      operation: alarmAt ? { status: 'alarm', since: alarmAt } : { status: 'running', since: null },
      signal: { ...makeSignal(d.eqp, snap, g === 'emergency' ? '기존 센서 알람' : 'Q-First 이상 징후'), mark: alarmAt ? { at: alarmAt, label: '기존 알람' } : { at: d.detectedAt, label: '예고 등재 · 알람 전' } },
      quality: q, evidence: d.evidence(snap, q), checks: d.checks(snap, q), investigation: d.investigation(snap), zones: d.zones,
    } satisfies Incident
  })
  // 같은 목록 안 정렬: 등급 → 품질 영향 크기 → 이상 점수 → 설비 ID (데이터셋 README 규칙)
  const rate = (i: Incident) => (i.quality.inspected ? (i.quality.defects ?? 0) / i.quality.inspected : 0)
  for (const g of ['emergency', 'warning'] as const) {
    list.filter((x) => x.group === g)
      .sort((a, b) => a.grade - b.grade || rate(b) - rate(a) || scoreOf(b.equipment.id, snap) - scoreOf(a.equipment.id, snap) || a.equipment.id.localeCompare(b.equipment.id))
      .forEach((x, i) => { x.rank = i + 1 })
  }
  return list.sort((a, b) => (a.group === b.group ? a.rank - b.rank : a.group === 'emergency' ? -1 : 1))
}

export function normalIds(snap: Snapshot): string[] {
  const abnormal = new Set(buildIncidents(snap).map((x) => x.equipment.id))
  return Object.keys(EQUIPMENT).filter((id) => !abnormal.has(id))
}

export function buildNormal(id: string, snap: Snapshot): NormalEquipment {
  // 14:04 뚜껑 LOT 불량을 거슬러 올라갈 때 같은 뚜껑 사출기 3대는 대조군으로 확인됨
  const capCheck = atOrAfter(snap, '1405') && ['EQP-007', 'EQP-009', 'EQP-010'].includes(id)
  return {
    equipment: EQUIPMENT[id], signal: makeSignal(id, snap),
    isInspectionSource: false,
    operation: { status: 'running', since: null },
    note: capCheck ? '14:04 뚜껑 불량 LOT 대조 · 이 설비 LOT 아님' : undefined,
  }
}

/** 판단 이력 (장면별) — 중간발표용으로 프론트에서 정해 둠. 백엔드 판단 이력(revisions)으로 교체. 새 판이 생긴 이유를 detail 첫머리에 적는다 */
export const REVISIONS: Record<string, (HistoryRecord['revisions'][number] & { snap: Snapshot })[]> = {
  'IG-0015': [
    { snap: '1341', rev: 'r1', at: '13:41', label: '예고 1위 · 4등급', detail: '예고 등재 · 배럴 온도 서서히 상승 · 기존 알람 전 · 검사 결과 없음', basis: ['센서 1'] },
    { snap: '1400', rev: 'r2', at: '14:00', label: '예고 1위 · 4등급', detail: '검사 반영 · 뚜껑 LOT 0/19 불량 0건 → 품질 영향 없음(기준 미만)', basis: ['센서 1', '검사 1'] },
    { snap: '1405', rev: 'r3', at: '14:05', label: '예고 1위 · 4등급 → 3등급', detail: '검사 반영 · 14:04 뚜껑 LOT 표면결함 1/24(4.2%)가 3호기로 연결 → 품질 영향 있음', basis: ['센서 1', '검사 1', 'LOT 1'] },
    { snap: '1415a', rev: 'r4', at: '14:15', label: '예고 3등급 → 비상 2위 · 1등급', detail: '기존 알람 · 배럴 온도 알람 상한 넘음 · 뚜껑 LOT 2/34(5.9%)', basis: ['알람 1', '검사 1', 'LOT 1'] },
    { snap: '1415b', rev: 'r5', at: '14:15', label: '비상 2위 · 1등급 (그대로)', detail: '조사 반영 · 등급·순위는 그대로, 확인 항목을 근거 4건으로 구체화', basis: ['센서 1', '알람 1', '검사 1', 'LOT 1'] },
  ],
  'IG-0014': [
    { snap: '1341', rev: 'r1', at: '13:26', label: '예고 · 이상 징후', detail: '예고 등재 · 13:25부터 사출 압력·배럴 온도 동시 저하', basis: ['센서 2'] },
    { snap: '1341', rev: 'r2', at: '13:33', label: '비상 1위 · 2등급', detail: '기존 알람 · 압력 저하 알람 · 몸체 LOT 검사 결과 없음', basis: ['센서 2'] },
    { snap: '1400', rev: 'r3', at: '13:58', label: '비상 1위 · 2등급 → 1등급', detail: '검사 반영 · 몸체 LOT 치수불량 3/25(12%)가 이 설비로 연결 → 품질 영향 있음 · 13:58 점검 착수', basis: ['센서 2', '검사 1', 'LOT 1'] },
  ],
  'IG-0016': [
    { snap: '1405', rev: 'r1', at: '14:04', label: '비상 2위 · 2등급', detail: '기존 알람 · 사출 압력 급저하 · 속뚜껑 LOT 검사 결과 없음', basis: ['센서 1'] },
    { snap: '1415a', rev: 'r2', at: '14:15', label: '비상 3위 · 2등급', detail: '검사 반영 · 속뚜껑 LOT 0/10 불량 0건(기준 미만) · 3호기 비상 이동으로 한 칸 뒤로', basis: ['센서 1', '검사 1'] },
  ],
  'IG-0017': [
    { snap: '1405', rev: 'r1', at: '14:04', label: '비상 3위 · 2등급', detail: '기존 알람 · 스크류 회전 불안정 · 속뚜껑 LOT 검사 결과 없음 · 2호기와 같은 등급, 점수 다음', basis: ['센서 1'] },
    { snap: '1415a', rev: 'r2', at: '14:15', label: '비상 4위 · 2등급', detail: '검사 반영 · 속뚜껑 LOT 0/10 불량 0건(기준 미만) · 3호기 비상 이동으로 한 칸 뒤로', basis: ['센서 1', '검사 1'] },
  ],
}

/** 지난 이력: 데이터셋 inspection_guide 중 시연 구간(2/3 13:00) 전에 끝난 점검 */
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
