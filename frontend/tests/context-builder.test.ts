/**
 * Context 组装器单测（步骤 13 验收）：
 * - 章节正文截断预算
 * - 历史 Journal 摘要化
 * - System 组装含用户画像
 * - 访谈场景不注入章节内容
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { buildChatMessages, fetchReaderContext } from '../../electron/ai/contextBuilder'
import { INTERVIEW_SYSTEM, AUTHOR_POSITION_SYSTEM } from '../../electron/ai/prompts'

afterEach(() => vi.restoreAllMocks())

describe('fetchReaderContext', () => {
  it('拉取书籍/高亮/Journal/章节文本并组装上下文数据', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const u = String(url)
      if (u.endsWith('/api/books/1')) {
        return Promise.resolve(new Response(JSON.stringify({
          id: 1, title: '测试之书', author: '作者',
          intent: { motivation: '想理解拖延', expected_gain: '答案' },
          chapters: [{ id: 3, toc_title: '第三章 结论' }],
        })))
      }
      if (u.includes('/highlights')) {
        return Promise.resolve(new Response(JSON.stringify([
          { chapter_id: 3, selected_text: '高亮一' },
          { chapter_id: 2, selected_text: '其他章高亮' },
        ])))
      }
      if (u.includes('/journals')) {
        return Promise.resolve(new Response(JSON.stringify([
          { chapter_id: 2, agreement_level: '部分一致', final_thought: '第二章的想法' },
        ])))
      }
      if (u.includes('/chapters/3/text')) {
        return Promise.resolve(new Response(JSON.stringify({ text: '第三章正文内容' })))
      }
      return Promise.resolve(new Response('{}'))
    }))

    const data = await fetchReaderContext(1, 3)
    expect(data.bookTitle).toBe('测试之书')
    expect(data.intent?.motivation).toBe('想理解拖延')
    expect(data.chapterText).toBe('第三章正文内容')
    expect(data.highlights).toEqual(['高亮一']) // 只含本章
    expect(data.previousJournals?.[0]).toContain('第二章的想法')
  })

  it('章节文本超长时截断', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const u = String(url)
      if (u.endsWith('/api/books/1')) {
        return Promise.resolve(new Response(JSON.stringify({ id: 1, chapters: [{ id: 1, toc_title: 'x' }] })))
      }
      if (u.includes('/highlights') || u.includes('/journals')) return Promise.resolve(new Response('[]'))
      if (u.includes('/text')) return Promise.resolve(new Response(JSON.stringify({ text: '长'.repeat(20000) })))
      return Promise.resolve(new Response('{}'))
    }))
    const data = await fetchReaderContext(1, 1)
    expect(data.chapterText!.length).toBeLessThanOrEqual(6000 + 20)
  })
})

describe('buildChatMessages', () => {
  it('访谈场景：System 含画像，不注入章节内容', () => {
    const messages = buildChatMessages('interview', {
      bookId: 1,
      intent: { motivation: '想理解拖延' },
      chapterText: '绝不应出现的正文',
    }, INTERVIEW_SYSTEM)
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('想理解拖延')
    expect(messages[0].content).not.toContain('绝不应出现的正文')
    expect(messages.length).toBe(1)
  })

  it('反思场景：注入章节正文 + 高亮 + 历史，追加对话历史', () => {
    const messages = buildChatMessages('author_position', {
      bookId: 1,
      chapterTitle: '第一章',
      chapterText: '正文内容',
      highlights: ['高亮一'],
      previousJournals: ['第一章 [一致] 想法'],
      history: [{ role: 'user', content: '我的观点' }],
    }, AUTHOR_POSITION_SYSTEM)
    expect(messages.length).toBe(3) // system + 章节 + 历史
    expect(messages[1].content).toContain('正文内容')
    expect(messages[1].content).toContain('高亮一')
    expect(messages[2].content).toBe('我的观点')
  })
})
