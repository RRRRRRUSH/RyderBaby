import React, { useEffect, useState } from 'react'
import type { AppSettings, DingTalkChannelSettings, ExternalToolSettings } from '../../shared/settings'
import { i18n, type I18nKey, type Lang } from './i18n'
import StatsPage from './StatsPage'
import './settings.css'

type PageId = 'general' | 'reminders' | 'push' | 'appearance' | 'agents' | 'external' | 'stats' | 'about'

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
  { id: 'external', labelKey: 'navExternal' },
  { id: 'about', labelKey: 'navAbout' }
]

const MOOD_KEYS = ['idle', 'working', 'happy', 'worried', 'panicked', 'offline', 'sleeping'] as const

const DEFAULT_EMOJIS: Record<(typeof MOOD_KEYS)[number], string> = {
  idle: '😺',
  working: '🤖',
  happy: '😸',
  worried: '😿',
  panicked: '😱',
  offline: '💤',
  sleeping: '😴'
}

export default function SettingsPage(): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [page, setPage] = useState<PageId>('general')
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<PushResult[] | null>(null)
  const [testing, setTesting] = useState(false)
  const [channels, setChannels] = useState<ChannelInfo[]>([])
  const [agents, setAgents] = useState<AgentInfo[]>([])

  // 语言响应式：语言变化时强制重渲染
  const [, setLangTick] = useState(0)

  useEffect(() => {
    void window.pet.getSettings().then((s) => {
      setSettings(s as AppSettings)
      const app = (s as AppSettings).appearance
      if (app?.language) i18n.setLang(app.language)
    })
    void window.pet.listChannels().then((c) => setChannels(c as ChannelInfo[]))
    void window.pet.listAgents().then((a) => setAgents(a as AgentInfo[]))
    // 定时刷新 agent 状态（检测/活跃度会变化）
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

  const update = async (patch: Partial<AppSettings>): Promise<void> => {
    setSaving(true)
    try {
      const res = await window.pet.setSettings(patch)
      if (res.ok && res.settings) {
        const next = res.settings as AppSettings
        setSettings(next)
        if (patch.appearance?.language) i18n.setLang(next.appearance.language)
        void window.pet.listChannels().then((c) => setChannels(c as ChannelInfo[]))
        void window.pet.listAgents().then((a) => setAgents(a as AgentInfo[]))
      }
    } finally {
      setSaving(false)
    }
  }

  const updateDingTalk = async (patch: Partial<DingTalkChannelSettings>): Promise<void> => {
    if (!settings) return
    await update({ push: { ...settings.push, dingtalk: { ...settings.push.dingtalk, ...patch } } })
  }

  const updateExternal = async (patch: Partial<ExternalToolSettings>): Promise<void> => {
    if (!settings) return
    await update({ external: { ...settings.external, ...patch } })
  }

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
  const ext = settings.external
  const rem = settings.reminders

  return (
    <div className="settings-layout">
      <aside className="settings-sidebar">
        <div className="sidebar-brand">🐱 RyderBaby</div>
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
        {saving && <div className="saving-tip">{t('saving')}</div>}
      </aside>

      <main className="settings-content">
        {page === 'general' && (
          <section className="page-section">
            <h2>{t('secGeneral')}</h2>
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
            <label className="col">
              <span>{t('dshUrlLabel')}</span>
              <input
                type="text"
                value={settings.dshUrl}
                onChange={(e) => void update({ dshUrl: e.target.value })}
              />
            </label>
            <p className="hint">{t('dshUrlHint')}</p>
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
                      <span className={`badge ${a.detected ? 'badge-ok' : 'badge-warn'}`}>
                        {a.detected ? t('agentDetected') : t('agentNotDetected')}
                      </span>
                      {a.active && <span className="badge badge-live">{t('agentActive')}</span>}
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
            <div className="sub-section">
              <h3>{t('secCommands')}</h3>
              <p className="hint">{t('commandsHint')}</p>
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
                      <input
                        type="text"
                        placeholder="https://oapi.dingtalk.com/robot/send?access_token=…"
                        value={d.webhook}
                        onChange={(e) => void updateDingTalk({ webhook: e.target.value })}
                      />
                    </label>
                    <label className="col">
                      <span>{t('dingtalkSecret')}</span>
                      <input
                        type="password"
                        placeholder="SEC…"
                        value={d.secret}
                        onChange={(e) => void updateDingTalk({ secret: e.target.value })}
                      />
                    </label>
                  </div>
                )}
              </div>
            ))}
            <div className="test-row">
              <button disabled={testing || saving} onClick={() => void runTest()}>
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
            <div className="icon-grid">
              {MOOD_KEYS.map((mood) => (
                <label key={mood} className="icon-cell">
                  <span className="icon-preview">
                    {appr.petIcons[mood]?.trim() || DEFAULT_EMOJIS[mood]}
                  </span>
                  <input
                    type="text"
                    placeholder={DEFAULT_EMOJIS[mood]}
                    value={appr.petIcons[mood] ?? ''}
                    onChange={(e) =>
                      void update({
                        appearance: {
                          ...appr,
                          petIcons: { ...appr.petIcons, [mood]: e.target.value }
                        }
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <div className="icon-actions">
              <button
                onClick={() =>
                  void update({ appearance: { ...appr, petIcons: null as unknown as AppSettings['appearance']['petIcons'] } })
                }
              >
                {t('resetIcons')}
              </button>
            </div>
            <label className="col">
              <span>{t('idleText')}</span>
              <input
                type="text"
                value={appr.idleText}
                onChange={(e) => void update({ appearance: { ...appr, idleText: e.target.value } })}
              />
            </label>
          </section>
        )}

        {page === 'external' && (
          <section className="page-section">
            <h2>{t('secExternal')}</h2>
            <p className="hint">{t('extHint')}</p>
            <div className="channel-card">
              <div className="channel-head">
                <span className="channel-name">{t('extClaude')}</span>
              </div>
              <label className="row">
                <span>{t('extWatch')}</span>
                <input
                  type="checkbox"
                  checked={ext.claudeCode}
                  onChange={(e) => void updateExternal({ claudeCode: e.target.checked })}
                />
              </label>
            </div>
            <div className="channel-card">
              <div className="channel-head">
                <span className="channel-name">{t('extCodex')}</span>
              </div>
              <label className="row">
                <span>{t('extWatch')}</span>
                <input
                  type="checkbox"
                  checked={ext.codex}
                  onChange={(e) => void updateExternal({ codex: e.target.checked })}
                />
              </label>
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
  )
}
