import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import logo from '../assets/logo-symbol.png'
import { getNotifications, resetStore, subscribe } from '../api'
import { SCENES, sceneOf } from '../api/mock'
import type { Notice, Snapshot } from '../api/types'
import { ChatDrawer } from './Chat'
import { cx } from './ui'
import { useLoad } from './useLoad'

type Ctx = {
  snap: Snapshot; setSnap: (s: Snapshot) => void; toast: (t: string) => void; version: number
  demo: boolean; news: boolean; dismissNews: () => void; arrive: () => void; restart: () => void
  chat: { open: boolean; incidentId?: string }; ask: (incidentId?: string) => void; closeChat: () => void
  /** 알림에서 고른 사건: 현황판이 받아서 상세를 연다 */
  focusId: string | null; setFocusId: (id: string | null) => void
  seen: Set<string>; markSeen: (ids: string[]) => void
}
const AppCtx = createContext<Ctx>({ snap: '1405', setSnap: () => {}, toast: () => {}, version: 0, demo: false, news: false, dismissNews: () => {}, arrive: () => {}, restart: () => {}, chat: { open: false }, ask: () => {}, closeChat: () => {}, focusId: null, setFocusId: () => {}, seen: new Set(), markSeen: () => {} })

/** 주소에 ?demo 가 있으면 시연 모드: 13:41(첫 예고)에서 시작하고, 발표자만 쓰는 '다음 장면' 버튼이 보인다.
 *  다음 장면 = API v1.1 POST /demo/replay/next. 연결 후에는 성공 응답을 받으면 board를 바로 다시 부른다 */
const isDemo = () => {
  // 공유 링크(아티팩트)용 빌드는 주소에 ?demo를 붙일 수 없어 시연 모드로 시작한다
  if (import.meta.env.VITE_DEMO_DEFAULT === '1') return true
  const { search, hash } = window.location
  return /[?&]demo\b/.test(search) || /[?&]demo\b/.test(hash)
}
export const useApp = () => useContext(AppCtx)

export function AppProvider({ children }: { children: ReactNode }) {
  const demo = useRef(isDemo()).current
  // 시연 모드는 13:41에서 시작, 그 외(사용성 테스트)는 14:05 상태로 시작
  const [snap, setSnap] = useState<Snapshot>(demo ? SCENES[0].id : '1405')
  const [news, setNews] = useState(false)
  const [msg, setMsg] = useState('')
  const [version, setVersion] = useState(0)
  const [chat, setChat] = useState<{ open: boolean; incidentId?: string }>({ open: false })
  const ask = useCallback((incidentId?: string) => setChat({ open: true, incidentId }), [])
  const [focusId, setFocusId] = useState<string | null>(null)
  const [seen, setSeen] = useState<Set<string>>(new Set())
  const markSeen = useCallback((ids: string[]) => setSeen((s) => new Set([...s, ...ids])), [])
  const closeChat = useCallback(() => setChat((c) => ({ ...c, open: false })), [])
  const timer = useRef<number | undefined>(undefined)
  const toast = useCallback((t: string) => {
    setMsg(t)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMsg(''), 2600)
  }, [])
  // 저장소가 바뀌면 화면 다시 읽기
  useEffect(() => subscribe(() => setVersion((v) => v + 1)), [])
  const arrive = useCallback(() => {
    setSnap((s) => SCENES[SCENES.findIndex((x) => x.id === s) + 1]?.id ?? s)
    setNews(true)
  }, [])
  const restart = useCallback(() => { resetStore(); setNews(false); setSeen(new Set()); setSnap(SCENES[0].id); window.location.hash = '#/' }, [])
  return (
    <AppCtx.Provider value={{ snap, setSnap, toast, version, demo, news, dismissNews: () => setNews(false), arrive, restart, chat, ask, closeChat, focusId, setFocusId, seen, markSeen }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-8 flex justify-center">
        {msg && <div className="rounded-xl bg-inv px-5 py-3 text-[14px] font-semibold text-inv-fg shadow-lg">{msg}</div>}
      </div>
    </AppCtx.Provider>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; t: string; disabled?: boolean }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-xl border border-card-bd bg-card p-1">
      {options.map((o) => (
        <button key={o.v} role="radio" aria-checked={value === o.v} disabled={o.disabled} onClick={() => onChange(o.v)}
          className={cx('rounded-lg px-3.5 py-1.5 text-[13px] font-bold', value === o.v ? 'bg-inv text-inv-fg' : 'btn-line text-ink disabled:text-mute/60')}>
          {o.t}
        </button>
      ))}
    </div>
  )
}

const NAV = [
  { to: '/', t: '사건', end: true },
  { to: '/history', t: '이력' },
]

