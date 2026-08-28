import React, { useEffect, useRef, useState } from 'react'
import type { PetMood } from '../../shared/types'
import type { AppSettings, PetMoodKey } from '../../shared/settings'
import SettingsPage from './SettingsPage'
import { i18n, type I18nKey } from './i18n'
import { playFailureSound, playSuccessSound } from './sounds'
import { fmtTokens } from './fmt'
import { calcCost, fmtCost } from './cost'

type UsagePayload = {
  ts: number
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number }
  totalTokens: number
  sessionId: string
  model: string
  provider: string
  source?: string
}

type TaskEndPayload = {
  kind: string
  result: string
  label?: string
  detail?: string
  ts: number
  source?: string
}

type StrongReminderPayload = {
  ok: boolean
  kind: string
  label: string
}

type ConnectionPayload = 'connected' | 'reconnecting' | 'offline'

interface PetState {
  mood: PetMood
  connection: ConnectionPayload
  todayTokens: number
  todayCost: number
  latestUsage: UsagePayload | null
  latestTask: TaskEndPayload | null
  bubble: string | null
  strongFx: { ok: boolean; key: number } | null
}

const DEFAULT_EMOJIS: Record<PetMoodKey, string> = {
  idle: '😺',
  working: '🤖',
  happy: '😸',
  worried: '😿',
  panicked: '😱',
  offline: '💤'
}

const MOOD_TEXT_KEYS: Record<PetMood, I18nKey> = {
  idle: 'idleDefault',
  working: 'workingText',
  happy: 'happyText',
  worried: 'worriedText',
  panicked: 'panickedText',
  offline: 'offlineText'
}

const PARTICLE_EMOJIS = ['🎉', '✨', '⭐', '🎊', '💫']

function getHashRoute(): string {
  return window.location.hash
}

/** 是否设置窗口：仅带 ?settings=1 的窗口渲染设置页（主窗口忽略 hash） */
function isSettingsWindow(): boolean {
  return new URLSearchParams(window.location.search).get('settings') === '1'
}

