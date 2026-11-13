import { CAUTION } from '../api/mock'
import type { ReactNode } from 'react'
import sprite from '../assets/eqp-sprite.webp'
import symbol from '../assets/logo-symbol.png'
import { EQUIPMENT } from '../api/mock'
import type { AlertGroup, EquipmentKind, Grade, InvestigationView, MachineZone, Operation, QualityInfo, SignalSeries } from '../api/types'

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ')

// ── 상태색: 비상 빨강 · 예고 파랑 · 정상 초록 · 품질 영향 앰버 ──
export const tone = (g: AlertGroup) => (g === 'emergency' ? 'red' : 'blue')
export const TONE = {
  red: { tx: 'text-red-tx', bg: 'bg-red-bg', bd: 'border-red', line: 'var(--color-red)', txv: 'var(--color-red-tx)' },
  blue: { tx: 'text-blue-tx', bg: 'bg-blue-bg', bd: 'border-blue', line: 'var(--color-blue)', txv: 'var(--color-blue-tx)' },
} as const

const KIND_ICON: Record<EquipmentKind, number> = { injection: 0, tcu: 2, inspection: 6 }

const ZONE_LABEL: Record<MachineZone, string> = { hydraulic: '유압', barrel: '배럴', screw: '스크류 구동', mold: '금형' }

/** 사진 위 이상 부위 위치 (스프라이트 사출기 칸 기준 비율 x, y) */
const ZONE_AT: Record<MachineZone, [number, number]> = { barrel: [0.69, 0.43], screw: [0.86, 0.42], hydraulic: [0.80, 0.58], mold: [0.36, 0.44] }

/** 사출기 사진 + 이상 부위 캡슐(상세 3D 핀과 같은 말). 사진은 그대로 두고 "어디를 봐야 하는지"만 얹는다.
 *  사진 아래쪽 부위(유압)는 캡슐을 점 아래에, 위쪽 부위는 점 위에 달아 서로 겹치지 않게 한다 */