export function Layout() {
  const { snap, demo, arrive, restart, ask } = useApp()
  const next = SCENES[SCENES.findIndex((x) => x.id === snap) + 1]
  return (
    <div className="min-h-full">
      <header className="flex items-center gap-4 px-6 pt-4">
        <img src={logo} alt="Q-First" className="h-8 w-8" />
        <nav aria-label="주 메뉴" className="flex rounded-xl border border-card-bd bg-card p-1">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => cx('rounded-lg px-4 py-1.5 text-[14px] font-bold', isActive ? 'bg-inv text-inv-fg' : 'btn-line text-ink')}>
              {n.t}
            </NavLink>
          ))}
        </nav>
        <span className="text-[13px] text-mute">크림 용기 사출 라인 · 사출기 10대 · 가상 데이터</span>
        <div className="flex-1" />
        {demo && (
          <div className="flex items-center gap-1 rounded-xl border border-dashed border-card-bd p-1" aria-label="시연 제어">
            <span className="px-2 text-[11px] font-bold text-mute">시연</span>
            {next
              ? <button onClick={arrive} className="btn-solid rounded-lg bg-inv px-3 py-1.5 text-[13px] font-bold text-inv-fg">다음 장면 ▶ <span className="num">{next.time}</span> {next.label}</button>
              : <span className="px-2 text-[13px] font-semibold text-sub">마지막 장면</span>}
            <button onClick={restart} className="btn-line rounded-lg px-3 py-1.5 text-[13px] font-bold text-sub">↺ 처음으로</button>
          </div>
        )}
        <Bell />
        <button onClick={() => ask()} className="flex items-center gap-2 rounded-xl border border-card-bd bg-card px-4 py-2 text-[13px] font-bold btn-line">💬 물어보기</button>
        <div className="flex items-center gap-2 rounded-xl border border-card-bd bg-card px-4 py-2 text-[13px]">
          <span className="h-2 w-2 animate-pulse rounded-full bg-green" aria-hidden="true" />
          <span className="text-sub">{demo ? '시나리오 재생' : '마지막 판단'}</span>
          <b className="num text-[15px]">{sceneOf(snap).time}</b>
          {!demo && <span className="text-mute">· 실시간</span>}
        </div>
      </header>
      <Outlet />
      <ChatDrawer />
    </div>
  )
}

const NOTICE_TONE: Record<Notice['tone'], { dot: string; tx: string }> = {
  emergency: { dot: 'bg-red', tx: 'text-red-tx' },
  warning: { dot: 'bg-blue rounded-none', tx: 'text-blue-tx' },
  ink: { dot: 'bg-ink', tx: 'text-ink' },
}

/** 헤더 알림 (FR-03): 안 읽은 수 + 장면마다 쌓이는 목록. 누르면 그 사건 상세를 연다 */
function Bell() {
  const { snap, seen, markSeen, setFocusId } = useApp()
  const list = useLoad(() => getNotifications(snap))
  const [open, setOpen] = useState(false)
  const nav = useNavigate()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const f = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', f); window.addEventListener('keydown', k)
    return () => { window.removeEventListener('mousedown', f); window.removeEventListener('keydown', k) }
  }, [open])
  const items = list ?? []
  const unread = items.filter((n) => !seen.has(n.id)).length
  const toggle = () => { if (!open) markSeen(items.map((n) => n.id)); setOpen(!open) }
  return (
    <div ref={box} className="relative">
      <button onClick={toggle} aria-expanded={open} aria-label={`알림 ${items.length}건${unread ? `, 안 읽은 알림 ${unread}건` : ''}`}
        className={cx('relative flex items-center gap-2 rounded-xl border px-4 py-2 text-[13px] font-bold', open ? 'border-ink bg-inv text-inv-fg' : 'btn-line border-card-bd bg-card')}>
        <span aria-hidden="true">🔔</span>알림
        {unread > 0 && <span className="num absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-red px-1 text-[11px] font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="알림 목록" className="absolute right-0 top-full z-30 mt-2 w-[400px] overflow-hidden rounded-xl border border-card-bd bg-card shadow-xl">
          <p className="border-b border-line px-4 py-2.5 text-[12px] text-sub">판단이 바뀐 사건 · 최근 것이 위</p>
          <ul className="max-h-[420px] divide-y divide-line overflow-auto">
            {items.map((n) => {
              const t = NOTICE_TONE[n.tone]
              return (
                <li key={n.id}>
                  <button onClick={() => { setOpen(false); setFocusId(n.incidentId); nav('/') }} className="btn-line flex w-full items-start gap-3 px-4 py-3 text-left">
                    <span className="num w-10 shrink-0 text-[13px] text-sub">{n.at}</span>
                    <span aria-hidden="true" className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', t.dot)} />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <b className={cx('text-[14px]', t.tx)}>{n.title}</b>
                      <span className="text-[13px] text-sub">{n.detail}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {!items.length && <p className="px-4 py-6 text-center text-[13px] text-mute">아직 알림이 없어요</p>}
        </div>
      )}
    </div>
  )
}
