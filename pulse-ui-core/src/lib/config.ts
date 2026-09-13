const PROXY = process.env.NEXT_PUBLIC_PULSE_PROXY_URL;

export function resolveHttp(
  routePrefix: string,
  directFallback: string
): string {
  if (PROXY) return `${PROXY}${routePrefix}`;
  if (typeof window !== "undefined") {
    const isSecure = window.location.protocol === "https:";
    const host = window.location.host;
    const directPort = new URL(directFallback).port;
    if (
      host.includes("-3000") &&
      (host.includes("devtunnels.ms") || host.includes("github.dev"))
    ) {
      const backendHost = host.replace("-3000", `-${directPort}`);
      return isSecure ? `https://${backendHost}` : `http://${backendHost}`;
    }
  }
  return directFallback;
}

export function resolveWs(
  routePrefix: string,
  directFallback: string
): string {
  if (PROXY) {
    const url = new URL(PROXY);
    const wsScheme = url.protocol === "https:" ? "wss" : "ws";
    return `${wsScheme}://${url.host}${routePrefix}`;
  }
  if (typeof window !== "undefined") {
    const isSecure = window.location.protocol === "https:";
    const host = window.location.host;
    const directPort = new URL(directFallback.replace(/^ws/, "http")).port;
    if (
      host.includes("-3000") &&
      (host.includes("devtunnels.ms") || host.includes("github.dev"))
    ) {
      const backendHost = host.replace("-3000", `-${directPort}`);
      return isSecure ? `wss://${backendHost}` : `ws://${backendHost}`;
    }
  }
  return directFallback;
}

export const coreConfig = {
  identityUrl: resolveHttp("/api/identity", "http://localhost:8002"),
};
