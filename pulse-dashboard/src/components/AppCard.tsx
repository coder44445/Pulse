import React from 'react'
import { motion } from 'framer-motion'
import { Play, Square, RefreshCw, Activity, Terminal } from 'lucide-react'
import { ApplicationDetail } from '../types'
import { StatusBadge, statusColor } from './StatusBadge'

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
  const s = statusColor(app.status)
  const isRunning = app.status === 'running'
  const isStopped = app.status === 'stopped'
  const isStarting = app.status === 'starting'

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ scale: 1.02 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={`glass group relative overflow-hidden rounded-2xl transition-colors duration-500 hover:bg-slate-800/60 hover-glow`}
    >
      {/* Accent Gradient Background for Running apps */}
      {isRunning && (
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent pointer-events-none" />
      )}
      
      {/* Left accent bar */}
      <motion.div 
        layout
        className={`absolute left-0 top-0 bottom-0 w-1 transition-all duration-500 ${isRunning ? 'bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.8)]' : isStarting ? 'bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.8)] animate-pulse' : 'bg-transparent group-hover:bg-indigo-500/30'}`}
      />

      <div className="p-6 ml-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <span className="text-xl font-bold text-white tracking-tight truncate">
                {app.name}
              </span>
              <StatusBadge status={app.status} />
            </div>
            
            <div className="flex items-center gap-4 mt-3">
              <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium bg-white/5 px-2 py-1 rounded-md border border-white/5">
                <Activity className="w-3 h-3 text-indigo-400" />
                <span>{app.routes?.length || 0} Routes</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium bg-white/5 px-2 py-1 rounded-md border border-white/5">
                <Terminal className="w-3 h-3 text-emerald-400" />
                <span>{Object.keys(app.stacks || {}).length} Stacks</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2 pt-4 border-t border-white/5">
          {app.routes?.[0] && (
            <a
              href={getAppUrl(app.routes[0])}
              target="_blank"
              rel="noreferrer"
              className="flex-1 btn-micro flex items-center justify-center gap-2 rounded-xl bg-sky-500/10 px-4 py-2.5 text-sm font-semibold text-sky-300 border border-sky-500/20
                hover:bg-sky-500/20 hover:border-sky-500/40 hover:shadow-[0_0_15px_rgba(59,130,246,0.15)] transition-all"
            >
              <Activity className="w-4 h-4" />
              Open
            </a>
          )}

          <button
            onClick={() => onAction('start', app.name)}
            disabled={isRunning || busy}
            className="flex-1 btn-micro flex items-center justify-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-400 border border-emerald-500/20
              hover:bg-emerald-500/20 hover:border-emerald-500/40 hover:shadow-[0_0_15px_rgba(16,185,129,0.15)] transition-all disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:shadow-none"
          >
            {busy && isStarting ? (
              <span className="animate-spin-fast inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            Start
          </button>
          
          <button
            onClick={() => onAction('stop', app.name)}
            disabled={isStopped || busy}
            className="flex-1 btn-micro flex items-center justify-center gap-2 rounded-xl bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-400 border border-rose-500/20
              hover:bg-rose-500/20 hover:border-rose-500/40 hover:shadow-[0_0_15px_rgba(244,63,94,0.15)] transition-all disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:shadow-none"
          >
            <Square className="w-4 h-4 fill-current" />
            Stop
          </button>

          <button
            onClick={() => onAction('restart', app.name)}
            disabled={isStopped || busy}
            className="flex-none btn-micro flex items-center justify-center w-10 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20
              hover:bg-indigo-500/20 hover:border-indigo-500/40 hover:shadow-[0_0_15px_rgba(99,102,241,0.15)] transition-all disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:shadow-none"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
