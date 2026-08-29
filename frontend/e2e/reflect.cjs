/**
 * 伴读闭环 E2E（步骤 14-17 验收，真实 API）：
 * 1. 新书打开 → 自动启动阅读前访谈 → 对话数轮 → ReadingIntent 落库
 * 2. 「读完本章」→ 章节反思 → 回答 → 我思考完了 → 作者对照分析 → Journal 落库
 * 前置：后端 + Vite 运行；OpenCode provider 已配置（ai.cjs 执行过）；测试书无 intent
 */
const { _electron } = require('playwright-core')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const VITE = 'http://localhost:5173'
const ELECTRON_EXE = path.join(ROOT, 'electron', 'node_modules', 'electron', 'dist', 'electron.exe')

let passed = 0
let failed = 0
function check(name, cond, extra = '') {
  if (cond) {
    passed++
    console.log(`  ✅ ${name}`)
  } else {
    failed++
    console.log(`  ❌ ${name} ${extra}`)
  }
}

async function waitFor(win, fn, timeout = 90000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await win.evaluate(fn)) return true
    await new Promise((r) => setTimeout(r, 1500))
  }
  return false
}

async function sendAnswer(win, text) {
  // 等待输入框可用（user_waiting）
  const ready = await waitFor(win, () => {
    const input = document.querySelector('.epub-viewer, .app-shell') // no-op
    const panel = document.querySelector('input[placeholder*="回答"]') || document.querySelector('input[placeholder*="表达"]')
    return !!panel
  })
  if (!ready) return false
  await win.fill('input[placeholder*="回答"], input[placeholder*="表达"]', text)
  await win.keyboard.press('Enter')
  return true
}

async function main() {
  const app = await _electron.launch({ executablePath: ELECTRON_EXE, args: ['.'], cwd: path.join(ROOT, 'electron') })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  // ============ 阶段一：阅读前访谈 ============
  console.log('阶段一：阅读前访谈（真实 API）')
  await win.goto(`${VITE}/#/reader/1`)
  const interviewStarted = await waitFor(win, () => document.body.innerText.includes('阅读前访谈'), 60000)
  check('访谈自动启动（FR-13）', interviewStarted)

  if (interviewStarted) {
    // 等 AI 第一问（流式完成，面板出现"回答"输入框）
    const firstQ = await waitFor(win, () => {
      const t = document.body.innerText
      return t.includes('阅读前访谈') && (t.includes('？') || t.includes('?'))
    }, 150000)
    check('AI 提出第一问', firstQ)

    // 循环回答（最多 5 轮），每轮等 AI 回复完成后再答
    const answers = [
      '我想理解自己为什么总是拖延',
      '我希望获得对拖延原因的理解，而不是简单的行动建议',
      '我特别关注行为、逃避和不确定性这几个主题',
      '我想知道逃避和拖延是不是一回事',
      '我已经说完了，请整理我的阅读意图',
    ]
    for (const answer of answers) {
      // 等待输入框可用（AI 回复完成）
      const ready = await waitFor(
        win,
        () => !!document.querySelector('input[placeholder*="回答"]'),
        150000,
      )
      if (!ready) break
      await win.fill('input[placeholder*="回答"]', answer)
      await win.keyboard.press('Enter')
      // 等 AI 回复完成（思考中消失 + 输入框再次可用）
      await waitFor(win, () => !document.body.innerText.includes('思考中…'), 150000)
    }
  }

  // 访谈完成 → 意图落库（轮询后端）
  const intentSaved = await waitFor(
    win,
    () =>
      fetch('http://127.0.0.1:8000/api/books/1/intent')
        .then((r) => r.json())
        .then((i) => i && i.status === 'completed'),
    180000,
  )
  check('ReadingIntent 落库（FR-14）', intentSaved)

  // ============ 阶段二：章节反思 ============
  console.log('阶段二：章节反思（真实 API）')
  // 重新打开阅读器（访谈已完成，不再自动弹）
  await win.goto(`${VITE}/#/reader/1`)
  await waitFor(win, () => document.querySelector('iframe')?.contentDocument?.body?.innerText?.includes('正文段落'), 60000)

  // 打开伴读面板（访谈已完成不会自动弹，手动点）
  const hasReflectBtn = await win.evaluate(() =>
    [...document.querySelectorAll('button')].some((b) => b.textContent.includes('读完本章')),
  )
  check('「读完本章」按钮存在（FR-15）', hasReflectBtn)
  if (hasReflectBtn) {
    await win.locator('button:has-text("读完本章")').click()
    const reflectStart = await waitFor(win, () => document.body.innerText.includes('章节反思'), 30000)
    check('反思流程启动', reflectStart)

    // 等 AI 提问
    const aiQuestion = await waitFor(
      win,
      () => {
        const t = document.body.innerText
        return t.includes('章节反思') && t.includes('？') && !t.includes('思考中…')
      },
      150000,
    )
    check('AI 提出反思问题（分层提问）', aiQuestion)

    // 回答 + 等追问/反馈
    await sendAnswer(win, '这一章让我很有共鸣，作者说的逃避心理很像我')
    const followUp = await waitFor(win, () => {
      const t = document.body.innerText
      return !t.includes('思考中…') && t.includes('逃避')
    }, 150000)
    check('AI 动态回应/追问（FR-16）', followUp)

    // 直接"我思考完了" → 作者对照分析
    await win.locator('button:has-text("我思考完了")').click()
    const journalSaved = await waitFor(
      win,
      () =>
        fetch('http://127.0.0.1:8000/api/books/1/journals')
          .then((r) => r.json())
          .then((js) => js.length >= 1 && js[0].status === 'completed'),
      180000,
    )
    check('ChapterJournal 落库（FR-18）', journalSaved)

    // 检查对照结论非空
    const journals = await fetch('http://127.0.0.1:8000/api/books/1/journals').then((r) => r.json())
    check('对照结论存在（FR-17 四分类）', !!journals[0]?.agreement_level, `结论=${journals[0]?.agreement_level}`)
    check('作者原意分析存在', !!journals[0]?.author_position?.core_claim)
  }

  await app.close()
  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('E2E 异常:', e.message)
  process.exit(1)
})
