import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSettings, DingTalkChannelSettings } from '../../shared/settings'
import { i18n, type I18nKey, type Lang } from './i18n'
import StatsPage from './StatsPage'
import './settings.css'

type PageId = 'general' | 'reminders' | 'push' | 'appearance' | 'agents' | 'stats' | 'about'

type PushResult = { ok: boolean; channel: string; error?: string }
type ChannelInfo = { id: string; label: string; enabled: boolean; configured: boolean }
type AgentInfo = { id: string; name: string; detected: boolean; active: boolean; detail: string }

const NAV_ITEMS: Array<{ id: PageId; labelKey: I18nKey }> = [
  { id: 'general', labelKey: 'navGeneral' },
  { id: 'agents', labelKey: 'navAgents' },
  { id: 'reminders', labelKey: 'navReminders' },
  { id: 'push', labelKey: 'navPush' },
  { id: 'stats', labelKey: 'navStats' },
  { id: 'appearance', labelKey: 'navAppearance' },
  { id: 'about', labelKey: 'navAbout' }
]

/** 真实生效的状态（与主进程 mood 逻辑一致）：去掉从未使用的 sleeping */
const MOOD_KEYS = ['idle', 'working', 'happy', 'worried', 'panicked', 'offline'] as const

/** 每个状态的含义说明（设置页标注用） */
const MOOD_LABELS: Record<(typeof MOOD_KEYS)[number], { zh: string; en: string }> = {
  idle: { zh: '空闲', en: 'Idle' },
  working: { zh: '工作中', en: 'Working' },
  happy: { zh: '任务完成', en: 'Task done' },
  worried: { zh: '任务失败/重连', en: 'Failed / reconnecting' },
  panicked: { zh: 'Token 预警', en: 'Token warning' },
  offline: { zh: '离线', en: 'Offline' }
}

/** 各状态的默认文字 key（与 App.tsx 一致，placeholder 用） */
const MOOD_TEXT_KEYS: Record<(typeof MOOD_KEYS)[number], I18nKey> = {
  idle: 'idleDefault',
  working: 'workingText',
  happy: 'happyText',
  worried: 'worriedText',
  panicked: 'panickedText',
  offline: 'offlineText'
}

const DEFAULT_EMOJIS: Record<(typeof MOOD_KEYS)[number], string> = {
  idle: '😺',
  working: '🤖',
  happy: '😸',
  worried: '😿',
  panicked: '😱',
  offline: '💤'
}

/**
 * 防抖文本输入：本地 state 立即响应输入（不抖动），
 * 停顿 500ms 或失焦时才调用 save（避免每次按键都走 IPC + 全量重渲染）。
 */
function DebouncedTextInput(props: {
  value: string
  onSave: (v: string) => void
  placeholder?: string
  type?: 'text' | 'password'
  className?: string
}): React.JSX.Element {
  const [local, setLocal] = useState(props.value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSaved = useRef(props.value)

  // 外部 value 变化（如初始化/语言切换）时同步
  useEffect(() => {
    setLocal(props.value)
  }, [props.value])

  const save = useCallback(
    (v: string) => {
      if (v === lastSaved.current) return
      lastSaved.current = v
      props.onSave(v)
    },
    [props.onSave]
  )

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  return (
    <input
      type={props.type ?? 'text'}
      className={props.className}
      placeholder={props.placeholder}
      value={local}
      onChange={(e) => {
        const v = e.target.value
        setLocal(v)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => save(v), 500)
      }}
      onBlur={() => {
        if (timer.current) clearTimeout(timer.current)
        save(local)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          if (timer.current) clearTimeout(timer.current)
          save(local)
        }
      }}
    />
  )
}

