import { useEffect, useRef, useState } from 'react'
import { getBoard } from '../api'
import { EQUIPMENT, PAST_HISTORY } from '../api/mock'
import type { Board, Incident } from '../api/types'
import { useApp } from './Shell'
import { AiTag, EqpIcon, cx } from './ui'

// 물어보기(챗봇) 서랍 — 시연용. 답은 화면에 있는 판단·데이터로만 만들고, 원인은 확정하지 않는다(FR-06).
// 실제 LLM이 붙으면 answer() 자리만 API 호출로 바꾼다.

type Answer = { judgment: string; points: string[]; basis: string[] }
type Msg = { q: string; a: Answer }

const rate = (i: Incident) => (i.quality.inspected ? `${(((i.quality.defects ?? 0) / i.quality.inspected) * 100).toFixed(1)}%` : '검사 결과 없음')
const all = (b: Board) => [...b.emergency, ...b.warning]

function questions(inc?: Incident): string[] {
  const g = ['지금 어떤 설비부터 봐야 해?', '품질에 영향이 있는 설비는?', '이번 주 이상이 가장 많았던 장비는?']
  return inc ? [`${inc.equipment.no}은 어디부터 확인해야 해?`, `${inc.equipment.no}은 왜 이 순서야?`, ...g] : g
}

function answer(q: string, b: Board, inc?: Incident): Answer {
  if (inc && q.includes('어디부터')) {
    return {
      judgment: `${inc.equipment.no}은 아래 순서로 확인해 보세요.`,
      points: inc.checks.map((c, i) => `${i + 1}. ${c.label}${c.refined ? ' (Q-First 조사로 구체화)' : ''}`),
      basis: [`${inc.signal.label} ${inc.signal.values[inc.signal.values.length - 1].toFixed(1)}${inc.signal.unit} (기준 ${inc.signal.reference})`, `품질 ${inc.quality.source} ${rate(inc)}`],
    }
  }
  if (inc && q.includes('왜 이 순서')) {
    return {
      judgment: `${inc.group === 'emergency' ? '비상' : '예고'} ${inc.rank}위 · ${inc.grade}등급으로 판단했어요. ${inc.whyFirst}.`,
      points: inc.evidence.map((e) => `${e.kind} · ${e.title}`),
      basis: inc.evidence.map((e) => e.detail),
    }
  }
  if (q.includes('어떤 설비부터')) {
    const list = all(b)
    return {
      judgment: `${b.emergency[0]?.equipment.no ?? list[0]?.equipment.no}부터 보세요. 비상 중 품질 영향이 가장 커요.`,
      points: [
        ...b.emergency.map((x) => `비상 ${x.rank}위 ${x.equipment.no} · ${x.grade}등급 · 품질 ${rate(x)}`),
        ...b.warning.map((x) => `예고 ${x.rank}위 ${x.equipment.no} · ${x.grade}등급 · 알람 전 · 품질 ${rate(x)}`),
      ],
      basis: ['5등급 규칙: 비상 → 예고, 같은 등급 안에서는 품질 영향 → 위험도 → 이상 점수 순', `${b.asOf} 판단 기준`],
    }
  }
  if (q.includes('품질에 영향')) {
    const yes = all(b).filter((x) => x.quality.impact === 'yes')
    const unknown = all(b).filter((x) => x.quality.impact === null)
    return {
      judgment: `품질 영향이 확인된 설비는 ${yes.length}대예요.`,
      points: [...yes.map((x) => `${x.equipment.no} · ${x.quality.source} · ${rate(x)}`), ...unknown.map((x) => `${x.equipment.no} · 검사 결과가 아직 없어 미확인`)],
      basis: ['검사 불량을 LOT로 설비까지 연결', '주의 기준 3% 이상 · 불량 기준 8% 이상(가정)'],
    }
  }
  // 이번 주 가장 많았던 장비
  const cnt: Record<string, number> = {}
  for (const h of PAST_HISTORY) cnt[h.equipment.id] = (cnt[h.equipment.id] ?? 0) + 1
  for (const x of all(b)) cnt[x.equipment.id] = (cnt[x.equipment.id] ?? 0) + 1
  const top = Object.entries(cnt).sort((p, q2) => q2[1] - p[1] || p[0].localeCompare(q2[0]))
  const max = top[0]?.[1] ?? 0
  return {
    judgment: `이번 주에는 ${top.filter((t) => t[1] === max).map((t) => EQUIPMENT[t[0]].no).join(', ')}이 ${max}건으로 가장 많았어요.`,
    points: top.slice(0, 5).map(([id, n]) => `${EQUIPMENT[id].no} (${id}) · ${n}건`),
    basis: ['점검 이력(2/2~2/3) + 오늘 사건 기준'],
  }
}

