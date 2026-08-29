# 项目设计 Plan（Phase 0）：「伴读 / ReadMate」

> 版本：v1.1（技术栈按用户重选更新） ｜ 日期：2026-08-30 ｜ 依据：`01-需求分析/需求规格说明书-SRS.md` ｜ **状态：已实施完成（2026-08-30，MVP 验收通过）**
> 本文档覆盖想法文档要求的 15 项设计内容。

## 实施记录（2026-08-30）

- 全部 15 项设计落地，20 步开发完成（`00-项目管理/项目计划.md` 变更记录 v1.2）
- 实施调整：
  1. 访谈/反思状态机执行于 **renderer**（原设计 main 进程）——UI 交互驱动更直接，AI 调用仍经 main 中转（密钥不出主进程）
  2. 会话进度存 **localStorage**（原设计后端持久化）——单机场景更简单，历史记录仍在 ai_messages 可追溯
  3. EPUB 渲染引擎：npm 官方 **epubjs@0.3.93**（0.2.15 为老架构 API 不可用；GitHub 源构建脚本不可用）
  4. 高亮 CFI 生成：`EpubCFI.fromRange` + 章节前缀 base（0.3.x 无 Book.cfiFromRange）
  5. 认证自适应：Anthropic API Key 用 x-api-key，OAuth token 用 Bearer（Claude Code 凭据场景）
  6. 主题标签 MVP 用简化规则（自动截取书名 + 手动编辑）
  7. 新增 OpenCode 网关 Provider 预设（用户现有 API，33 模型，OpenAI 兼容协议）
- 验收：`04-测试/测试报告.md`（66 断言全绿，16 项真实 API）

---

## 1. 项目目录结构

```
readmate/                         # 仓库根（monorepo）
├── README.md                     # 项目说明：运行方式、已知问题、版本记录
├── backend/                      # Python 后端：数据与解析层
│   ├── pyproject.toml
│   ├── app/
│   │   ├── main.py               # FastAPI 入口、路由注册
│   │   ├── api/                  # REST 接口（books/reader/settings/backup）
│   │   ├── services/             # 业务服务（book/reading/journal/memory）
│   │   ├── models/               # SQLAlchemy ORM 模型
│   │   └── infrastructure/
│   │       ├── db.py             # 引擎/Session
│   │       └── parsers/
│   │           ├── epub_meta.py  # 元数据/目录/封面解析（ebooklib）
│   │           └── html_cleaner.py
│   └── tests/                    # pytest
├── electron/                     # Electron 主进程（AI 智能层在此）
│   ├── main.ts                   # 窗口管理、拉起/关闭 Python 子进程
│   ├── ai/                       # AI Provider 层（参考 Cherry Studio）
│   │   ├── provider.ts           # 统一接口 + 错误类型
│   │   ├── openaiCompat.ts
│   │   ├── anthropic.ts
│   │   ├── contextBuilder.ts     # Context 组装 + Prompt 模板
│   │   └── sessions.ts           # 访谈/反思状态机
│   ├── store.ts                  # safeStorage 密钥管理（IPC 受控）
│   └── preload.ts                # 暴露安全 IPC API
├── frontend/                     # React + TS（renderer，Vite 构建）
│   ├── package.json / vite.config.ts
│   ├── src/
│   │   ├── pages/                # library/bookDetail/reader/reflection/
│   │   │                         # journal/bookReport/archive/settings
│   │   ├── components/           # 工具条/模态框/标注列表/阅读设置面板
│   │   ├── reader/               # epub.js 封装（渲染/CFI 高亮/笔记）
│   │   ├── api/                  # 后端 REST 客户端
│   │   └── hooks/                # 阅读进度、AI 对话流等
│   └── index.html
├── shared/                       # TS 共享类型（renderer 与 main 共用）
│   └── types.ts                  # Provider 配置/AI 消息/Journal 等类型
├── data/                         # 运行时数据（不入 Git）
│   ├── readmate.db               # SQLite
│   └── books/                    # 导入的 EPUB 原文件副本
└── docs/                         # 流程文档（本套 00~07）
```

**进程模型**：

