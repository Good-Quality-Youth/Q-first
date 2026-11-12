import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getHistory } from '../api'
import { DEMO_DATE } from '../api/mock'
import type { HistoryRecord } from '../api/types'
import { Segmented, useApp } from '../components/Shell'
import { useLoad } from '../components/useLoad'
import { TONE, cx, tone } from '../components/ui'

type Filter = '전체' | '진행 중' | '이상 발견' | '이상 없음' | '판단 어려움' | '반려·보류'
type Period = 'today' | 'week' | 'month'

const RESULT_TX: Record<HistoryRecord['status'], string> = {
  '진행 중': 'text-ink', '이상 발견': 'text-red-tx', '이상 없음': 'text-green-tx', '판단 어려움': 'text-ink', '반려': 'text-mute', '보류': 'text-mute',
}

export default function History() {
  const { snap, ask } = useApp()
  const [params] = useSearchParams()
  const focus = params.get('focus')
  const rows = useLoad(() => getHistory(snap))
  const [filter, setFilter] = useState<Filter>('전체')
  const [period, setPeriod] = useState<Period>('week')
  const [sel, setSel] = useState<string | null>(focus ?? 'IG-0014')
  const nav = useNavigate()

  // 기간으로 먼저 거른 목록 → 결과 버튼의 건수는 이 목록 기준
  const base = useMemo(() => (rows ?? []).filter((r) => period !== 'today' || r.date === DEMO_DATE), [rows, period])
  const list = useMemo(() => base.filter((r) => {
    if (filter === '전체') return true
    if (filter === '반려·보류') return r.status === '반려' || r.status === '보류'
    return r.status === filter
  }), [base, filter])
  const n = (st: HistoryRecord['status']) => base.filter((r) => r.status === st).length
  const countOf = (f: Filter) => (f === '전체' ? base.length : f === '반려·보류' ? n('반려') + n('보류') : n(f as HistoryRecord['status']))
  if (!rows) return <p className="p-6 text-mute">불러오는 중…</p>
  const cur = rows.find((r) => r.id === sel) ?? list[0]

  return (
    <main className="flex flex-col gap-4 px-6 pb-10 pt-4">
      <div className="flex items-center gap-3">
        <h1 className="text-[24px] font-extrabold">이력</h1>
        <span className="text-[14px] text-sub">Q-First 판단 <b className="text-ink">{base.length}</b>건 중 담당자 확인 완료 <b className="text-ink">{n('이상 발견') + n('이상 없음') + n('판단 어려움')}</b>건</span>
        <div className="ml-auto flex gap-3">
          <Segmented label="기간" value={period} onChange={setPeriod}
            options={[{ v: 'today', t: '오늘' }, { v: 'week', t: '이번 주' }, { v: 'month', t: '이번 달', disabled: true }]} />
          <Segmented label="결과" value={filter} onChange={setFilter}
            options={(['전체', '진행 중', '이상 발견', '이상 없음', '판단 어려움', '반려·보류'] as Filter[]).map((v) => ({ v, t: `${v} ${countOf(v)}` }))} />
        </div>
      </div>

      <div className="grid grid-cols-[1fr_540px] items-start gap-4">
        <div className="overflow-hidden rounded-xl border border-card-bd bg-card">
          <table className="w-full text-left">
            <thead className="border-b border-line text-[12px] text-sub">
              <tr><th className="px-5 py-3 font-semibold">발생</th><th className="font-semibold">설비</th><th className="font-semibold">이상</th><th className="font-semibold">구분</th><th className="font-semibold">결과</th><th className="pr-5 text-right font-semibold">처리</th></tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const t = TONE[tone(r.group)]
                const on = cur?.id === r.id
                return (
                  <tr key={r.id} onClick={() => setSel(r.id)} aria-selected={on}
                    className={cx('cursor-pointer border-b border-line text-[14px]', on ? 'bg-soft shadow-[inset_4px_0_0_var(--color-blue)]' : 'hover:bg-soft/60')}>
                    <td className="num px-5 py-3 text-[14px] text-sub">{r.date} {r.time}</td>
                    <td><div className="flex items-baseline gap-2 py-3"><span className="text-[17px] font-bold">{r.equipment.no}</span><span className="text-[13px] text-sub">{r.equipment.part}</span></div></td>
                    <td className="font-bold">{r.title}</td>
                    <td className={cx('text-[13px] font-bold', t.tx)}>{r.group === 'emergency' ? '● 비상' : '■ 예고'} {r.grade}등급</td>
                    <td className={cx('font-bold', RESULT_TX[r.status])}>{r.status}{r.reason ? <span className="block text-[12px] font-normal">{r.reason}</span> : null}</td>
                    <td className="pr-5 text-right text-sub">{r.minutes ? `${r.minutes}분` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!list.length && <p className="p-8 text-center text-mute">조건에 맞는 이력이 없어요</p>}
        </div>

        {cur && (
          <aside className={cx('flex flex-col gap-4 rounded-xl border-2 bg-card p-6', TONE[tone(cur.group)].bd)} aria-label="선택한 이력">
            <div className="flex items-baseline gap-3">
              <span className="text-[30px] font-bold leading-tight">{cur.equipment.no}</span>
              <span className="num text-[14px] text-sub">{cur.equipment.name}</span>
            </div>
            <div><p className="text-[17px] font-bold">{cur.title}</p><p className="text-[12px] text-mute">{cur.date} {cur.time} 발생</p></div>
            <section className="flex flex-col gap-3">
              <h3 className="text-[15px] font-extrabold">판단 이력</h3>
              {cur.revisions.map((r, i) => (
                <div key={r.rev} className="flex gap-3">
                  <span className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold', i === cur.revisions.length - 1 ? 'bg-inv text-inv-fg' : 'border border-card-bd')}>{r.rev}</span>
                  <div className="flex flex-col gap-1">
                    <p className="text-[14px] font-bold"><span className="num">{r.at}</span> · {r.label}</p>
                    <p className="text-[13px] text-sub">{r.detail}</p>
                    <div className="flex gap-1">{r.basis.map((b) => <span key={b} className="rounded bg-soft px-1.5 py-0.5 text-[11px] font-semibold">{b}</span>)}</div>
                  </div>
                </div>
              ))}
            </section>
            <p className="-mt-2 text-[12px] text-mute">각 판단은 그 시각까지 도착한 데이터만으로 만들어요. 나중에 온 검사 결과로 지난 판단을 고치지 않아요.</p>
            {(cur.status !== '진행 중' || cur.actions.length > 0) && (
              <dl className="grid grid-cols-[110px_1fr] gap-y-2 rounded-lg bg-soft p-4 text-[13px]">
                <dt className="text-sub">점검 결과</dt><dd className={cx('text-right font-bold', RESULT_TX[cur.status])}>{cur.status}{cur.reason ? ` · ${cur.reason}` : ''}</dd>
                {cur.actions.length > 0 && <><dt className="text-sub">한 일</dt><dd className="text-right font-bold">{cur.actions.join(', ')}</dd></>}
                {cur.memo && <><dt className="text-sub">메모</dt><dd className="text-right font-bold">{cur.memo}</dd></>}
                {!!cur.minutes && <><dt className="text-sub">처리 시간</dt><dd className="text-right font-bold">{cur.minutes}분</dd></>}
              </dl>
            )}
            <div className="flex gap-2">
              {cur.status === '진행 중' && cur.date === DEMO_DATE && (
                <button onClick={() => nav(`/incident/${cur.id}/result`)} className="btn-solid flex-1 rounded-xl bg-inv py-3 text-[15px] font-bold text-inv-fg">점검 결과 입력 →</button>
              )}
              <button onClick={() => ask(cur.id)} className="btn-line flex-1 rounded-xl border-2 border-ink py-3 text-[15px] font-bold">💬 이 사건 물어보기</button>
            </div>
          </aside>
        )}
      </div>
    </main>
  )
}
