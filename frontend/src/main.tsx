import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

// 注意：不启用 StrictMode —— epub.js 渲染有 DOM 副作用（iframe/全局 ePub），
// 开发模式的双挂载会导致两个 rendition 实例竞争（已知问题，记录于 README）
ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