export function MachineFigure({ id, zones, group, size = 128, compact = false }: { id: string; zones: MachineZone[]; group: AlertGroup; size?: number; compact?: boolean }) {
  const t = TONE[tone(group)]
  const stem = compact ? 8 : 12
  return (
    <div className="flex shrink-0 flex-col items-center gap-1" aria-label={zones.length ? `이상 부위 ${zones.map((k) => ZONE_LABEL[k]).join(' · ')}` : undefined}>
      <span className="relative inline-block">
        <EqpIcon id={id} size={size} />
        {zones.map((k) => {
          const [fx, fy0] = ZONE_AT[k]
          const fy = fy0 - 0.09
          const below = fy0 >= 0.5
          const x = fx * size
          const y = fy * size
          // 오른쪽 끝 부위는 캡슐을 왼쪽으로 붙여 사진 밖으로 나가지 않게
          const shift = fx > 0.82 ? '-85%' : '-50%'
          return (
            <span key={k} aria-hidden="true">
              <span className="absolute h-2 w-2 rounded-full border border-white" style={{ left: x - 4, top: y - 4, background: t.line }} />
              <span className="absolute w-0.5" style={{ left: x - 1, top: below ? y : y - stem, height: stem, background: t.line }} />
              <span className={cx('absolute whitespace-nowrap rounded-full border-2 bg-card font-bold leading-none', compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[12px]', t.tx)}
                style={{ left: x, top: below ? y + stem : y - stem, borderColor: t.line, transform: `translate(${shift}, ${below ? '0' : '-100%'})` }}>
                {ZONE_LABEL[k]}
              </span>
            </span>
          )
        })}
      </span>
    </div>
  )
}

/** 설비 3D 아이콘 (스프라이트 8종 중 하나) */
export function EqpIcon({ id, size = 64, dim = false, ring }: { id: string; size?: number; dim?: boolean; ring?: string }) {
  const idx = KIND_ICON[EQUIPMENT[id].kind]
  return (
    <span
      role="img"
      aria-label={`${id} ${EQUIPMENT[id].name}`}
      className="inline-block shrink-0 rounded-md bg-spr bg-no-repeat"
      style={{
        width: size, height: size * 0.82,
        backgroundImage: `url(${sprite})`, backgroundSize: `${size * 8}px ${size}px`,
        backgroundPosition: `${-idx * size}px ${-size * 0.09}px`,
        filter: dim ? 'grayscale(1) opacity(.8)' : undefined,
        boxShadow: ring ? `0 0 0 2px ${ring}` : undefined,
      }}
    />
  )
}

export function GradeChip({ grade, group, long = false }: { grade: Grade; group: AlertGroup; long?: boolean }) {
  const t = TONE[tone(group)]
  const LONG: Record<Grade, string> = { 1: '비상 + 품질 영향', 2: '비상 + 품질 영향 없음/미확인', 3: '예고 + 품질 영향', 4: '예고 + 위험도 높음', 5: '예고' }
  return (
    <span className={cx('inline-flex items-center rounded px-1.5 py-0.5 text-[12px] font-bold border', t.tx, t.bg, t.bd)}>
      {grade}등급{long ? ` · ${LONG[grade]}` : ''}
    </span>
  )
}

/** 반쯤 찬 원 (점검중 기호) — 글꼴에 ◐가 없어 SVG로 그린다 */
export function HalfDot({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true" className="inline-block shrink-0 align-[-1px]">
      <circle cx={5} cy={5} r={4.2} fill="none" stroke="currentColor" strokeWidth={1.4} />
      <path d="M5 0.8 A4.2 4.2 0 0 1 5 9.2 Z" fill="currentColor" />
    </svg>
  )
}

/** 설비 가동 상태 칩: 가동 / 이상감지 / 점검중. 색만으로 구분하지 않게 모양 기호를 함께 쓴다 */
const OP = {
  running: { t: '가동', mark: '●', cls: 'border-line text-sub', markCls: 'text-green' },
  alarm: { t: '이상감지', mark: '▲', cls: 'border-ink text-ink', markCls: '' },
  inspecting: { t: '점검중', mark: '◐', cls: 'border-inv bg-inv text-inv-fg', markCls: '' },
} as const
export function OpChip({ op, small = false }: { op: Operation; small?: boolean }) {
  const o = OP[op.status]
  return (
    <span title={op.status === 'inspecting' ? '담당자가 확인 중인 상태예요. 이 시간에도 센서값은 1분마다 들어와요.' : '설비 가동 상태 (알람·점검 이력에서 규칙으로 계산)'}
      className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded border font-bold', small ? 'px-1.5 py-0.5 text-[12px]' : 'px-2 py-1 text-[13px]', o.cls)}>
      {op.status === 'inspecting' ? <HalfDot /> : <span aria-hidden="true" className={o.markCls}>{o.mark}</span>}
      <span className="sr-only">설비 상태 </span>{o.t}{op.since && <span className="num font-semibold opacity-80"> {op.since}~</span>}
      {op.status === 'inspecting' && <span className="font-normal"> · 센서 수신 중</span>}
    </span>
  )
}

/** AI 판단 표시: 화면에서 Q-First가 내린 판단(순위·등급·이유)에만 붙인다. 센서·검사 같은 원자료에는 붙이지 않는다 */
export function AiTag({ dark = false, label = 'Q-First 판단' }: { dark?: boolean; label?: string }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-[12px] font-extrabold tracking-tight',
      dark ? 'bg-card text-ink' : 'bg-inv text-inv-fg')}>
      <img src={symbol} alt="" className={cx('h-3 w-3', !dark && 'invert')} />{label}
    </span>
  )
}

/** 에이전트 조사 상태 (태그 · 반응 없음). 조사 중은 점선 테두리, 완료는 Q-First 검정, 실패는 회색 */
export function InvTag({ inv, refined = false }: { inv: InvestigationView | null; refined?: boolean }) {
  if (!inv) return null
  if (inv.status === 'running') return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-dashed border-ink px-2 py-0.5 text-[12px] font-bold text-ink">
      <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink" />Q-First 조사 중 <span className="font-normal text-sub">· {inv.trigger} 후</span>
    </span>
  )
  if (inv.status === 'failed') return <span className="whitespace-nowrap rounded border border-card-bd px-2 py-0.5 text-[12px] font-bold text-sub">조사 실패 · 기본 안내 유지</span>
  return <span className="whitespace-nowrap rounded bg-inv px-2 py-0.5 text-[12px] font-bold text-inv-fg">{refined ? 'Q-First 조사 반영' : '조사 완료'}</span>
}

