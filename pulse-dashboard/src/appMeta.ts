export interface AppMeta {
  title: string
  description: string
  icon: string
  category: string
  isUserFacing: boolean
}

export const APP_METADATA: Record<string, AppMeta> = {
  'quiz-ui': {
    title: 'OpenQuiz',
    description: 'AI-powered real-time multiplayer quiz game. Join or create rooms, pick topics, and compete live.',
    icon: '🧠',
    category: 'Application',
    isUserFacing: true,
  },
  'quiz': {
    title: 'Quiz Engine Service',
    description: 'FastAPI game engine service managing room state, WebSocket connections, and question generation.',
    icon: '⚡',
    category: 'Backend Microservice',
    isUserFacing: false,
  },
  'identity': {
    title: 'Identity & Auth Service',
    description: 'Centralized authentication service issuing JWT tokens, user credentials, and session management.',
    icon: '🔐',
    category: 'Security & Auth',
    isUserFacing: false,
  },
  'persona': {
    title: 'Persona Service',
    description: 'User profile management service storing player identity, avatar preferences, and player stats.',
    icon: '👤',
    category: 'User Management',
    isUserFacing: false,
  },
  'core-infra': {
    title: 'Core Infrastructure',
    description: 'Foundational state layer hosting PostgreSQL database and Redis message broker for all services.',
    icon: '🗄️',
    category: 'Data & Messaging',
    isUserFacing: false,
  },
}

export function getAppMeta(appName: string, routes: string[] = []): AppMeta {
  if (APP_METADATA[appName]) {
    return APP_METADATA[appName]
  }

  // Fallback for dynamically added apps
  const isUserFacing = routes.some((r) => !r.startsWith('/api') && r !== '/healthz')
  const cleanTitle = appName
    .replace(/-ui$/, '')
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

  return {
    title: cleanTitle,
    description: isUserFacing ? 'Web application accessible via Pulse proxy.' : 'Backend microservice managed by Pulse.',
    icon: isUserFacing ? '🚀' : '⚙️',
    category: isUserFacing ? 'Application' : 'Service',
    isUserFacing,
  }
}
