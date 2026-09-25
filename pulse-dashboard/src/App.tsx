import { useEffect, useState, useCallback, useRef } from 'react'
import { Application, ApplicationDetail } from './types'
import {
  getApplications,
  getApplication,
  startApplication,
  stopApplication,
  restartApplication,
} from './api'
import { Sidebar } from './components/Sidebar'
import { AppCard } from './components/AppCard'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth, AuthView } from 'pulse-ui-core'

// ─── Toast ────────────────────────────────────────────────────────────────────

interface Toast {
  id: number
  type: 'success' | 'error'
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
            className={`pointer-events-auto flex items-center gap-3 rounded-2xl px-5 py-4 text-sm font-medium shadow-2xl border backdrop-blur-xl
              ${t.type === 'error'
                ? 'bg-rose-950/80 border-rose-500/30 text-rose-100 shadow-[0_10px_30px_rgba(225,29,72,0.2)]'
                : 'bg-emerald-950/80 border-emerald-500/30 text-emerald-100 shadow-[0_10px_30px_rgba(16,185,129,0.2)]'
              }`}
          >
            <span className="text-lg">{t.type === 'error' ? '✖' : '✔'}</span>
            <span>{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="ml-3 p-1 rounded-full hover:bg-white/10 opacity-70 hover:opacity-100 transition">✕</button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

function getAppUrl(route: string) {
  if (/^https?:\/\//i.test(route)) return route
  return `http://localhost:9000${route.startsWith('/') ? route : `/${route}`}`
}

export default function App() {
  const [apps, setApps] = useState<ApplicationDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Track apps currently being mutated
  const [busyApps, setBusyApps] = useState<Set<string>>(new Set())

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextToastId = useRef(1)

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = nextToastId.current++
    setToasts((t) => [...t, { id, type, message }])
    setTimeout(() => {
      setToasts((t) => t.filter((toast) => toast.id !== id))
    }, 4000)
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((toast) => toast.id !== id))
  }, [])

  // Auth and View State
  const { state: authState, user, login, register, logout } = useAuth()
  const [currentView, setCurrentView] = useState<'store' | 'console'>('store')

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
    }
  }, [])

  useEffect(() => {
    refreshApps()
    const interval = setInterval(refreshApps, 3000)
    return () => clearInterval(interval)
  }, [refreshApps])

  // Actions
  const handleAction = async (action: 'start' | 'stop' | 'restart', id: string) => {
    setBusyApps((prev) => new Set(prev).add(id))
    
    // Optimistically update the UI to 'starting' or 'stopping' for immediate feedback
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
      showToast(`Failed to ${action} ${id}: ${err.message}`, 'error')
    } finally {
      // Small delay before unmarking busy to allow the next poll to catch the real status
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

  // Render
  if (authState.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-100 selection:bg-indigo-500/30">
        <span className="animate-spin-fast inline-block w-8 h-8 border-[3px] border-indigo-500 border-t-transparent rounded-full shadow-[0_0_15px_rgba(99,102,241,0.5)]" />
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

  const storeApps = apps.filter((a) => a.routes?.length > 0)

  return (
    <div className="flex min-h-screen text-slate-100 selection:bg-indigo-500/30">
      <Sidebar 
        currentView={currentView}
        onNavClick={setCurrentView}
        user={user!}
        onLogout={logout}
      />
      
      <main className="flex-1 ml-64 p-8 relative">
        <div className="max-w-6xl mx-auto">
          
          <header className="mb-10 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2 shadow-indigo-500/20 drop-shadow-lg">
                {currentView === 'store' ? 'App Store' : 'Developer Console'}
              </h1>
              <p className="text-slate-400">
                {currentView === 'store' ? 'Launch your favorite applications.' : 'Manage your microservices and infrastructure.'}
              </p>
            </div>
            
            <div className="flex gap-3">
              <button className="btn-micro bg-indigo-500 hover:bg-indigo-400 text-white px-5 py-2.5 rounded-xl font-semibold shadow-[0_0_20px_rgba(99,102,241,0.4)] transition-all">
                New App
              </button>
            </div>
          </header>

          {loading && apps.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-slate-400">
              <span className="animate-spin-fast inline-block w-8 h-8 border-[3px] border-indigo-500 border-t-transparent rounded-full mb-4 shadow-[0_0_15px_rgba(99,102,241,0.5)]" />
              <p className="text-lg">Connecting to Pulse Engine...</p>
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-8 text-center glass-panel">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/20 shadow-[0_0_20px_rgba(244,63,94,0.3)]">
                <span className="text-xl">⚠️</span>
              </div>
              <h3 className="mb-2 text-lg font-bold text-rose-300">Connection Failed</h3>
              <p className="text-rose-400/80 mb-6">{error}</p>
              <button
                onClick={refreshApps}
                className="btn-micro bg-white/10 hover:bg-white/20 text-white px-5 py-2.5 rounded-xl font-medium transition-colors"
              >
                Try Again
              </button>
            </div>
          ) : currentView === 'console' ? (
            <motion.div 
              layout
              className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
            >
              <AnimatePresence mode="popLayout">
                {apps.map((app) => (
                  <AppCard
                    key={app.name}
                    app={app}
                    busy={busyApps.has(app.name)}
                    onAction={handleAction}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div 
              layout
              className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
            >
              <AnimatePresence mode="popLayout">
                {storeApps.map((app) => (
                  <motion.div
                    key={app.name}
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="relative flex flex-col justify-between overflow-hidden rounded-3xl border border-white/10 bg-slate-900/50 p-6 shadow-2xl glass-panel transition-all hover:bg-slate-800/50"
                  >
                    <div>
                      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/10 border border-indigo-500/30 text-3xl mb-4">
                        {app.name.includes('quiz') ? '🧠' : '🚀'}
                      </div>
                      <h3 className="text-xl font-bold text-white mb-2 capitalize">{app.name.replace('-ui', '')}</h3>
                      <p className="text-slate-400 text-sm mb-6">
                        {app.description || 'A Pulse Application'}
                      </p>
                    </div>
                    <a
                      href={getAppUrl(app.routes[0])}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-primary w-full py-3 text-center block"
                    >
                      Play Now
                    </a>
                  </motion.div>
                ))}
                {storeApps.length === 0 && (
                  <p className="text-slate-400 col-span-full py-12 text-center">No apps available in the store yet.</p>
                )}
              </AnimatePresence>
            </motion.div>
          )}

        </div>
      </main>

      <ToastBar toasts={toasts} dismiss={dismissToast} />
    </div>
  )
}
