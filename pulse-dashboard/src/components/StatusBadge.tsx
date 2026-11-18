import React from 'react'

export function statusColor(status: string) {
  switch (status) {
    case 'running':  return { dot: 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]', badge: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30', label: 'Running', shadow: 'shadow-emerald-500/20' }
    case 'starting': return { dot: 'bg-indigo-400 animate-status-pulse shadow-[0_0_12px_rgba(99,102,241,0.8)]', badge: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30', label: 'Starting…', shadow: 'shadow-indigo-500/20' }
    case 'error':    return { dot: 'bg-rose-400 shadow-[0_0_12px_rgba(251,113,133,0.8)]', badge: 'bg-rose-500/10 text-rose-300 border-rose-500/30', label: 'Error', shadow: 'shadow-rose-500/20' }
    default:         return { dot: 'bg-slate-500 shadow-[0_0_12px_rgba(100,116,139,0.5)]', badge: 'bg-slate-500/10 text-slate-400 border-slate-500/30', label: 'Stopped', shadow: 'shadow-slate-500/20' }
  }
}

export function StatusBadge({ status }: { status: string }) {
  const s = statusColor(status)
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider ${s.badge} shadow-lg ${s.shadow}`}>
      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

export function TierBadge({ tier }: { tier?: number }) {
  switch (tier) {
    case 0:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-purple-300">
          <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
          Tier 0 · Control
        </span>
      )
    case 1:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-300">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
          Tier 1 · Pinned
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-sky-300">
          <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
          Tier 2 · On-Demand
        </span>
      )
  }
}
