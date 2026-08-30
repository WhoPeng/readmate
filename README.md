# 伴读（ReadMate）— 个人 AI 阅读器

> 一个会陪你读书、先听你思考、再与你讨论，并记录你思想变化轨迹的个人 AI 阅读器。34
> 开发中项目：流程文档见 `docs/`（00~07 阶段），进度按 `00-项目管理/项目计划.md` 的 20 步推进。

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Electron（main 进程：AI Provider 层 + 密钥安全存储） |
| 前端 | React 19 + TypeScript + Vite（renderer） |
| 阅读器 | epub.js（EPUB 渲染 + CFI 锚点） |
| 后端 | Python 3.11+ / FastAPI + SQLite（SQLAlchemy，数据与解析层） |

## 如何运行（开发模式）

```bash
# 1. 后端（端口 8000）
cd backend
python -m venv .venv && .venv/Scripts/pip install -e ".[dev]"
.venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 2. 前端 dev server（端口 5173）
cd frontend
npm install && npm run dev

# 3. 桌面窗口
cd electron
npm install && npm run dev   # tsc 编译 + electron .
```

## 测试

```bash
cd backend && .venv/Scripts/python -m pytest          # 后端 27 项
cd frontend && npm test                               # TS 逻辑单测（vitest）
```

## 目录

```
backend/    Python 数据与解析层（FastAPI + SQLite + ebooklib）
electron/   Electron 主进程（AI Provider / 密钥 / 窗口）
frontend/   React 渲染进程（阅读器 / 界面）
shared/     TS 共享类型
data/       运行时数据（SQLite + 书籍文件，不入 Git）
docs/       软件工程流程文档（本项目的学习载体）
```

## 已知问题（P2）

- 阅读器主题切换后约 2 秒内选区生成 CFI 可能失败（epub.js 样式应用重排时序），失败时提示重新选择即可
- 开发模式 Electron 提示 Insecure Content-Security-Policy（无 CSP），打包版本需补充 CSP
- React StrictMode 已禁用（epub.js 双挂载会产生两个 rendition 实例竞争）
- 主题标签为简化规则（书名截取 + 手动编辑），非 AI 提取
- AI 生成的"最终想法"需要用户在记录卡片中手动填写

## 使用说明

1. 启动后自动拉起后端（或手动：`backend/.venv/Scripts/python -m uvicorn app.main:app --port 8000`）
2. 首次使用：设置 → AI 模型配置 → 选择厂商 → 填入 API Key → 测试连接
3. 书架 → 导入 EPUB → 首次打开自动进入"阅读前访谈"
4. 读完一章 → 「读完本章」→ 与 AI 讨论 → 生成章节记录
5. 全书完成 → 书籍详情页「我与这本书」生成思想档案
6. 数据备份：设置 → 数据备份（导出 zip 不含明文密钥）

## 版本记录

- v0.1.0 骨架：后端 API + 数据层 + 测试 27 项全绿（2026-08-30）