export function Pill({ children, dark = false, className }: { children: ReactNode; dark?: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-bold', dark ? 'bg-inv text-inv-fg' : 'bg-soft text-ink', className)}>
      {children}
    </span>
  )
}

/** 최근 60분 신호 + 기준값(가는 선) + 기존 알람 한계(점선) + 평소 범위(서버가 줄 때만 회색 띠) */
export function Sparkline({ s, w, h, color, detail = false }: { s: SignalSeries; w: number; h: number; color: string; detail?: boolean }) {
  const lim = [s.alarmLimits?.lower, s.alarmLimits?.upper].filter((x): x is number => x != null)
  // 세로 범위: 작은 그래프는 값·기준값만, 상세 그래프는 알람 한계까지 담는다
  const ys = [...s.values, s.reference, ...(detail ? lim : []), ...(s.band ?? [])]
  const lo = Math.min(...ys), hi = Math.max(...ys)
  const pad = (hi - lo) * 0.12 || 1
  const d0 = lo - pad, d1 = hi + pad
  const top = detail ? 16 : 0 // 사건 시각 글씨 자리
  const Y = (v: number) => +(top + h - ((v - d0) / (d1 - d0)) * h).toFixed(1)
  const X = (i: number) => +((i / (s.values.length - 1)) * w).toFixed(1)
  const path = 'M' + s.values.map((v, i) => `${X(i)} ${Y(v)}`).join(' L')
  const last = s.values[s.values.length - 1]
  const overLimit = (s.alarmLimits?.lower != null && last < s.alarmLimits.lower) || (s.alarmLimits?.upper != null && last > s.alarmLimits.upper)
  // 이상 카드(비상·예고)이거나 알람 한계를 넘으면 강조
  const out = s.source !== '' || overLimit
  let mx = -1
  if (s.mark) {
    const [sh, sm] = s.startTime.split(':').map(Number)
    const [oh, om] = s.mark.at.split(':').map(Number)
    const i = oh * 60 + om - (sh * 60 + sm)
    if (i >= 0 && i < s.values.length) mx = X(i)
  }
  const dg = s.unit === 'N·m' ? 2 : 1
  return (
    <svg width={w} height={h + top + (detail ? 18 : 0)} viewBox={`0 0 ${w} ${h + top + (detail ? 18 : 0)}`} role="img"
      aria-label={`${s.label} 최근 60분, 현재 ${last}${s.unit}, 기준 ${s.reference}${overLimit ? ', 기존 알람 한계 밖' : ''}`} className="block overflow-visible">
      {s.band && <rect x={0} y={Y(s.band[1])} width={w} height={Y(s.band[0]) - Y(s.band[1])} fill="var(--color-line)" opacity={0.7} />}
      <line x1={0} x2={w} y1={Y(s.reference)} y2={Y(s.reference)} stroke="var(--color-mute)" strokeWidth={1} opacity={0.6} />
      {detail && s.alarmLimits?.upper != null && (
        <>
          <line x1={0} x2={w} y1={Y(s.alarmLimits.upper)} y2={Y(s.alarmLimits.upper)} stroke="var(--color-mute)" strokeWidth={1} strokeDasharray="6 3" />
          <text x={4} y={Y(s.alarmLimits.upper) + 13} fontSize={11} fill="var(--color-mute)">기존 알람 상한 {s.alarmLimits.upper.toFixed(dg)}</text>
        </>
      )}
      {detail && s.alarmLimits?.lower != null && (
        <>
          <line x1={0} x2={w} y1={Y(s.alarmLimits.lower)} y2={Y(s.alarmLimits.lower)} stroke="var(--color-mute)" strokeWidth={1} strokeDasharray="6 3" />
          <text x={4} y={Y(s.alarmLimits.lower) - 5} fontSize={11} fill="var(--color-mute)">기존 알람 하한 {s.alarmLimits.lower.toFixed(dg)}</text>
        </>
      )}
      {mx >= 0 && detail && s.mark && (
        <>
          <line x1={mx} x2={mx} y1={14} y2={h + top} stroke="var(--color-mute)" strokeDasharray="3 3" />
          <text x={mx > w * 0.7 ? mx - 4 : mx + 4} y={10} textAnchor={mx > w * 0.7 ? 'end' : 'start'} fontSize={11} fontWeight={700} fill="var(--color-ink)">{s.mark.at} {s.mark.label}</text>
        </>
      )}
      <path d={path} fill="none" stroke={out ? 'var(--color-ink)' : 'var(--color-mute)'} strokeWidth={detail ? 2 : 1.5} strokeLinejoin="round" />
      <circle cx={X(s.values.length - 1)} cy={Y(last)} r={detail ? 5 : 3.5} fill={out ? color : 'var(--color-green)'} stroke="white" strokeWidth={1.5} />
      {detail && (
        <>
          <text x={0} y={h + top + 15} fontSize={11} fill="var(--color-mute)">{s.startTime}</text>
          <text x={w / 2} y={h + top + 15} fontSize={11} fill="var(--color-mute)" textAnchor="middle">가는 선 = 기준 {s.reference.toFixed(dg)} · 점선 = 기존 알람 한계</text>
          <text x={w} y={h + top + 15} fontSize={11} fill="var(--color-mute)" textAnchor="end">{s.endTime}</text>
        </>
      )}
    </svg>
  )
}

