import type { AdvanceResponse, Board, Card, IncidentDetail, NotificationPage } from './contract'
import { hhmm, toChecks, toEvidence, toInvestigation } from './adapt'
import type { Board as BoardView, Incident, Snapshot, SignalSeries } from './types'

export const replayEnabled = import.meta.env.VITE_QFIRST_REPLAY_API === '1'
const api = '/api/v1'
export const LOCAL_REPLAY_SCENES: Snapshot[] = ['1341', '1400', '1405', '1415a']

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(api + path, { cache: 'no-store', ...options })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error?.code ?? `재생 API 응답 오류 (${response.status})`)
  }
  return response.json() as Promise<T>
}

export const readReplayBoard = () => request<Board>('/board')
export const replayScene = (board: Board): Snapshot =>
  board.replay?.step === 4 && [...board.emergency, ...board.warning].some(
    (card) => card.equipment.id === 'EQP-003' && card.investigation?.status === 'completed',
  ) ? '1415b' : LOCAL_REPLAY_SCENES[(board.replay?.step ?? 1) - 1] ?? '1341'

let pending: { boardId: string; expectedStep: number; key: string } | undefined
export async function advanceReplay(board: Board) {
  if (!board.replay?.hasNext) return { board, notices: [] }
  if (pending?.boardId !== board.boardId || pending.expectedStep !== board.replay.step) {
    pending = { boardId: board.boardId, expectedStep: board.replay.step, key: crypto.randomUUID() }
  }
  const { key, ...body } = pending
  try {
    await request<AdvanceResponse>('/demo/replay/next', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(body),
    })
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'REPLAY_STEP_CONFLICT') throw error
  }
  pending = undefined
  const updated = await readReplayBoard()
  const page = await request<NotificationPage>(`/notifications?after=${encodeURIComponent(board.notificationCursor)}`)
  return { board: updated, notices: page.items }
}

interface LiveSeries {
  equipment: Card['equipment']; signal: Card['signal']; asOf: string
  values: number[]; startAt: string; endAt: string
}
const equipmentView = (eq: Card['equipment']): Incident['equipment'] => ({
  ...eq, kind: 'injection', name: `${eq.id} · ${eq.part}`,
})
const readSeries = (id: string, board: Board) => request<LiveSeries>(
  `/equipment/${encodeURIComponent(id)}/series?asOf=${encodeURIComponent(board.asOf)}`,
)
function signalView(series: LiveSeries, board: Board, card?: Card): SignalSeries {
  const s = card?.signal ?? series.signal
  const limits = s.alarmLimits
  const mark = s.marks[s.marks.length - 1]
  const bounds = [...series.values, s.reference ?? 0,
    ...(limits?.lower != null ? [limits.lower] : []), ...(limits?.upper != null ? [limits.upper] : [])]
  const min = Math.min(...bounds), max = Math.max(...bounds), pad = Math.max((max-min)*0.08, 0.1)
  return {
    label: s.label, unit: s.unit, reference: s.reference ?? 0,
    values: series.values, alarmLimits: limits,
    threshold: limits ? ((s.value ?? 0) < (s.reference ?? 0) ? limits.lower : limits.upper) : null,
    band: s.band?.lower != null && s.band?.upper != null ? [s.band.lower, s.band.upper] : null,
    domain: [min-pad, max+pad],
    source: card ? (card.group === 'emergency' ? '기존 센서 알람' : 'Q-First 이상 징후') : '',
    startTime: hhmm(series.startAt, board.displayTimeZone), endTime: hhmm(series.endAt, board.displayTimeZone),
    outSince: card ? hhmm(card.detectedAt, board.displayTimeZone) : null,
    mark: mark ? { at: hhmm(mark.at, board.displayTimeZone), label: mark.kind === 'firstAlarm' ? '기존 센서 알람' : '첫 예고' } : undefined,
  }
}
function cardView(card: Card, board: Board, series: LiveSeries, detail?: IncidentDetail): Incident {
  return {
    equipment: equipmentView(card.equipment),
    id: card.incidentId, group: card.group, grade: card.grade, rank: card.rank,
    previousGrade: card.previousGrade ?? undefined,
    previousGroup: card.previousGrade && card.group === 'emergency' && card.signal.marks.some((m) => m.kind === 'firstWarning')
      && card.previousGrade >= 3 ? 'warning' : undefined,
    detectedAt: hhmm(card.detectedAt, board.displayTimeZone),
    title: card.headline, headline: card.headline, whyFirst: card.rankReason,
    status: card.status === 'open' ? 'unassigned' : card.status,
    assignee: card.operation.startedBy?.name ?? null,
    operation: { status: card.operation.status, since: card.operation.since ? hhmm(card.operation.since, board.displayTimeZone) : null },
    signal: signalView(series, board, card),
    quality: { source: `${card.equipment.part} LOT`, impact: card.quality.impact, lot: card.quality.lotIds[0],
      defects: card.quality.defects ?? undefined, inspected: card.quality.inspected ?? undefined },
    checks: toChecks(detail?.checklist ?? [card.firstCheck]),
    investigation: toInvestigation(card.investigation),
    evidence: detail?.evidence.map((e) => toEvidence(e, board.displayTimeZone)) ?? [],
    zones: detail?.zones ?? (card.signal.metric === 'barrelTemperature' ? ['barrel'] : card.signal.metric === 'screwSpeed' ? ['screw'] : ['hydraulic']),
  }
}

export async function readLiveBoard(): Promise<BoardView> {
  const board = await readReplayBoard()
  const snap = replayScene(board)
  const series = new Map(await Promise.all([...board.emergency, ...board.warning, ...board.normal].map(async item =>
    [item.equipment.id, await readSeries(item.equipment.id, board)] as const)))
  return {
    snapshot: snap, asOf: hhmm(board.asOf, board.displayTimeZone),
    emergency: board.emergency.map((card) => cardView(card, board, series.get(card.equipment.id)!)),
    warning: board.warning.map((card) => cardView(card, board, series.get(card.equipment.id)!)),
    normal: board.normal.map((item) => ({ equipment: equipmentView(item.equipment),
      signal: signalView(series.get(item.equipment.id)!, board),
      operation: { status: item.operation.status, since: item.operation.since ? hhmm(item.operation.since, board.displayTimeZone) : null },
    })),
    summary: {
      emergency: board.summary.emergencyCount, warning: board.summary.warningCount,
      inProgress: board.summary.workCounts.inProgress, normal: board.summary.normalCount,
      qualityLinked: [...board.emergency, ...board.warning].filter((card) => card.quality.impact === 'yes').map((card) => card.equipment.id),
      handled: { started: board.summary.workCounts.inProgress + board.summary.workCounts.done,
        onHold: board.summary.workCounts.onHold, rejected: board.summary.workCounts.rejected,
        total: board.summary.emergencyCount + board.summary.warningCount },
    },
  }
}

export async function readLiveIncident(id: string) {
  const board = await readReplayBoard()
  const card = [...board.emergency, ...board.warning].find((c) => c.incidentId === id)
  if (!card) return undefined
  const detail = await request<IncidentDetail>(`/incidents/${encodeURIComponent(id)}?revision=${card.revision}`)
  return cardView(card, board, await readSeries(card.equipment.id, board), detail)
}
