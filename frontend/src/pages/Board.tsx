import { useState } from 'react'
import { getBoard } from '../api'
import type { Board as BoardData, Incident, NormalEquipment } from '../api/types'
import { useApp } from '../components/Shell'
import { useLoad } from '../components/useLoad'
import { AiTag, Card, EqpIcon, HalfDot, MachineFigure, OpChip, Pill, QualityLine, Sparkline, TONE, cx, diffText, fmt, tone } from '../components/ui'
import { DetailModal } from './DetailModal'

const STATUS: Record<Incident['status'], string> = {
  unassigned: '착수 전', assigned: '착수 전', inProgress: '점검 중', rejected: '반려', onHold: '보류', done: '점검 완료',
}

export default function Board() {
  const { snap, news, dismissNews } = useApp()
  const data = useLoad(() => getBoard(snap))
  const [open, setOpen] = useState<string | null>(null)
  if (!data) return <p className="p-6 text-mute">불러오는 중…</p>
  const changed = data.warning.find((x) => x.previousGrade)
  return (
    <main className="flex flex-col gap-4 px-6 pb-10 pt-4">
      {news && changed && (
        <div role="status" className="flex items-center gap-3 rounded-xl border-2 border-blue bg-blue-bg px-5 py-3">
          <span aria-hidden="true" className="text-[18px]">🔔</span>
          <p className="text-[15px]">
            <b className="num">14:05</b> {changed.quality.source} 검사 결과가 들어와 판단이 바뀌었어요 ·{' '}
            <b className="text-blue-tx">{changed.equipment.no} 예고 {changed.previousGrade}등급 → {changed.grade}등급</b> (품질 영향 있음)
          </p>
          <button onClick={() => { setOpen(changed.id); dismissNews() }} className="btn-solid ml-auto rounded-lg bg-inv px-4 py-2 text-[14px] font-bold text-inv-fg">보기</button>
          <button onClick={dismissNews} aria-label="알림 닫기" className="btn-text px-2 text-[18px] text-sub">×</button>
        </div>
      )}
      <StatusBand d={data} onOpen={setOpen} />
      <div className="grid grid-cols-12 items-start gap-4">
        <section aria-label="비상 목록" className="col-span-5 flex flex-col gap-3">
          <ColHead dot="bg-red" t="비상" sub="기존 센서 알람" n={`${data.emergency.length}건`} />
          {data.emergency.map((x, i) => i === 0
            ? <BigCard key={x.id} inc={x} asOf={data.asOf} onOpen={() => setOpen(x.id)} />
            : <RowCard key={x.id} inc={x} onOpen={() => setOpen(x.id)} />)}
        </section>
        <section aria-label="예고 목록" className="col-span-4 flex flex-col gap-3">
          <ColHead dot="bg-blue rounded-none" t="예고" sub="Q-First 이상 징후 · 알람 전" n={`${data.warning.length}건`} />
          {data.warning.map((x) => <BigCard key={x.id} inc={x} asOf={data.asOf} onOpen={() => setOpen(x.id)} flash={news && !!x.previousGrade} />)}
        </section>
        <section aria-label="정상 설비" className="col-span-3 flex flex-col gap-2">
          <ColHead dot="bg-green" t="정상" sub={data.normal.every((n) => n.operation.status === 'running') ? '이상 징후 없음 · 모두 가동' : '이상 징후 없음'} n={`${data.normal.length}대`} />
          {data.normal.map((n) => <NormalCard key={n.equipment.id} n={n} />)}
        </section>
      </div>
      {open && <DetailModal id={open} onClose={() => setOpen(null)} />}
    </main>
  )
}

const mins = (a: string, b: string) => { const [ah, am] = a.split(':').map(Number); const [bh, bm] = b.split(':').map(Number); return bh * 60 + bm - (ah * 60 + am) }

const STATE_LABEL: Record<Incident['status'], string> = { unassigned: '착수 전', assigned: '착수 전', inProgress: '점검 중', rejected: '반려', onHold: '보류', done: '완료' }
const lotNo = (lot?: string) => lot ?? ''