export const fmt = (s: SignalSeries) => {
  const v = s.values[s.values.length - 1]
  return s.unit === 'N·m' ? v.toFixed(2) : v.toFixed(1)
}
export const diffText = (s: SignalSeries) => {
  const d = s.values[s.values.length - 1] - s.reference
  const dg = s.unit === 'N·m' ? 2 : 1
  return `기준 ${s.reference.toFixed(dg)} · 차이 ${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(dg)}`
}

/** 품질 영향 줄: 있음(앰버 막대) / 미확인(회색 점선) */
export function QualityLine({ q }: { q: QualityInfo }) {
  if (q.impact === 'no' && q.inspected) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px] text-sub">
        <span className="rounded border border-card-bd px-1.5 py-0.5 text-[12px] font-bold text-ink">품질 영향 없음</span>
        {q.source} · {q.inspected}개 검사 · {q.defects ? `불량 ${q.defects}건 (${((q.defects / q.inspected) * 100).toFixed(1)}%) · 주의 기준 3% 미만` : '불량 없음'}
      </div>
    )
  }
  if (q.impact !== 'yes' || q.defects === undefined || !q.inspected) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-mute/60 px-3 py-2 text-[13px] text-sub">
        <span className="rounded border border-dashed border-mute px-1.5 py-0.5 text-[12px] font-bold text-ink">품질 영향 미확인</span>
        {q.source} · 검사 결과 아직 없음
      </div>
    )
  }
  const r = (q.defects / q.inspected) * 100
  const mx = Math.max(r * 1.1, 4)
  return (
    <div className="flex items-center gap-3 rounded-lg border border-amber bg-amber-bg px-3 py-2">
      <span className="shrink-0 rounded bg-amber px-2 py-0.5 text-[12px] font-bold text-ink">▲ 품질 영향 있음</span>
      <span className="shrink-0 text-[13px] text-sub">{q.source}</span>
      {/* 불량률 막대 + 주의 기준(3%) 눈금. 비교 대상은 확정된 판정 기준뿐이다 */}
      <div className="relative h-2 flex-1 rounded-full bg-line" aria-hidden>
        <div className="h-2 rounded-full bg-amber" style={{ width: `${(r / mx) * 100}%` }} />
        <div className="absolute -top-1 h-4 w-0.5 bg-ink" style={{ left: `${(CAUTION / mx) * 100}%` }} />
      </div>
      <span className="num shrink-0 text-[15px] font-semibold">{q.defects}/{q.inspected} · {r.toFixed(1)}%</span>
      <span className="shrink-0 text-[12px] text-mute">주의 기준 {CAUTION}%</span>
    </div>
  )
}

/** onOpen을 주면 카드 어디를 눌러도 열린다 (마우스·Enter·Space) */
export function Card({ children, className, ring, onOpen, label }: { children: ReactNode; className?: string; ring?: 'red' | 'blue'; onOpen?: () => void; label?: string }) {
  const open = onOpen
    ? {
        role: 'button', tabIndex: 0, 'aria-label': label, onClick: onOpen,
        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } },
      }
    : {}
  return (
    <div {...open} className={cx('rounded-xl border bg-card', ring === 'red' ? 'border-2 border-red' : ring === 'blue' ? 'border-2 border-blue' : 'border-card-bd',
      onOpen && 'cursor-pointer transition-shadow hover:shadow-[0_6px_20px_rgba(0,0,0,0.10)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink', className)}>
      {children}
    </div>
  )
}
