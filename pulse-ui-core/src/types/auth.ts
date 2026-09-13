// Auth types for Identity Service integration

export type AuthUser = {
  userId: string;
  displayName: string;
  email: string;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix ms timestamp
};

export type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; user: AuthUser; tokens: AuthTokens };
