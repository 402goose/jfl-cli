import { api } from "@/api"
import { cn, timeAgo } from "@/lib/hooks"
import { useState, useRef, useEffect } from "preact/hooks"

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  ts: string
  sources?: ChatSource[]
}

interface ChatSource {
  title: string
  type: string
  source: string
  relevance?: string
  snippet?: string
}

export function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = async () => {
    const query = input.trim()
    if (!query || loading) return

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: query,
      ts: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])
    setInput("")
    setLoading(true)

    try {
      const [memoryResult, contextResult] = await Promise.allSettled([
        api.memorySearch(query),
        api.search(query),
      ])

      const sources: ChatSource[] = []
      const sections: string[] = []

      const memResults = memoryResult.status === "fulfilled"
        ? ((memoryResult.value as any).results || [])
        : []
      const ctxResults = contextResult.status === "fulfilled"
        ? ((contextResult.value as any).results || (contextResult.value as any).items || [])
        : []

      if (memResults.length > 0) {
        sections.push(`**Memory** (${memResults.length} results)`)
        for (const r of memResults.slice(0, 5)) {
          const title = r.title || r.content?.slice(0, 80) || "Untitled"
          const type = r.type || "unknown"
          const snippet = r.summary || r.content?.slice(0, 200) || ""
          sections.push(`- **${title}** \`${type}\`${snippet ? `\n  ${snippet}` : ""}`)
          sources.push({
            title,
            type,
            source: "memory",
            relevance: r.relevance,
            snippet: snippet.slice(0, 100),
          })
        }
      }

      if (ctxResults.length > 0) {
        sections.push(`\n**Context** (${ctxResults.length} results)`)
        for (const r of ctxResults.slice(0, 5)) {
          const title = r.title || r.path || "Untitled"
          const type = r.type || r.source || "unknown"
          const snippet = r.content?.slice(0, 200) || ""
          sections.push(`- **${title}** \`${type}\`${snippet ? `\n  ${snippet}` : ""}`)
          sources.push({
            title,
            type,
            source: "context",
            snippet: snippet.slice(0, 100),
          })
        }
      }

      const content = sections.length > 0
        ? sections.join("\n")
        : "No results found. Try a different query."

      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content,
        ts: new Date().toISOString(),
        sources,
      }
      setMessages((prev) => [...prev, assistantMsg])
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: "assistant",
          content: `Search failed: ${err.message}`,
          ts: new Date().toISOString(),
        },
      ])
    }
    setLoading(false)
  }

  return (
    <div class="flex flex-col h-[calc(100vh-3rem)]">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-xl font-semibold">Chat</h1>
        <div class="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              class="text-[10px] mono px-2 py-1 rounded bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              clear
            </button>
          )}
          <span class="text-sm text-muted-foreground">{messages.length} messages</span>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.length === 0 && (
          <div class="flex flex-col items-center justify-center h-full text-center">
            <div class="text-muted-foreground/40 mb-4">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div class="text-sm text-muted-foreground mb-1">Search your project context</div>
            <div class="text-xs text-muted-foreground/60 max-w-sm">
              Ask about decisions, features, bugs, or anything in your journal and knowledge base.
            </div>
            <div class="flex flex-wrap gap-1.5 mt-4 justify-center">
              {[
                "What decisions were made?",
                "Recent features built",
                "What bugs were fixed?",
                "Show eval results",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => { setInput(q); inputRef.current?.focus() }}
                  class="text-[11px] mono px-2.5 py-1 rounded-md bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {loading && (
          <div class="flex gap-3 animate-fade-in">
            <div class="w-6 h-6 rounded-full bg-info/15 flex items-center justify-center shrink-0">
              <span class="text-[10px] text-info font-bold">J</span>
            </div>
            <div class="bg-card rounded-lg border border-border px-3 py-2">
              <span class="text-sm text-muted-foreground animate-pulse-dot">Searching...</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div class="border-t border-border pt-3">
        <div class="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            placeholder="Ask about your project..."
            value={input}
            onInput={(e) => setInput((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            disabled={loading}
            class="flex-1 bg-card border border-border rounded-lg px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-info/50 transition-colors disabled:opacity-50"
          />
          <button
            onClick={handleSubmit}
            disabled={loading || !input.trim()}
            class={cn(
              "px-4 py-2.5 rounded-lg text-sm font-medium transition-colors",
              input.trim() && !loading
                ? "bg-info text-white hover:bg-info/90"
                : "bg-muted text-muted-foreground cursor-not-allowed",
            )}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 2 11 13" />
              <path d="M22 2 15 22l-4-9-9-4z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user"

  return (
    <div class={cn("flex gap-3 animate-fade-in", isUser && "flex-row-reverse")}>
      <div class={cn(
        "w-6 h-6 rounded-full flex items-center justify-center shrink-0",
        isUser ? "bg-foreground/10" : "bg-info/15",
      )}>
        <span class={cn("text-[10px] font-bold", isUser ? "text-foreground" : "text-info")}>
          {isUser ? "Y" : "J"}
        </span>
      </div>

      <div class={cn(
        "rounded-lg px-3 py-2 max-w-[80%]",
        isUser
          ? "bg-foreground/5 border border-border"
          : "bg-card border border-border",
      )}>
        {isUser ? (
          <div class="text-sm">{message.content}</div>
        ) : (
          <div class="text-sm space-y-2">
            {message.content.split("\n").map((line, i) => {
              if (line.startsWith("**") && line.endsWith(")")) {
                return <div key={i} class="text-xs font-medium text-muted-foreground uppercase tracking-wider mt-2 first:mt-0">{renderInline(line)}</div>
              }
              if (line.startsWith("- **")) {
                return <div key={i} class="text-xs pl-2 border-l-2 border-border ml-1">{renderInline(line.slice(2))}</div>
              }
              if (line.startsWith("  ")) {
                return <div key={i} class="text-xs text-muted-foreground pl-4 ml-1">{line.trim()}</div>
              }
              if (line.trim() === "") return null
              return <div key={i} class="text-sm">{renderInline(line)}</div>
            })}
          </div>
        )}

        <div class="flex items-center gap-2 mt-1.5">
          <span class="text-[10px] text-muted-foreground/50 mono">{timeAgo(message.ts)}</span>
          {message.sources && message.sources.length > 0 && (
            <span class="text-[10px] text-muted-foreground/50 mono">
              {message.sources.length} sources
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function renderInline(text: string): preact.JSX.Element {
  const parts: preact.JSX.Element[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/)
    const codeMatch = remaining.match(/`(.+?)`/)

    const boldIdx = boldMatch?.index ?? Infinity
    const codeIdx = codeMatch?.index ?? Infinity

    if (boldIdx === Infinity && codeIdx === Infinity) {
      parts.push(<span key={key++}>{remaining}</span>)
      break
    }

    if (boldIdx <= codeIdx && boldMatch) {
      if (boldIdx > 0) parts.push(<span key={key++}>{remaining.slice(0, boldIdx)}</span>)
      parts.push(<span key={key++} class="font-medium">{boldMatch[1]}</span>)
      remaining = remaining.slice(boldIdx + boldMatch[0].length)
    } else if (codeMatch) {
      if (codeIdx > 0) parts.push(<span key={key++}>{remaining.slice(0, codeIdx)}</span>)
      parts.push(<span key={key++} class="mono text-info text-[10px] bg-info/10 px-1 py-0.5 rounded">{codeMatch[1]}</span>)
      remaining = remaining.slice(codeIdx + codeMatch[0].length)
    }
  }

  return <>{parts}</>
}