```text
┌─ Electron 主进程 ──────────────────────────────┐
│  窗口管理 │ safeStorage 密钥 │ AI Provider 层    │
│  Context 组装 │ 访谈/反思状态机 │ 拉起 Python    │
└──────┬───────────────┬──────────────────────────┘
       │ IPC(受控)      │ spawn(子进程)
┌─ Renderer(React) ────┼──────────────────────────┐
│  epub.js 阅读器      │  REST(localhost)         │
│  UI / 对话界面       │                          │
└──────────────────────┼──────────────────────────┘
       ┌─ Python FastAPI 子进程（uvicorn）─────────┘
       │  数据与解析：SQLite / EPUB 元数据 / REST API
       └──────────────────────────────────────────
```

## 2. 技术栈最终选择及理由（v1.1，用户重选）

| 层 | 选择 | 参考开源项目 | 理由 |
|---|---|---|---|
| 桌面壳 | **Electron**（main + preload + renderer） | Cherry Studio、Koodo Reader、Thorium Reader | 生态最全、Chromium 渲染 epub.js 无障碍、safeStorage 内置密钥加密 |
| 前端 | **React 19 + TypeScript + Vite** | Readest、Cherry Studio | 阅读器与 AI 客户端的开源参考几乎全是此组合，参考代码直接可用 |
| 阅读器渲染 | **epub.js**（CFI 锚点体系） | Readest、Koodo Reader | 内置 EPUB 解析+分页渲染+CFI 定位；**高亮/笔记锚点（原计划最大风险）由它解决** |
| 后端 | **Python 3.11+ / FastAPI + Uvicorn** | — | 数据与解析层；用户确认保留 Python |
| 数据 | **SQLite + SQLAlchemy 2.x** | — | 单机；SQLAlchemy 成熟，未来可迁 PostgreSQL |
| EPUB 元数据解析 | **ebooklib** | — | 不自造 EPUB 标准解析；正文渲染交给 epub.js |
| AI Provider | **TS 自研层**（main 进程内，接口抽象） | **Cherry Studio**（其 Provider 抽象直接参考） | 用户重选：AI 层在 TS 侧；main 进程直连 AI API 规避 CORS，密钥不出主进程 |
| 密钥存储 | **Electron safeStorage**（Windows DPAPI 加密） | Cherry Studio | 系统级加密；替代原 keyring 方案（Provider 移 TS 后一致化） |
| AI 流式 | fetch stream（main 进程转发，逐块推送 renderer） | Cherry Studio | 渲染进程无跨域问题 |
| 打包 | **electron-builder** | Cherry Studio、Koodo | 产出 Windows 安装包/exe |

> ⚠️ **与 v1.0 及想法文档的差异**：v1.0 用 pywebview + 原生 JS + Python 侧 Provider；现改为 Electron + React/TS + **TS 侧 Provider（参考 Cherry Studio）**。理由：① 用户重选方案 B；② epub.js 需 JS 生态，React 化后高亮/标注等复杂交互直接借鉴 Readest/Koodo 开源实现；③ Electron 主进程直连 AI 规避 CORS 与密钥暴露。**Python 保留做数据与解析**（想法文档钦定 SQLite + 成熟解析方案）。

## 3. 核心数据模型（领域层）

> 与 v1.0 一致，仅高亮锚点字段调整（采用 epub.js 的 CFI 定位）。

```
Book ──1:N──> Chapter ──1:0..1──> ReadingIntent（每书一条，可重新生成）
 │                │
 │                ├──1:N──> Highlight / Note / Bookmark
 │                └──1:0..1──> ChapterJournal
 ├──1:N──> ReaderThought（思想轨迹快照）
 ├──1:N──> BookMemory
 └──1:0..1──> BookReport（「我与这本书」）

ChapterJournal ──1:N──> AiMessage（AI 调用记录，可追踪）
ReaderMemory（用户长期偏好，全局）
Settings（AI 配置 + UI 偏好；不含密钥）
```

