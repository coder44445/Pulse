import { Application, ApplicationDetail } from './types'

// During `vite dev`, /api is proxied to http://localhost:7777 via vite.config.ts.
// For direct access (e.g. env file), set VITE_API_BASE=http://localhost:7777
// @ts-ignore
const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

const ADMIN_KEY_STORAGE = 'pulse_admin_key'

export function getStoredAdminKey(): string | null {
  return (
    localStorage.getItem(ADMIN_KEY_STORAGE) ||
    // @ts-ignore
    import.meta.env.VITE_PULSE_ADMIN_KEY ||
    null
  )
}

export function setStoredAdminKey(key: string | null) {
  if (key && key.trim()) {
    localStorage.setItem(ADMIN_KEY_STORAGE, key.trim())
  } else {
    localStorage.removeItem(ADMIN_KEY_STORAGE)
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const adminKey = getStoredAdminKey()

  const headers: Record<string, string> = {
    ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
    ...(adminKey ? { 'X-Pulse-Admin-Key': adminKey } : {}),
    ...((options?.headers as Record<string, string>) || {}),
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  })

  if (!res.ok) {
    let errMessage = `${res.status} ${res.statusText}`
    try {
      const data = await res.json()
      if (data.message) errMessage = data.message
      else if (data.error) errMessage = data.error
    } catch {
      const text = await res.text()
      if (text) errMessage = text
    }

    if (res.status === 401) {
      throw new Error(`Authentication Required: ${errMessage}`)
    }
    throw new Error(errMessage)
  }

  if (res.status === 204) {
    return undefined as T
  }

  return (await res.json()) as T
}

export const checkServerHealth = () =>
  fetch(`${API_BASE}/health`).then((r) => r.ok)

export const verifyAdminKey = async (keyToTest?: string): Promise<boolean> => {
  const key = keyToTest ?? getStoredAdminKey()
  if (!key) return false

  try {
    const res = await fetch(`${API_BASE}/auth/verify`, {
      method: 'GET',
      headers: {
        'X-Pulse-Admin-Key': key.trim(),
      },
    })
    return res.ok
  } catch {
    return false
  }
}

export const getApplications = () =>
  request<Application[]>('/applications')

export const getApplication = (id: string) =>
  request<ApplicationDetail>(`/applications/${encodeURIComponent(id)}`)

export const startApplication = (id: string) =>
  request<void>(`/applications/${encodeURIComponent(id)}/start`, { method: 'POST' })

export const stopApplication = (id: string) =>
  request<void>(`/applications/${encodeURIComponent(id)}/stop`, { method: 'POST' })

export const restartApplication = (id: string) =>
  request<void>(`/applications/${encodeURIComponent(id)}/restart`, { method: 'POST' })
