import { useState, useEffect, useRef, useCallback } from "preact/hooks"

export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  deps: unknown[] = [],
): { data: T | null; loading: boolean; error: string | null; refetch: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval>>()

  const refetch = useCallback(() => {
    fetcher()
      .then((d) => {
        setData(d)
        setError(null)
        setLoading(false)
      })
      .catch((e) => {
        setError(e.message)
        setLoading(false)
      })
  }, deps)

  useEffect(() => {
    refetch()
    timer.current = setInterval(refetch, intervalMs)
    return () => clearInterval(timer.current)
  }, [refetch, intervalMs])

  return { data, loading, error, refetch }
}

export function useSSE(
  path: string,
  onEvent: (event: unknown) => void,
): { connected: boolean } {
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem("jfl-token") || ""
    const url = `${path}${path.includes("?") ? "&" : "?"}token=${token}`
    const source = new EventSource(url)
    source.onopen = () => setConnected(true)
    source.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data))
      } catch {}
    }
    source.onerror = () => setConnected(false)
    return () => source.close()
  }, [path])

  return { connected }
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ")
}

export function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toString()
}
