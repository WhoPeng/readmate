/** 应用外壳：hash 路由 + 顶栏 + 健康状态指示 */
import { useEffect, useState } from 'react'
import Library from './pages/Library'
import BookDetail from './pages/BookDetail'
import Reader from './pages/Reader'
import BookReport from './pages/BookReport'
import Archive from './pages/Archive'
import Settings from './pages/Settings'
import { api } from './api/client'

/** 极简 hash 路由（#/library、#/book/:id、#/reader/:bookId、#/settings…） */
export function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash || '#/library')
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/library')
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash.replace(/^#/, '') || '/library'
}

export default function App() {
  const route = useHashRoute()
  const [backendOk, setBackendOk] = useState<boolean | null>(null)

  useEffect(() => {
    api
      .health()
      .then((h) => setBackendOk(h.database === 'ok'))
      .catch(() => setBackendOk(false))
  }, [])

  const navItems = [
    { path: '/library', label: '书架' },
    { path: '/archive', label: '阅读档案' },
    { path: '/settings', label: '设置' },
  ]

  const renderPage = () => {
    if (route.startsWith('/library')) return <Library />
    if (route.includes('/report')) {
      const id = Number(route.split('/')[2])
      return <BookReport bookId={id} />
    }
    if (route.startsWith('/book/')) {
      const id = Number(route.split('/')[2])
      return <BookDetail bookId={id} />
    }
    if (route.startsWith('/reader/')) {
      const id = Number(route.split('/')[2])
      return <Reader bookId={id} />
    }
    if (route.startsWith('/archive')) return <Archive />
    if (route.startsWith('/settings')) return <Settings />
    return <div className="empty">页面建设中：{route}</div>
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="brand">伴读</span>
        <nav>
          {navItems.map((item) => (
            <a key={item.path} href={`#${item.path}`} className={route.startsWith(item.path) ? 'active' : ''}>
              {item.label}
            </a>
          ))}
        </nav>
        <span
          className={`health-dot ${backendOk === null ? '' : backendOk ? 'ok' : 'bad'}`}
          title={backendOk === null ? '检查后端中' : backendOk ? '后端连接正常' : '后端连接失败'}
        />
      </header>
      <main className="content">{renderPage()}</main>
    </div>
  )
}
