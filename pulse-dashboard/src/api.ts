import { Application, ApplicationDetail } from './types'

// During `vite dev`, /api is proxied to http://localhost:7777 via vite.config.ts.
// For direct access (e.g. env file), set VITE_API_BASE=http://localhost:7777
// @ts-ignore
const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...options?.headers,
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${text}`)
  }

  if (res.status === 204) {
    return undefined as T
  }

  return (await res.json()) as T
}

export const checkServerHealth = () =>
  fetch(`${API_BASE}/health`).then((r) => r.ok)

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