- **Book**：id、title、author、cover、format、file_path（EPUB 原文件副本）、file_fingerprint（去重）、metadata_json、progress（chapter_cfi + 位置）、status（未读/阅读中/已完成）、created_at
- **Chapter**：id、book_id、index、toc_title、chapter_cfi（epub.js 章节定位）、word_count、toc_level、created_at —— **正文不落库**：渲染时 epub.js 直接读原文件（正文由 epub.js 处理，避免双份存储与清洗负担）
- **ReadingIntent**：id、book_id、version、motivation、expected_gain、interested_topics、personal_questions、emotional_context、created_at（版本化）
- **Highlight**：id、book_id、chapter_id、**cfi_start、cfi_end**（epub.js CFI 锚点）、selected_text、color、note、created_at
- **Note**：id、book_id、chapter_id、**cfi**（可空=章内笔记）、content、created_at、updated_at
- **Bookmark**：id、book_id、chapter_id、cfi、created_at
- **ChapterJournal**：id、book_id、chapter_id、reading_seconds、reader_feeling、reader_understanding、reader_questions、ai_feedback、author_position_json、agreement_level（一致/部分一致/理解偏差/合理分歧）、disagreement、misunderstanding、changed_mind、final_thought、status、created_at、updated_at
- **BookReport**：id、book_id、version、sections_json（10 项）、trajectory_json（思想轨迹）、user_edits_json、created_at
- **AiMessage**：id、session_key、role、content、source_tag（[BOOK]/[AI]/[READER]…）、provider、model、prompt_tokens、completion_tokens、latency_ms、created_at —— **由 TS 调用后经 REST 落库**
- **ReaderMemory**：id、category、content_json、source、updated_at
- **Settings**：key PK、value_json（AI 配置 provider/base_url/model/params 等，**不含 Key**；UI 偏好）

## 4. EPUB 阅读器方案（v1.1）

**职责划分**：
- **Python（ebooklib）**：解析元数据（书名/作者/封面/出版社）、目录树、章节清单（标题+CFI 定位），入库供书架/详情页/目录导航使用；EPUB 原文件复制到 `data/books/` 统一管理。
- **epub.js（前端）**：加载原文件、渲染正文（分页/滚动/翻页）、提供 **CFI** 定位体系、章节跳转、进度位置记录。

```text
导入 EPUB → Python: 校验+指纹去重+元数据/目录解析 → 存文件+入库 → 书架
打开阅读 → 前端拿到 books 元数据 → epub.js book.load(原文件 URL)
        → 渲染章节 → 阅读交互（高亮/笔记/书签）用 CFI 锚点 → 存后端
```

- **高亮/笔记锚点**：epub.js `cfiFromRange()` 生成 CFI 字符串（标准定位，重排版不失效）→ 存 `cfi_start/cfi_end`；渲染时 `book.getRange(cfi)` 还原并包裹高亮 DOM（参考 Koodo Reader 的高亮实现）。
- **进度**：epub.js 提供章节位置与百分比（`book.locations`），结合 CFI 实现"精确恢复阅读位置"。
- **长章节性能**：epub.js 内置分页渲染（页面视图）与滚动视图两种模式，MVP 默认分页模式；大书用 `book.ready` 与懒加载策略。

## 5. AI Provider 抽象方案（v1.1，参考 Cherry Studio）

**位置**：Electron **main 进程**（renderer 不可直接持有密钥与网络凭证，避免 XSS 面）。

```typescript
// shared/types.ts —— 前后端与主进程共用的契约
interface ProviderConfig { id: string; type: 'openai-compat' | 'anthropic'; baseUrl: string; model: string; params: LLMParams }

// electron/ai/provider.ts —— 统一接口（业务只依赖它）
interface ILLMProvider {
  chatStream(req: ChatRequest, onToken: (t: string) => void, signal?: AbortSignal): Promise<Usage>;
  chat(req: ChatRequest): Promise<{ text: string; usage: Usage }>;
  testConnection(): Promise<ConnectionResult>;
}

// 适配器
openaiCompat.ts   // OpenAI/DeepSeek/OpenRouter/Ollama/Moonshot…（/chat/completions 流式）
anthropic.ts      // Claude messages API（流式 SSE）
```

- **错误模型**：`AuthError / RateLimitError / NetworkError / ContextLengthError / UnknownError` → 统一错误码经 IPC 返回 renderer，界面显示中文可读提示（FR-12）。
- **IPC 桥（preload 暴露最小面）**：
  - `ai.chatStream(session)` — 启动流式对话（事件回传 token 块）
  - `ai.testConnection()`、`ai.cancel()`
  - `store.getProviders() / setProvider() / clearKey()` — 密钥读写仅在 main（safeStorage 加解密后存 SQLite settings，字段加密）
- **模型清单**：内置各厂商常用模型表（OpenAI/Claude/DeepSeek 等），下拉选择 + 手动输入（参考 Cherry Studio 的 provider 目录）。
- **调用记录**：main 进程每次调用完成后 `POST /api/ai/messages` 落库（FR-24 可追踪）。

## 6. AI Context 方案（v1.1：组装移到 TS 侧）

`electron/ai/contextBuilder.ts`：数据经 REST 从后端拉取（章节元数据、高亮、动机、历史 Journal 摘要），组装 prompt；**原则：不把整本书发给模型**。

