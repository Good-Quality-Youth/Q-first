import { HashRouter, Route, Routes } from 'react-router-dom'
import { AppProvider, Layout } from './components/Shell'
import Board from './pages/Board'
import History from './pages/History'
import Result from './pages/Result'

// HashRouter: 주소에 #이 붙어서 어떤 정적 호스팅(Vercel, GitHub Pages, nginx)에서도 새로고침 404가 나지 않는다.
export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Board />} />
            <Route path="incident/:id/result" element={<Result />} />
            <Route path="history" element={<History />} />
          </Route>
        </Routes>
      </HashRouter>
    </AppProvider>
  )
}
