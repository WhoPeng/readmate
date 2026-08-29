/**
 * 伴读面板（步骤 14-17 核心）：阅读前访谈 + 章节反思（苏格拉底式对话）。
 *
 * 状态机（执行于 renderer，AI 调用经 main 进程）：
 *   访谈：idle → ai_asking → user_waiting → … → analyzing(生成意图) → done
 *   反思：idle → ai_asking(提问) → user_waiting → ai_followup → … → analyzing(作者对照) → done
 *
 * 核心原则（P1~P8）由 Prompt 模板保证：先问后答 / 追问 / 合理分歧≠错误 / 来源标记。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BookDto, ChapterJournalDto, ReadingIntentDto } from '../api/types'
import { api } from '../api/client'
import { buildChatMessages, fetchReaderContext } from '../ai/contextBuilder'
import { AUTHOR_POSITION_SYSTEM, INTERVIEW_SYSTEM, REFLECT_QUESTIONS_SYSTEM } from '../ai/prompts'
import { extractJson, useAiChat } from '../hooks/useAiChat'
import type { ChatMessage } from '../../../shared/types'

export type ReflectionMode = 'interview' | 'reflect'

type FlowStep = 'idle' | 'ai_asking' | 'user_waiting' | 'analyzing' | 'done' | 'error'

interface PersistedSession {
  mode: ReflectionMode
  messages: ChatMessage[]
  qCount: number
  followUps: number
  step: FlowStep
  bookId: number
  chapterId?: number
}

interface Props {
  book: BookDto
  mode: ReflectionMode
  chapterId?: number
  onDone: (kind: 'intent' | 'journal' | 'skipped', data?: unknown) => void
}

const MAX_QUESTIONS = 5 // 访谈
const MAX_FOLLOW_UPS = 3

function sessionKey(mode: ReflectionMode, bookId: number, chapterId?: number) {
  return `rm_session_${mode}_${bookId}_${chapterId ?? ''}`
}

export default function ReflectionPanel({ book, mode, chapterId, onDone }: Props) {
  const { chatStream, cancel } = useAiChat('opencode')
  const [step, setStep] = useState<FlowStep>('idle')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [qCount, setQCount] = useState(0)
  const [followUps, setFollowUps] = useState(0)
  const [error, setError] = useState('')
  const [journal, setJournal] = useState<ChapterJournalDto | null>(null)
  const [intent, setIntent] = useState<ReadingIntentDto | null>(null)
  const [finalThought, setFinalThought] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const latestMessages = useRef<ChatMessage[]>([])
  latestMessages.current = messages

  const persist = useCallback((m: ChatMessage[], s: FlowStep) => {
    const data: PersistedSession = { mode, messages: m, qCount, followUps, step: s, bookId: book.id, chapterId }
    localStorage.setItem(sessionKey(mode, book.id, chapterId), JSON.stringify(data))
  }, [mode, book.id, chapterId, qCount, followUps])

  const appendMsg = useCallback((role: ChatMessage['role'], content: string): ChatMessage[] => {
    const next: ChatMessage[] = [...latestMessages.current, { role, content }]
    latestMessages.current = next
    setMessages(next)
    return next
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const reset = useCallback(() => {
    localStorage.removeItem(sessionKey(mode, book.id, chapterId))
    setMessages([])
    setStep('idle')
    setQCount(0)
    setFollowUps(0)
    setError('')
    setJournal(null)
    setIntent(null)
  }, [mode, book.id, chapterId])

  const finish = useCallback(
    (s: FlowStep, m: ChatMessage[]) => {
      setStep(s)
      persist(m, s)
    },
    [persist],
  )

  /** AI 流式回复（自动追加消息 + 落库记录） */
  const askAi = useCallback(
    async (msgs: ChatMessage[], scene: string, onToken?: (t: string) => void) => {
      const result = await chatStream(msgs, onToken)
      if (!result.ok) {
        setError(result.error ?? 'AI 调用失败')
        setStep('error')
        return null
      }
      const next = [...msgs, { role: 'assistant' as const, content: result.full }]
      latestMessages.current = next
      setMessages(next)
      api
        .recordAiMessage({
          session_key: `${scene}:${book.id}:${chapterId ?? 0}`,
          role: 'assistant',
          content: result.full.slice(0, 2000),
          source_tag: '[AI]',
        })
        .catch(() => undefined)
      return result.full
    },
    [chatStream, book.id, chapterId],
  )

  // ============ 阅读前访谈 ============
  const startInterview = useCallback(async () => {
    setStep('ai_asking')
    const ctx = await fetchReaderContext(book.id)
    const sys = buildChatMessages('interview', ctx, INTERVIEW_SYSTEM)
    const msgs: ChatMessage[] = [...sys, { role: 'user', content: '我们开始吧。' }]
    const aiText = await askAi(msgs, 'interview')
    if (aiText === null) return
    setStep('user_waiting')
  }, [book.id, askAi])

  const sendInterviewAnswer = useCallback(
    async (answer: string) => {
      const msgs = appendMsg('user', answer)
      setStep('ai_asking')
      api.recordAiMessage({ session_key: `interview:${book.id}:0`, role: 'user', content: answer.slice(0, 1000), source_tag: '[READER]' }).catch(() => undefined)

      // 第 5 问之后：强制要求结构化输出意图
      const forceJson = qCount >= MAX_QUESTIONS - 1
      const promptMsgs: ChatMessage[] = [
        ...msgs,
        {
          role: 'user' as const,
          content: forceJson
            ? '访谈已足够。现在请直接输出完整的 ReadingIntent JSON（字段：motivation, expected_gain, interested_topics, personal_questions, emotional_context），不要其他内容。'
            : '',
        },
      ].filter((m) => m.content !== '')
      const aiText = await askAi(promptMsgs, 'interview')
      if (aiText === null) return

      const parsed = extractJson<Partial<ReadingIntentDto>>(aiText)
      if (parsed && (parsed.motivation || parsed.expected_gain || parsed.interested_topics)) {
        // 保存意图（FR-14）
        try {
          const saved = await api.saveIntent(book.id, {
            motivation: parsed.motivation ?? '',
            expected_gain: parsed.expected_gain ?? '',
            interested_topics: parsed.interested_topics ?? '',
            personal_questions: parsed.personal_questions ?? '',
            emotional_context: parsed.emotional_context ?? '',
            status: 'completed',
          })
          setIntent(saved)
          finish('done', latestMessages.current)
          onDone('intent', saved)
          return
        } catch (e) {
          setError(e instanceof Error ? e.message : '意图保存失败')
        }
      }
      setQCount((c) => c + 1)
      if (qCount + 1 >= MAX_QUESTIONS) {
        // 最后一轮仍未解析出 JSON：提示用户结束
        appendMsg('assistant', '我已经了解你的阅读意图了。你可以点「完成访谈」，我会整理记录。')
        finish('user_waiting', latestMessages.current)
        setStep('user_waiting')
      } else {
        setStep('user_waiting')
      }
    },
    [appendMsg, askAi, book.id, finish, qCount, onDone],
  )

  const skipInterview = useCallback(async () => {
    try {
      await api.saveIntent(book.id, { status: 'skipped' })
    } catch {
      /* 忽略 */
    }
    localStorage.removeItem(sessionKey('interview', book.id))
    onDone('skipped')
  }, [book.id, onDone])

  // ============ 章节反思 ============
  const startReflect = useCallback(async () => {
    if (!chapterId) return
    setStep('ai_asking')
    const ctx = await fetchReaderContext(book.id, chapterId)
    const sys = buildChatMessages('reflect_questions', ctx, REFLECT_QUESTIONS_SYSTEM)
    const msgs: ChatMessage[] = [...sys, { role: 'user', content: '我读完了这一章，我们开始吧。' }]
    const aiText = await askAi(msgs, 'reflect_q')
    if (aiText === null) return
    setQCount(1)
    setStep('user_waiting')
  }, [book.id, chapterId, askAi])

  const sendReflectAnswer = useCallback(
    async (answer: string) => {
      const msgs = appendMsg('user', answer)
      setStep('ai_asking')
      api.recordAiMessage({ session_key: `reflect:${book.id}:${chapterId}`, role: 'user', content: answer.slice(0, 1000), source_tag: '[READER]' }).catch(() => undefined)

      // 追问判定：AI 输出 {action, question}
      const followMsgs: ChatMessage[] = [
        ...msgs,
        {
          role: 'user',
          content: '（请根据上述对话判定下一步：若需继续追问输出 {"action":"follow_up","question":"追问"}；若本章问题已讨论充分输出 {"action":"finish","question":"提示"}；若还有更高层次问题未问输出 {"action":"next_question","question":"新问题"}。只输出 JSON。）',
        },
      ]
      const aiText = await askAi(followMsgs, 'reflect_follow')
      if (aiText === null) return

      const parsed = extractJson<{ action?: string; question?: string }>(aiText)
      const action = parsed?.action ?? (followUps >= MAX_FOLLOW_UPS ? 'finish' : 'follow_up')

      if (action === 'finish' || followUps >= MAX_FOLLOW_UPS) {
        await analyzeChapter()
        return
      }
      setFollowUps((f) => f + 1)
      setStep('user_waiting')
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appendMsg, askAi, book.id, chapterId, followUps],
  )

  /** 用户表达完成 → 作者原意分析 + 对照 → 生成 Journal（步骤 17） */
  const analyzeChapter = useCallback(async () => {
    if (!chapterId) return
    setStep('analyzing')
    const ctx = await fetchReaderContext(book.id, chapterId)
    const sys = buildChatMessages('author_position', ctx, AUTHOR_POSITION_SYSTEM)
    const msgs: ChatMessage[] = [
      ...sys,
      ...latestMessages.current.filter((m) => m.role !== 'system'),
      { role: 'user', content: '我已经表达完了我的想法，请分析作者原意并对照我的理解。' },
    ]
    const aiText = await askAi(msgs, 'reflect_analysis')
    if (aiText === null) return

    const parsed = extractJson<{
      core_claim?: string
      evidence?: string[]
      reasoning?: string
      premises?: string[]
      conclusion?: string
      agreement_level?: string
      misunderstanding?: string
      disagreement?: string
      ai_feedback?: string
      final_question?: string
    }>(aiText)

    if (!parsed) {
      setError('AI 分析格式异常，请重试或稍后再试')
      setStep('error')
      return
    }

    const journalPayload = {
      chapter_id: chapterId,
      reader_feeling: '',
      reader_understanding: '',
      reader_questions: parsed.final_question ?? '', // AI 留给读者的思考问题 → 我的问题列表
      ai_feedback: parsed.ai_feedback ?? '',
      author_position: {
        core_claim: parsed.core_claim ?? '',
        evidence: (parsed.evidence ?? []).join('；'),
        reasoning: parsed.reasoning ?? '',
        premises: (parsed.premises ?? []).join('；'),
        conclusion: parsed.conclusion ?? '',
      },
      agreement_level: parsed.agreement_level ?? '',
      misunderstanding: parsed.misunderstanding ?? '',
      disagreement: parsed.disagreement ?? '',
      changed_mind: '',
      final_thought: '',
      status: 'completed',
    }
    try {
      const saved = await api.saveJournal(book.id, journalPayload)
      setJournal(saved)
      finish('done', latestMessages.current)
      onDone('journal', saved)
    } catch (e) {
      setError(e instanceof Error ? e.message : '记录保存失败')
      setStep('error')
    }
  }, [book.id, chapterId, askAi, finish, onDone])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || step !== 'user_waiting') return
    setInput('')
    if (mode === 'interview') await sendInterviewAnswer(text)
    else await sendReflectAnswer(text)
  }, [input, step, mode, sendInterviewAnswer, sendReflectAnswer])

  // 启动：根据模式进入流程
  useEffect(() => {
    if (mode === 'interview') startInterview()
    else startReflect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const isAsking = step === 'ai_asking' || step === 'analyzing'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
        <b>{mode === 'interview' ? '阅读前访谈' : '章节反思'}</b>
        <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
          {mode === 'interview' ? `第 ${Math.min(qCount + 1, MAX_QUESTIONS)} 问` : `问题 ${qCount}/3`}
        </span>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages
          .filter((m) => m.role !== 'system')
          .map((m, i) => (
            <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 12,
                  background: m.role === 'user' ? 'var(--accent)' : 'var(--bg-panel)',
                  color: m.role === 'user' ? '#fff' : 'var(--fg)',
                  border: m.role === 'user' ? 'none' : '1px solid var(--border)',
                  fontSize: 13.5,
                  lineHeight: 1.7,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {m.content}
              </div>
            </div>
          ))}
        {isAsking && <div className="muted" style={{ fontSize: 12 }}>思考中…</div>}
        {journal && (
          <div className="card" style={{ marginTop: 8, fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>本章阅读记录</div>
            {journal.agreement_level && (
              <div style={{ marginBottom: 6 }}>
                对照结论：<b>{journal.agreement_level}</b>
              </div>
            )}
            {journal.author_position?.core_claim && (
              <div className="muted" style={{ marginBottom: 6 }}>
                作者核心观点 [BOOK]：{String(journal.author_position.core_claim)}
              </div>
            )}
            {journal.disagreement && (
              <div className="muted" style={{ marginBottom: 6 }}>你的分歧：{journal.disagreement}</div>
            )}
            {journal.ai_feedback && (
              <div className="muted" style={{ marginBottom: 6 }}>AI 反馈 [AI]：{journal.ai_feedback}</div>
            )}
            <div style={{ marginTop: 8 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>我的最终想法（可编辑）</div>
              <textarea
                style={{ width: '100%', minHeight: 60 }}
                value={finalThought}
                placeholder="记录你此刻对本章的最终理解…"
                onChange={(e) => setFinalThought(e.target.value)}
              />
              <button
                className="primary"
                style={{ marginTop: 6 }}
                disabled={!finalThought.trim()}
                onClick={async () => {
                  if (journal) {
                    await api.saveJournal(book.id, { chapter_id: journal.chapter_id, final_thought: finalThought.trim(), status: 'completed' })
                    onDone('journal', journal)
                  }
                }}
              >
                保存最终想法
              </button>
            </div>
          </div>
        )}
        {intent && (
          <div className="card" style={{ marginTop: 8, fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>阅读意图已生成 ✅</div>
            {intent.motivation && <div className="muted">动机：{intent.motivation}</div>}
            {intent.expected_gain && <div className="muted">期待：{intent.expected_gain}</div>}
            {intent.interested_topics && <div className="muted">关注：{intent.interested_topics}</div>}
          </div>
        )}
        {error && (
          <div style={{ color: '#c96a5f', fontSize: 13, padding: 8 }}>
            {error}
            <button style={{ marginLeft: 8, fontSize: 12 }} onClick={reset}>重新开始</button>
          </div>
        )}
      </div>

      <div style={{ padding: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
        {step === 'user_waiting' && (
          <>
            <input
              style={{ flex: 1 }}
              placeholder={mode === 'interview' ? '回答 AI 的问题…' : '表达你对这一章的思考…'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              disabled={isAsking}
            />
            <button className="primary" onClick={sendMessage} disabled={isAsking || !input.trim()}>
              发送
            </button>
            {mode === 'reflect' && (
              <button onClick={analyzeChapter} disabled={isAsking} title="不再讨论，直接生成作者对照分析">
                我思考完了
              </button>
            )}
          </>
        )}
        {step === 'idle' && mode === 'interview' && <button onClick={skipInterview}>跳过访谈</button>}
        {isAsking && <button onClick={cancel}>停止</button>}
        {step === 'done' && <button onClick={reset}>再来一次</button>}
      </div>
    </div>
  )
}