| 层 | 内容 | 预算（tokens） |
|---|---|---|
| System | 伴读角色 + 交互原则（P1~P8）+ 输出格式约束 | ≤ 800 |
| Reader Profile | 阅读动机摘要 + 长期偏好 + 已纠正误解 | ≤ 500 |
| 当前章节 | 章节正文（epub.js 导出文本，按预算截断：开头 + 高亮段落优先） | ≤ 3000 |
| Previous Reflections | 本书历史 Journal 摘要（每章 ≤ 80 tokens，>5 章取最近+首章） | ≤ 500 |
| 对话历史 | 当前会话最近 N 轮（>6 轮压缩） | ≤ 2000 |
| 输出指令 | 来源标记要求 + 本次任务（提问/分析/对照/报告） | ≤ 300 |
| **合计** | **≈ 7k tokens/次**（适配 8k 上下文模型） | |

- **超长章节**：截断 + 高亮段落优先；必要时快速模型做"要点摘要"缓存到 book_memories。
- **可配置**：设置页"发送给 AI 的内容范围"开关（默认：章节+动机+高亮/笔记；可选含全书摘要）——NFR-05。
- **Prompt 模板库**（TS 侧）：`interview / reflect_questions / follow_up / author_position / book_report` 五类；结构化输出场景用 JSON Schema 约束 + 解析失败重试一次 + 降级人工编辑（FR-14）。

## 7. 阅读前访谈流程（状态机，执行于 TS 侧 sessions.ts）

```text
         ┌────────────────────────────────────────────┐
         ▼                                            │
[OPEN] → [INTRO]  AI: "是什么让你想读这本书?"          │
         ▼                                            │
    [MOTIVATION]  用户答 → AI 基于上一答追问            │
         ▼                                            │
    [EXPECTED_GAIN] "你希望获得解决方案, 还是理解自己?" │
         ▼                                            │
    [TOPICS]      "最想深入读哪部分?"                  │
         ▼                                            │
    [QUESTIONS]   "阅读前最想弄清的问题?"              │
         ▼                                            │
    [GENERATE]    AI 结构化输出 ReadingIntent JSON     │
         ▼                                            │
    [DONE]        经 REST 保存(版本化) → 详情页展示/编辑 └── 重新访谈 → [OPEN]
```

- 状态与对话历史持久化经后端（reading_intents.status + ai_messages），重启可续（FR-13）。
- **跳过入口**：INTRO 阶段"跳过访谈" → 直接 DONE（意图为空，不影响后续流程）。
- AI 不介绍书籍内容，只围绕动机提问（FR-13 验收）。

## 8. 章节伴读流程（状态机，执行于 TS 侧）

```text
[阅读中] → 点击「读完本章」（epub.js 当前位置 → 记录）
   ▼
[Q1 提问] AI 基于(本章内容+动机+高亮+笔记)提出第 1 问（感受层）
   ▼ 用户回答
[追问循环] AI 输出"提问文本+action(追问/下一问/结束)" → 追问≤3轮
   ▼ 回答完成
[下一问] 第 2 问（理解层）→ 第 3 问（联系自己层）      ← 1~3 问，AI 按内容决定
   ▼ 用户点「我思考完了」或追问耗尽
[作者原意分析] AI 输出: 核心观点/论据/论证/隐含前提/结论 [BOOK]
   ▼
[对照] 结构化输出四类: 一致/部分一致/理解偏差/合理分歧
   ▼
[Journal 生成] 组装 ChapterJournal → 经 REST 落库 → 展示 → 用户可编辑最终想法
   ▼
[返回阅读] 进度+1 章 → 最后一章 → 「我与这本书」
```

- **状态持久化**：reflection session（步骤 + 对话引用）存后端，重启可恢复（FR-15）。
- **追问机控**：AI 输出带 `action` 字段，流程不失控（FR-16 上限 3 轮）。
- **合理分歧保护**：对照模板显式注入"理解正确但不同意 → 合理分歧，不得描述为错误"（P3），3 组固定样例单测验证（FR-17）。
- **来源标记**：[BOOK]/[AI] 标注；无 [AUTHOR]/[COMMUNITY] 数据时不得输出（P4、FR-20）。

## 9. 数据库 Schema（SQLite）

> SQLAlchemy 2.x 声明式模型；MVP 用 `metadata.create_all` 建表（需求出现演进时再引 Alembic）。

