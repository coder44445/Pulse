import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { ApplicationDetail } from './types'
import {
  getApplications,
  getApplication,
  startApplication,
  stopApplication,
  restartApplication,
  getStoredAdminKey,
  setStoredAdminKey,
  verifyAdminKey,
} from './api'
import { Sidebar } from './components/Sidebar'
import { AppCard } from './components/AppCard'
import { UserAppCard } from './components/UserAppCard'
import { AdminUnlockModal } from './components/AdminUnlockModal'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth, AuthView, type AuthUser } from 'pulse-ui-core'
import {
  Activity,
  Layers,
  Server,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Search,
  Lock,
  ShieldCheck,
} from 'lucide-react'

// ─── Toast ────────────────────────────────────────────────────────────────────

interface Toast {
  id: number
  type: 'success' | 'error' | 'info'
  message: string
}

function ToastBar({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 items-end pointer-events-none">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: 50, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
            className={`pointer-events-auto flex items-center gap-3 rounded-2xl px-5 py-4 text-sm font-medium shadow-2xl border backdrop-blur-xl ${
              t.type === 'error'
                ? 'bg-rose-950/80 border-rose-500/30 text-rose-100 shadow-[0_10px_30px_rgba(225,29,72,0.2)]'
                : t.type === 'info'
                ? 'bg-sky-950/80 border-sky-500/30 text-sky-100 shadow-[0_10px_30px_rgba(56,189,248,0.2)]'
                : 'bg-emerald-950/80 border-emerald-500/30 text-emerald-100 shadow-[0_10px_30px_rgba(16,185,129,0.2)]'
            }`}
          >
            <span className="text-lg">
              {t.type === 'error' ? '✖' : t.type === 'info' ? 'ℹ' : '✔'}
            </span>
            <span>{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="ml-3 p-1 rounded-full hover:bg-white/10 opacity-70 hover:opacity-100 transition"
            >
              ✕
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAppUrl(route: string) {
  if (/^https?:\/\//i.test(route)) return route
  return `http://localhost:9000${route.startsWith('/') ? route : `/${route}`}`
}

function isUserFacingApp(app: ApplicationDetail): boolean {
  if (!app.routes || app.routes.length === 0) return false
  return app.routes.some((r) => !r.startsWith('/api') && r !== '/healthz')
}

function checkIsAdmin(user: AuthUser | null): boolean {
  if (!user) return false
  const str = `${user.email} ${user.displayName}`.toLowerCase()
  return str.includes('admin') || str.includes('dev')
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function App() {
  const [apps, setApps] = useState<ApplicationDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Track apps currently being mutated
  const [busyApps, setBusyApps] = useState<Set<string>>(new Set())

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextToastId = useRef(1)

  const showToast = useCallback(
    (message: string, type: 'success' | 'error' | 'info' = 'success') => {
      const id = nextToastId.current++
      setToasts((t) => [...t, { id, type, message }])
      setTimeout(() => {
        setToasts((t) => t.filter((toast) => toast.id !== id))
      }, 4000)
    },
    []
  )

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((toast) => toast.id !== id))
  }, [])

  // Auth
  const { state: authState, user, login, register, logout } = useAuth()

  // Role & Admin Key State
  const userIsAdmin = useMemo(() => checkIsAdmin(user), [user])
  const [role, setRole] = useState<'developer' | 'user'>('user')
  const [hasAdminKey, setHasAdminKey] = useState(false)
  const [isUnlockModalOpen, setIsUnlockModalOpen] = useState(false)

  // Verify Admin Key on bootstrap
  useEffect(() => {
    async function checkAuth() {
      const key = getStoredAdminKey()
      if (key) {
        const isValid = await verifyAdminKey(key)
        setHasAdminKey(isValid)
        if (isValid) {
          const savedRole = localStorage.getItem('pulse_view_role') as 'developer' | 'user' | null
          if (savedRole === 'developer' || userIsAdmin) {
            setRole('developer')
          }
        }
      } else if (userIsAdmin) {
        // Test default dev key
        const isDevKeyValid = await verifyAdminKey('pulse-admin-secret')
        if (isDevKeyValid) {
          setStoredAdminKey('pulse-admin-secret')
          setHasAdminKey(true)
          setRole('developer')
        }
      }
    }

    if (user) {
      checkAuth()
    }
  }, [user, userIsAdmin])

  const handleRoleChange = (newRole: 'developer' | 'user') => {
    if (newRole === 'developer' && !hasAdminKey) {
      setIsUnlockModalOpen(true)
      return
    }
    setRole(newRole)
    localStorage.setItem('pulse_view_role', newRole)
  }

  const handleUnlockSuccess = () => {
    setHasAdminKey(true)
    setRole('developer')
    setIsUnlockModalOpen(false)
    localStorage.setItem('pulse_view_role', 'developer')
    showToast('Developer console unlocked with Admin Key', 'success')
  }

  const handleLockAdmin = () => {
    setStoredAdminKey(null)
    setHasAdminKey(false)
    setRole('user')
    localStorage.setItem('pulse_view_role', 'user')
    showToast('Developer console locked. Switched to User View.', 'info')
  }

  // Collapsible infrastructure section state
  const [infraOpen, setInfraOpen] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  // Data fetching
  const refreshApps = useCallback(async () => {
    try {
      const names = await getApplications()
      const loaded = await Promise.all(
        names.map((n) => getApplication(n.name).catch(() => null))
      )
      setApps(loaded.filter((a): a is ApplicationDetail => a !== null))
      setError(null)
    } catch (e: any) {
      setError(e.message || 'Failed to connect to Pulse Engine')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    refreshApps()
    const interval = setInterval(refreshApps, 3000)
    return () => clearInterval(interval)
  }, [refreshApps])

  const handleManualRefresh = () => {
    setRefreshing(true)
    refreshApps()
  }

  // App Actions (Protected with Admin Key)
  const handleAction = async (action: 'start' | 'stop' | 'restart', id: string) => {
    setBusyApps((prev) => new Set(prev).add(id))
    
    // Optimistic status update
    setApps((currentApps) =>
      currentApps.map((a) =>
        a.name === id
          ? { ...a, status: action === 'stop' ? 'stopping' : 'starting' }
          : a
      )
    )

    try {
      if (action === 'start') await startApplication(id)
      else if (action === 'stop') await stopApplication(id)
      else await restartApplication(id)
      
      showToast(`Successfully requested to ${action} ${id}`)
    } catch (err: any) {
      if (err.message?.includes('Authentication Required') || err.message?.includes('Unauthorized')) {
        setHasAdminKey(false)
        setIsUnlockModalOpen(true)
      }
      showToast(`Failed to ${action} ${id}: ${err.message}`, 'error')
    } finally {
      setTimeout(() => {
        setBusyApps((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        refreshApps()
      }, 1000)
    }
  }

  // Normal User Launch: Navigates in the SAME window/tab through Port 9000 Gateway
  // The gateway automatically cold-starts on-demand services without requiring admin permissions!
  const handleUserLaunch = (id: string, route: string) => {
    showToast(`Launching ${id}…`, 'info')
    setTimeout(() => {
      window.location.href = getAppUrl(route)
    }, 350)
  }

  // Partition applications: User-facing vs Infrastructure
  const { userFacingApps, infraApps, stats } = useMemo(() => {
    const userFacing: ApplicationDetail[] = []
    const infra: ApplicationDetail[] = []
    let runningCount = 0
    let stoppedCount = 0
    let pinnedCount = 0

    const query = searchQuery.trim().toLowerCase()
    const filtered = query
      ? apps.filter(
          (a) =>
            a.name.toLowerCase().includes(query) ||
            a.routes?.some((r) => r.toLowerCase().includes(query)) ||
            (a.dependencies || []).some((d) => d.toLowerCase().includes(query))
        )
      : apps

    for (const app of filtered) {
      if (app.status === 'running') runningCount++
      else stoppedCount++
      if ((app.tier ?? 2) <= 1) pinnedCount++

      if (isUserFacingApp(app)) {
        userFacing.push(app)
      } else {
        infra.push(app)
      }
    }

    return {
      userFacingApps: userFacing,
      infraApps: infra,
      stats: {
        total: apps.length,
        running: runningCount,
        stopped: stoppedCount,
        pinned: pinnedCount,
      },
    }
  }, [apps, searchQuery])

  // ── Auth Gates ─────────────────────────────────────────────────────────────

  if (authState.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100 selection:bg-indigo-500/30">
        <span className="animate-spin-fast inline-block w-8 h-8 border-[3px] border-violet-500 border-t-transparent rounded-full shadow-[0_0_15px_rgba(124,58,237,0.5)]" />
      </div>
    )
  }

  if (authState.status === 'unauthenticated') {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-indigo-500/30">
        <AuthView onLogin={login} onRegister={register} />
      </div>
    )
  }

  // ── Render Dashboard ───────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen text-slate-100 selection:bg-violet-500/30">
      <Sidebar
        user={user!}
        role={role}
        onRoleChange={handleRoleChange}
        isAdmin={userIsAdmin}
        hasAdminKey={hasAdminKey}
        onLockAdmin={handleLockAdmin}
        onRequestAdminUnlock={() => setIsUnlockModalOpen(true)}
        engineConnected={!error}
        onLogout={logout}
      />

      <main className="flex-1 ml-64 p-8 relative">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Header */}
          <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-white/5">
            <div>
              {role === 'user' ? (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold uppercase tracking-wider text-violet-400">
                      Application Launchpad
                    </span>
                  </div>
                  <h1 className="text-3xl font-extrabold tracking-tight text-white shadow-indigo-500/20 drop-shadow-lg">
                    Welcome back, {user?.displayName} 👋
                  </h1>
                  <p className="mt-1 text-sm text-slate-400">
                    Select an application below to launch and start playing.
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold uppercase tracking-wider text-violet-400">
                      Developer Control Plane
                    </span>
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300 border border-emerald-500/20">
                      <ShieldCheck className="h-3 w-3" />
                      Admin Key Authenticated
                    </span>
                  </div>
                  <h1 className="text-3xl font-extrabold tracking-tight text-white drop-shadow-lg">
                    Microservice Dashboard
                  </h1>
                  <p className="mt-1 text-sm text-slate-400">
                    Manage service dependencies, state tiers, and container lifecycles.
                  </p>
                </>
              )}
            </div>

            {/* Quick Actions / Refresh */}
            <div className="flex items-center gap-3">
              {role === 'developer' && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search services…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="rounded-xl border border-white/10 bg-slate-900/60 pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                  />
                </div>
              )}

              <button
                onClick={handleManualRefresh}
                disabled={refreshing}
                title="Refresh services"
                className="btn-micro flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/60 px-4 py-2 text-xs font-semibold text-slate-300 transition-all hover:bg-slate-800 hover:text-white"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>
          </header>

          {/* Developer Mode Stats Bar */}
          {role === 'developer' && !loading && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="glass rounded-2xl p-4 border border-white/5 bg-slate-900/40">
                <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Total Services
                </span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-black text-white">{stats.total}</span>
                  <span className="text-xs text-slate-500">managed</span>
                </div>
              </div>

              <div className="glass rounded-2xl p-4 border border-white/5 bg-slate-900/40">
                <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Running
                </span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-black text-emerald-400">{stats.running}</span>
                  <span className="text-xs text-emerald-400/60">active</span>
                </div>
              </div>

              <div className="glass rounded-2xl p-4 border border-white/5 bg-slate-900/40">
                <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Stopped / Idle
                </span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-black text-slate-400">{stats.stopped}</span>
                  <span className="text-xs text-slate-500">cold</span>
                </div>
              </div>

              <div className="glass rounded-2xl p-4 border border-white/5 bg-slate-900/40">
                <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Pinned (Tiers 0 & 1)
                </span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-black text-indigo-400">{stats.pinned}</span>
                  <span className="text-xs text-indigo-400/60">always on</span>
                </div>
              </div>
            </div>
          )}

          {/* Loading or Error States */}
          {loading && apps.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-slate-400">
              <span className="animate-spin-fast inline-block w-8 h-8 border-[3px] border-violet-500 border-t-transparent rounded-full mb-4 shadow-[0_0_15px_rgba(124,58,237,0.5)]" />
              <p className="text-lg font-medium text-slate-300">Connecting to Pulse Engine…</p>
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-8 text-center glass-panel">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/20 shadow-[0_0_20px_rgba(244,63,94,0.3)]">
                <span className="text-xl">⚠️</span>
              </div>
              <h3 className="mb-2 text-lg font-bold text-rose-300">Pulse Engine Unreachable</h3>
              <p className="text-rose-400/80 mb-6 text-sm">{error}</p>
              <button
                onClick={refreshApps}
                className="btn-micro bg-white/10 hover:bg-white/20 text-white px-5 py-2.5 rounded-xl font-medium transition-colors"
              >
                Reconnect
              </button>
            </div>
          ) : role === 'user' ? (
            /* ─────────────────────────────────────────────────────────────
               NORMAL USER VIEW: Clean, friendly hero cards only
               ───────────────────────────────────────────────────────────── */
            <section className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <AnimatePresence mode="popLayout">
                  {userFacingApps.map((app) => (
                    <UserAppCard
                      key={app.name}
                      app={app}
                      busy={busyApps.has(app.name)}
                      onLaunch={handleUserLaunch}
                    />
                  ))}
                </AnimatePresence>
              </div>

              {userFacingApps.length === 0 && (
                <div className="rounded-3xl border border-white/5 bg-slate-900/40 p-12 text-center glass">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 text-3xl">
                    🚀
                  </div>
                  <h3 className="text-lg font-bold text-white mb-1">No Applications Available</h3>
                  <p className="text-sm text-slate-400 max-w-sm mx-auto">
                    There are currently no active user-facing applications configured in Pulse.
                  </p>
                </div>
              )}
            </section>
          ) : (
            /* ─────────────────────────────────────────────────────────────
               DEVELOPER MODE VIEW: Grouped sections with rich cards & controls
               ───────────────────────────────────────────────────────────── */
            <div className="space-y-10">
              {/* Section 1: User-Facing Applications */}
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-violet-400" />
                    <h2 className="text-lg font-bold tracking-tight text-white">
                      User Applications
                    </h2>
                    <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-xs font-semibold text-violet-300 border border-violet-500/30">
                      {userFacingApps.length}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500">
                    Frontends cold-started on demand
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  <AnimatePresence mode="popLayout">
                    {userFacingApps.map((app) => (
                      <AppCard
                        key={app.name}
                        app={app}
                        busy={busyApps.has(app.name)}
                        onAction={handleAction}
                      />
                    ))}
                  </AnimatePresence>
                </div>

                {userFacingApps.length === 0 && (
                  <p className="rounded-2xl border border-white/5 bg-slate-900/30 p-8 text-center text-sm text-slate-500">
                    No user-facing applications match the filter.
                  </p>
                )}
              </section>

              {/* Section 2: Infrastructure & Backend Services (Collapsible) */}
              <section className="rounded-3xl border border-white/5 bg-slate-900/20 p-6 glass">
                <div
                  onClick={() => setInfraOpen((prev) => !prev)}
                  className="flex items-center justify-between cursor-pointer select-none pb-2"
                >
                  <div className="flex items-center gap-3">
                    <Server className="h-4 w-4 text-indigo-400" />
                    <h2 className="text-lg font-bold tracking-tight text-white">
                      Infrastructure & Microservices
                    </h2>
                    <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-xs font-semibold text-indigo-300 border border-indigo-500/30">
                      {infraApps.length}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
                    <span className="text-xs font-medium">
                      {infraOpen ? 'Collapse' : 'Expand'}
                    </span>
                    {infraOpen ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </div>

                <p className="text-xs text-slate-500 mb-6">
                  Core control-plane, pinned services (Identity, Persona), and backing APIs.
                </p>

                <AnimatePresence>
                  {infraOpen && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pt-2">
                        {infraApps.map((app) => (
                          <AppCard
                            key={app.name}
                            app={app}
                            busy={busyApps.has(app.name)}
                            onAction={handleAction}
                          />
                        ))}
                      </div>

                      {infraApps.length === 0 && (
                        <p className="py-8 text-center text-sm text-slate-500">
                          No infrastructure services found.
                        </p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>
            </div>
          )}
        </div>
      </main>

      <AdminUnlockModal
        isOpen={isUnlockModalOpen}
        onClose={() => setIsUnlockModalOpen(false)}
        onSuccess={handleUnlockSuccess}
      />

      <ToastBar toasts={toasts} dismiss={dismissToast} />
    </div>
  )
}
