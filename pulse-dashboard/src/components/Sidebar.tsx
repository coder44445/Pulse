import React from 'react'
import { Activity, LayoutDashboard, Server, Settings } from 'lucide-react'

import { UserBadge, type AuthUser } from 'pulse-ui-core'

interface SidebarProps {
  currentView: 'store' | 'console'
  onNavClick: (item: 'store' | 'console') => void
  user: AuthUser
  onLogout: () => void
}

export function Sidebar({ currentView, onNavClick, user, onLogout }: SidebarProps) {
  return (
    <aside className="fixed left-0 top-0 h-screen w-64 border-r border-white/5 bg-slate-950/50 backdrop-blur-xl flex flex-col z-40">
      <div className="flex h-16 items-center gap-3 border-b border-white/5 px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.3)] border border-indigo-500/30">
          <Activity className="h-5 w-5 text-indigo-400" />
        </div>
        <span className="text-xl font-bold tracking-tight text-white shadow-indigo-500/50 drop-shadow-md">
          Pulse
        </span>
      </div>
      
      <div className="flex-1 overflow-y-auto py-6 px-4">
        <nav className="flex flex-col gap-2">
          <button
            onClick={() => onNavClick('store')}
            className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all ${
              currentView === 'store'
                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shadow-[0_0_15px_rgba(99,102,241,0.15)]'
                : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
            }`}
          >
            <LayoutDashboard className="h-4 w-4" />
            App Store
          </button>
          <button
            onClick={() => onNavClick('console')}
            className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all ${
              currentView === 'console'
                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shadow-[0_0_15px_rgba(99,102,241,0.15)]'
                : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
            }`}
          >
            <Server className="h-4 w-4" />
            Developer Console
          </button>
        </nav>
      </div>

      <div className="border-t border-white/5 p-4">
        <UserBadge user={user} onLogout={onLogout} />
      </div>
    </aside>
  )
}
