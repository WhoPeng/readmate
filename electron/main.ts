/**
 * Electron 主进程：窗口管理 + Python 后端子进程生命周期 + IPC 桥注册。
 *
 * 设计文档第 1 节进程模型：
 *   main（本文件）──spawn──> Python FastAPI（127.0.0.1:8000）
 *   main ──IPC──> renderer（React）
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import * as path from 'path'
import { registerAiIpc } from './ai/ipc'
import { registerStoreIpc } from './storeIpc'

const BACKEND_URL = 'http://127.0.0.1:8000'
const DEV_SERVER_URL = 'http://localhost:5173'

let pythonProc: ChildProcess | null = null
let mainWindow: BrowserWindow | null = null

async function backendAlive(): Promise<boolean> {
  try {
    const resp = await fetch(`${BACKEND_URL}/api/health`)
    return resp.ok
  } catch {
    return false
  }
}

/** 启动 Python 后端（若已被用户手动启动则复用），等待就绪后返回 */
async function startBackend(): Promise<void> {
  if (await backendAlive()) return
  // app.getAppPath() = electron/；项目根 = 其父目录（backend/frontend 所在层）
  const projectRoot = path.resolve(app.getAppPath(), '..')
  const python = path.join(projectRoot, 'backend', '.venv', 'Scripts', 'python.exe')
  pythonProc = spawn(python, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000'], {
    cwd: path.join(projectRoot, 'backend'),
    stdio: 'ignore',
  })
  pythonProc.on('exit', () => {
    pythonProc = null
  })
  // 轮询健康检查，最多等 20 秒
  for (let i = 0; i < 40; i++) {
    if (await backendAlive()) return
    await new Promise((r) => setTimeout(r, 500))
  }
  console.warn('[readmate] 后端启动超时，请手动检查 backend 环境')
}

function stopBackend(): void {
  if (pythonProc) {
    pythonProc.kill()
    pythonProc = null
  }
}

function registerAppIpc(): void {
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:pingBackend', () => backendAlive())
  registerAiIpc()
  registerStoreIpc()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: '伴读 ReadMate',
    backgroundColor: '#faf9f6',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (!app.isPackaged) {
    // 开发模式：优先加载 Vite dev server（HMR），失败则回退构建产物
    mainWindow.loadURL(DEV_SERVER_URL).catch(() => {
      mainWindow?.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'))
    })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'))
  }

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[readmate] 窗口加载完成:', mainWindow?.webContents.getURL())
  })
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('[readmate] 窗口加载失败:', code, desc)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  registerAppIpc()
  await startBackend()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopBackend()
  app.quit()
})

app.on('before-quit', stopBackend)
