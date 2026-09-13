# Pulse UI Core

This is the shared frontend library for the Pulse microservices ecosystem. It provides the core authentication logic, standard UI components, and API routing utilities so you don't have to rewrite them for every new frontend application.

## Installation

In your new frontend application, install this package via a local path:
```bash
npm install file:../pulse-ui-core
```

## Usage

### 1. Authentication
Import the shared `useAuth` hook and the `AuthView` component to instantly add authentication to your app.

```tsx
import { useAuth, AuthView } from "pulse-ui-core";

export default function App() {
  const { state, user, login, register, logout } = useAuth();

  if (state.status === "unauthenticated") {
    return <AuthView onLogin={login} onRegister={register} />;
  }

  return <div>Welcome, {user?.displayName}!</div>;
}
```

### 2. Configuration Utilities
Use `resolveHttp` to build API URLs that automatically understand whether they are running behind the Pulse reverse proxy or locally.

```typescript
import { resolveHttp } from "pulse-ui-core";

// Will return PULSE_PROXY_URL/api/chat if behind the proxy
// Will fallback to http://localhost:8001/api/chat if running locally
const chatApiUrl = resolveHttp("/api/chat", "http://localhost:8001");
```

## Developing
If you make changes to this library, run `npm run build` inside the `pulse-ui-core` directory to update the `dist` folder. All connected apps will automatically see the changes (you may need to restart the Next.js dev server).
