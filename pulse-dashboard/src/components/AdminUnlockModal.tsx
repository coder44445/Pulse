import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { KeyRound, Lock, Eye, EyeOff, AlertCircle, ShieldCheck } from 'lucide-react'
import { verifyAdminKey, setStoredAdminKey } from '../api'

interface AdminUnlockModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export function AdminUnlockModal({ isOpen, onClose, onSuccess }: AdminUnlockModalProps) {
  const [adminKey, setAdminKey] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!adminKey.trim()) {
      setError('Admin key cannot be empty')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const isValid = await verifyAdminKey(adminKey.trim())
      if (isValid) {
        setStoredAdminKey(adminKey.trim())
        onSuccess()
      } else {
        setError('Invalid Admin Key. Access denied.')
      }
    } catch {
      setError('Failed to reach Pulse Engine. Check connection.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-slate-900/90 p-8 shadow-2xl glass-panel"
      >
        {/* Top Glare */}
        <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-violet-400/40 to-transparent" />

        <div className="text-center mb-6">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600/30 to-fuchsia-600/20 border border-violet-500/40 shadow-[0_0_30px_rgba(124,58,237,0.25)]">
            <Lock className="h-6 w-6 text-violet-300" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-white">
            Developer Access Required
          </h2>
          <p className="mt-2 text-xs text-slate-400 leading-relaxed">
            Enter your control plane Admin Key to unlock microservice lifecycle controls.
          </p>
        </div>

        <form onSubmit={handleUnlock} className="space-y-4">
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">
              Admin Key
            </label>
            <div className="relative">
              <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter PULSE_ADMIN_KEY…"
                value={adminKey}
                onChange={(e) => {
                  setAdminKey(e.target.value)
                  setError(null)
                }}
                autoFocus
                className="input-field pl-10 pr-10 text-sm font-mono tracking-wider"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              Default dev key: <code className="text-violet-400">pulse-admin-secret</code>
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 rounded-xl border border-white/10 bg-white/5 py-3 text-xs font-semibold text-slate-300 hover:bg-white/10 hover:text-white transition-all disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 btn-primary py-3 text-xs font-semibold flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="animate-spin h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full" />
                  <span>Verifying…</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  <span>Unlock Console</span>
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}
