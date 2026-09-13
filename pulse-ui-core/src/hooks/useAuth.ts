"use client";

/**
 * useAuth — Identity Service integration hook.
 *
 * Responsibilities:
 *  - register / login / logout via Identity Service REST API
 *  - persist tokens in localStorage (access_token, refresh_token, user)
 *  - auto-refresh the access token 60 seconds before expiry
 *  - decode display_name from JWT claims (no extra Persona call needed at login)
 *  - expose the raw access token so useGameSocket can attach it to the WS URL
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { coreConfig } from "../lib/config";
import type { AuthState, AuthTokens, AuthUser } from "../types/auth";

// ─── JWT decode (no library needed — just base64 the payload) ─────────────────

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch {
    return {};
  }
}

// ─── localStorage keys ────────────────────────────────────────────────────────

const LS_TOKENS = "oq_auth_tokens";
const LS_USER   = "oq_auth_user";

function loadPersistedAuth(): { tokens: AuthTokens; user: AuthUser } | null {
  try {
    const t = localStorage.getItem(LS_TOKENS);
    const u = localStorage.getItem(LS_USER);
    if (!t || !u) return null;
    return { tokens: JSON.parse(t), user: JSON.parse(u) };
  } catch {
    return null;
  }
}

function persistAuth(user: AuthUser, tokens: AuthTokens) {
  localStorage.setItem(LS_TOKENS, JSON.stringify(tokens));
  localStorage.setItem(LS_USER, JSON.stringify(user));
}

function clearPersistedAuth() {
  localStorage.removeItem(LS_TOKENS);
  localStorage.removeItem(LS_USER);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth() {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Schedule a silent token refresh 60s before expiry ─────────────────────
  const scheduleRefresh = useCallback((tokens: AuthTokens, user: AuthUser) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);

    const msUntilExpiry = tokens.expiresAt - Date.now();
    const msUntilRefresh = Math.max(msUntilExpiry - 60_000, 0);

    refreshTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${coreConfig.identityUrl}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: tokens.refreshToken }),
        });

        if (!res.ok) {
          // Refresh token expired — force logout
          clearPersistedAuth();
          setState({ status: "unauthenticated" });
          return;
        }

        const data = await res.json();
        const _payload = decodeJwtPayload(data.access_token);
        const newTokens: AuthTokens = {
          accessToken: data.access_token,
          refreshToken: tokens.refreshToken, // keep same refresh token
          expiresAt: Date.now() + (data.expires_in ?? 900) * 1000,
        };

        persistAuth(user, newTokens);
        setState({ status: "authenticated", user, tokens: newTokens });
        scheduleRefresh(newTokens, user);
      } catch {
        // Network error — keep current token, retry later
      }
    }, msUntilRefresh);
  }, []);

  // ── Bootstrap from localStorage on mount ──────────────────────────────────
  useEffect(() => {
    const persisted = loadPersistedAuth();

    if (!persisted) {
      setState({ status: "unauthenticated" });
      return;
    }

    const { tokens, user } = persisted;

    // If access token is already expired, try to refresh immediately
    if (Date.now() >= tokens.expiresAt) {
      fetch(`${coreConfig.identityUrl}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: tokens.refreshToken }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) {
            clearPersistedAuth();
            setState({ status: "unauthenticated" });
            return;
          }
          const newTokens: AuthTokens = {
            accessToken: data.access_token,
            refreshToken: tokens.refreshToken,
            expiresAt: Date.now() + (data.expires_in ?? 900) * 1000,
          };
          persistAuth(user, newTokens);
          setState({ status: "authenticated", user, tokens: newTokens });
          scheduleRefresh(newTokens, user);
        })
        .catch(() => {
          clearPersistedAuth();
          setState({ status: "unauthenticated" });
        });
    } else {
      setState({ status: "authenticated", user, tokens });
      scheduleRefresh(tokens, user);
    }

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [scheduleRefresh]);

  // ── Register ──────────────────────────────────────────────────────────────
  const register = useCallback(
    async (email: string, password: string, displayName: string): Promise<void> => {
      const res = await fetch(`${coreConfig.identityUrl}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, display_name: displayName }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? "Registration failed. Please try again.");
      }

      const data = await res.json();
      const _payload = decodeJwtPayload(data.access_token);

      const user: AuthUser = {
        userId: data.user_id,
        displayName: data.display_name,
        email,
      };
      const tokens: AuthTokens = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + (data.expires_in ?? 900) * 1000,
      };

      persistAuth(user, tokens);
      setState({ status: "authenticated", user, tokens });
      scheduleRefresh(tokens, user);
    },
    [scheduleRefresh]
  );

  // ── Login ─────────────────────────────────────────────────────────────────
  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      const res = await fetch(`${coreConfig.identityUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        throw new Error("Invalid email or password.");
      }

      const data = await res.json();
      const payload = decodeJwtPayload(data.access_token);

      const displayName =
        (payload.display_name as string) ??
        email.split("@")[0];

      const user: AuthUser = {
        userId: payload.sub as string,
        displayName,
        email,
      };
      const tokens: AuthTokens = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + (data.expires_in ?? 900) * 1000,
      };

      persistAuth(user, tokens);
      setState({ status: "authenticated", user, tokens });
      scheduleRefresh(tokens, user);
    },
    [scheduleRefresh]
  );

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    const current = state;
    clearPersistedAuth();
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    setState({ status: "unauthenticated" });

    // Fire-and-forget revocation — don't block UI on it
    if (current.status === "authenticated") {
      fetch(`${coreConfig.identityUrl}/auth/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${current.tokens.accessToken}`,
        },
        body: JSON.stringify({ refresh_token: current.tokens.refreshToken }),
      }).catch(() => {});
    }
  }, [state]);

  // ── Derived helpers ───────────────────────────────────────────────────────
  const accessToken =
    state.status === "authenticated" ? state.tokens.accessToken : null;

  const user =
    state.status === "authenticated" ? state.user : null;

  return { state, user, accessToken, register, login, logout };
}
