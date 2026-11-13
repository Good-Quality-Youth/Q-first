import { useEffect, useState, type ReactNode } from 'react'
import { getBoard } from '../api'
import type { Board as BoardData, Incident, NormalEquipment, Snapshot } from '../api/types'
import { useApp } from '../components/Shell'
import { useLoad } from '../components/useLoad'
import { AiTag, AutoSparkline, Card, EqpIcon, GradeWhy, HalfDot, InvTag, MachineFigure, OpChip, Pill, QualityLine, Sparkline, TONE, cx, diffText, fmt, tone } from '../components/ui'
import { DetailModal } from './DetailModal'

const FLASH = { emergency: 'shadow-[0_0_0_6px_var(--color-red-bg),0_0_0_8px_var(--color-red)]', warning: 'shadow-[0_0_0_6px_var(--color-blue-bg),0_0_0_8px_var(--color-blue)]' } as const

const STATUS: Record<Incident['status'], string> = {
  unassigned: '착수 전', assigned: '착수 전', inProgress: '점검 중', rejected: '반려', onHold: '보류', done: '점검 완료',
}

export default function Board() {
  const { snap, news, dismissNews, focusId, setFocusId } = useApp()
  const data = useLoad(() => getBoard(snap))
  const [open, setOpen] = useState<string | null>(null)
  // 헤더 알림에서 고른 사건 상세 열기
  useEffect(() => { if (focusId) { setOpen(focusId); setFocusId(null) } }, [focusId, setFocusId])
  if (!data) return <p className="p-6 text-mute">불러오는 중…</p>
  const notice = news ? noticeOf(data, snap) : null
  return (
    <main className="flex flex-col gap-4 px-4 pb-10 pt-4 sm:px-6">
      {notice && (
        <div role="status" className={cx('flex flex-wrap items-center gap-3 rounded-xl border-2 px-4 py-3 sm:px-5', notice.box)}>
          <span aria-hidden="true" className="text-[18px]">🔔</span>
          <p className="min-w-0 flex-1 text-[15px]"><b className="num">{data.asOf}</b> {notice.text}</p>
          <button onClick={() => { setOpen(notice.inc.id); dismissNews() }} className="btn-solid rounded-lg bg-inv px-4 py-2 text-[14px] font-bold text-inv-fg">보기</button>
          <button onClick={dismissNews} aria-label="알림 닫기" className="btn-text px-2 text-[18px] text-sub">×</button>
        </div>
      )}
      <StatusBand d={data} onOpen={setOpen} />
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-12">
        <section aria-label="비상 목록" className="flex min-w-0 flex-col gap-3 xl:col-span-5">
          <ColHead dot="bg-red" t="비상" sub="기존 센서 알람" n={`${data.emergency.length}건`} />
          {data.emergency.map((x, i) => i === 0
            ? <BigCard key={x.id} inc={x} asOf={data.asOf} onOpen={() => setOpen(x.id)} flash={news && changedNow(x)} />
            : <RowCard key={x.id} inc={x} onOpen={() => setOpen(x.id)} flash={news && changedNow(x)} />)}
        </section>
        <section aria-label="예고 목록" className="flex min-w-0 flex-col gap-3 xl:col-span-4">
          <ColHead dot="bg-blue rounded-none" t="예고" sub="Q-First 이상 징후 · 알람 전" n={`${data.warning.length}건`} />
          {data.warning.map((x) => <BigCard key={x.id} inc={x} asOf={data.asOf} onOpen={() => setOpen(x.id)} flash={news && changedNow(x)} />)}
          {!data.warning.length && <p className="rounded-xl border border-dashed border-card-bd px-4 py-6 text-center text-[14px] text-mute">지금 예고 중인 설비가 없어요</p>}
        </section>
        <section aria-label="정상 설비" className="grid min-w-0 gap-2 md:col-span-2 md:grid-cols-2 xl:col-span-3 xl:grid-cols-1">
          <ColHead wide dot="bg-green" t="정상" sub={data.normal.every((n) => n.operation.status === 'running') ? '이상 징후 없음 · 모두 가동' : '이상 징후 없음'} n={`${data.normal.length}대`} />
          {data.normal.map((n) => <NormalCard key={n.equipment.id} n={n} />)}
        </section>
      </div>
      {open && <DetailModal id={open} onClose={() => setOpen(null)} />}
    </main>
  )
}

