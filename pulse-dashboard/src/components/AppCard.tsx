import React from 'react'
import { motion } from 'framer-motion'
import { Play, Square, RefreshCw, Activity, Terminal, ExternalLink, Layers, ShieldAlert, Clock } from 'lucide-react'
import { ApplicationDetail } from '../types'
import { StatusBadge, TierBadge } from './StatusBadge'
import { getAppMeta } from '../appMeta'

interface AppCardProps {
  app: ApplicationDetail
  busy: boolean
  onAction: (action: 'start' | 'stop' | 'restart', id: string) => void
}

function getAppUrl(route: string) {
  if (/^https?:\/\//i.test(route)) return route
  return `http://localhost:9000${route.startsWith('/') ? route : `/${route}`}`
}

export function AppCard({ app, busy, onAction }: AppCardProps) {
  const isRunning = app.status === 'running'
  const isStopped = app.status === 'stopped'
  const isStarting = app.status === 'starting' || busy
  const meta = getAppMeta(app.name, app.routes)

  // Pinned or Control services (Tier 0 and 1) should not be stopped
  const isPinnedService = (app.tier ?? 2) <= 1

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -2 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className="glass group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl transition-all duration-300 hover:border-violet-500/30 hover:bg-slate-800/60 hover-glow"
    >
      {/* Accent Gradient Background for Running apps */}
      {isRunning && (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent" />
      )}
      
      {/* Left accent bar */}
      <motion.div 
        layout
        className={`absolute bottom-0 left-0 top-0 w-1 transition-all duration-500 ${
          isRunning
            ? 'bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.8)]'
            : isStarting
            ? 'animate-status-pulse bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.8)]'
            : 'bg-transparent group-hover:bg-indigo-500/30'
        }`}
      />

      <div className="flex-1">
        {/* Header: Title, Icon, Badges */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-xl shadow-inner">
              {meta.icon}
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-lg font-bold text-white tracking-tight">
                {meta.title}
              </h3>
              <p className="text-xs font-mono text-slate-400 truncate">
                {app.name}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <StatusBadge status={app.status} />
            <TierBadge tier={app.tier} />
          </div>
        </div>

        {/* Description */}
        <p className="mb-4 text-xs leading-relaxed text-slate-400">
          {meta.description}
        </p>

        {/* Metadata Tags: Stacks, Dependencies, Idle Timeout */}
        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/5 px-2.5 py-1 text-slate-300 font-medium">
            <Terminal className="h-3.5 w-3.5 text-emerald-400" />
            <span>{Object.keys(app.stacks || {}).length} Stack{Object.keys(app.stacks || {}).length !== 1 ? 's' : ''}</span>
          </div>

          {app.idle_timeout && (
            <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/5 px-2.5 py-1 text-slate-300 font-medium">
              <Clock className="h-3.5 w-3.5 text-amber-400" />
              <span>Idle: {app.idle_timeout}</span>
            </div>
          )}

          {app.dependencies && app.dependencies.length > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/5 px-2.5 py-1 text-slate-300 font-medium">
              <Layers className="h-3.5 w-3.5 text-indigo-400" />
              <span>Deps: {app.dependencies.join(', ')}</span>
            </div>
          )}
        </div>

        {/* Routes */}
        {app.routes && app.routes.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Routes:
            </span>
            {app.routes.map((route) => (
              <a
                key={route}
                href={getAppUrl(route)}
                target="_blank"
                rel="noreferrer"
                className="group/route inline-flex items-center gap-1 rounded-md border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-sky-300 transition-colors hover:border-sky-500/40 hover:bg-sky-500/20"
                title={`Open ${route}`}
              >
                <span>{route}</span>
                <ExternalLink className="h-2.5 w-2.5 opacity-60 group-hover/route:opacity-100" />
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Action Controls */}
      <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-4">
        {app.routes?.[0] && (
          <a
            href={getAppUrl(app.routes[0])}
            target="_blank"
            rel="noreferrer"
            className="flex-1 btn-micro flex items-center justify-center gap-1.5 rounded-xl border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-300 transition-all hover:border-sky-500/40 hover:bg-sky-500/20 hover:shadow-[0_0_15px_rgba(56,189,248,0.2)]"
          >
            <Activity className="h-3.5 w-3.5" />
            <span>Open</span>
          </a>
        )}

        <button
          onClick={() => onAction('start', app.name)}
          disabled={isRunning || busy}
          className="flex-1 btn-micro flex items-center justify-center gap-1.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-400 transition-all hover:border-emerald-500/40 hover:bg-emerald-500/20 hover:shadow-[0_0_15px_rgba(16,185,129,0.2)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:shadow-none"
        >
          {busy && isStarting ? (
            <span className="animate-spin-fast inline-block h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          <span>Start</span>
        </button>
        
        <button
          onClick={() => onAction('stop', app.name)}
          disabled={isStopped || busy || isPinnedService}
          title={isPinnedService ? 'Pinned/Control services cannot be stopped' : 'Stop service'}
          className={`flex-1 btn-micro flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-all ${
            isPinnedService
              ? 'border-white/5 bg-white/5 text-slate-500 cursor-not-allowed opacity-40'
              : 'border-rose-500/20 bg-rose-500/10 text-rose-400 hover:border-rose-500/40 hover:bg-rose-500/20 hover:shadow-[0_0_15px_rgba(244,63,94,0.2)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:shadow-none'
          }`}
        >
          {isPinnedService ? (
            <ShieldAlert className="h-3.5 w-3.5" />
          ) : (
            <Square className="h-3.5 w-3.5 fill-current" />
          )}
          <span>Stop</span>
        </button>

        <button
          onClick={() => onAction('restart', app.name)}
          disabled={isStopped || busy}
          title="Restart service"
          className="flex-none btn-micro flex items-center justify-center h-8 w-8 rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-400 transition-all hover:border-indigo-500/40 hover:bg-indigo-500/20 hover:shadow-[0_0_15px_rgba(99,102,241,0.2)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:shadow-none"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
    </motion.div>
  )
}
