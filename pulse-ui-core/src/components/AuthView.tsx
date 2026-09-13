"use client";

import { useState, FormEvent } from "react";

interface AuthViewProps {
  onRegister: (email: string, password: string, displayName: string) => Promise<void>;
  onLogin: (email: string, password: string) => Promise<void>;
}

type Tab = "login" | "register";

export default function AuthView({ onRegister, onLogin }: AuthViewProps) {
  const [tab, setTab] = useState<Tab>("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const switchTab = (t: Tab) => {
    setTab(t);
    setError("");
    setDisplayName("");
    setEmail("");
    setPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (tab === "register") {
      if (!displayName.trim()) { setError("Display name is required."); return; }
      if (displayName.trim().length < 2) { setError("Display name must be at least 2 characters."); return; }
      if (password !== confirmPassword) { setError("Passwords do not match."); return; }
      if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    }

    setLoading(true);
    try {
      if (tab === "register") {
        await onRegister(email.trim(), password, displayName.trim());
      } else {
        await onLogin(email.trim(), password);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Authentication failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-16">
      <div className="w-full max-w-[440px] animate-scale-in">

        {/* Hero Branding */}
        <div className="mb-10 text-center">
          <div className="group relative mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600/20 to-fuchsia-600/20 p-1 shadow-[0_0_40px_rgba(124,58,237,0.15)] ring-1 ring-white/10 transition-all duration-500 hover:shadow-[0_0_60px_rgba(124,58,237,0.3)]">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-100"></div>
            <span className="relative text-4xl drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]">⚡️</span>
          </div>
          <h1 className="text-4xl font-black tracking-tight text-white drop-shadow-sm">
            Pulse <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">Hub</span>
          </h1>
          <p className="mt-3 text-sm text-slate-400">Centralized Identity & Access Management</p>
        </div>

        {/* Auth Card */}
        <div className="glass-panel relative overflow-hidden rounded-3xl p-6 sm:p-10">
          
          {/* Subtle top glare */}
          <div className="absolute inset-x-0 -top-px h-px w-full bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>

          {/* Tab switcher */}
          <div className="relative mb-8 flex rounded-2xl bg-slate-900/60 p-1.5 shadow-inner ring-1 ring-white/5">
            {(["login", "register"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => switchTab(t)}
                className={`relative z-10 flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all duration-300 ${
                  tab === t
                    ? "bg-violet-600 text-white shadow-[0_4px_12px_rgba(124,58,237,0.3)]"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {t === "login" ? "Sign In" : "Create Account"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Display name — register only */}
            {tab === "register" && (
              <div className="animate-toast-in">
                <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">
                  Display Name
                </label>
                <input
                  id="auth-display-name"
                  className="input-field"
                  placeholder="How you'll appear in apps"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={32}
                  autoFocus={tab === "register"}
                  autoComplete="nickname"
                  required
                />
              </div>
            )}

            {/* Email */}
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">
                Email Address
              </label>
              <input
                id="auth-email"
                type="email"
                className="input-field"
                placeholder="hello@pulse.dev"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus={tab === "login"}
                autoComplete={tab === "login" ? "email" : "email"}
                required
              />
            </div>

            {/* Password */}
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                className="input-field"
                placeholder={tab === "register" ? "At least 8 characters" : "••••••••"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={tab === "login" ? "current-password" : "new-password"}
                required
              />
            </div>

            {/* Confirm password — register only */}
            {tab === "register" && (
              <div className="animate-toast-in">
                <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">
                  Confirm Password
                </label>
                <input
                  id="auth-confirm-password"
                  type="password"
                  className="input-field"
                  placeholder="Verify your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="animate-scale-in rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm font-medium text-rose-400 shadow-inner">
                {error}
              </div>
            )}

            {/* Submit Button */}
            <div className="pt-2">
              <button
                id="auth-submit"
                type="submit"
                className="btn-primary w-full py-4 text-[15px] tracking-wide"
                disabled={loading}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-3">
                    <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {tab === "login" ? "Authenticating…" : "Provisioning identity…"}
                  </span>
                ) : tab === "login" ? (
                  "Access Hub ➔"
                ) : (
                  "Initialize Account ✦"
                )}
              </button>
            </div>
          </form>
        </div>

        <p className="mt-8 text-center text-[13px] font-medium text-slate-500">
          Secure Access to the Pulse Microservice Ecosystem
        </p>
      </div>
    </div>
  );
}
