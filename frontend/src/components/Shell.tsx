import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import logo from '../assets/logo-symbol.png'
import { advanceReplay, readReplayBoard, replayEnabled, replayScene } from '../api/replay'
import type { NotificationPage } from '../api/contract'
import { resetStore, subscribe } from '../api'
import { SCENES, sceneOf } from '../api/mock'
import type { Snapshot } from '../api/types'
import { ChatDrawer } from './Chat'
import { cx } from './ui'

type Ctx = {
  snap: Snapshot; setSnap: (s: Snapshot) => void; toast: (t: string) => void; version: number
  demo: boolean; news: boolean; advancing?: boolean; notice?: NotificationPage['items'][number]; dismissNews: () => void; arrive: () => void; restart: () => void
  chat: { open: boolean; incidentId?: string }; ask: (incidentId?: string) => void; closeChat: () => void
}
const AppCtx = createContext<Ctx>({ snap: '1405', setSnap: () => {}, toast: () => {}, version: 0, demo: false, news: false, dismissNews: () => {}, arrive: () => {}, restart: () => {}, chat: { open: false }, ask: () => {}, closeChat: () => {} })

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
  const [notice, setNotice] = useState<NotificationPage['items'][number]>()
  const [advancing, setAdvancing] = useState(false)
  const latestVersion = useRef(0)
  const inFlight = useRef(false)
  const [msg, setMsg] = useState('')
  const [version, setVersion] = useState(0)
  const [chat, setChat] = useState<{ open: boolean; incidentId?: string }>({ open: false })
  const ask = useCallback((incidentId?: string) => { if (!replayEnabled) setChat({ open: true, incidentId }) }, [])
  const closeChat = useCallback(() => setChat((c) => ({ ...c, open: false })), [])
  const timer = useRef<number | undefined>(undefined)
  const toast = useCallback((t: string) => {
    setMsg(t)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMsg(''), 2600)
  }, [])
  // 저장소가 바뀌면 화면 다시 읽기
  useEffect(() => subscribe(() => setVersion((v) => v + 1)), [])
  useEffect(() => {
    if (!replayEnabled) return
    let alive = true
    const refresh = () => {
      readReplayBoard().then((board) => {
        if (alive && !inFlight.current && board.snapshotVersion > latestVersion.current) {
          latestVersion.current = board.snapshotVersion
          setSnap(replayScene(board))
          setVersion((v) => v + 1)
        }
      }).catch(() => { if (alive) toast('재생 API 연결을 확인해 주세요.') })
    }
    refresh()
    const poll = window.setInterval(refresh, 10000)
    return () => { alive = false; window.clearInterval(poll) }
  }, [toast])
  const arrive = useCallback(() => {
    if (replayEnabled) {
      if (inFlight.current) return
      inFlight.current = true
      setAdvancing(true)
      readReplayBoard().then(advanceReplay).then(({ board, notices }) => {
        latestVersion.current = board.snapshotVersion
        setSnap(replayScene(board))
        setNotice(notices.find((n) => n.equipment.id === 'EQP-003') ?? notices[0])
        setNews(notices.length > 0)
        setVersion((v) => v + 1)
      }).catch((error: Error) => toast(error.message)).finally(() => {
        inFlight.current = false
        setAdvancing(false)
      })
      return
    }
    setSnap((s) => SCENES[SCENES.findIndex((x) => x.id === s) + 1]?.id ?? s)
    setNews(true)
  }, [toast])
  const restart = useCallback(() => { resetStore(); setNews(false); setSnap(SCENES[0].id); window.location.hash = '#/' }, [])
  return (
    <AppCtx.Provider value={{ snap, setSnap, toast, version, demo, news, advancing, notice, dismissNews: () => setNews(false), arrive, restart, chat, ask, closeChat }}>
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
  const { snap, demo, arrive, restart, ask, advancing } = useApp()
  const next = replayEnabled && (snap === '1415a' || snap === '1415b') ? undefined : SCENES[SCENES.findIndex((x) => x.id === snap) + 1]
  return (
    <div className="min-h-full">
      <header className="flex items-center gap-4 px-6 pt-4">
        <img src={logo} alt="Q-First" className="h-8 w-8" />
        <nav aria-label="주 메뉴" className="flex rounded-xl border border-card-bd bg-card p-1">
          {NAV.filter(n => !replayEnabled || n.to === '/').map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => cx('rounded-lg px-4 py-1.5 text-[14px] font-bold', isActive ? 'bg-inv text-inv-fg' : 'btn-line text-ink')}>
              {n.t}
            </NavLink>
          ))}
        </nav>
        <span className="text-[13px] text-mute">사출기 10대 · {replayEnabled ? 'v8 원본 재생 / 실제 탐지·조사 · 점검 저장·챗봇 미연결' : '가상 데이터'}</span>
        <div className="flex-1" />
        {demo && (
          <div className="flex items-center gap-1 rounded-xl border border-dashed border-card-bd p-1" aria-label="시연 제어">
            <span className="px-2 text-[11px] font-bold text-mute">시연</span>
            {next
              ? <button disabled={advancing} onClick={arrive} className="btn-solid rounded-lg bg-inv px-3 py-1.5 text-[13px] font-bold text-inv-fg">다음 장면 ▶ <span className="num">{next.time}</span> {next.label}</button>
              : <span className="px-2 text-[13px] font-semibold text-sub">마지막 장면</span>}
            {!replayEnabled && <button onClick={restart} className="btn-line rounded-lg px-3 py-1.5 text-[13px] font-bold text-sub">↺ 처음으로</button>}
          </div>
        )}
        <button disabled={replayEnabled} onClick={() => ask()} className="flex items-center gap-2 rounded-xl border border-card-bd bg-card px-4 py-2 text-[13px] font-bold btn-line">💬 물어보기</button>
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