export default function App(): React.JSX.Element {
  const [route, setRoute] = useState(getHashRoute)

  useEffect(() => {
    const onHash = (): void => setRoute(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (isSettingsWindow() && route.startsWith('#/settings')) {
    return <SettingsPage />
  }

  return <PetWindow />
}

/** 解析自定义图标：emoji 或图片路径 → ReactNode */
function resolveIcon(raw: string | undefined, fallback: string): React.ReactNode {
  const v = raw?.trim()
  if (!v) return fallback
  // 图片路径（.png/.jpg/.gif/.webp/.svg 等）
  if (/\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i.test(v)) {
    return <img src={v} className="custom-icon-img" alt="" draggable={false} />
  }
  // 多 emoji 或单 emoji 都直接渲染
  return v
}

function PetWindow(): React.JSX.Element {
  const [state, setState] = useState<PetState>({
    mood: 'idle',
    connection: 'offline',
    todayTokens: 0,
    todayCost: 0,
    latestUsage: null,
    latestTask: null,
    bubble: null,
    strongFx: null
  })
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const settingsRef = useRef<AppSettings | null>(null)
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fxTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [, setLangTick] = useState(0)
  // 悬浮详情卡
  const [hovered, setHovered] = useState(false)
  const [sessions, setSessions] = useState<Array<{ id: string; title: string; tokens: number; cost: number; turns: number }>>([])

  // 悬浮时加载会话数据
  useEffect(() => {
    if (!hovered) return
    let disposed = false
    void window.pet.getSessions().then((s) => {
      if (!disposed) setSessions((s as Array<{ id: string; title: string; tokens: number; cost: number; turns: number }>).slice(0, 5))
    })
    return () => {
      disposed = true
    }
  }, [hovered])

  // 点击穿透切换：鼠标在窗口内任意位置即可交互（拖动把手在 pet-shell 上）
  // 穿透状态下 forward 仍会转发 mousemove 用于判断
  useEffect(() => {
    let dragging = false
    const onMove = (e: MouseEvent): void => {
      // 拖动期间保持可交互（不打断拖拽）
      if (dragging) return
      const interactive = e.target instanceof Element && !!e.target.closest('.pet-shell')
      void window.pet.setIgnoreMouse(!interactive)
    }
    const onDown = (): void => {
      dragging = true
      void window.pet.setIgnoreMouse(false)
    }
    const onUp = (): void => {
      dragging = false
      // 鼠标可能已离开窗口，交给后续 mousemove 判断
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    // 离开窗口恢复穿透
    const onLeave = (): void => {
      void window.pet.setIgnoreMouse(true)
    }
    document.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      document.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  useEffect(() => {
    let disposed = false
    window.pet.getState().then((s: any) => {
      if (disposed) return
      setSettings(s.settings as AppSettings)
      settingsRef.current = s.settings as AppSettings
      setState((prev) => ({
        ...prev,
        connection: s.connection,
        mood: s.mood ?? prev.mood,
        // 今日 token 总量（含 cacheRead），与花费口径一致
        todayTokens: s.todayTokens
          ? s.todayTokens.input + s.todayTokens.output + s.todayTokens.cacheRead + s.todayTokens.cacheWrite
          : 0,
        todayCost: s.todayCost ?? 0
      }))
    })

    const offLang = i18n.onChange(() => setLangTick((t) => t + 1))

    const offs = [
      window.pet.onEvent('pet:mood', (m) => {
        if (disposed) return
        setState((prev) => ({ ...prev, mood: m as PetMood }))
      }),
      window.pet.onEvent('pet:connection', (c) => {
        if (disposed) return
        setState((prev) => ({ ...prev, connection: c as ConnectionPayload }))
      }),
      window.pet.onEvent('pet:usage', (u) => {
        if (disposed) return
        const usage = u as UsagePayload
        setState((prev) => {
          const pricing = settingsRef.current?.pricing
          const cost = calcCost(usage.usage, pricing)
          return {
            ...prev,
            latestUsage: usage,
            todayTokens:
              prev.todayTokens +
              usage.usage.input +
              usage.usage.output +
              usage.usage.cacheRead +
              usage.usage.cacheWrite,
            todayCost: prev.todayCost + cost
          }
        })
      }),
      window.pet.onEvent('pet:task-end', (t) => {
        if (disposed) return
        setState((prev) => ({ ...prev, latestTask: t as TaskEndPayload }))
      }),
      window.pet.onEvent('pet:strong-reminder', (p) => {
        if (disposed) return
        const fx = p as StrongReminderPayload
        if (fx.ok) playSuccessSound()
        else playFailureSound()
        setState((prev) => ({ ...prev, strongFx: { ok: fx.ok, key: Date.now() } }))
        if (fxTimer.current) clearTimeout(fxTimer.current)
        fxTimer.current = setTimeout(() => {
          setState((prev) => ({ ...prev, strongFx: null }))
        }, 2600)
        showBubble(fx.ok ? `🎉 ${fx.kind} done${fx.label ? ' · ' + fx.label : ''}` : `❌ ${fx.kind} failed${fx.label ? ' · ' + fx.label : ''}`)
      }),
      window.pet.onEvent('pet:reminder', (r) => {
        if (disposed) return
        const rem = r as { title: string; body: string }
        showBubble(`${rem.title} ${rem.body}`)
      })
    ]

    return () => {
      disposed = true
      offLang()
      offs.forEach((off) => off())
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current)
      if (fxTimer.current) clearTimeout(fxTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const showBubble = (text: string): void => {
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current)
    setState((prev) => ({ ...prev, bubble: text }))
    bubbleTimer.current = setTimeout(() => {
      setState((prev) => ({ ...prev, bubble: null }))
    }, 5000)
  }

  const { mood, connection, todayTokens, todayCost, latestUsage, bubble, strongFx } = state
  const icons = settings?.appearance?.petIcons ?? {}
  const moodTexts = settings?.appearance?.moodTexts ?? {}
  // 兼容旧字段：idleText 等价于 moodTexts.idle
  const customIdle = settings?.appearance?.idleText?.trim()

  // 图标：自定义优先，否则内置默认
  const iconNode = resolveIcon(icons[mood as PetMoodKey], DEFAULT_EMOJIS[mood as PetMoodKey])
  // 文字：当前状态的自定义文字优先（旧 idleText 兜底），否则用 i18n 默认
  const moodText =
    (mood === 'idle' && customIdle) ||
    moodTexts[mood as PetMoodKey]?.trim() ||
    i18n.t(MOOD_TEXT_KEYS[mood])

  const connText =
    connection === 'connected'
      ? i18n.t('connected')
      : connection === 'reconnecting'
        ? i18n.t('reconnecting')
        : i18n.t('offline')

  const sourceTag = latestUsage?.provider && latestUsage.provider !== 'dsh' && latestUsage.source
    ? latestUsage.source
    : latestUsage?.provider

  return (
    <div
      className={`pet-shell mood-${mood} conn-${connection}${strongFx ? (strongFx.ok ? ' fx-happy' : ' fx-worried') : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {strongFx && (
        <div className="particles" key={strongFx.key}>
          {PARTICLE_EMOJIS.map((p, i) => (
            <span key={i} className="particle" style={{ left: `${8 + i * 21}%`, animationDelay: `${i * 0.08}s` }}>
              {p}
            </span>
          ))}
        </div>
      )}

      {bubble && (
        <div className="bubble">
          <span className="bubble-text">{bubble}</span>
        </div>
      )}

      {/* 悬浮详情卡 */}
      {hovered && (
        <div className="hover-card">
          <div className="hover-head">
            <span className={`hud-dot dot-${connection}`} />
            <span className="hover-title">{connText}</span>
            <span className="hover-mood">{moodText}</span>
          </div>
          <div className="hover-row">
            <span>今日 Token</span>
            <span className="hover-val">⚡ {fmtTokens(todayTokens)}</span>
          </div>
          <div className="hover-row">
            <span>估算花费</span>
            <span className="hover-val hover-cost">💰 {fmtCost(todayCost)}</span>
          </div>
          {sessions.length > 0 && (
            <div className="hover-sessions">
              <div className="hover-sess-title">按会话</div>
              {sessions.map((s) => (
                <div key={s.id} className="hover-sess-row">
                  <span className="hover-sess-name" title={s.id}>{s.title}</span>
                  <span className="hover-sess-nums">⚡{fmtTokens(s.tokens)} · 💰{fmtCost(s.cost)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="pet-body">
        <div className="pet-emoji">{iconNode}</div>
        <div className="pet-status">{moodText}</div>
      </div>

      {/* HUD：玻璃拟态信息卡（居中布局） */}
      <div className="pet-hud">
        <div className="hud-status">
          <span className={`hud-dot dot-${connection}`} />
          <span className="hud-conn">{connText}</span>
          {latestUsage && <span className="hud-model">{sourceTag ?? latestUsage.model}</span>}
        </div>
        <div className="hud-main">
          <span className="hud-token">
            ⚡ {fmtTokens(todayTokens)}
            <em>{i18n.t('today')}</em>
          </span>
        </div>
        <div className="hud-cost-row">
          <span className="hud-cost">💰 {fmtCost(todayCost)}</span>
        </div>
      </div>
    </div>
  )
}
