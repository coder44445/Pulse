import React from 'react'
import { motion } from 'framer-motion'
import { ExternalLink, Play, Sparkles } from 'lucide-react'
import { ApplicationDetail } from '../types'
import { getAppMeta } from '../appMeta'

interface UserAppCardProps {
  app: ApplicationDetail
  busy: boolean
  onLaunch: (id: string, route: string) => void
}

function getAppUrl(route: string) {
  if (/^https?:\/\//i.test(route)) return route
  return `http://localhost:9000${route.startsWith('/') ? route : `/${route}`}`
}

export function UserAppCard({ app, busy, onLaunch }: UserAppCardProps) {
  const meta = getAppMeta(app.name, app.routes)
  const isRunning = app.status === 'running'
  const isStarting = app.status === 'starting' || busy
  const primaryRoute = app.routes?.[0] || ''

  const handleLaunchClick = () => {
    if (isRunning) {
      window.open(getAppUrl(primaryRoute), '_blank', 'noreferrer')
    } else {
      onLaunch(app.name, primaryRoute)
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="group relative flex flex-col justify-between overflow-hidden rounded-3xl border border-white/10 bg-slate-900/60 p-7 shadow-2xl glass-panel transition-all hover:border-violet-500/40 hover:bg-slate-800/60 hover:shadow-[0_12px_40px_rgba(124,58,237,0.18)]"
    >
      {/* Background ambient glow */}
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-violet-600/10 blur-3xl transition-opacity group-hover:opacity-100" />
      
      <div>
        {/* Top bar: Icon & Status */}
        <div className="mb-6 flex items-start justify-between">
          <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-600/20 to-fuchsia-600/10 p-1 shadow-[0_0_30px_rgba(124,58,237,0.15)] ring-1 ring-white/10 transition-transform group-hover:scale-105">
            <span className="text-4xl">{meta.icon}</span>
          </div>

          <div className="flex flex-col items-end gap-1.5">
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {meta.category}
            </span>
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  isRunning
                    ? 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]'
                    : isStarting
                    ? 'animate-status-pulse bg-indigo-400 shadow-[0_0_12px_rgba(99,102,241,0.8)]'
                    : 'bg-slate-500'
                }`}
              />
              <span className="text-xs font-medium text-slate-300">
                {isRunning ? 'Online' : isStarting ? 'Starting…' : 'Ready'}
              </span>
            </div>
          </div>
        </div>

        {/* Title & Description */}
        <h3 className="mb-2 text-2xl font-bold tracking-tight text-white group-hover:text-violet-200 transition-colors">
          {meta.title}
        </h3>
        <p className="mb-8 text-sm leading-relaxed text-slate-300/80">
          {meta.description}
        </p>
      </div>

      {/* Launch Action */}
      <div className="pt-2">
        <button
          onClick={handleLaunchClick}
          disabled={isStarting}
          className="btn-primary w-full py-4 text-center font-semibold text-base tracking-wide flex items-center justify-center gap-2 shadow-[0_0_25px_rgba(124,58,237,0.35)]"
        >
          {isStarting ? (
            <>
              <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span>Starting App…</span>
            </>
          ) : isRunning ? (
            <>
              <Sparkles className="w-5 h-5" />
              <span>Launch App</span>
              <ExternalLink className="w-4 h-4 ml-1 opacity-70" />
            </>
          ) : (
            <>
              <Play className="w-5 h-5 fill-current" />
              <span>Start & Launch</span>
            </>
          )}
        </button>
      </div>
    </motion.div>
  )
}