| 表 | 关键字段与约束 |
|---|---|
| books | title, author, cover_path, format, file_path, fingerprint UNIQUE, status, progress_cfi, current_chapter_id, created_at |
| chapters | book_id FK INDEX, idx, toc_title, chapter_cfi, word_count, toc_level, created_at —— 正文不落库（epub.js 读原文件） |
| reading_intents | book_id FK UNIQUE(book, version), motivation, expected_gain, interested_topics, personal_questions, emotional_context, status, created_at |
| highlights | book_id FK, chapter_id FK, cfi_start, cfi_end, selected_text, color, note, created_at；INDEX(chapter_id) |
| notes | book_id FK, chapter_id FK, cfi(可空), content, created_at, updated_at |
| bookmarks | book_id FK, chapter_id FK, cfi, created_at |
| chapter_journals | book_id FK, chapter_id FK, reading_seconds, reader_feeling, reader_understanding, reader_questions, ai_feedback, author_position_json, agreement_level, disagreement, misunderstanding, changed_mind, final_thought, status, created_at, updated_at |
| book_reports | book_id FK, version, sections_json, trajectory_json, user_edits_json, created_at |
| ai_messages | session_key, role, content, source_tag, provider, model, prompt_tokens, completion_tokens, latency_ms, created_at；INDEX(session_key, created_at) |
| reader_memories | category, content_json, source, updated_at |
| settings | key PK, value_json, updated_at —— AI 配置存此（**Key 经 safeStorage 加密后存此**） |

## 10. UI 页面结构（React 组件化）

| 页面 | 路由 | 内容 |
|---|---|---|
| Library 书架 | `/library` | 书籍卡片网格（封面/书名/进度）、导入对话框、最近阅读置顶 |
| Book Detail | `/book/:id` | 封面+元数据、阅读意图卡（含"重新访谈"）、目录树、"开始/继续阅读"、完成状态 |
| Reader 阅读器 | `/reader/:bookId` | 三栏：左目录（可折叠）｜中 epub.js 正文｜右伴读面板（默认隐藏）；顶栏：书名/章节/进度/设置；正文选区工具条（高亮/笔记）；底部「读完本章」 |
| Reflection 伴读 | Reader 右栏内 | 反思步骤指示器、流式对话（来源标记）、追问循环、「我思考完了」 |
| Journal 章节记录 | `/book/:id/journal/:chapterId` | 我的理解/感受/疑问、AI 反馈、作者立场、一致程度、最终想法（可编辑） |
| Book Report | `/book/:id/report` | 10 项报告 + 思想轨迹时间线 + 重新生成/编辑 |
| Archive 档案 | `/archive` | 我的想法（全部最终想法）、我的问题、主题标签 |
| Settings 设置 | `/settings` | AI：Provider 类型/Base URL/Model/参数/Key（掩码，仅 main 可见明文）/测试连接/上下文范围；阅读：字体/行距/主题 |

**布局与视觉**（P6、"安静、沉浸、克制"）：三栏布局如 v1.0；CSS 变量驱动三套主题（light/sepia/dark）；epub.js 正文排版样式独立。组件化：工具条、模态框、标注列表、设置面板。

## 11. MVP 任务拆解（WBS）

与 `00-项目管理/项目计划.md` 第 4 节 20 步一一对应：

- **阶段 A 骨架**：01 仓库结构（monorepo）／ 02 后端骨架+SQLite ／ 03 Electron 壳 + Vite/React 骨架 + 前后端/主进程三通
- **阶段 B 书籍**：04 EPUB 元数据解析(+单测) ／ 05 导入入库+书架列表 ／ 06 书籍详情+目录树
- **阶段 C 阅读器**：07 epub.js 集成与正文渲染 ／ 08 阅读器布局+导航+进度 ／ 09 阅读设置 ／ 10 高亮+笔记+书签（CFI）
- **阶段 D AI 基础设施**：11 Provider 层（TS，Cherry Studio 式，+单测）／ 12 配置页+密钥安全存储 ／ 13 Context 组装+流式对话通道
- **阶段 E 伴读闭环**：14 阅读前访谈 ／ 15 章节完成 AI 提问 ／ 16 动态追问 ／ 17 作者原意对照+Journal
- **阶段 F 全书闭环**：18 「我与这本书」 ／ 19 阅读档案首页 ／ 20 端到端验收+打磨

## 12. 任务依赖关系

