import React from 'react'
import { LayoutDashboard, Terminal, User, Lock, Unlock } from 'lucide-react'
import { UserBadge, type AuthUser } from 'pulse-ui-core'

interface SidebarProps {
  user: AuthUser
  role: 'developer' | 'user'
  onRoleChange: (role: 'developer' | 'user') => void
  hasAdminKey: boolean
  onLockAdmin: () => void
  onRequestAdminUnlock: () => void
  engineConnected: boolean
  onLogout: () => void
}

export function Sidebar({
  user,
  role,
  onRoleChange,
  hasAdminKey,
  onLockAdmin,
  onRequestAdminUnlock,
  engineConnected,
  onLogout,
}: SidebarProps) {
  const handleModeClick = (targetRole: 'developer' | 'user') => {
    if (targetRole === 'developer' && !hasAdminKey) {
      onRequestAdminUnlock()
    } else {
      onRoleChange(targetRole)
    }
  }

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 border-r border-white/5 bg-slate-950/70 backdrop-blur-2xl flex flex-col z-40">
      {/* Brand Header */}
      <div className="flex h-16 items-center gap-3 border-b border-white/5 px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600/30 to-fuchsia-600/20 border border-violet-500/40 shadow-[0_0_20px_rgba(124,58,237,0.3)]">
          <span className="text-lg">⚡</span>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-black tracking-tight text-white drop-shadow-md">
              Pulse
            </span>
            <span className="rounded-md bg-violet-500/20 px-1.5 py-0.2 text-[10px] font-bold uppercase tracking-wider text-violet-300 border border-violet-500/30">
              Hub
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-6 px-4 flex flex-col justify-between">
        <div className="space-y-6">
          {/* Main Navigation */}
          <div>
            <div className="mb-2 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Overview
            </div>
            <button
              className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all bg-violet-600/15 text-violet-300 border border-violet-500/30 shadow-[0_0_15px_rgba(124,58,237,0.15)]"
            >
              <LayoutDashboard className="h-4 w-4" />
              <span>Dashboard</span>
            </button>
          </div>

          {/* Mode Switcher */}
          <div>
            <div className="mb-2 flex items-center justify-between px-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                View Mode
              </span>
              {hasAdminKey ? (
                <button
                  onClick={onLockAdmin}
                  title="Admin Key active. Click to lock."
                  className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                >
                  <Unlock className="h-2.5 w-2.5" />
                  Unlocked
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 border border-white/5">
                  <Lock className="h-2.5 w-2.5" />
                  Protected
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-900/80 p-1 border border-white/5">
              <button
                type="button"
                onClick={() => handleModeClick('user')}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all ${
                  role === 'user'
                    ? 'bg-violet-600 text-white shadow-[0_2px_10px_rgba(124,58,237,0.4)]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <User className="h-3.5 w-3.5" />
                <span>User</span>
              </button>

              <button
                type="button"
                onClick={() => handleModeClick('developer')}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all ${
                  role === 'developer'
                    ? 'bg-violet-600 text-white shadow-[0_2px_10px_rgba(124,58,237,0.4)]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Terminal className="h-3.5 w-3.5" />
                <span>Developer</span>
                {!hasAdminKey && <Lock className="h-2.5 w-2.5 opacity-60 ml-0.5" />}
              </button>
            </div>
            <p className="mt-2 px-2 text-[11px] text-slate-500 leading-tight">
              {role === 'user'
                ? 'Simplified user launchpad. Apps cold-start via gateway proxy.'
                : 'Developer console. Container lifecycle controls authenticated with Admin Key.'}
            </p>
          </div>
        </div>

        {/* Engine Status pill */}
        <div className="rounded-xl border border-white/5 bg-slate-900/60 p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Pulse Engine</span>
            <div className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${
                  engineConnected
                    ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                    : 'bg-rose-500 animate-pulse'
                }`}
              />
              <span className="text-[11px] font-semibold text-slate-300">
                {engineConnected ? 'Connected' : 'Offline'}
              </span>
            </div>
          </div>
          <p className="mt-1 text-[11px] text-slate-500 font-mono">
            localhost:7777 / :9000
          </p>
        </div>
      </div>

      {/* Footer User Badge */}
      <div className="border-t border-white/5 p-4 bg-slate-950/80">
        <UserBadge user={user} onLogout={onLogout} />
      </div>
    </aside>
  )
}
