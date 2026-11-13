import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getIncident } from '../api'
import { useApp } from '../components/Shell'
import { useLoad } from '../components/useLoad'
import { AiTag, GradeChip, InvTag, MachineFigure, OpChip, QualityLine, Sparkline, TONE, cx, diffText, fmt, tone } from '../components/ui'

/** 카드 클릭 → 상세 팝업: 판단 근거(목록) · 확인할 것 · 점검 시작 */
// 3D(three.js + 모델 약 3MB)는 상세를 처음 열 때만 불러온다. 받는 동안은 사진 + 점 표시
const Machine3D = lazy(() => import('../components/Machine3D').then((m) => ({ default: m.Machine3D })))
const KIND: Record<string, string> = { '기존 센서 알람': '알람', 'Q-First 이상 징후': '이상 징후' }

export function DetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { snap, ask } = useApp()
  const inc = useLoad(() => getIncident(id, snap), [id])
  const nav = useNavigate()
  const [ck, setCk] = useState<Record<number, boolean>>({})
  const [spot, setSpot] = useState<number | null>(null) // 위치를 보고 있는 확인 항목
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', f)
    ref.current?.focus()
    return () => window.removeEventListener('keydown', f)
  }, [onClose])
  if (!inc) return null
  const t = TONE[tone(inc.group)]
  const groupLabel = inc.group === 'emergency' ? '비상' : '예고'
  const started = inc.status === 'inProgress' || inc.status === 'done'
  // 조사로 구체화된 확인 항목이 가리키는 근거 (API v1.1 CheckItem.evidenceIds)
  const linked = new Set(inc.checks.flatMap((c) => c.evidenceIds))
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-ink/40 p-6" onClick={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${inc.equipment.id} 상세`}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-[1100px] flex-col gap-5 overflow-auto rounded-2xl bg-card p-7 outline-none">
        <div className="flex items-start gap-4">
          <span className="num text-[52px] font-semibold leading-none">{inc.rank}</span>
          <Suspense fallback={<MachineFigure id={inc.equipment.id} zones={inc.zones} group={inc.group} size={150} />}>
            <Machine3D zones={inc.zones} group={inc.group} focus={spot !== null ? inc.checks[spot]?.zone ?? null : null} width={380} height={220} fallback={<MachineFigure id={inc.equipment.id} zones={inc.zones} group={inc.group} size={150} />} />
          </Suspense>
          <div className="flex flex-col">
            <h2 className="text-[30px] font-bold leading-tight">{inc.equipment.no}</h2>
            <span className="num text-[14px] text-sub">{inc.equipment.name}</span>
            <span className="mt-1"><OpChip op={inc.operation} small /></span>
          </div>
          <div className="ml-3 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className={cx('text-[13px] font-bold', t.tx)}>{groupLabel} {inc.rank}위</span>
              <GradeChip grade={inc.grade} group={inc.group} long />
              {inc.previousGrade && <span className="rounded-md border-2 border-ink px-2 py-0.5 text-[12px] font-bold">{inc.previousGroup ? '예고 ' : ''}{inc.previousGrade}등급 → {inc.grade}등급</span>}
            </div>
            <h3 className="text-[20px] font-bold">{inc.headline}</h3>
          </div>
          <button onClick={onClose} aria-label="닫기" className="btn-line ml-auto grid h-10 w-10 place-items-center rounded-full border border-card-bd text-[18px]">×</button>
        </div>

        <section aria-label="판단 근거" className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h4 className="text-[15px] font-extrabold">판단 근거</h4>
            <AiTag />
            <span className="text-[15px] font-bold">{groupLabel} {inc.rank}위 · {inc.grade}등급</span>
            <span className="text-[15px] text-sub">{inc.whyFirst}</span>
          </div>
          <ul className="divide-y divide-line rounded-lg border border-card-bd">
            {inc.evidence.map((e, i) => {
              const derived = e.kind.includes('Q-First') || e.kind === '대조'
              return (
                <li key={i} className={cx('grid grid-cols-[52px_76px_1fr_auto] items-baseline gap-3 px-4 py-2.5', e.id && linked.has(e.id) && 'bg-soft')}>
                  <span className="num text-[14px] text-sub">{e.at ?? ''}</span>
                  <span className={cx('text-[13px] font-bold', e.kind.includes('기존') ? 'text-red-tx' : e.kind.includes('Q-First') ? 'text-blue-tx' : 'text-sub')}>{KIND[e.kind] ?? e.kind}</span>
                  <span className="min-w-0 text-[15px]"><b>{e.title}</b>{e.detail && <span className="text-sub"> · {e.detail}</span>}{e.id && linked.has(e.id) && <span className="ml-2 whitespace-nowrap text-[12px] font-bold text-ink">↳ 점검 안내 근거</span>}</span>
                  <span title={derived ? 'Q-First가 기록을 읽어 낸 해석이에요. 점검으로 확인이 필요해요.' : '설비·검사에 남은 값 그대로예요.'}
                    className={cx('whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-bold', derived ? 'bg-inv text-inv-fg' : 'border border-card-bd text-sub')}>
                    {derived ? 'Q-First 해석' : '기록'}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>

        <div className="grid grid-cols-[1.1fr_1fr] gap-5">
          <div className="flex flex-col gap-3">
            <div className="rounded-lg bg-soft p-4">
              <div className="mb-2 flex items-baseline gap-2 text-[12px]">
                <span className={cx('font-bold', t.tx)}>{inc.signal.source}</span>
                <span className="text-sub">{inc.signal.label} · 최근 60분</span>
                <span className="ml-auto text-sub">{diffText(inc.signal)}</span>
                <span className="num text-[26px] font-semibold">{fmt(inc.signal)}</span><span className="text-mute">{inc.signal.unit}</span>
              </div>
              <Sparkline s={inc.signal} w={540} h={110} color={t.line} detail />
            </div>
            <QualityLine q={inc.quality} />
          </div>
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h4 className="text-[15px] font-extrabold">확인할 것</h4>
              <InvTag inv={inc.investigation} refined={inc.checks.some((c) => c.refined)} />
            </div>
            {inc.investigation?.status === 'running' && (
              <p className="rounded-lg border border-dashed border-card-bd px-3 py-2 text-[13px] text-sub">Q-First가 센서 구간·LOT·검사 이력을 조회하고 있어요. 끝나면 확인 항목이 근거와 함께 구체화돼요. 그 전에는 기본 안내로 점검하면 돼요.</p>
            )}
            {inc.investigation?.status === 'failed' && (
              <p className="rounded-lg border border-card-bd px-3 py-2 text-[13px] text-sub">조사를 끝내지 못했어요. 순위와 기본 안내는 그대로라 아래 항목대로 점검하면 돼요.</p>
            )}
            {inc.checks.map((c, i) => {
              const z = c.zone
              const on = spot === i
              return (
                <div key={i} className={cx('flex items-stretch overflow-hidden rounded-lg border', on ? 'border-ink' : 'border-card-bd')}>
                  <label className="btn-line flex flex-1 cursor-pointer items-center gap-3 px-4 py-3 text-[15px] font-semibold">
                    <input type="checkbox" checked={!!ck[i]} onChange={() => setCk({ ...ck, [i]: !ck[i] })} className="h-5 w-5 shrink-0 accent-ink" />
                    <span className="flex flex-col gap-1">
                      <span>{c.label}</span>
                      {c.refined && (
                        <span className="flex flex-wrap items-center gap-2 text-[12px] font-normal text-sub">
                          <span className="rounded bg-inv px-1.5 py-0.5 font-bold text-inv-fg">Q-First 조사로 구체화 · 근거 {c.evidenceIds.length}건</span>
                          {c.baseline && <span>기본 안내: {c.baseline}</span>}
                        </span>
                      )}
                    </span>
                  </label>
                  {z && (
                    <button type="button" aria-pressed={on} onClick={() => setSpot(on ? null : i)}
                      className={cx('shrink-0 border-l px-3 text-[13px] font-bold', on ? 'border-ink bg-inv text-inv-fg btn-solid' : 'btn-line border-card-bd text-sub')}>
                      {on ? '위치 보는 중' : '위치 보기'}
                    </button>
                  )}
                </div>
              )
            })}
            <p className="text-[12px] text-mute">「위치 보기」를 누르면 위 3D에서 그 부분을 보여 줘요. 원인을 확정하지 않고, 이상이 나타난 곳과 확인 순서까지만 안내해요.</p>
          </section>
        </div>

        <div className="flex items-center gap-3 border-t border-line pt-4">
          <button onClick={() => ask(inc.id)} className="btn-text text-[14px] font-bold underline underline-offset-4">💬 이 설비 물어보기</button>
          <button onClick={() => nav(`/incident/${inc.id}/result`)} className="btn-solid ml-auto rounded-xl bg-inv px-6 py-3 text-[15px] font-bold text-inv-fg">
            {started ? '점검 결과 보기 →' : '점검 시작 →'}
          </button>
        </div>
      </div>
    </div>
  )
}
