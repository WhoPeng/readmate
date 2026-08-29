/**
 * 设置页（步骤 12 验收：FR-10/11/12）。
 * AI 配置：多厂商选择 / Base URL / 模型 / Key（safeStorage 掩码）/ 测试连接
 * 阅读偏好：主题/字号默认值（Reader 页实时修改，此处读取展示）
 */
import { useCallback, useEffect, useState } from 'react'
import type { ProviderConfig } from '../../../shared/types'
import { api } from '../api/client'

export default function Settings() {
  const rm = window.readmate
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [defaults, setDefaults] = useState<ProviderConfig[]>([])
  const [editId, setEditId] = useState<string>('')
  const [form, setForm] = useState<ProviderConfig | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)

  const load = useCallback(async () => {
    if (!rm) return
    const [list, defs] = await Promise.all([rm.store.listProviders(), rm.store.defaultProviders()])
    setProviders(list)
    setDefaults(defs)
  }, [rm])

  useEffect(() => {
    load()
  }, [load])

  const pickProvider = async (id: string) => {
    setEditId(id)
    setTestResult(null)
    const saved = providers.find((p) => p.id === id)
    if (saved) {
      setForm({ ...saved })
      setHasKey(await rm!.store.hasKey(id))
    } else {
      const def = defaults.find((p) => p.id === id)
      setForm(def ? { ...def } : null)
      setHasKey(false)
    }
    setApiKey('')
  }

  const save = async () => {
    if (!rm || !form) return
    try {
      await rm.store.saveProvider(form, apiKey || undefined)
      setApiKey('')
      setTestResult({ ok: true, message: '已保存（密钥已加密存储）' })
      await load()
      setHasKey(await rm.store.hasKey(form.id))
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : '保存失败' })
    }
  }

  const testConnection = async () => {
    if (!rm || !editId) return
    setTesting(true)
    setTestResult(null)
    const r = await rm.ai.testConnection(editId)
    setTestResult(r.ok ? { ok: true, message: `连接成功（${r.latencyMs}ms，${r.model ?? ''}）` } : { ok: false, message: r.message ?? '连接失败' })
    setTesting(false)
  }

  const remove = async (id: string) => {
    if (!rm || !confirm('删除该 AI 配置？')) return
    await rm.store.deleteProvider(id)
    if (editId === id) setForm(null)
    setTestResult(null)
    await load()
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>设置</h2>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, marginBottom: 10 }}>AI 模型配置</h3>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          自备 API Key，数据仅在你的电脑与所选厂商之间传输。密钥使用系统加密存储（FR-11）。
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {defaults.map((d) => (
            <button
              key={d.id}
              onClick={() => pickProvider(d.id)}
              style={{
                background: editId === d.id ? 'var(--accent-soft)' : undefined,
                borderColor: providers.some((p) => p.id === d.id) ? 'var(--accent)' : undefined,
              }}
            >
              {d.label}
              {providers.some((p) => p.id === d.id) && ' ✓'}
            </button>
          ))}
          <button onClick={() => pickProvider('custom')} style={{ background: editId === 'custom' ? 'var(--accent-soft)' : undefined }}>
            + 自定义
          </button>
        </div>

        {form && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div>
              <label className="muted" style={{ fontSize: 12 }}>Base URL</label>
              <input
                style={{ width: '100%' }}
                value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="muted" style={{ fontSize: 12 }}>模型</label>
                <select
                  style={{ width: '100%' }}
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                >
                  {form.models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value="__custom__">自定义…</option>
                </select>
              </div>
              <div>
                <label className="muted" style={{ fontSize: 12 }}>temperature</label>
                <input
                  style={{ width: '100%' }}
                  type="number"
                  step={0.1}
                  min={0}
                  max={2}
                  value={form.temperature ?? 0.7}
                  onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })}
                />
              </div>
            </div>
            {form.model === '__custom__' && (
              <input placeholder="输入自定义模型名" onChange={(e) => setForm({ ...form, model: e.target.value })} />
            )}
            <div>
              <label className="muted" style={{ fontSize: 12 }}>
                API Key {hasKey && <span style={{ color: '#6fae6a' }}>（已配置，掩码显示）</span>}
              </label>
              <input
                style={{ width: '100%' }}
                type="password"
                placeholder={hasKey ? '••••••••（留空则保留原 Key）' : '输入 API Key'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="primary" onClick={save}>保存</button>
              <button disabled={testing} onClick={testConnection}>
                {testing ? '测试中…' : '测试连接'}
              </button>
              <button onClick={() => setForm(null)}>取消</button>
              {providers.some((p) => p.id === editId) && (
                <button onClick={() => remove(editId)}>删除配置</button>
              )}
              {testResult && (
                <span style={{ fontSize: 13, color: testResult.ok ? '#6fae6a' : '#c96a5f' }}>{testResult.message}</span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, marginBottom: 10 }}>阅读偏好</h3>
        <p className="muted" style={{ fontSize: 13 }}>
          字体大小、行距与主题在阅读器右上角「Aa 设置」中调整，自动保存。
        </p>
      </div>

      <div className="card">
        <h3 style={{ fontSize: 15, marginBottom: 10 }}>数据备份（FR-23）</h3>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          导出包含全部书籍与阅读记录的备份文件；导入会覆盖当前数据（不含明文密钥）。
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={async () => {
              try {
                const blob = await api.exportBackup()
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `readmate-backup-${new Date().toISOString().slice(0, 10)}.zip`
                a.click()
                URL.revokeObjectURL(url)
              } catch (e) {
                alert(e instanceof Error ? e.message : '导出失败')
              }
            }}
          >
            导出备份
          </button>
          <label style={{ alignSelf: 'center' }}>
            <input
              type="file"
              accept=".zip"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                if (!confirm('导入备份会覆盖当前全部数据，确定继续？')) return
                try {
                  await api.importBackup(f)
                  alert('恢复成功')
                  window.location.hash = '#/library'
                  window.location.reload()
                } catch (err) {
                  alert(err instanceof Error ? err.message : '恢复失败')
                }
              }}
            />
            <span style={{ cursor: 'pointer', color: 'var(--accent)' }}>导入备份…</span>
          </label>
        </div>
      </div>
    </div>
  )
}
