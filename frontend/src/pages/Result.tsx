import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getIncident, getSaved, saveDecision, saveResult } from '../api'
import { ACTION_OPTIONS, MEMO_CHIPS, REASONS } from '../api/mock'
import type { DecisionType, Outcome } from '../api/types'
import photoInj from '../assets/photo-inj.webp'
import photoTcu from '../assets/photo-tcu.webp'
import { useApp } from '../components/Shell'
import { useLoad } from '../components/useLoad'
import { AutoSparkline, GradeChip, QualityLine, TONE, cx, diffText, fmt, tone } from '../components/ui'

const OUTCOMES: { v: Outcome; key: string; t: string; sub: string; icon: string }[] = [
  { v: 'found', key: '1', t: '이상 발견', sub: '원인을 찾았어요', icon: '●' },
  { v: 'notFound', key: '2', t: '이상 없음', sub: '설비 정상 · 다른 원인 가능', icon: '✓' },
  { v: 'unclear', key: '3', t: '판단 어려움', sub: '추가 점검 필요 · 다음 교대', icon: '▲' },
]
const DECISIONS: { v: DecisionType; t: string; sub: string }[] = [
  { v: 'start', t: '착수', sub: '점검 시작' },
  { v: 'reject', t: '반려', sub: '점검 안 함' },
  { v: 'hold', t: '보류', sub: '나중에' },
]

