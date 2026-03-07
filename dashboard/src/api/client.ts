const getToken = (): string => {
  const params = new URLSearchParams(window.location.search)
  const urlToken = params.get("token")
  if (urlToken) {
    localStorage.setItem("jfl-token", urlToken)
    const clean = new URL(window.location.href)
    clean.searchParams.delete("token")
    window.history.replaceState({}, "", clean.toString())
    return urlToken
  }
  return localStorage.getItem("jfl-token") || ""
}

let cachedToken: string | null = null

export function token(): string {
  if (!cachedToken) cachedToken = getToken()
  return cachedToken
}

export async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
    ...((opts.headers as Record<string, string>) || {}),
  }
  const res = await fetch(path, { ...opts, headers })
  if (res.status === 401) throw new Error("Unauthorized")
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export function sseSubscribe(
  path: string,
  onEvent: (event: SSEEvent) => void,
  onError?: (err: Event) => void,
): () => void {
  const url = `${path}${path.includes("?") ? "&" : "?"}token=${token()}`
  const source = new EventSource(url)
  source.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data))
    } catch {}
  }
  source.onerror = (e) => onError?.(e)
  return () => source.close()
}

export interface SSEEvent {
  id: string
  type: string
  source: string
  data: Record<string, unknown>
  ts: string
}
