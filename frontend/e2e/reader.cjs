/**
 * E2E 验证脚本：Playwright 驱动 Electron，走通 书架 → 详情 → 阅读器 → 高亮。
 * 前置：后端已启动（8000）、Vite dev（5173）、测试书已导入。
 * 运行：node scripts/e2e-reader.js
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

async function main() {
  console.log('启动 Electron…')
  const app = await _electron.launch({ executablePath: ELECTRON_EXE, args: ['.'], cwd: path.join(ROOT, 'electron') })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  // 1. 书架页
  await win.goto(`${VITE}/#/library`)
  await win.waitForSelector('text=测试之书', { timeout: 15000 })
  check('书架显示测试书', true)

  // 2. 详情页（按钮文字随状态变化：开始/继续/重新阅读）
  await win.goto(`${VITE}/#/book/1`)
  await win.waitForSelector('text=/开始阅读|继续阅读|重新阅读/', { timeout: 10000 })
  check('详情页显示', true)
  const chapterItems = await win.$$eval('.card div', (els) =>
    els.filter((e) => e.textContent && e.textContent.includes('第') && e.textContent.includes('章')).length,
  )
  check('目录章节数量', chapterItems >= 3, `实际 ${chapterItems}`)

  // 3. 阅读器渲染（epub.js，正文在 iframe 内；位置可能恢复自上次阅读）
  await win.goto(`${VITE}/#/reader/1`)
  await win.waitForFunction(
    () => document.querySelector('iframe')?.contentDocument?.body?.innerText?.includes('正文段落'),
    { timeout: 20000 },
  )
  const bodyText = await win.evaluate(() => document.body.innerText)
  const frameText = await win.evaluate(
    () => document.querySelector('iframe')?.contentDocument?.body?.innerText || '',
  )
  check('epub.js 正文渲染（正文段落可见）', /正文段落\d/.test(frameText), frameText.slice(0, 80))
  check('进度条出现（顶栏百分比）', /%/.test(bodyText))

  // 4. 翻页/章节跳转：点目录第三章
  await win.click('text=第三章 结论')
  await win.waitForFunction(
    () => document.querySelector('iframe')?.contentDocument?.body?.innerText?.includes('第3章正文段落'),
    { timeout: 15000 },
  )
  const frameText2 = await win.evaluate(
    () => document.querySelector('iframe')?.contentDocument?.body?.innerText || '',
  )
  check('目录跳转第三章成功', frameText2.includes('第3章正文段落'), frameText2.slice(0, 80))

  // 5. 阅读设置：切夜间模式
  await win.click('text=Aa 设置')
  await win.click('text=夜间')
  const theme = await win.evaluate(() => document.body.dataset.theme)
  check('夜间模式应用', theme === 'dark')
  await win.click('.modal-mask') // 关闭设置弹窗
  await win.waitForTimeout(5000) // 等待主题样式应用完成（epub.js 重排时序）

  // 6. 模拟选中文字 → 高亮（在 iframe 内容文档中构造选区 + 触发 mouseup）
  await win.waitForTimeout(1500) // 等待 rendered 事件完成监听绑定
  await win.evaluate(() => {
    const frame = document.querySelector('.epub-viewer iframe')
    if (!frame) return
    const contentDoc = frame.contentDocument
    if (!contentDoc) return
    const p = Array.from(contentDoc.querySelectorAll('p')).find((x) => x.textContent.includes('第3章正文段落'))
    if (!p) return
    const range = contentDoc.createRange()
    range.selectNodeContents(p)
    const sel = contentDoc.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    contentDoc.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: contentDoc.defaultView }))
  })
  await win.waitForTimeout(800)
  const toolbarVisible = await win.evaluate(
    () => [...document.querySelectorAll('button')].some((b) => b.textContent === '黄'),
  )
  check('选中文字后高亮工具条出现', toolbarVisible)

  // 7. 点黄色高亮 → API 落库（轮询等待落库完成）
  if (toolbarVisible) {
    await win.locator('button:has-text("黄")').first().click({ force: true })
    let hl = []
    for (let i = 0; i < 10 && hl.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 500))
      hl = await fetch('http://127.0.0.1:8000/api/books/1/highlights').then((r) => r.json())
    }
    check('高亮已落库（CFI 锚点）', hl.length >= 1, `实际 ${hl.length}`)
    check('高亮含 CFI', hl[0]?.cfi_start?.startsWith('epubcfi('), hl[0]?.cfi_start)
  }

  // 8. 进度保存
  const progress = await fetch('http://127.0.0.1:8000/api/books/1').then((r) => r.json())
  check('阅读进度已保存（status 非 unread）', progress.status !== 'unread', progress.status)

  await app.close()
  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('E2E 异常:', e)
  process.exit(1)
})