/** 이 장면에서 판단이 바뀐 사건 (등급·목록 변경 또는 조사 완료로 안내가 구체화) */
const changedNow = (x: Incident) => !!x.previousGrade || !!x.previousGroup

/** 장면이 바뀔 때 화면 위 알림: 판단이 바뀐 사건 1건 (API v1.1에서는 notifications로 받는다) */
function noticeOf(d: BoardData, snap: Snapshot): { inc: Incident; text: ReactNode; box: string } | null {
  const all = [...d.emergency, ...d.warning]
  if (snap === '1415b') {
    const x = all.find((i) => i.investigation?.status === 'completed' && i.checks.some((c) => c.refined))
    if (!x) return null
    const c = x.checks.find((k) => k.refined)!
    return { inc: x, box: 'border-ink bg-card', text: <><b>{x.equipment.no} Q-First 조사 완료</b> · 등급·순위는 그대로, 확인 항목을 근거 {c.evidenceIds.length}건으로 구체화했어요</> }
  }
  const x = all.find(changedNow)
  if (!x) return null
  const em = x.group === 'emergency'
  const cls = em ? 'border-red bg-red-bg' : 'border-blue bg-blue-bg'
  const tx = em ? 'text-red-tx' : 'text-blue-tx'
  if (x.previousGroup) return { inc: x, box: cls, text: <>기존 비상 알람이 울렸어요 · <b className={tx}>{x.equipment.no} 예고 {x.previousGrade}등급 → 비상 {x.rank}위 · {x.grade}등급</b>{x.investigation?.status === 'running' ? ' · Q-First 조사 시작' : ''}</> }
  return { inc: x, box: cls, text: <>{x.quality.source} 검사 결과가 들어와 판단이 바뀌었어요 · <b className={tx}>{x.equipment.no} {em ? '비상' : '예고'} {x.previousGrade}등급 → {x.grade}등급</b> (품질 영향 {x.quality.impact === 'yes' ? '있음' : '없음'})</> }
}

/** 점검중은 사람이 확인 중이라는 뜻. 가동·정지는 데이터에 없으니 단정하지 않고, 센서가 계속 들어온다는 사실만 쓴다 */
const INSP_TIP = '담당자가 확인 중인 상태예요. 이 시간에도 센서값은 1분마다 들어와요.'

const mins = (a: string, b: string) => { const [ah, am] = a.split(':').map(Number); const [bh, bm] = b.split(':').map(Number); return bh * 60 + bm - (ah * 60 + am) }

const STATE_LABEL: Record<Incident['status'], string> = { unassigned: '착수 전', assigned: '착수 전', inProgress: '점검 중', rejected: '반려', onHold: '보류', done: '완료' }

/** Q-First 판단 띠: "지금 먼저 할 1건"만 크게. 이유는 줄글 대신 칩, 확인은 첫 항목 하나, 다음 순서는 설비 이름만.
 *  품질 영향(LOT)·순위별 상세는 아래 카드에 이미 있으니 띠에서는 뺀다 */
