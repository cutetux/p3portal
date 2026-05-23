// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { useState } from 'react'

const SCHEDULE_TYPES = [
  { value: 'daily',   label: 'Täglich' },
  { value: 'weekly',  label: 'Wöchentlich' },
  { value: 'hourly',  label: 'Stündlich' },
  { value: 'every15', label: 'Alle 15 Minuten' },
  { value: 'custom',  label: 'Eigener Cron-Ausdruck…' },
]

const WEEKDAYS = [
  { value: '1', short: 'Mo', label: 'Montag' },
  { value: '2', short: 'Di', label: 'Dienstag' },
  { value: '3', short: 'Mi', label: 'Mittwoch' },
  { value: '4', short: 'Do', label: 'Donnerstag' },
  { value: '5', short: 'Fr', label: 'Freitag' },
  { value: '6', short: 'Sa', label: 'Samstag' },
  { value: '0', short: 'So', label: 'Sonntag' },
]

export function parseCronToState(cron) {
  const def = { type: 'daily', time: '08:00', weekdays: ['1'], custom: '' }
  if (!cron) return def
  if (cron === '*/15 * * * *') return { ...def, type: 'every15' }
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return { ...def, type: 'custom', custom: cron }
  const [min, hour, dom, month, dow] = parts
  const num = s => /^\d+$/.test(s)
  const isDow = s => /^[\d,]+$/.test(s) && s.split(',').every(n => num(n))
  const pad = n => String(parseInt(n)).padStart(2, '0')
  if (hour === '*' && dom === '*' && month === '*' && dow === '*' && num(min))
    return { ...def, type: 'hourly', time: `00:${pad(min)}` }
  if (dom === '*' && month === '*' && dow === '*' && num(min) && num(hour))
    return { ...def, type: 'daily', time: `${pad(hour)}:${pad(min)}` }
  if (dom === '*' && month === '*' && isDow(dow) && num(min) && num(hour))
    return { ...def, type: 'weekly', time: `${pad(hour)}:${pad(min)}`, weekdays: dow.split(',') }
  return { ...def, type: 'custom', custom: cron }
}

export function buildCronFromState(type, time, weekdays, custom) {
  if (type === 'every15') return '*/15 * * * *'
  const [hStr = '8', mStr = '0'] = (time || '08:00').split(':')
  const h = parseInt(hStr) || 0
  const m = parseInt(mStr) || 0
  if (type === 'hourly') return `${m} * * * *`
  if (type === 'daily')  return `${m} ${h} * * *`
  if (type === 'weekly') {
    const days = (weekdays && weekdays.length > 0) ? [...weekdays].sort().join(',') : '1'
    return `${m} ${h} * * ${days}`
  }
  return custom || ''
}

function humanLabel(type, time, weekdays) {
  const t = time || '08:00'
  if (type === 'every15') return 'alle 15 Minuten'
  if (type === 'hourly')  return `jede Stunde, Minute ${parseInt(t.split(':')[1]) || 0}`
  if (type === 'daily')   return `täglich um ${t} Uhr`
  if (type === 'weekly') {
    if (!weekdays || weekdays.length === 0) return `um ${t} Uhr`
    const names = [...weekdays].sort().map(v => WEEKDAYS.find(d => d.value === v)?.label ?? v).join(', ')
    return `${names} um ${t} Uhr`
  }
  return ''
}

const cls = 'text-sm border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-orange-500'

export default function CronPicker({ value, onChange, label }) {
  const init = parseCronToState(value)
  const [type,     setType]     = useState(init.type)
  const [time,     setTime]     = useState(init.time)
  const [weekdays, setWeekdays] = useState(init.weekdays)
  const [custom,   setCu]       = useState(init.custom)

  const emit = (ty, ti, wds, cu) => onChange(buildCronFromState(ty, ti, wds, cu))

  const onType   = v => { setType(v); emit(v, time, weekdays, custom) }
  const onTime   = v => { setTime(v); emit(type, v, weekdays, custom) }
  const onCustom = v => { setCu(v);   emit(type, time, weekdays, v) }

  const toggleDay = v => {
    const next = weekdays.includes(v)
      ? weekdays.filter(d => d !== v)
      : [...weekdays, v]
    if (next.length === 0) return // mindestens 1 Tag muss gewählt sein
    setWeekdays(next)
    emit(type, time, next, custom)
  }

  const cron   = buildCronFromState(type, time, weekdays, custom)
  const human  = humanLabel(type, time, weekdays)
  const minute = parseInt((time || '00:00').split(':')[1]) || 0

  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
          {label} <span className="text-red-500">*</span>
        </label>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <select value={type} onChange={e => onType(e.target.value)} className={`${cls} flex-1 min-w-[150px]`}>
          {SCHEDULE_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {(type === 'daily' || type === 'weekly') && (
          <input
            type="time"
            value={time}
            onChange={e => onTime(e.target.value)}
            className={cls}
          />
        )}

        {type === 'hourly' && (
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-zinc-400">
            <span>Minute:</span>
            <input
              type="number"
              min={0}
              max={59}
              value={minute}
              onChange={e => onTime(`00:${String(Math.min(59, Math.max(0, parseInt(e.target.value) || 0))).padStart(2, '0')}`)}
              className={`${cls} w-20 text-center`}
            />
          </div>
        )}
      </div>

      {type === 'weekly' && (
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map(d => {
            const active = weekdays.includes(d.value)
            return (
              <button
                key={d.value}
                type="button"
                onClick={() => toggleDay(d.value)}
                title={d.label}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  active
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-600'
                }`}
              >
                {d.short}
              </button>
            )
          })}
        </div>
      )}

      {type === 'custom' && (
        <input
          type="text"
          value={custom}
          onChange={e => onCustom(e.target.value)}
          placeholder="0 */6 * * *"
          className={`${cls} w-full font-mono`}
        />
      )}

      <p className="text-xs text-gray-400 dark:text-zinc-500">
        {human && `${human} · `}
        <code className="font-mono">{cron || '–'}</code>
      </p>
    </div>
  )
}
