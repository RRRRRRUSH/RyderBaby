import React, { useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts'
import { i18n, type I18nKey } from './i18n'
import { fmtTokens } from './fmt'
import { calcCost, fmtCost } from './cost'
import type { AppSettings } from '../../shared/settings'
import './stats.css'

type HistoryPoint = { ts: number; label: string; total: number; input: number; output: number; cacheRead: number }
type SessionRow = { id: string; title: string; input: number; output: number; cacheRead: number; tokens: number; cost: number; turns: number }

export default function StatsPage(): React.JSX.Element {
  const [bucket, setBucket] = useState<'hour' | 'day'>('day')
  const [days, setDays] = useState(7)
  const [data, setData] = useState<HistoryPoint[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [aggregate, setAggregate] = useState<{
    totals: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; calls: number }
    taskCount: number
    failCount: number
  } | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const chartRef = useRef<HTMLDivElement | null>(null)
  const chartInst = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    void window.pet.getTokenHistory({ bucket, days }).then((d) => setData(d as HistoryPoint[]))
    void window.pet.getState().then((s: any) => {
      setAggregate(s.aggregate ?? null)
      setSettings(s.settings as AppSettings)
    })
    void window.pet.getSessions().then((s) => setSessions(s as SessionRow[]))
  }, [bucket, days])

  useEffect(() => {
    if (!chartRef.current) return
    if (!chartInst.current) {
      chartInst.current = echarts.init(chartRef.current)
    }
    const inst = chartInst.current
    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v) => fmtTokens(Number(v))
      },
      legend: {
        data: ['total', 'input', 'output', 'cacheRead'],
        textStyle: { color: '#6b7280', fontSize: 11 },
        top: 0
      },
      grid: { left: 56, right: 16, top: 28, bottom: 24 },
      xAxis: {
        type: 'category',
        data: data.map((d) => d.label),
        axisLine: { lineStyle: { color: '#d1d5db' } },
        axisLabel: { color: '#6b7280', fontSize: 10 }
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: '#6b7280',
          fontSize: 10,
          formatter: (v: number) => fmtTokens(v)
        },
        splitLine: { lineStyle: { color: '#eef1f7' } }
      },
      series: [
        {
          name: 'total',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: data.map((d) => d.total),
          lineStyle: { width: 2, color: '#4f6ef2' },
          areaStyle: { color: 'rgba(79,110,242,0.18)' }
        },
        {
          name: 'input',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: data.map((d) => d.input),
          lineStyle: { width: 1, color: '#22c55e' }
        },
        {
          name: 'output',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: data.map((d) => d.output),
          lineStyle: { width: 1, color: '#f59e0b' }
        },
        {
          name: 'cacheRead',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: data.map((d) => d.cacheRead),
          lineStyle: { width: 1, color: '#a855f7' }
        }
      ]
    }
    inst.setOption(option, true)
    return () => {
      inst.dispose()
      chartInst.current = null
    }
  }, [data])

  // 窗口尺寸变化时重绘图表（设置窗口可拉伸）
  useEffect(() => {
    const onResize = (): void => {
      chartInst.current?.resize()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const t = (key: I18nKey): string => i18n.t(key)
  const total = aggregate
    ? aggregate.totals.input + aggregate.totals.output + aggregate.totals.cacheRead + aggregate.totals.cacheWrite
    : 0

  return (
    <div className="stats-page">
      <div className="stats-toolbar">
        <div className="segmented">
          <button className={bucket === 'day' ? 'active' : ''} onClick={() => setBucket('day')}>
            {t('statsByDay')}
          </button>
          <button className={bucket === 'hour' ? 'active' : ''} onClick={() => setBucket('hour')}>
            {t('statsByHour')}
          </button>
        </div>
        <select className="range-select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>1 {t('statsDays')}</option>
          <option value={7}>7 {t('statsDays')}</option>
          <option value={14}>14 {t('statsDays')}</option>
          <option value={30}>30 {t('statsDays')}</option>
        </select>
      </div>

      <div className="stats-cards">
        <div className="stat-card">
          <div className="stat-value">{fmtTokens(total)}</div>
          <div className="stat-label">{t('statsTotalTokens')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{aggregate?.totals.calls ?? 0}</div>
          <div className="stat-label">{t('statsCalls')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value stat-cost">
            {fmtCost(
              calcCost(
                aggregate?.totals ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0 },
                settings?.pricing
              )
            )}
          </div>
          <div className="stat-label">{t('statsCost')}</div>
        </div>
      </div>

      <div ref={chartRef} className="chart-box" />

      {/* 按会话统计 */}
      <div className="sessions-section">
        <h3>{t('statsBySession')}</h3>
        {sessions.length === 0 ? (
          <p className="hint">{t('statsNoSession')}</p>
        ) : (
          <div className="session-table">
            {sessions.map((s) => (
              <div key={s.id} className="session-row">
                <div className="session-info">
                  <span className="session-title" title={s.id}>{s.title}</span>
                  <span className="session-turns">🔄 {s.turns} 回合</span>
                </div>
                <div className="session-nums">
                  <span className="session-tokens">⚡ {fmtTokens(s.tokens)}</span>
                  <span className="session-cost">💰 {fmtCost(s.cost)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
