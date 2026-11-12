// API 계약(contract.ts) → 화면 타입(types.ts) 변환.
// 시각 변환·코드 라벨·구역 매핑처럼 "API 값을 화면에 어떻게 보일지"는 이 파일에만 둔다.
// 런타임 import 없이 순수 함수로만 쓴다 (scripts/check-fixtures.ts가 Node에서 바로 불러 검사한다).
import type { Board, Card, CheckItem, Evidence, Investigation } from './contract'
import type { CheckView, EvidenceStep, InvestigationView, MachineZone } from './types'

/**
 * ISO 시각 → "HH:mm". 반드시 Board.displayTimeZone으로 바꾼다.
 * 브라우저 시간대로 표시하면 같은 응답이 PC 설정에 따라 다른 시각으로 보인다.
 */
export function hhmm(iso: string, timeZone: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new Error(`시각 형식이 아니에요: ${iso}`)
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
}

/** 확인 항목 코드 → 3D 기능 구역. API는 코드만 주므로 위치 표는 프론트가 가진다(API v1.0 합의) */
export const CHECK_ZONE: Record<string, MachineZone> = {
  BARREL_HEATING: 'barrel',
  PRESSURE_CHECK: 'hydraulic',
  SCREW_DRIVE: 'screw',
}

/** 확인 항목: 같은 code의 기본 안내와 구체화 안내는 한 줄로 합치고, 서버가 보낸 순서는 지킨다 */
export function toChecks(items: CheckItem[]): CheckView[] {
  const out: CheckView[] = []
  for (const it of items) {
    const same = out.find((c) => c.code === it.code)
    if (!same) {
      out.push({
        code: it.code, label: it.label, baseline: null, refined: it.source === 'investigation',
        evidenceIds: it.evidenceIds, zone: CHECK_ZONE[it.code] ?? null,
      })
    } else if (it.source === 'investigation' && !same.refined) {
      Object.assign(same, { baseline: same.label, label: it.label, refined: true, evidenceIds: it.evidenceIds })
    } else if (it.source === 'baseline' && same.refined && !same.baseline) {
      same.baseline = it.label
    }
  }
  return out
}

const TRIGGER = { newWarning: '신규 예고', emergencyAlarm: '기존 비상 알람' } as const
const INV_LABEL = { running: 'Q-First 조사 중', completed: '조사 완료', failed: '조사 실패 · 기본 안내 유지' } as const

export function toInvestigation(inv: Investigation | null): InvestigationView | null {
  if (!inv) return null
  return { status: inv.status, trigger: TRIGGER[inv.trigger], label: INV_LABEL[inv.status] }
}

/** 근거 종류 라벨. 화면의 기존 라벨(기존 센서 알람, Q-First 이상 징후 등)과 맞춘다 */
const KIND_LABEL: Record<Evidence['kind'], string> = {
  sensor: '센서', alarm: '기존 센서 알람', inspection: '검사', lot: 'LOT', comparison: '대조', analysis: 'Q-First 이상 징후',
}

export function toEvidence(e: Evidence, timeZone: string): EvidenceStep {
  return {
    id: e.id,
    kind: KIND_LABEL[e.kind],
    at: e.observedAt ? hhmm(e.observedAt, timeZone) : undefined,
    title: e.title,
    detail: e.detail,
    interpretation: e.basis !== 'record',
  }
}

/** 시연 재생 표시 문구. 일반 환경(replay = null)이면 null */
export function replayLabel(board: Board): string | null {
  return board.replay ? `시나리오 재생 · ${hhmm(board.replay.currentAt, board.displayTimeZone)}` : null
}

const GROUP = { emergency: '비상', warning: '예고' } as const

/** 카드 한 줄 요약 (검사 스크립트·로그용): "3호기 비상 2위 · 1등급 · 조사 완료 · 점검 안내 구체화(근거 4)" */
export function describeCard(card: Card): string {
  const inv = toInvestigation(card.investigation)
  const [check] = toChecks([card.firstCheck])
  return [
    `${card.equipment.no} ${GROUP[card.group]} ${card.rank}위 · ${card.grade}등급`,
    card.previousGrade ? `(${card.previousGrade}등급에서 바뀜)` : '',
    inv ? `· ${inv.label}` : '',
    check.refined ? `· 점검 안내 구체화(근거 ${check.evidenceIds.length})` : '',
  ].filter(Boolean).join(' ')
}
