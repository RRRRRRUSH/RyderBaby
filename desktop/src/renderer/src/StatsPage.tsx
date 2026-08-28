import React, { useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts'
import { i18n, type I18nKey } from './i18n'
import { fmtTokens } from './fmt'
import './stats.css'

type HistoryPoint = { ts: number; label: string; total: number; input: number; output: number; cacheRead: number }

export default function StatsPage(): React.JSX.Element {
  const [bucket, setBucket] = useState<'hour' | 'day'>('day')
  const [days, setDays] = useState(7)
  const [data, setData] = useState<HistoryPoint[]>([])
  const [aggregate, setAggregate] = useState<{
    totals: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; calls: number }
    taskCount: number
    failCount: number
  } | null>(null)
  const chartRef = useRef<HTMLDivElement | null>(null)
  const chartInst = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    void window.pet.getTokenHistory({ bucket, days }).then((d) => setData(d as HistoryPoint[]))
    void window.pet.getState().then((s: any) => setAggregate(s.aggregate ?? null))
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
        textStyle: { color: '#9aa3b2', fontSize: 11 },
        top: 0
      },
      grid: { left: 52, right: 16, top: 28, bottom: 24 },
      xAxis: {
        type: 'category',
        data: data.map((d) => d.label),
        axisLine: { lineStyle: { color: '#3a4150' } },
        axisLabel: { color: '#9aa3b2', fontSize: 10 }
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: '#9aa3b2',
          fontSize: 10,
          formatter: (v: number) => fmtTokens(v)
        },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } }
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

  const t = (key: I18nKey): string => i18n.t(key)
  const total = aggregate
    ? aggregate.totals.input + aggregate.totals.output + aggregate.totals.cacheRead + aggregate.totals.cacheWrite
    : 0

  return (
    <div className="stats-page">
      <div className="stats-toolbar">
        <div className="stats-toggles">
          <button className={bucket === 'day' ? 'active' : ''} onClick={() => setBucket('day')}>
            {t('statsByDay')}
          </button>
          <button className={bucket === 'hour' ? 'active' : ''} onClick={() => setBucket('hour')}>
            {t('statsByHour')}
          </button>
        </div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
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
          <div className="stat-value">
            {aggregate?.taskCount ?? 0}
            <span className="stat-sub"> / {aggregate?.failCount ?? 0} ❌</span>
          </div>
          <div className="stat-label">{t('statsTasks')}</div>
        </div>
      </div>

      <div ref={chartRef} className="chart-box" />
    </div>
  )
}