```text
01 → 02 → 03 ─┬─→ 04 → 05 → 06 ─┬─→ 07 → 08 → 09 → 10
              │                  │
              │                  └──（07 依赖 04 的元数据 + 05 的文件管理）
              └─→ 11 → 12 → 13 ─┼───────────────┼─→ 14 → 15 → 16 → 17
                                 │               │
                                 └──（11/12 与 B/C 链并行；13 依赖 12）│
                                                                     ↓
                                           18 → 19 → 20（依赖 17 完成）
```

- B 链（04~06）与 D 链（11~13）**可并行**（单人开发按排期顺序推进）。
- C 链（07~10）依赖 05 完成（有书可读）；与 D 链并行。
- E 链（14~17）依赖 13（AI 通道）与 15 依赖 14（访谈数据进上下文）。
- F 链（18~20）依赖 17。任意时刻主干可运行（每步 DoD）。

## 13. 使用成熟第三方库的部分（v1.1）

| 库 | 用途 | 参考来源 |
|---|---|---|
| **electron** | 桌面壳（main/preload/renderer） | Cherry Studio、Koodo |
| **react + typescript + vite** | 前端框架与构建 | Readest、Cherry Studio |
| **epub.js** | EPUB 渲染、分页、CFI 锚点 | Readest、Koodo Reader（直接参考其用法） |
| **ebooklib** | EPUB 元数据/目录解析（Python） | — |
| **fastapi + uvicorn** | 数据服务与静态托管 | — |
| **sqlalchemy 2.x** | ORM | — |
| **pytest** | Python 单测 | — |
| **vitest** | TS 侧单测（Provider/Context/状态机） | — |
| **electron-builder** | 打包 | Koodo、Cherry Studio |
| 可选 | UI 组件库（如 Ant Design / 或原生 CSS） | 保持简单优先，MVP 可用原生 CSS |

## 14. 自己实现的部分（v1.1：只做产品灵魂与薄胶水）

| 部分 | 为什么自研 | 参考 |
|---|---|---|
| AI Provider 适配器（openai-compat / anthropic） | 用户重选：TS 层参考 Cherry Studio 模式；不引入厂商 SDK 依赖（想法原则 4） | **Cherry Studio 的 provider 层设计** |
| Prompt 模板库 + Context 组装 | 产品灵魂（先问后答/追问/对照规则）必须完全可控 | — |
| 访谈/反思状态机（TS sessions.ts） | 核心业务流程，需持久化与恢复 | — |
| epub.js 交互封装（高亮/笔记/书签/进度） | epub.js 提供渲染与 CFI，但 UI 交互层需自建 | **Koodo Reader 的高亮实现** |
| Journal /「我与这本书」组装 | 结构化输出解析 + 用户编辑合并 | — |
| Electron 生命周期编排（拉起/关闭 Python 子进程、IPC 桥） | electron 不提供，需自写 | Cherry Studio 的进程管理思路 |

## 15. 明确推迟到后续版本的功能

| 功能 | 推迟理由 | 计划版本 |
|---|---|---|
| PDF 导入 | 需求明确一期只做 EPUB（pdf.js 方案已成熟，届时参考 Thorium） | v1.1 |
| 其他读者观点（网络资料聚合） | 依赖搜索 Provider，需设计数据真实性机制 | v2 |
| 作者公开观点（Author Context） | 同上 | v2 |
| 跨书知识图谱 | 需数据积累，MVP 无意义 | v2+ |
| 多 Agent 架构 | MVP 保持单 AI Service（想法文档第 19 节） | v2+ |
| Embedding + 向量检索 | MVP 用"章节+高亮+摘要"策略已够 | v1.5 |
| 云同步 | 单机定位，需账号体系 | 未知 |
| 移动端 | 平台拓展，大成本 | 未知 |
| 本地大模型（Ollama 深度适配） | openai-compat 已天然支持 Ollama，仅需文档 | v1.1 |
| 语音伴读 / OCR | 依赖额外 Provider | 未知 |

---

## 附：开工前确认清单（v1.1）

- [ ] 技术栈（Electron + React/TS + epub.js + Python FastAPI + SQLite + TS 侧 Provider）确认无异议
- [ ] 进程模型与职责划分（智能层在 Electron main，数据层在 Python）确认
- [ ] 数据模型与 9 个核心表确认（正文不落库，epub.js 直读原文件）
- [ ] Context 预算（~7k tokens/次）与截断策略确认
- [ ] 状态机（访谈/反思）流程确认
- [ ] 20 步任务拆解与依赖关系确认
- [ ] 确认后：进入步骤 01，每步完成即按 DoD 验收
