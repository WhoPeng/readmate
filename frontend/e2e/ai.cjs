/**
 * AI 层 E2E（步骤 11-13 验收）：
 * 1. 设置页 UI 存在（Provider 选择/Key/测试连接）
 * 2. 经 preload IPC 保存 Provider（Key 走 safeStorage 加密）
 * 3. 测试连接（真实调用 Anthropic API，Key 从环境变量读取，不落任何文件）
 * 4. 流式对话走通 + ai_messages 落库（FR-24）
 * 前置：后端 8000 + Vite 5173 运行中；环境变量 ANTHROPIC_API_KEY 已设置
 */
const { _electron } = require('playwright-core')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const VITE = 'http://localhost:5173'
const ELECTRON_EXE = path.join(ROOT, 'electron', 'node_modules', 'electron', 'dist', 'electron.exe')
const API_KEY = process.env.ANTHROPIC_API_KEY

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
  if (!API_KEY) {
    console.log('⚠️ 未设置 ANTHROPIC_API_KEY，跳过真实 API 验证（仅验证 UI 与 IPC 层）')
  }

  const app = await _electron.launch({ executablePath: ELECTRON_EXE, args: ['.'], cwd: path.join(ROOT, 'electron') })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.goto(`${VITE}/#/settings`)
  await win.waitForTimeout(1500)

  // 1. 设置页 UI
  const hasProviderBtn = await win.evaluate(() =>
    [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Anthropic')),
  )
  check('设置页显示 Anthropic 选项', hasProviderBtn)

  // 2. 保存 Provider（走真实 IPC + safeStorage 加密；Key 仅来自环境变量）
  const saved = await win.evaluate(async (key) => {
    const cfg = {
      id: 'opencode',
      type: 'openai-compat',
      label: 'OpenCode 网关',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      model: 'deepseek-v4-pro',
      temperature: 0.7,
      models: ['deepseek-v4-pro'],
    }
    await window.readmate.store.saveProvider(cfg, key || 'placeholder-key-for-test')
    const list = await window.readmate.store.listProviders()
    const has = await window.readmate.store.hasKey('opencode')
    return { count: list.length, hasKey: has }
  }, API_KEY)
  check('Provider 保存成功（IPC + 后端 settings）', saved.count >= 1 && saved.hasKey, JSON.stringify(saved))

  // 3. 密钥不明文落库（搜索后端 settings）
  const settings = await fetch('http://127.0.0.1:8000/api/settings').then((r) => r.json())
  const stored = JSON.stringify(settings)
  check('数据库中无明文 Key', !stored.includes(API_KEY || 'placeholder-key-for-test'), '已加密存储')

  // 4. 测试连接（真实 API 调用）
  if (API_KEY) {
    const result = await win.evaluate(() => window.readmate.ai.testConnection('opencode'))
    check('测试连接成功（真实网关 API）', result.ok === true, JSON.stringify(result).slice(0, 120))
  }

  // 5. 流式对话 + ai_messages 落库（FR-24）
  if (API_KEY) {
    const usage = await win.evaluate(
      () =>
        window.readmate.ai.chatStream(
          {
            providerId: 'opencode',
            sessionKey: 'e2e:test:1',
            messages: [
              { role: 'system', content: '你只回复"伴读测试通过"五个字。' },
              { role: 'user', content: '测试' },
            ],
          },
          () => undefined,
        ),
    )
    check('流式调用返回 usage', !!usage && usage.model.includes('deepseek'), JSON.stringify(usage).slice(0, 100))
    await new Promise((r) => setTimeout(r, 800))
    const msgs = await fetch('http://127.0.0.1:8000/api/ai/messages?session_key=e2e:test:1').then((r) => r.json())
    check('AI 调用已记录（ai_messages）', msgs.length >= 1 && msgs[0].provider === 'OpenCode 网关' && msgs[0].source_tag === '[AI]', `记录 ${msgs.length} 条`)
  }

  await app.close()
  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('E2E 异常:', e.message)
  process.exit(1)
})
