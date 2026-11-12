// 화면이 부르는 함수는 이 파일에만 있다.
// 지금은 가상 데이터(mock.ts)를 메모리에서 돌려주고, 백엔드 API가 나오면 각 함수 안쪽만 fetch로 바꾼다.
// 예) getBoard → GET /api/board?snapshot=1405
import { DEMO_DATE, PAST_HISTORY, REVISIONS, buildIncidents, buildNormal, normalIds } from './mock'
import type {
  Board, DecisionInput, HistoryRecord, Incident, ResultInput, Snapshot,
} from './types'

const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms))

// ── 메모리 저장소 (새로고침하면 처음 상태로 돌아감) ─────────────
type Saved = {
  decision?: DecisionInput & { at: string }
  result?: ResultInput & { at: string; minutes: number }
}
const store: Record<string, Saved> = {}
/** 시나리오상 이미 일어난 결정: EQP-001은 13:58에 점검 착수 (운영 상태 이상감지 → 점검중) */
const SEED: Record<string, Saved> = { 'IG-0013': { decision: { type: 'start', at: '13:58' } } }
const seed = () => { for (const [k, v] of Object.entries(SEED)) store[k] = { ...v } }
seed()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((f) => f())
export const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f) } }

/** 시연 시계: 착수 14:06, 결과 저장 14:18 */
const DEMO_START = '14:06'
const DEMO_SAVE = '14:18'

function applyStore(inc: Incident): Incident {
  const s = store[inc.id]
  if (!s?.decision) return inc
  const t = s.decision.type
  if (t === 'reject') return { ...inc, status: 'rejected' }
  if (t === 'hold') return { ...inc, status: 'onHold' }
  // 착수하면 설비 상태는 점검중, 결과를 저장하면 다시 가동 (operation_status 제안 규칙)
  const operation: Incident['operation'] = s.result
    ? { status: 'running', since: s.result.at }
    : { status: 'inspecting', since: s.decision.at }
  return { ...inc, status: s.result ? 'done' : 'inProgress', assignee: inc.assignee ?? 'OP-001', operation }
}

function incidents(snap: Snapshot): Incident[] {
  return buildIncidents(snap).map(applyStore)
}

// ── 조회 ─────────────────────────────────
export async function getBoard(snapshot: Snapshot): Promise<Board> {
  await wait()
  const all = incidents(snapshot)
  const emergency = all.filter((x) => x.group === 'emergency')
  const warning = all.filter((x) => x.group === 'warning')
  const decided = Object.values(store).map((s) => s.decision?.type)
  return {
    snapshot,
    asOf: snapshot === '1405' ? '14:05' : '14:00',
    emergency, warning,
    normal: normalIds(snapshot).map((id) => buildNormal(id, snapshot)),
    summary: {
      emergency: emergency.length,
      warning: warning.length,
      inProgress: all.filter((x) => x.status === 'inProgress').length,
      normal: normalIds(snapshot).length,
      qualityLinked: all.filter((x) => x.quality.impact === 'yes').map((x) => x.equipment.id),
      handled: {
        started: decided.filter((d) => d === 'start').length,
        onHold: decided.filter((d) => d === 'hold').length,
        rejected: decided.filter((d) => d === 'reject').length,
        total: all.length,
      },
    },
  }
}

export async function getIncident(id: string, snapshot: Snapshot): Promise<Incident | undefined> {
  await wait(60)
  return incidents(snapshot).find((x) => x.id === id)
}

// ── 저장 ─────────────────────────────────
export async function saveDecision(id: string, input: DecisionInput): Promise<void> {
  if (input.type !== 'start' && !input.reason) throw new Error('반려·보류는 사유가 필요해요')
  await wait()
  store[id] = { decision: { ...input, at: DEMO_START } }
  emit()
}

export async function saveResult(id: string, input: ResultInput): Promise<void> {
  if (store[id]?.decision?.type !== 'start') throw new Error('착수한 건만 결과를 저장할 수 있어요')
  await wait()
  store[id].result = { ...input, at: DEMO_SAVE, minutes: 12 }
  emit()
}

/** 시연 처음으로: 저장 내용 비우고 시나리오 시작 상태로 */
export function resetStore() {
  Object.keys(store).forEach((k) => delete store[k])
  seed()
  emit()
}

export function getSaved(id: string): Saved | undefined {
  return store[id]
}

const OUTCOME_LABEL = { found: '이상 발견', notFound: '이상 없음', unclear: '판단 어려움' } as const

export async function getHistory(snapshot: Snapshot): Promise<HistoryRecord[]> {
  await wait()
  const today: HistoryRecord[] = incidents(snapshot).map((inc) => {
    const s = store[inc.id]
    const status: HistoryRecord['status'] = s?.result ? OUTCOME_LABEL[s.result.outcome]
      : s?.decision?.type === 'reject' ? '반려' : s?.decision?.type === 'hold' ? '보류' : '진행 중'
    const revs = (REVISIONS[inc.id] ?? []).filter((r) => snapshot === '1405' || r.snap === '1400')
    return {
      id: inc.id, date: DEMO_DATE, time: inc.detectedAt,
      equipment: inc.equipment, title: inc.title.split(' →')[0].split(' · ')[0], group: inc.group, rank: inc.rank, grade: inc.grade,
      gradeChanged: !!inc.previousGrade, status, minutes: s?.result?.minutes ?? null,
      assignee: inc.assignee ?? (s?.decision?.type === 'start' ? 'OP-001' : null),
      actions: s?.result?.actions ?? [], memo: s?.result?.memo ?? '', reason: s?.decision?.reason, revisions: revs,
    }
  })
  return [...today.sort((a, b) => b.time.localeCompare(a.time)), ...PAST_HISTORY]
}