/** Q-First 판단 띠 (실제 운영 화면): 지금 먼저 할 일 · 다음 순서 · 품질 영향 범위(LOT). 아래 세 목록과 같은 12열(5·4·3) */
function StatusBand({ d, onOpen }: { d: BoardData; onOpen: (id: string) => void }) {
  const s = d.summary
  const order = [...d.emergency, ...d.warning]
  // 이미 점검 중이거나 처리된 건은 빼고, 아직 손대지 않은 건 중 1순위가 '지금 먼저'
  const open = order.filter((x) => x.status === 'unassigned' || x.status === 'assigned')
  const working = order.filter((x) => x.status === 'inProgress')
  const first = open[0]
  const next = open.slice(1, 4)
  const qRank = (x: Incident) => (x.quality.impact === 'yes' ? 0 : x.quality.impact === null ? 1 : 2)
  const lots = order.filter((x) => x.quality.lot).sort((a, b) => qRank(a) - qRank(b))
  return (
    <section aria-label="Q-First 판단 요약" className="ai-surface overflow-hidden rounded-xl text-band-fg">
      <div className="flex items-center gap-3 border-b border-band-line px-5 py-3">
        <AiTag dark />
        <span className="text-[16px] text-band-mute">설비 이상 징후 × 검사 결과(LOT)로 점검 순서를 정했어요 · <b className="num text-band-fg">{d.asOf}</b> 기준</span>
        <span className="ml-auto flex items-center gap-3 text-[15px] text-band-mute">
          {working.map((x) => (
            <span key={x.id} className="rounded border border-band-line px-2 py-0.5">
              <HalfDot /> 점검 중 <b className="text-band-fg">{x.equipment.no}</b> <span className="num">{x.operation.since}~</span>{x.assignee ? ` · ${x.assignee}` : ''}
            </span>
          ))}
          <span>이상 <b className="num text-band-fg">{s.emergency + s.warning}</b>건 <span className="num">(비상 {s.emergency} · 예고 {s.warning})</span> · 품질 연관 <b className="num text-band-fg">{s.qualityLinked.length}</b>건</span>
          <span className="border-l border-band-line pl-3">조치 <b className="num text-band-fg">{s.handled.started}/{s.handled.total}</b> · 착수 {s.handled.started} · 보류 {s.handled.onHold} · 반려 {s.handled.rejected}</span>
        </span>
      </div>
      <div className="grid grid-cols-12 gap-4">
        {!first && <div className="col-span-5 px-5 py-4 text-[14px] text-band-mute">착수 전인 설비가 없어요</div>}
        {first && (
          <div className="col-span-5 flex items-center gap-4 px-5 py-4">
            <div className="flex flex-col">
              <span className="text-[15px] font-bold text-band-mute">지금 먼저 <span className="font-normal">· 착수 전 1순위</span></span>
              <span className="text-[48px] font-bold leading-tight">{first.equipment.no}</span>
              <span className="text-[15px] text-band-mute">{first.equipment.name}</span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1 border-l border-band-line pl-4">
              <span className="text-[22px] font-bold leading-tight">{first.group === 'emergency' ? '비상' : '예고'} {first.rank}위 · {first.grade}등급</span>
              <span className="text-[17px] leading-snug">{first.whyFirst}</span>
              <span className="text-[17px] leading-snug"><span className="text-band-mute">먼저 확인</span> <b>{first.checklist[0]}</b></span>
              <span className="text-[15px] text-band-mute">{STATE_LABEL[first.status]}</span>
            </div>
            <button onClick={() => onOpen(first.id)} className="btn-light shrink-0 rounded-lg bg-card px-4 py-2.5 text-[16px] font-bold text-ink">근거 ›</button>
          </div>
        )}
        <div className="col-span-4 flex flex-col justify-center gap-2 border-l border-band-line px-5 py-4">
          <span className="text-[15px] font-bold text-band-mute">다음 순서</span>
          {next.map((x) => {
            return (
              <button key={x.id} onClick={() => onOpen(x.id)} className="btn-on-dark -mx-2 flex items-center gap-2 rounded-md px-2 py-0.5 text-left text-[17px]">
                <span className={cx('h-2.5 w-2.5 shrink-0', x.group === 'emergency' ? 'rounded-full bg-red' : 'bg-blue')} />
                <span className="w-[72px] shrink-0 text-band-mute">{x.group === 'emergency' ? '비상' : '예고'} {x.rank}위</span>
                <b className="shrink-0">{x.equipment.no}</b>
                <span className="min-w-0 flex-1 truncate text-band-mute">
                  {x.headline}
                </span>
                <span className="shrink-0 text-[15px] text-band-mute">{STATE_LABEL[x.status]}</span>
              </button>
            )
          })}
          {!next.length && <span className="text-[16px] text-band-mute">다음 대기 중인 설비가 없어요</span>}
        </div>
        <div className="col-span-3 flex flex-col justify-center gap-2 border-l border-band-line px-5 py-4">
          <span className="text-[15px] font-bold text-band-mute">품질 영향 범위 · LOT</span>
          {lots.slice(0, 4).map((x) => (
            <div key={x.id} className="flex items-center gap-2 text-[16px]">
              <span className={cx('shrink-0', x.quality.impact === 'yes' ? 'text-amber' : 'text-band-mute')}>{x.quality.impact === 'yes' ? '▲' : x.quality.impact === 'no' ? '–' : '○'}</span>
              <span className="min-w-0 flex-1 truncate">{x.equipment.part} LOT <span className="num">{lotNo(x.quality.lot)}</span> <span className="text-[14px] text-band-mute">· {x.equipment.no}</span></span>
              {x.quality.impact === 'yes'
                ? <span className="shrink-0"><b className="num text-amber">{x.quality.defects}/{x.quality.inspected}</b> <span className="text-[15px] text-band-mute">격리 검토</span></span>
                : x.quality.impact === 'no'
                  ? <span className="shrink-0"><span className="num">{x.quality.defects}/{x.quality.inspected}</span> <span className="text-[15px] text-band-mute">기준 미만</span></span>
                  : <span className="shrink-0 text-[15px] text-band-mute">검사 대기</span>}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function ColHead({ dot, t, sub, n }: { dot: string; t: string; sub: string; n: string }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span className={cx('h-2.5 w-2.5 rounded-full', dot)} />
      <h2 className="text-[16px] font-extrabold">{t}</h2>
      <span className="text-[13px] text-mute">{sub}</span>
      <span className="ml-auto text-[14px] font-bold text-sub">{n}</span>
    </div>
  )
}

function BigCard({ inc, onOpen, flash = false, asOf }: { inc: Incident; onOpen: () => void; flash?: boolean; asOf: string }) {
  const t = TONE[tone(inc.group)]
  const s = inc.signal
  const early = inc.group === 'warning' && inc.operation.status !== 'alarm'
  const insp = inc.operation.status === 'inspecting' && !!inc.operation.since
  return (
    <Card ring={tone(inc.group)} onOpen={onOpen} label={`${inc.equipment.no} 상세 열기`} className={cx('flex flex-col gap-3 overflow-hidden pb-5', flash && 'shadow-[0_0_0_6px_var(--color-blue-bg),0_0_0_8px_var(--color-blue)]')}>
      {/* Q-First 판단이 카드의 머리: 순위·등급·이유 (순위 숫자는 여기에만) */}
      <div className="ai-surface flex flex-col gap-1.5 px-5 py-3.5 text-inv-fg">
        <div className="flex items-center gap-3">
          <AiTag dark />
          <span className="whitespace-nowrap text-[20px] font-bold leading-tight">{inc.group === 'emergency' ? '비상' : '예고'} <span className="num text-[26px]">{inc.rank}</span>위 · {inc.grade}등급</span>
          {inc.previousGrade && <span className="ml-auto shrink-0 rounded-md border border-inv-fg/70 px-2 py-0.5 text-[13px] font-bold">{inc.previousGrade}등급 → {inc.grade}등급</span>}
        </div>
        <span className="text-[15px] leading-snug opacity-95">{inc.whyFirst}</span>
      </div>
      <div className="flex items-start gap-4 px-5">
        <MachineFigure id={inc.equipment.id} zones={inc.zones} group={inc.group} size={150} />
        <div className="flex flex-1 flex-col">
          <h3 className="text-[36px] font-bold leading-tight">{inc.equipment.no}</h3>
          <span className="num text-[15px] font-semibold text-sub">{inc.equipment.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {!insp && <Pill>{STATUS[inc.status]}</Pill>}
          <span aria-hidden className="text-[13px] font-bold text-sub">상세 ›</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-5">
        {insp ? (
          <>
            <span className="inline-flex items-center gap-2 rounded-md bg-inv px-3 py-1.5 text-[15px] font-bold text-inv-fg">
              <HalfDot size={13} /> 점검중 <span className="num font-semibold">{inc.operation.since}~</span>
              <span className="font-normal opacity-85">· {inc.assignee ? `담당 ${inc.assignee} · ` : ''}<span className="num">{mins(inc.operation.since!, asOf)}</span>분째</span>
            </span>
            <span className="text-[12px] text-sub">같은 이상으로 새 알림 안 보냄</span>
          </>
        ) : <OpChip op={inc.operation} />}
        {early && <span className="rounded border border-blue bg-blue-bg px-2 py-1 text-[13px] font-bold text-blue-tx">알람 전 · <span className="num">{inc.detectedAt}</span> 감지 후 <span className="num">{mins(inc.detectedAt, asOf)}</span>분째</span>}
      </div>
      <div className="mx-5 flex items-center gap-2">
        <span className="text-[11px] font-bold text-mute">근거 데이터</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="flex flex-col gap-3 px-5">
        <h4 className="-mt-1 text-[19px] font-bold">{inc.headline}</h4>
        <QualityLine q={inc.quality} />
        <div className="rounded-lg bg-soft p-3 text-left">
          <div className="mb-1 flex items-baseline gap-2 text-[12px]">
            <span className={cx('font-bold', t.tx)}>{s.source}</span>
            <span className="text-sub">{s.label} · 최근 60분</span>
            <span className="ml-auto text-sub">{diffText(s)}</span>
            <span className="num text-[26px] font-semibold text-ink">{fmt(s)}</span>
            <span className="text-[12px] text-mute">{s.unit}</span>
          </div>
          <Sparkline s={s} w={inc.group === 'emergency' ? 540 : 460} h={64} color={t.line} detail />
        </div>
      </div>
    </Card>
  )
}

function RowCard({ inc, onOpen }: { inc: Incident; onOpen: () => void }) {
  const t = TONE[tone(inc.group)]
  return (
    <Card onOpen={onOpen} label={`${inc.equipment.no} 상세 열기`} className="flex items-stretch gap-4 overflow-hidden pr-5">
      {/* 순위·등급 = Q-First 판단 → 판단 표면 안에 */}
      <div className="ai-surface flex w-[92px] shrink-0 flex-col items-center justify-center gap-1 py-3 text-inv-fg">
        <AiTag dark label="판단" />
        <span className="text-[15px] font-bold"><span className="num text-[30px] leading-none">{inc.rank}</span>위</span>
        <span className="text-[14px] font-bold">{inc.grade}등급</span>
      </div>
      <div className="flex items-center"><MachineFigure id={inc.equipment.id} zones={inc.zones} group={inc.group} size={96} compact /></div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-3">
        <div className="flex items-baseline gap-2 whitespace-nowrap"><span className="text-[24px] font-bold">{inc.equipment.no}</span><span className="num text-[13px] font-semibold text-sub">{inc.equipment.name}</span><OpChip op={inc.operation} /></div>
        <span className="text-[15px] font-bold leading-snug">{inc.headline}</span>
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="rounded border border-dashed border-mute px-1.5 py-0.5 font-bold">품질 영향 {inc.quality.impact === 'yes' ? '있음' : inc.quality.impact === 'no' ? '없음' : '미확인'}</span>
          <span className="text-sub">{STATUS[inc.status]}</span>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <Sparkline s={inc.signal} w={84} h={30} color={t.line} />
        <div className="flex w-[96px] flex-col items-end whitespace-nowrap">
          <span><span className="num text-[22px] font-semibold">{fmt(inc.signal)}</span><span className="text-[11px] text-mute">{inc.signal.unit}</span></span>
        </div>
        <span aria-hidden className="text-[13px] font-bold text-sub">상세 ›</span>
      </div>
    </Card>
  )
}

function NormalCard({ n }: { n: NormalEquipment }) {
  const s = n.signal
  return (
    <Card className="flex flex-col gap-1 px-4 py-2.5">
      <div className="flex items-center gap-3">
        <EqpIcon id={n.equipment.id} size={48} dim />
        <div className="flex min-w-0 flex-col leading-tight"><span className="text-[17px] font-bold">{n.equipment.no}</span><span className="truncate text-[12px] font-semibold text-sub">{n.equipment.name}</span></div>
        <Sparkline s={s} w={84} h={22} color="var(--color-amber)" />
        <span className="ml-auto whitespace-nowrap text-right"><span className="num text-[17px] font-semibold">{fmt(s)}</span> <span className="text-[11px] text-mute">{s.unit}</span></span>
      </div>
      {n.note && <span className="text-[11px] font-bold text-sub">{n.note}</span>}
    </Card>
  )
}

