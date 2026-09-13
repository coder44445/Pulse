"use client";

import type { AuthUser } from "../types/auth";

interface UserBadgeProps {
  user: AuthUser;
  onLogout: () => void;
}

export default function UserBadge({ user, onLogout }: UserBadgeProps) {
  // Derive initials from display name for the avatar circle
  const initials = user.displayName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
      {/* Avatar */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-volt-600/30 text-xs font-bold text-volt-300 ring-1 ring-volt-600/40">
        {initials}
      </div>

      {/* Name + email */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white leading-tight">
          {user.displayName}
        </p>
        <p className="truncate text-xs text-slate-500 leading-tight">{user.email}</p>
      </div>

      {/* Logout */}
      <button
        id="logout-btn"
        onClick={onLogout}
        className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
        title="Sign out"
      >
        Sign out
      </button>
    </div>
  );
}