function StatusBand({ d, onOpen }: { d: BoardData; onOpen: (id: string) => void }) {
  const s = d.summary
  const order = [...d.emergency, ...d.warning]
  // 이미 점검 중이거나 처리된 건은 빼고, 아직 손대지 않은 건 중 1순위가 '지금 먼저'
  const open = order.filter((x) => x.status === 'unassigned' || x.status === 'assigned')
  const working = order.filter((x) => x.status === 'inProgress')
  const first = open[0]
  const next = open.slice(1, 4)
  const reasons = first ? first.whyFirst.split(/ · | \+ /).map((r) => r.trim()).filter(Boolean) : []
  const check = first?.checks[0]
  return (
    <section aria-label="Q-First 판단 요약" className="ai-surface overflow-hidden rounded-xl text-band-fg">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-band-line px-5 py-2.5 text-[15px]">
        <AiTag dark />
        <span className="text-band-mute"><b className="num text-band-fg">{d.asOf}</b> 기준 점검 순서</span>
        <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-band-mute">
          {working.map((x) => (
            <span key={x.id}><HalfDot /> <b className="text-band-fg">{x.equipment.no}</b> 점검 중</span>
          ))}
          <span>비상 <b className="num text-band-fg">{s.emergency}</b> · 예고 <b className="num text-band-fg">{s.warning}</b></span>
          <span>품질 연관 <b className="num text-amber">{s.qualityLinked.length}</b></span>
          <span>조치 <b className="num text-band-fg">{s.handled.started}/{s.handled.total}</b></span>
        </span>
      </div>
      {!first && <div className="px-5 py-5 text-[16px] text-band-mute">착수 전인 설비가 없어요</div>}
      {first && (
        <div className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:gap-6">
          <div className="flex shrink-0 flex-col">
            <span className="text-[14px] font-bold text-band-mute">지금 먼저</span>
            <span className="text-[46px] font-bold leading-none">{first.equipment.no}</span>
            <span className="mt-1 text-[14px] text-band-mute">{first.equipment.name}</span>
          </div>
          <dl className="grid min-w-0 flex-1 grid-cols-[72px_1fr] items-center gap-x-3 gap-y-2.5 border-band-line lg:border-l lg:pl-6">
            <dt className="text-[14px] text-band-mute">판단</dt>
            <dd className="flex flex-wrap items-center gap-1.5">
              <span className="text-[20px] font-bold">{first.group === 'emergency' ? '비상' : '예고'} {first.rank}위</span>
              <GradeWhy grade={first.grade} className="mr-1 text-[14px] text-band-mute" />
              {reasons.map((r) => (
                <span key={r} className="rounded-full border border-band-line px-2.5 py-0.5 text-[14px] font-semibold">{r}</span>
              ))}
            </dd>
            <dt className="text-[14px] text-band-mute">먼저 확인</dt>
            <dd className="flex min-w-0 items-center gap-2 text-[17px] font-bold">
              <span className="num grid h-6 w-6 shrink-0 place-items-center rounded-full bg-card text-[13px] text-ink">1</span>
              <span className="min-w-0 truncate">{check?.refined ? check.baseline : check?.label}</span>
              {check?.refined && <span className="shrink-0 rounded border border-band-fg px-1.5 py-0.5 text-[12px] font-bold">Q-First 구체화 · 근거 {check.evidenceIds.length}건</span>}
            </dd>
          </dl>
          <div className="flex shrink-0 flex-row-reverse flex-wrap items-center justify-end gap-2.5 lg:flex-col lg:items-end">
            <button onClick={() => onOpen(first.id)} className="btn-light rounded-lg bg-card px-5 py-2.5 text-[16px] font-bold text-ink">{STATE_LABEL[first.status]} · 상세 보기 ›</button>
            {next.length > 0 && (
              <span className="flex items-center gap-1 text-[14px] text-band-mute">다음
                {next.map((x) => (
                  <button key={x.id} onClick={() => onOpen(x.id)} className="btn-on-dark flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-bold text-band-fg">
                    <span className={cx('h-2 w-2 shrink-0', x.group === 'emergency' ? 'rounded-full bg-red' : 'bg-blue')} />{x.equipment.no}
                  </button>
                ))}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function ColHead({ dot, t, sub, n, wide = false }: { dot: string; t: string; sub: string; n: string; wide?: boolean }) {
  return (
    <div className={cx('flex items-center gap-2 px-1', wide && 'md:col-span-2 xl:col-span-1')}>
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
    <Card ring={tone(inc.group)} onOpen={onOpen} label={`${inc.equipment.no} 상세 열기`} className={cx('flex flex-col gap-3 overflow-hidden pb-5', flash && FLASH[inc.group])}>
      {/* Q-First 판단이 카드의 머리: 순위(크게) · 등급 이유(작게) · 판단 이유 */}
      <div className="ai-surface flex flex-col gap-1.5 px-5 py-3.5 text-inv-fg">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <AiTag dark />
          <span className="whitespace-nowrap text-[20px] font-bold leading-tight">{inc.group === 'emergency' ? '비상' : '예고'} <span className="num text-[26px]">{inc.rank}</span>위</span>
          <GradeWhy grade={inc.grade} className="text-[14px] text-band-mute" />
          {inc.previousGrade && <span className="ml-auto shrink-0 rounded-md border border-inv-fg px-2 py-0.5 text-[13px] font-bold">{inc.previousGroup ? '예고 ' : ''}{inc.previousGrade}등급 → {inc.grade}등급</span>}
        </div>
        <span className="text-[15px] leading-snug">{inc.whyFirst}</span>
      </div>
      <div className="flex flex-wrap items-start gap-4 px-5">
        <MachineFigure id={inc.equipment.id} zones={inc.zones} group={inc.group} size={150} />
        <div className="flex min-w-[120px] flex-1 flex-col">
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
            <span title={INSP_TIP} className="inline-flex items-center gap-2 rounded-md bg-inv px-3 py-1.5 text-[15px] font-bold text-inv-fg">
              <HalfDot size={13} /> 점검중 <span className="num font-semibold">{inc.operation.since}~</span>
              <span className="font-normal">· {inc.assignee ? `담당 ${inc.assignee} · ` : ''}<span className="num">{mins(inc.operation.since!, asOf)}</span>분째 · 센서 수신 중</span>
            </span>
            <span className="text-[12px] text-sub">같은 이상으로 새 알림 안 보냄</span>
          </>
        ) : <OpChip op={inc.operation} />}
        {early && <span className="rounded border border-blue bg-blue-bg px-2 py-1 text-[13px] font-bold text-blue-tx">알람 전 · <span className="num">{inc.detectedAt}</span> 감지 후 <span className="num">{mins(inc.detectedAt, asOf)}</span>분째</span>}
        <InvTag inv={inc.investigation} refined={inc.checks.some((c) => c.refined)} />
      </div>
      <div className="mx-5 flex items-center gap-2">
        <span className="text-[11px] font-bold text-mute">근거 데이터</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="flex flex-col gap-3 px-5">
        <h4 className="-mt-1 text-[19px] font-bold">{inc.headline}</h4>
        <QualityLine q={inc.quality} />
        <div className="rounded-lg bg-soft p-3 text-left">
          <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-[12px]">
            <span className={cx('font-bold', t.tx)}>{s.source}</span>
            <span className="text-sub">{s.label} · 최근 60분</span>
            <span className="ml-auto text-sub">{diffText(s)}</span>
            <span className="num text-[26px] font-semibold text-ink">{fmt(s)}</span>
            <span className="text-[12px] text-mute">{s.unit}</span>
          </div>
          <AutoSparkline s={s} h={64} color={t.line} detail />
        </div>
      </div>
    </Card>
  )
}

function RowCard({ inc, onOpen, flash = false }: { inc: Incident; onOpen: () => void; flash?: boolean }) {
  const t = TONE[tone(inc.group)]
  return (
    <Card onOpen={onOpen} label={`${inc.equipment.no} 상세 열기`} className={cx('flex items-stretch gap-3 overflow-hidden pr-4 sm:gap-4 sm:pr-5', flash && FLASH[inc.group])}>
      {/* 순위·등급 = Q-First 판단 → 판단 표면 안에 */}
      <div className="ai-surface flex w-[76px] shrink-0 sm:w-[92px] flex-col items-center justify-center gap-1 py-3 text-inv-fg">
        <AiTag dark label="판단" />
        <span className="text-[15px] font-bold"><span className="num text-[30px] leading-none">{inc.rank}</span>위</span>
        <span className="text-[12px] text-band-mute">{inc.grade}등급</span>
        {inc.previousGrade && <span className="rounded border border-inv-fg px-1 text-[11px] font-bold">{inc.previousGroup ? '예고 ' : ''}{inc.previousGrade} → {inc.grade}</span>}
      </div>
      <div className="hidden items-center sm:flex"><MachineFigure id={inc.equipment.id} zones={inc.zones} group={inc.group} size={96} compact /></div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><span className="text-[24px] font-bold">{inc.equipment.no}</span><span className="num text-[13px] font-semibold text-sub">{inc.equipment.name}</span><OpChip op={inc.operation} /></div>
        <span className="text-[15px] font-bold leading-snug">{inc.headline}</span>
        <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="whitespace-nowrap rounded border border-dashed border-mute px-1.5 py-0.5 font-bold">품질 영향 {inc.quality.impact === 'yes' ? '있음' : inc.quality.impact === 'no' ? '없음' : '미확인'}</span>
          <span className="whitespace-nowrap text-sub">{STATUS[inc.status]}</span>
          <InvTag inv={inc.investigation} refined={inc.checks.some((c) => c.refined)} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <span className="hidden 2xl:block"><Sparkline s={inc.signal} w={84} h={30} color={t.line} /></span>
        <div className="hidden flex-col items-end whitespace-nowrap sm:flex">
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

