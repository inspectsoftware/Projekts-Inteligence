import { type ReactNode, useState } from 'react'
import { formatAge, formatInt } from '../lib/format'
import { serverNow } from '../runtime/clock'
import { useFeed } from '../runtime/useFeed'
import { Segmented } from './kit'

const TABS = [
  { id: 'power', label: 'Power', hint: 'Electricity: load, generation, exchange and price' },
  { id: 'net', label: 'Internet', hint: "How much of the country's internet is reachable" },
] as const
type Tab = (typeof TABS)[number]['id']

const TONE = { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger', plain: 'text-fg' }

function Row({ label, value, tone = 'plain' }: { label: string; value: ReactNode; tone?: keyof typeof TONE }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line/50 py-1 last:border-0">
      <dt className="tracking-[0.1em] text-fg-mute uppercase">{label}</dt>
      <dd className={`text-right tabular-nums ${TONE[tone]}`}>{value}</dd>
    </div>
  )
}

const Waiting = () => <p className="py-2 text-fg-mute">Waiting for data…</p>
const mw = (value: number | null) => (value === null ? '–' : `${formatInt(Math.abs(value))} MW`)

function Power() {
  const energy = useFeed('energy', 'energy')
  if (!energy) return <Waiting />
  const { price, importMw } = energy
  const largest = Math.max(1, ...energy.mix.map((part) => part.mw))
  return (
    <>
      <dl>
        <Row label="Price now" value={price.now === null ? '–' : `${price.now.toFixed(2)} €/MWh`} tone={(price.now ?? 0) >= 200 ? 'warn' : 'plain'} />
        {price.low !== null && price.high !== null && <Row label="Day range" value={`${Math.round(price.low) || 0} to ${Math.round(price.high) || 0} €/MWh`} />}
        <Row label="Load" value={mw(energy.loadMw)} />
        <Row label="Generation" value={mw(energy.generationMw)} />
        {importMw !== null && <Row label={importMw >= 0 ? 'Net import' : 'Net export'} value={mw(importMw)} />}
        {energy.flows.map((flow) => (
          <Row key={flow.country} label={flow.country} value={flow.mw === 0 ? 'no exchange' : `${mw(flow.mw)} ${flow.mw > 0 ? 'in' : 'out'}`} />
        ))}
      </dl>
      {energy.mix.length > 0 && (
        <ul className="mt-2 grid gap-1">
          {energy.mix.map((part) => (
            <li key={part.source} className="grid grid-cols-[7.5rem_1fr_3.5rem] items-center gap-2">
              <span className="truncate text-fg-dim">{part.source}</span>
              <span className="h-1 bg-line">
                <span className="block h-full bg-accent" style={{ width: `${(part.mw / largest) * 100}%` }} />
              </span>
              <span className="text-right text-fg tabular-nums">{formatInt(part.mw)}</span>
            </li>
          ))}
        </ul>
      )}
      {energy.at !== null && <p className="mt-2 text-[10px] text-fg-mute">Grid figures from {formatAge(serverNow() - energy.at)}: operators publish with a delay.</p>}
    </>
  )
}

function Internet() {
  const internet = useFeed('internet', 'internet')
  if (!internet) return <Waiting />
  if (internet.signals.length === 0) return <p className="py-2 text-fg-mute">No measurements published right now.</p>
  const share = (signal: { latest: number; baseline: number }) => (signal.baseline > 0 ? signal.latest / signal.baseline : 1)
  const worst = Math.min(...internet.signals.map(share))
  const verdict = worst >= 0.9 ? { text: 'Normal', tone: 'ok' as const } : worst >= 0.5 ? { text: 'Degraded', tone: 'warn' as const } : { text: 'Outage', tone: 'danger' as const }
  return (
    <>
      <dl>
        <Row label="Reachability" value={verdict.text} tone={verdict.tone} />
        {internet.signals.map((signal) => (
          <Row key={signal.id} label={signal.label} value={`${(share(signal) * 100).toFixed(0)}% of usual`} tone={share(signal) < 0.9 ? 'warn' : 'plain'} />
        ))}
      </dl>
      <p className="mt-2 text-[10px] text-fg-mute">Latest value against the median of the past 24 hours.</p>
    </>
  )
}

/** The country at a glance, for what has no place on a map. The body of the Situation window. */
export function StatusPanel() {
  const [tab, setTab] = useState<Tab>('power')

  return (
    <>
      <div className="shrink-0 px-3 pt-3">
        <Segmented<Tab> label="Situation panel" value={tab} options={TABS} onChange={setTab} />
      </div>
      <div className="min-h-0 overflow-y-auto p-3 text-[11px]">
        {tab === 'power' && <Power />}
        {tab === 'net' && <Internet />}
      </div>
    </>
  )
}
