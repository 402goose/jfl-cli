import { api } from "@/api"
import { streamChat, ChatSource } from "@/api/client"
import { cn, timeAgo } from "@/lib/hooks"
import { useState, useRef, useEffect } from "preact/hooks"

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  ts: string
  sources?: ChatSource[]
  streaming?: boolean
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

    const assistantId = `a-${Date.now()}`
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      ts: new Date().toISOString(),
      streaming: true,
    }

    setMessages((prev) => [...prev, userMsg, assistantMsg])
    setInput("")
    setLoading(true)

    const history = messages
      .filter((m) => !m.streaming)
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }))

    await streamChat(
      query,
      history,
      (sources) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, sources } : m)),
        )
      },
      (delta) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + delta } : m,
          ),
        )
      },
      () => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m,
          ),
        )
        setLoading(false)
      },
      (err) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `Error: ${err}`, streaming: false }
              : m,
          ),
        )
        setLoading(false)
      },
    )
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
            <div class="text-sm text-muted-foreground mb-1">Ask about your project</div>
            <div class="text-xs text-muted-foreground/60 max-w-sm">
              Answers grounded in your journal, knowledge base, and code context.
            </div>
            <div class="flex flex-wrap gap-1.5 mt-4 justify-center">
              {[
                "What decisions were made recently?",
                "What features were built this week?",
                "What bugs were fixed?",
                "Summarize the current roadmap",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setInput(q)
                    inputRef.current?.focus()
                  }}
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
  const [showSources, setShowSources] = useState(false)

  return (
    <div class={cn("flex gap-3 animate-fade-in", isUser && "flex-row-reverse")}>
      <div
        class={cn(
          "w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5",
          isUser ? "bg-foreground/10" : "bg-info/15",
        )}
      >
        <span class={cn("text-[10px] font-bold", isUser ? "text-foreground" : "text-info")}>
          {isUser ? "Y" : "J"}
        </span>
      </div>

      <div class="max-w-[80%] space-y-2">
        <div
          class={cn(
            "rounded-lg px-3 py-2",
            isUser ? "bg-foreground/5 border border-border" : "bg-card border border-border",
          )}
        >
          {isUser ? (
            <div class="text-sm">{message.content}</div>
          ) : (
            <div class="text-sm space-y-1.5">
              {message.content ? (
                message.content.split("\n").map((line, i) => {
                  if (!line.trim()) return <div key={i} class="h-2" />
                  if (line.startsWith("# "))
                    return (
                      <div key={i} class="font-semibold text-sm mt-2 first:mt-0">
                        {line.slice(2)}
                      </div>
                    )
                  if (line.startsWith("## "))
                    return (
                      <div key={i} class="font-medium text-sm text-muted-foreground mt-2">
                        {line.slice(3)}
                      </div>
                    )
                  if (line.startsWith("- "))
                    return (
                      <div key={i} class="text-sm pl-3">
                        <span class="text-muted-foreground mr-1.5">•</span>
                        {renderInline(line.slice(2))}
                      </div>
                    )
                  return (
                    <div key={i} class="text-sm">
                      {renderInline(line)}
                    </div>
                  )
                })
              ) : message.streaming ? (
                <span class="text-muted-foreground animate-pulse-dot">Thinking...</span>
              ) : null}
              {message.streaming && message.content && (
                <span class="inline-block w-1.5 h-4 bg-info/60 animate-pulse ml-0.5 align-middle" />
              )}
            </div>
          )}

          <div class="flex items-center gap-2 mt-1.5">
            <span class="text-[10px] text-muted-foreground/50 mono">{timeAgo(message.ts)}</span>
            {message.sources && message.sources.length > 0 && (
              <button
                onClick={() => setShowSources(!showSources)}
                class="text-[10px] text-info/70 hover:text-info mono transition-colors"
              >
                {message.sources.length} sources {showSources ? "▾" : "▸"}
              </button>
            )}
          </div>
        </div>

        {showSources && message.sources && (
          <div class="bg-card/50 border border-border/50 rounded-lg p-2 space-y-1.5 animate-fade-in">
            {message.sources.map((s, i) => (
              <div key={i} class="flex items-start gap-2 text-[11px]">
                <span
                  class={cn(
                    "shrink-0 px-1.5 py-0.5 rounded mono uppercase text-[9px]",
                    s.type === "decision"
                      ? "bg-warning/15 text-warning"
                      : s.type === "feature"
                        ? "bg-success/15 text-success"
                        : s.type === "fix"
                          ? "bg-destructive/15 text-destructive"
                          : "bg-info/15 text-info",
                  )}
                >
                  {s.type || "ctx"}
                </span>
                <div class="min-w-0">
                  <div class="font-medium truncate">{s.title}</div>
                  {s.content && (
                    <div class="text-muted-foreground line-clamp-2 mt-0.5">{s.content.slice(0, 150)}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
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
      parts.push(
        <span key={key++} class="font-medium">
          {boldMatch[1]}
        </span>,
      )
      remaining = remaining.slice(boldIdx + boldMatch[0].length)
    } else if (codeMatch) {
      if (codeIdx > 0) parts.push(<span key={key++}>{remaining.slice(0, codeIdx)}</span>)
      parts.push(
        <span key={key++} class="mono text-info text-[10px] bg-info/10 px-1 py-0.5 rounded">
          {codeMatch[1]}
        </span>,
      )
      remaining = remaining.slice(codeIdx + codeMatch[0].length)
    }
  }

  return <>{parts}</>
}