export default function SettingsPage(): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [page, setPage] = useState<PageId>('general')
  const [testResult, setTestResult] = useState<PushResult[] | null>(null)
  const [testing, setTesting] = useState(false)
  const [channels, setChannels] = useState<ChannelInfo[]>([])
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [savingTip, setSavingTip] = useState(false)

  const [, setLangTick] = useState(0)

  useEffect(() => {
    void window.pet.getSettings().then((s) => {
      setSettings(s as AppSettings)
      const app = (s as AppSettings).appearance
      if (app?.language) i18n.setLang(app.language)
    })
    void window.pet.listChannels().then((c) => setChannels(c as ChannelInfo[]))
    void window.pet.listAgents().then((a) => setAgents(a as AgentInfo[]))
    const timer = setInterval(() => {
      void window.pet.listAgents().then((a) => setAgents(a as AgentInfo[]))
    }, 5000)
    const off = i18n.onChange(() => setLangTick((t) => t + 1))
    return () => {
      clearInterval(timer)
      off()
    }
  }, [])

  const t = (key: I18nKey): string => i18n.t(key)

  /** 更新设置：本地乐观更新 + 后台保存 + 短暂提示 */
  const update = useCallback(
    async (patch: Partial<AppSettings>): Promise<void> => {
      setSettings((prev) => (prev ? mergeSettings(prev, patch) : prev))
      setSavingTip(true)
      try {
        const res = await window.pet.setSettings(patch)
        if (res.ok && res.settings) {
          setSettings(res.settings as AppSettings)
          const lang = (res.settings as AppSettings).appearance.language
          if (patch.appearance?.language) i18n.setLang(lang)
        }
      } finally {
        setTimeout(() => setSavingTip(false), 800)
      }
    },
    []
  )

  const updateDingTalk = useCallback(
    async (patch: Partial<DingTalkChannelSettings>): Promise<void> => {
      if (!settings) return
      await update({ push: { ...settings.push, dingtalk: { ...settings.push.dingtalk, ...patch } } })
    },
    [settings, update]
  )

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await window.pet.testPush()
      setTestResult(res.results)
    } finally {
      setTesting(false)
    }
  }

  if (!settings) {
    return <div className="settings-page">{t('loading')}</div>
  }

  const d = settings.push.dingtalk
  const appr = settings.appearance
  const rem = settings.reminders

  return (
    <div className="settings-layout">
      {/* 自定义标题栏（无边框窗口） */}
      <div className="titlebar">
        <span className="titlebar-title">RyderBaby</span>
        <div className="titlebar-controls">
          <button
            className="tb-btn"
            title={t('tbMinimize')}
            onClick={() => void window.pet.minimizeWindow()}
          >
            ─
          </button>
          <button
            className="tb-btn tb-close"
            title={t('tbClose')}
            onClick={() => void window.pet.closeWindow()}
          >
            ✕
          </button>
        </div>
      </div>

      <div className="settings-body">
        <aside className="settings-sidebar">
        <div className="sidebar-brand">
          <span className="brand-logo">🐱</span>
          <span>RyderBaby</span>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-item${page === item.id ? ' active' : ''}`}
              onClick={() => setPage(item.id)}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          {savingTip && <span className="saving-tip">{t('saved')}</span>}
          <span className="version-tip">v0.2.0</span>
        </div>
      </aside>

      <main className="settings-content">
        {page === 'general' && (
          <section className="page-section">
            <h2>{t('secGeneral')}</h2>
            <div className="field-card">
              <label className="row">
                <span>{t('langLabel')}</span>
                <select
                  value={appr.language}
                  onChange={(e) => void update({ appearance: { ...appr, language: e.target.value as Lang } })}
                >
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                </select>
              </label>
            </div>
            <div className="field-card">
              <label className="col">
                <span>{t('dshUrlLabel')}</span>
                <DebouncedTextInput
                  value={settings.dshUrl}
                  onSave={(v) => void update({ dshUrl: v })}
                />
              </label>
              <p className="hint">{t('dshUrlHint')}</p>
            </div>
            <div className="field-card">
              <h3 className="card-title">{t('secPricing')}</h3>
              <p className="hint">{t('pricingHint')}</p>
              <label className="row">
                <span>{t('priceCacheHit')}</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={settings.pricing.cacheHit}
                  onChange={(e) =>
                    void update({ pricing: { ...settings.pricing, cacheHit: Number(e.target.value) || 0 } })
                  }
                />
              </label>
              <label className="row">
                <span>{t('priceInput')}</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={settings.pricing.input}
                  onChange={(e) =>
                    void update({ pricing: { ...settings.pricing, input: Number(e.target.value) || 0 } })
                  }
                />
              </label>
              <label className="row">
                <span>{t('priceOutput')}</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={settings.pricing.output}
                  onChange={(e) =>
                    void update({ pricing: { ...settings.pricing, output: Number(e.target.value) || 0 } })
                  }
                />
              </label>
            </div>
          </section>
        )}

        {page === 'agents' && (
          <section className="page-section">
            <h2>{t('secAgents')}</h2>
            <p className="hint">{t('agentsHint')}</p>
            <div className="agent-list">
              {agents.map((a) => {
                const watched = settings.agents.watch[a.id] ?? true
                const pushed = settings.agents.push[a.id] ?? true
                return (
                  <div key={a.id} className="agent-card">
                    <div className="agent-head">
                      <span className={`agent-status-dot ${a.active ? 'on' : a.detected ? 'standby' : 'off'}`} />
                      <span className="agent-name">{a.name}</span>
                      {a.active && <span className="badge badge-live">{t('agentActive')}</span>}
                      <span className={`badge ${a.detected ? 'badge-ok' : 'badge-warn'}`}>
                        {a.detected ? t('agentDetected') : t('agentNotDetected')}
                      </span>
                    </div>
                    <div className="agent-detail">{a.detail}</div>
                    <div className="agent-toggles">
                      <label className="toggle-pill">
                        <span>{t('watchAgent')}</span>
                        <input
                          type="checkbox"
                          checked={watched}
                          onChange={(e) =>
                            void update({
                              agents: {
                                ...settings.agents,
                                watch: { ...settings.agents.watch, [a.id]: e.target.checked }
                              }
                            })
                          }
                        />
                      </label>
                      <label className="toggle-pill">
                        <span>{t('pushAgent')}</span>
                        <input
                          type="checkbox"
                          checked={pushed}
                          disabled={!watched}
                          onChange={(e) =>
                            void update({
                              agents: {
                                ...settings.agents,
                                push: { ...settings.agents.push, [a.id]: e.target.checked }
                              }
                            })
                          }
                        />
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {page === 'reminders' && (
          <section className="page-section">
            <h2>{t('secReminders')}</h2>
            <div className="field-card">
              <label className="row">
                <span>{t('strongTaskEnd')}</span>
                <input
                  type="checkbox"
                  checked={rem.strongOnTaskEnd}
                  onChange={(e) => void update({ reminders: { ...rem, strongOnTaskEnd: e.target.checked } })}
                />
              </label>
              <label className="row">
                <span>{t('strongFailure')}</span>
                <input
                  type="checkbox"
                  checked={rem.strongOnFailure}
                  onChange={(e) => void update({ reminders: { ...rem, strongOnFailure: e.target.checked } })}
                />
              </label>
            </div>
            <div className="field-card">
              <label className="row">
                <span>{t('dailyBudget')}</span>
                <input
                  type="number"
                  min={0}
                  value={rem.dailyTokenBudget}
                  onChange={(e) =>
                    void update({ reminders: { ...rem, dailyTokenBudget: Number(e.target.value) || 0 } })
                  }
                />
              </label>
            </div>
            <div className="sub-section">
              <h3>{t('secCommands')}</h3>
              <p className="hint">{t('commandsHint')}</p>
              <div className="field-card">
                <label className="row">
                  <span>{t('notifyCommandSuccess')}</span>
                  <input
                    type="checkbox"
                    checked={rem.notifyCommandSuccess}
                    onChange={(e) => void update({ reminders: { ...rem, notifyCommandSuccess: e.target.checked } })}
                  />
                </label>
                <label className="row">
                  <span>{t('notifyCommandFailure')}</span>
                  <input
                    type="checkbox"
                    checked={rem.notifyCommandFailure}
                    onChange={(e) => void update({ reminders: { ...rem, notifyCommandFailure: e.target.checked } })}
                  />
                </label>
              </div>
            </div>
          </section>
        )}

        {page === 'push' && (
          <section className="page-section">
            <h2>{t('secPush')}</h2>
            <p className="hint">{t('pushHint')}</p>
            {channels.map((c) => (
              <div key={c.id} className="channel-card">
                <div className="channel-head">
                  <span className="channel-name">{c.label}</span>
                  {!c.configured && <span className="badge badge-warn">{t('notConfigured')}</span>}
                  {c.configured && c.enabled && <span className="badge badge-ok">{t('enabled')}</span>}
                </div>
                {c.id === 'dingtalk' && (
                  <div className="channel-fields">
                    <label className="row">
                      <span>{t('enableChannel')}</span>
                      <input
                        type="checkbox"
                        checked={d.enabled}
                        onChange={(e) => void updateDingTalk({ enabled: e.target.checked })}
                      />
                    </label>
                    <label className="col">
                      <span>{t('dingtalkWebhook')}</span>
                      <DebouncedTextInput
                        value={d.webhook}
                        onSave={(v) => void updateDingTalk({ webhook: v })}
                        placeholder="https://oapi.dingtalk.com/robot/send?access_token=…"
                      />
                    </label>
                    <label className="col">
                      <span>{t('dingtalkSecret')}</span>
                      <DebouncedTextInput
                        value={d.secret}
                        onSave={(v) => void updateDingTalk({ secret: v })}
                        placeholder="SEC…"
                        type="password"
                      />
                    </label>
                  </div>
                )}
              </div>
            ))}
            <div className="test-row">
              <button className="btn-primary" disabled={testing} onClick={() => void runTest()}>
                {testing ? t('sending') : t('sendTest')}
              </button>
              {testResult && (
                <ul className="test-results">
                  {testResult.map((r) => (
                    <li key={r.channel} className={r.ok ? 'ok' : 'fail'}>
                      {r.channel}: {r.ok ? `✅ ${t('testOk')}` : `❌ ${r.error ?? t('testFail')}`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {page === 'stats' && <StatsPage />}

        {page === 'appearance' && (
          <section className="page-section">
            <h2>{t('secAppearance')}</h2>
            <p className="hint">{t('iconHint')}</p>
            <div className="mood-list">
              {MOOD_KEYS.map((mood) => {
                const label = MOOD_LABELS[mood]
                const labelText = appr.language === 'en' ? label.en : label.zh
                return (
                  <div key={mood} className="mood-card">
                    <div className="mood-head">
                      <span className="mood-preview">{appr.petIcons[mood]?.trim() || DEFAULT_EMOJIS[mood]}</span>
                      <div className="mood-title">
                        <span className="mood-name">{labelText}</span>
                        <span className="mood-state">state: {mood}</span>
                      </div>
                    </div>
                    <div className="mood-fields">
                      <label className="col">
                        <span>{t('moodIcon')}</span>
                        <DebouncedTextInput
                          value={appr.petIcons[mood] ?? ''}
                          placeholder={DEFAULT_EMOJIS[mood]}
                          onSave={(v) =>
                            void update({
                              appearance: {
                                ...appr,
                                petIcons: { ...appr.petIcons, [mood]: v.trim() || null }
                              }
                            })
                          }
                        />
                      </label>
                      <label className="col">
                        <span>{t('moodText')}</span>
                        <DebouncedTextInput
                          value={appr.moodTexts[mood] ?? ''}
                          placeholder={i18n.t(MOOD_TEXT_KEYS[mood])}
                          onSave={(v) =>
                            void update({
                              appearance: {
                                ...appr,
                                moodTexts: { ...appr.moodTexts, [mood]: v.trim() }
                              }
                            })
                          }
                        />
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="icon-actions">
              <button
                className="btn-secondary"
                onClick={() =>
                  void update({
                    appearance: {
                      ...appr,
                      petIcons: null as unknown as AppSettings['appearance']['petIcons'],
                      moodTexts: null as unknown as AppSettings['appearance']['moodTexts']
                    }
                  })
                }
              >
                {t('resetIcons')}
              </button>
            </div>
          </section>
        )}

        {page === 'about' && (
          <section className="page-section">
            <h2>{t('secAbout')}</h2>
            <div className="about-box">
              <div className="about-logo">🐱</div>
              <p>{t('aboutText')}</p>
              <p className="hint">
                {t('version')} 0.2.0 · Electron + React + TypeScript
              </p>
            </div>
          </section>
        )}
      </main>
      </div>
    </div>
  )
}

/** 浅合并设置（本地乐观更新用） */
function mergeSettings(prev: AppSettings, patch: Partial<AppSettings>): AppSettings {
  return {
    ...prev,
    ...patch,
    reminders: patch.reminders ? { ...prev.reminders, ...patch.reminders } : prev.reminders,
    push: patch.push ? { ...prev.push, dingtalk: patch.push.dingtalk ? { ...prev.push.dingtalk, ...patch.push.dingtalk } : prev.push.dingtalk } : prev.push,
    appearance: patch.appearance ? { ...prev.appearance, ...patch.appearance, petIcons: patch.appearance.petIcons ?? prev.appearance.petIcons } : prev.appearance,
    agents: patch.agents
      ? { watch: { ...prev.agents.watch, ...patch.agents.watch }, push: { ...prev.agents.push, ...patch.agents.push } }
      : prev.agents
  }
}