export default function Result() {
  const { id = '' } = useParams()
  const { snap, toast } = useApp()
  const nav = useNavigate()
  const inc = useLoad(() => getIncident(id, snap), [id])
  const saved = getSaved(id)

  const [pick, setPick] = useState<DecisionType | null>(saved?.decision?.type ?? null)
  const [reason, setReason] = useState<string>('')
  const started = saved?.decision?.type === 'start'
  const [outcome, setOutcome] = useState<Outcome | null>(saved?.result?.outcome ?? null)
  const [actions, setActions] = useState<string[]>(saved?.result?.actions ?? [])
  const [memo, setMemo] = useState(saved?.result?.memo ?? '')
  const [busy, setBusy] = useState(false)

  // 키보드 1·2·3으로 결과 선택
  useEffect(() => {
    if (!started) return
    const f = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'TEXTAREA') return
      const o = OUTCOMES.find((x) => x.key === e.key)
      if (o) setOutcome(o.v)
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [started])

  if (!inc) return <p className="p-6 text-mute">불러오는 중…</p>
  const t = TONE[tone(inc.group)]
  const kind = inc.equipment.kind === 'tcu' ? 'tcu' : 'injection'
  const groupLabel = inc.group === 'emergency' ? '비상' : '예고'
  const step = saved?.result ? 4 : started ? 3 : 2
  const done = !!saved?.result

  async function choose(v: DecisionType) {
    setPick(v); setReason('')
    if (v === 'start') {
      setBusy(true)
      await saveDecision(id, { type: 'start' })
      setBusy(false)
      toast(`${inc!.equipment.no} 점검을 시작했어요 · 14:06`)
    }
  }
  async function saveRejectHold() {
    if (!pick || pick === 'start' || !reason) return
    setBusy(true)
    await saveDecision(id, { type: pick, reason })
    setBusy(false)
    toast(`${inc!.equipment.no} ${pick === 'reject' ? '반려' : '보류'} · ${reason} — 이력에 남겼어요`)
    nav(`/history?focus=${id}`)
  }
  async function submit() {
    if (!outcome) return
    setBusy(true)
    await saveResult(id, { outcome, actions, memo })
    setBusy(false)
    toast(`${inc!.equipment.no} 점검 결과를 이력에 저장했어요`)
    nav(`/history?focus=${id}`)
  }
  const toggle = (a: string) => setActions(actions.includes(a) ? actions.filter((x) => x !== a) : [...actions, a])
  const addChip = (c: string) => setMemo(memo ? `${memo} · ${c}` : c)

  return (
    <main className="flex flex-col gap-4 px-4 pb-10 pt-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button onClick={() => nav('/')} className="btn-text text-[14px] font-bold text-sub">← 사건</button>
        <h1 className="text-[24px] font-extrabold">점검 결과 입력</h1>
        <span className="hidden text-[13px] text-mute lg:inline">관제실 PC 기준 · 키보드 1/2/3으로 결과 선택</span>
        <ol className="flex flex-wrap items-center gap-3 xl:ml-auto" aria-label="진행 단계">
          {['상세 확인', '착수 결정', '결과 입력', '이력 저장'].map((s, i) => {
            const n = i + 1, ok = n < step || (n === 4 && done), on = n === step && !done
            return (
              <li key={s} className="flex items-center gap-2">
                <span className={cx('grid h-7 w-7 place-items-center rounded-full text-[13px] font-bold', ok ? 'bg-inv text-inv-fg' : on ? 'bg-inv text-inv-fg' : 'border border-card-bd text-mute')}>{ok ? '✓' : n}</span>
                <span className={cx('text-[14px] font-bold', ok || on ? 'text-ink' : 'text-mute')}>{s}</span>
                {n < 4 && <span className="h-px w-8 bg-card-bd" />}
              </li>
            )
          })}
        </ol>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,560px)_1fr]">
        {/* 왼쪽: 설비 */}
        <section className={cx('flex flex-col gap-3 rounded-xl border-2 bg-card p-5', t.bd)}>
          <div className="flex items-center gap-2 text-[13px]">
            <span className={cx('rounded px-2 py-0.5 font-bold', t.bg, t.tx)}>{inc.group === 'emergency' ? '●' : '■'} {groupLabel} {inc.rank}위</span>
            <GradeChip grade={inc.grade} group={inc.group} />
            <span className="text-sub">{started ? `${saved?.decision?.at ?? '14:06'} 점검 시작 · 담당 ${inc.assignee ?? 'OP-001'}` : '착수 전'}</span>
          </div>
          <div className="flex items-baseline gap-3"><h2 className="text-[40px] font-bold leading-none">{inc.equipment.no}</h2><span className="num text-[16px] text-sub">{inc.equipment.name}</span></div>
          <p className={cx('text-[17px] font-bold', t.tx)}>{inc.headline}</p>
          <img src={kind === 'tcu' ? photoTcu : photoInj} alt={`${inc.equipment.name} 사진(예시)`} className="h-[260px] w-full rounded-lg bg-spr object-contain" />
          <div className="rounded-lg bg-soft p-3">
            <div className="mb-1 flex items-baseline gap-2 text-[12px]">
              <span className={cx('font-bold', t.tx)}>{inc.signal.source}</span><span className="text-sub">{inc.signal.label} · 최근 60분</span>
              <span className="ml-auto num text-[24px] font-semibold">{fmt(inc.signal)}</span><span className="text-mute">{inc.signal.unit}</span>
            </div>
            <AutoSparkline s={inc.signal} h={56} color={t.line} />
            <p className="mt-1 text-[12px] text-mute">{diffText(inc.signal)}</p>
          </div>
          <QualityLine q={inc.quality} />
        </section>

        {/* 오른쪽: 결정 → 결과 */}
        <section className="flex flex-col gap-6 rounded-xl border border-card-bd bg-card p-6">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-[18px] font-extrabold">이 건을</h3>
            {DECISIONS.map((d) => (
              <button key={d.v} disabled={busy || started} onClick={() => choose(d.v)} aria-pressed={pick === d.v}
                className={cx('rounded-xl border-2 px-5 py-2.5 text-left', pick === d.v ? 'border-ink bg-inv text-inv-fg' : 'btn-line border-card-bd disabled:opacity-40')}>
                <span className="text-[16px] font-extrabold">{d.t}</span> <span className="text-[12px] opacity-80">{d.sub}</span>
              </button>
            ))}
            <span className="text-[12px] text-mute">반려·보류는 사유를 골라야 저장돼요</span>
            {pick && pick !== 'start' && !started && (
              <button onClick={() => { setPick(null); setReason('') }} className="btn-text ml-auto text-[13px] font-bold underline underline-offset-4">결정 다시 고르기</button>
            )}
          </div>

          {pick && pick !== 'start' && !started ? (
            <div className="flex flex-col gap-3">
              <h4 className="text-[15px] font-bold">{pick === 'reject' ? '반려' : '보류'} 사유 <span className="text-red-tx">*필수</span></h4>
              <div className="grid grid-cols-2 gap-2">
                {REASONS[pick].map((r) => (
                  <button key={r} onClick={() => setReason(r)} aria-pressed={reason === r}
                    className={cx('rounded-xl border-2 px-4 py-4 text-left text-[16px] font-bold', reason === r ? 'border-ink bg-soft' : 'btn-line border-card-bd')}>{r}</button>
                ))}
              </div>
              <button disabled={!reason || busy} onClick={saveRejectHold}
                className="btn-solid mt-2 rounded-xl bg-inv py-4 text-[17px] font-bold text-inv-fg disabled:bg-line disabled:text-mute">
                {reason ? `${pick === 'reject' ? '반려' : '보류'}로 저장 · ${reason}` : '사유를 골라 주세요'}
              </button>
            </div>
          ) : (
            <fieldset disabled={!started || done} className={cx('flex flex-col gap-6', !started && 'opacity-40')}>
              <div className="flex flex-col gap-2">
                <h4 className="text-[15px] font-bold">1 점검해 보니 <span className="text-[12px] font-normal text-mute">키보드 1 · 2 · 3</span></h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {OUTCOMES.map((o) => (
                    <button key={o.v} type="button" onClick={() => setOutcome(o.v)} aria-pressed={outcome === o.v}
                      className={cx('flex items-center gap-3 rounded-xl border-2 px-4 py-5 text-left', outcome === o.v ? 'border-ink bg-soft' : 'btn-line border-card-bd')}>
                      <span className={cx('grid h-10 w-10 place-items-center rounded-full text-[16px]', o.v === 'found' ? 'bg-red-bg text-red-tx' : o.v === 'notFound' ? 'bg-green-bg text-green-tx' : 'bg-amber-bg text-ink')}>{o.icon}</span>
                      <span className="flex flex-col"><span className="text-[18px] font-extrabold">{o.t}</span><span className="text-[12px] text-sub">{o.sub}</span></span>
                      <span className="ml-auto self-start rounded border border-card-bd px-1.5 text-[11px] text-mute">{o.key}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <h4 className="text-[15px] font-bold">2 한 일 <span className="text-[12px] font-normal text-mute">여러 개 선택</span></h4>
                  <div className="grid grid-cols-2 gap-2">
                    {ACTION_OPTIONS[kind].map((a) => (
                      <label key={a.label} className="btn-line flex cursor-pointer items-center gap-2 rounded-lg border border-card-bd px-3 py-3 text-[14px] font-semibold">
                        <input type="checkbox" checked={actions.includes(a.label)} onChange={() => toggle(a.label)} className="h-5 w-5 accent-ink" />
                        {a.label}{a.often && <span className="ml-auto rounded border border-card-bd px-1 text-[10px] text-mute">자주 함</span>}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <h4 className="text-[15px] font-bold">3 메모 <span className="text-[12px] font-normal text-mute">선택 · 문구를 누르면 들어가요</span></h4>
                  <div className="flex flex-wrap gap-1.5">
                    {MEMO_CHIPS[kind].map((c) => <button key={c} type="button" onClick={() => addChip(c)} className="btn-line rounded-md border border-card-bd px-2.5 py-1.5 text-[13px] font-semibold">{c}</button>)}
                  </div>
                  <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={3} placeholder="예) 냉각 채널 막힘 · 청소 후 금형 온도 회복 확인"
                    className="rounded-lg border border-card-bd p-3 text-[14px]" />
                </div>
              </div>
              <div className="rounded-lg border border-dashed border-card-bd px-4 py-3 text-[13px] text-sub">
                <p className="text-[12px] text-mute">이력에 이렇게 남아요</p>
                <p><b className="text-ink">14:18 · {inc.equipment.no}</b> · {outcome ? OUTCOMES.find((o) => o.v === outcome)!.t : '결과 선택 전'}{actions.length ? ` · ${actions.join(', ')}` : ''}{memo ? ` · ${memo}` : ''}</p>
              </div>
            </fieldset>
          )}

          {(!pick || pick === 'start' || started) && (
            <button disabled={!started || !outcome || busy || done} onClick={submit}
              className="btn-solid rounded-xl bg-inv py-4 text-[17px] font-bold text-inv-fg disabled:bg-line disabled:text-mute">
              {done ? '저장됨 · 이력에서 확인할 수 있어요' : !started ? '먼저 착수·반려·보류를 골라 주세요' : !outcome ? '점검 결과(1·2·3)를 골라 주세요' : '결과 저장 → 이력'}
            </button>
          )}
        </section>
      </div>
    </main>
  )
}