export function ChatDrawer() {
  const { chat, closeChat, snap, version } = useApp()
  const [board, setBoard] = useState<Board | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (chat.open) getBoard(snap).then(setBoard) }, [chat.open, snap, version])
  useEffect(() => { setMsgs([]) }, [chat.incidentId])
  useEffect(() => {
    if (!chat.open) return
    ref.current?.focus()
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') closeChat() }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [chat.open, closeChat])
  if (!chat.open || !board) return null
  const inc = chat.incidentId ? all(board).find((x) => x.id === chat.incidentId) : undefined
  const ask = (q: string) => setMsgs((m) => [...m, { q, a: answer(q, board, inc) }])

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/20" onClick={closeChat}>
      <aside ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Q-First에게 물어보기" onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col sm:w-[440px] bg-card shadow-2xl outline-none">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <h2 className="text-[17px] font-extrabold">물어보기</h2>
          <span className="text-[12px] text-mute">{board.asOf} 판단 기준</span>
          <button onClick={closeChat} aria-label="닫기" className="btn-line ml-auto grid h-9 w-9 place-items-center rounded-full border border-card-bd text-[16px]">×</button>
        </div>
        {inc && (
          <div className="flex items-center gap-3 border-b border-line bg-soft px-5 py-3">
            <EqpIcon id={inc.equipment.id} size={44} />
            <div className="flex flex-col"><span className="text-[17px] font-bold">{inc.equipment.no}</span><span className="text-[12px] text-sub">{inc.equipment.name} · {inc.headline}</span></div>
          </div>
        )}
        <div className="flex flex-1 flex-col gap-4 overflow-auto px-5 py-4">
          {msgs.length === 0 && <p className="text-[13px] text-sub">{inc ? `${inc.equipment.no}에 대해 물어보세요.` : '지금 화면의 판단과 이력에 대해 물어보세요.'} 아래 질문을 누르면 돼요.</p>}
          {msgs.map((m, i) => (
            <div key={i} className="flex flex-col gap-2">
              <p className="self-end rounded-2xl rounded-br-sm bg-inv px-4 py-2 text-[14px] font-semibold text-inv-fg">{m.q}</p>
              <div className="flex flex-col gap-2 rounded-2xl rounded-bl-sm border border-card-bd p-4">
                <div className="ai-surface flex flex-col items-start gap-2 rounded-lg px-3 py-2.5 text-inv-fg">
                  <AiTag dark />
                  <p className="text-[14px] font-bold leading-snug">{m.a.judgment}</p>
                </div>
                <ul className="flex flex-col gap-1 text-[13px]">{m.a.points.map((p) => <li key={p} className="leading-snug">{p}</li>)}</ul>
                <div className="flex flex-col gap-1 border-t border-line pt-2">
                  <span className="text-[11px] font-bold text-mute">근거 데이터</span>
                  {m.a.basis.map((b) => <span key={b} className="text-[12px] text-sub">· {b}</span>)}
                </div>
                <p className="text-[11px] text-mute">원인을 확정하지 않아요 · 이상이 나타난 곳과 확인 순서까지만 안내해요</p>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2 border-t border-line px-5 py-4">
          <span className="text-[11px] font-bold text-mute">자주 묻는 질문</span>
          <div className="flex flex-wrap gap-1.5">
            {questions(inc).map((q) => (
              <button key={q} onClick={() => ask(q)} className={cx('btn-line rounded-full border border-card-bd px-3 py-1.5 text-[13px] font-semibold')}>{q}</button>
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-card-bd px-3 py-2 text-[13px] text-mute">
            직접 입력은 다음 버전에서 연결돼요
          </div>
        </div>
      </aside>
    </div>
  )
}
