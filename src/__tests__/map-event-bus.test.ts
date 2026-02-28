import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { MAPEventBus } from "../lib/map-event-bus.js"
import type { MAPEvent, MAPEventType } from "../types/map.js"

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "map-bus-test-"))
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe("MAPEventBus", () => {
  describe("emit", () => {
    it("auto-assigns id and ts to emitted events", () => {
      const bus = new MAPEventBus()
      const event = bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: { foo: 1 },
      })

      expect(event.id).toBeDefined()
      expect(typeof event.id).toBe("string")
      expect(event.id.length).toBeGreaterThan(0)
      expect(event.ts).toBeDefined()
      expect(new Date(event.ts).getTime()).not.toBeNaN()
      bus.destroy()
    })

    it("adds events to the buffer", () => {
      const bus = new MAPEventBus()
      bus.emit({ type: "custom" as MAPEventType, source: "test", data: {} })
      bus.emit({ type: "custom" as MAPEventType, source: "test", data: {} })

      const events = bus.getEvents()
      expect(events).toHaveLength(2)
      bus.destroy()
    })

    it("preserves source, type, and data from the partial", () => {
      const bus = new MAPEventBus()
      const event = bus.emit({
        type: "task:started" as MAPEventType,
        source: "my-source",
        session: "sess-1",
        data: { key: "val" },
      })

      expect(event.type).toBe("task:started")
      expect(event.source).toBe("my-source")
      expect(event.session).toBe("sess-1")
      expect(event.data).toEqual({ key: "val" })
      bus.destroy()
    })
  })

  describe("subscribe + callback", () => {
    it("delivers matching events to subscriber callback", () => {
      const bus = new MAPEventBus()
      const received: MAPEvent[] = []

      bus.subscribe({
        clientId: "test-sub",
        patterns: ["custom"],
        transport: "poll",
        callback: (e) => received.push(e),
      })

      bus.emit({ type: "custom" as MAPEventType, source: "test", data: {} })

      expect(received).toHaveLength(1)
      expect(received[0].type).toBe("custom")
      bus.destroy()
    })

    it("does not deliver non-matching events", () => {
      const bus = new MAPEventBus()
      const received: MAPEvent[] = []

      bus.subscribe({
        clientId: "test-sub",
        patterns: ["session:started"],
        transport: "poll",
        callback: (e) => received.push(e),
      })

      bus.emit({ type: "custom" as MAPEventType, source: "test", data: {} })

      expect(received).toHaveLength(0)
      bus.destroy()
    })
  })

  describe("pattern matching", () => {
    it("exact match works", () => {
      const bus = new MAPEventBus()
      const received: MAPEvent[] = []

      bus.subscribe({
        clientId: "exact",
        patterns: ["task:completed"],
        transport: "poll",
        callback: (e) => received.push(e),
      })

      bus.emit({ type: "task:completed" as MAPEventType, source: "test", data: {} })
      bus.emit({ type: "task:started" as MAPEventType, source: "test", data: {} })

      expect(received).toHaveLength(1)
      expect(received[0].type).toBe("task:completed")
      bus.destroy()
    })

    it("glob * matches all events", () => {
      const bus = new MAPEventBus()
      const received: MAPEvent[] = []

      bus.subscribe({
        clientId: "glob-all",
        patterns: ["*"],
        transport: "poll",
        callback: (e) => received.push(e),
      })

      bus.emit({ type: "custom" as MAPEventType, source: "test", data: {} })
      bus.emit({ type: "task:started" as MAPEventType, source: "test", data: {} })

      expect(received).toHaveLength(2)
      bus.destroy()
    })

    it("partial glob hook:* matches hook events", () => {
      const bus = new MAPEventBus()
      const received: MAPEvent[] = []

      bus.subscribe({
        clientId: "hook-glob",
        patterns: ["hook:*"],
        transport: "poll",
        callback: (e) => received.push(e),
      })

      bus.emit({ type: "hook:tool-use" as MAPEventType, source: "test", data: {} })
      bus.emit({ type: "hook:stop" as MAPEventType, source: "test", data: {} })
      bus.emit({ type: "custom" as MAPEventType, source: "test", data: {} })

      expect(received).toHaveLength(2)
      expect(received[0].type).toBe("hook:tool-use")
      expect(received[1].type).toBe("hook:stop")
      bus.destroy()
    })

    it("non-matching pattern does not deliver", () => {
      const bus = new MAPEventBus()
      const received: MAPEvent[] = []

      bus.subscribe({
        clientId: "no-match",
        patterns: ["deploy:*"],
        transport: "poll",
        callback: (e) => received.push(e),
      })

      bus.emit({ type: "hook:tool-use" as MAPEventType, source: "test", data: {} })

      expect(received).toHaveLength(0)
      bus.destroy()
    })
  })

  describe("ring buffer", () => {
    it("caps at maxSize and drops oldest events", () => {
      const bus = new MAPEventBus({ maxSize: 5 })

      for (let i = 0; i < 10; i++) {
        bus.emit({
          type: "custom" as MAPEventType,
          source: "test",
          data: { index: i },
        })
      }

      const events = bus.getEvents()
      expect(events).toHaveLength(5)
      expect(events[0].data.index).toBe(5)
      expect(events[4].data.index).toBe(9)
      bus.destroy()
    })
  })

  describe("unsubscribe", () => {
    it("stops delivering events after unsubscribe", () => {
      const bus = new MAPEventBus()
      const received: MAPEvent[] = []

      const sub = bus.subscribe({
        clientId: "unsub-test",
        patterns: ["*"],
        transport: "poll",
        callback: (e) => received.push(e),
      })

      bus.emit({ type: "custom" as MAPEventType, source: "test", data: { n: 1 } })
      expect(received).toHaveLength(1)

      bus.unsubscribe(sub.id)

      bus.emit({ type: "custom" as MAPEventType, source: "test", data: { n: 2 } })
      expect(received).toHaveLength(1)
      bus.destroy()
    })

    it("returns true when subscription existed", () => {
      const bus = new MAPEventBus()
      const sub = bus.subscribe({
        clientId: "x",
        patterns: ["*"],
        transport: "poll",
      })

      expect(bus.unsubscribe(sub.id)).toBe(true)
      bus.destroy()
    })

    it("returns false for unknown subscription id", () => {
      const bus = new MAPEventBus()
      expect(bus.unsubscribe("nonexistent-id")).toBe(false)
      bus.destroy()
    })
  })

  describe("getEvents", () => {
    it("filters by since timestamp", () => {
      const bus = new MAPEventBus()

      const past = new Date(Date.now() - 5000).toISOString()
      bus.emit({ type: "custom" as MAPEventType, source: "test", data: { n: 1 } })
      bus.emit({ type: "custom" as MAPEventType, source: "test", data: { n: 2 } })

      const allEvents = bus.getEvents({ since: past })
      expect(allEvents).toHaveLength(2)

      const future = new Date(Date.now() + 5000).toISOString()
      const none = bus.getEvents({ since: future })
      expect(none).toHaveLength(0)
      bus.destroy()
    })

    it("filters by pattern", () => {
      const bus = new MAPEventBus()
      bus.emit({ type: "custom" as MAPEventType, source: "test", data: {} })
      bus.emit({ type: "task:started" as MAPEventType, source: "test", data: {} })
      bus.emit({ type: "task:completed" as MAPEventType, source: "test", data: {} })

      const taskEvents = bus.getEvents({ pattern: "task:*" })
      expect(taskEvents).toHaveLength(2)
      bus.destroy()
    })

    it("limits results", () => {
      const bus = new MAPEventBus()
      for (let i = 0; i < 10; i++) {
        bus.emit({ type: "custom" as MAPEventType, source: "test", data: { i } })
      }

      const limited = bus.getEvents({ limit: 3 })
      expect(limited).toHaveLength(3)
      expect(limited[0].data.i).toBe(7)
      expect(limited[2].data.i).toBe(9)
      bus.destroy()
    })
  })

  describe("fan-out", () => {
    it("multiple subscribers all receive matching events", () => {
      const bus = new MAPEventBus()
      const r1: MAPEvent[] = []
      const r2: MAPEvent[] = []
      const r3: MAPEvent[] = []

      bus.subscribe({ clientId: "s1", patterns: ["*"], transport: "poll", callback: (e) => r1.push(e) })
      bus.subscribe({ clientId: "s2", patterns: ["custom"], transport: "poll", callback: (e) => r2.push(e) })
      bus.subscribe({ clientId: "s3", patterns: ["task:*"], transport: "poll", callback: (e) => r3.push(e) })

      bus.emit({ type: "custom" as MAPEventType, source: "test", data: {} })

      expect(r1).toHaveLength(1)
      expect(r2).toHaveLength(1)
      expect(r3).toHaveLength(0)
      bus.destroy()
    })
  })

  describe("subscriber errors", () => {
    it("does not crash the bus when a callback throws", () => {
      const bus = new MAPEventBus()
      const received: MAPEvent[] = []

      bus.subscribe({
        clientId: "thrower",
        patterns: ["*"],
        transport: "poll",
        callback: () => { throw new Error("boom") },
      })

      bus.subscribe({
        clientId: "good",
        patterns: ["*"],
        transport: "poll",
        callback: (e) => received.push(e),
      })

      bus.emit({ type: "custom" as MAPEventType, source: "test", data: {} })

      expect(received).toHaveLength(1)
      bus.destroy()
    })
  })

  describe("TTL", () => {
    it("does not load expired events from persistence", () => {
      const dir = tmpDir()
      const persistPath = path.join(dir, "events.jsonl")

      const expiredEvent = {
        id: "evt-old",
        ts: new Date(Date.now() - 120_000).toISOString(),
        type: "custom",
        source: "test",
        data: {},
        ttl: 60,
      }
      const freshEvent = {
        id: "evt-new",
        ts: new Date().toISOString(),
        type: "custom",
        source: "test",
        data: {},
        ttl: 3600,
      }

      fs.writeFileSync(
        persistPath,
        JSON.stringify(expiredEvent) + "\n" + JSON.stringify(freshEvent) + "\n"
      )

      const bus = new MAPEventBus({ persistPath })
      const events = bus.getEvents()

      expect(events.some(e => e.id === "evt-old")).toBe(false)
      expect(events.some(e => e.id === "evt-new")).toBe(true)
      bus.destroy()

      fs.rmSync(dir, { recursive: true, force: true })
    })
  })

  describe("persistence", () => {
    it("writes emitted events to persistPath", () => {
      const dir = tmpDir()
      const persistPath = path.join(dir, "events.jsonl")

      const bus = new MAPEventBus({ persistPath })
      bus.emit({ type: "custom" as MAPEventType, source: "test", data: { v: 42 } })
      bus.destroy()

      const content = fs.readFileSync(persistPath, "utf-8")
      const lines = content.trim().split("\n").filter(l => l.trim())
      expect(lines.length).toBeGreaterThanOrEqual(1)

      const parsed = JSON.parse(lines[lines.length - 1])
      expect(parsed.type).toBe("custom")
      expect(parsed.data.v).toBe(42)

      fs.rmSync(dir, { recursive: true, force: true })
    })

    it("loads persisted events on restart", () => {
      const dir = tmpDir()
      const persistPath = path.join(dir, "events.jsonl")

      const bus1 = new MAPEventBus({ persistPath })
      bus1.emit({ type: "custom" as MAPEventType, source: "test", data: { marker: "alpha" } })
      bus1.emit({ type: "task:started" as MAPEventType, source: "test", data: { marker: "beta" } })
      bus1.destroy()

      const bus2 = new MAPEventBus({ persistPath })
      const events = bus2.getEvents()

      expect(events.length).toBeGreaterThanOrEqual(2)
      expect(events.some(e => e.data.marker === "alpha")).toBe(true)
      expect(events.some(e => e.data.marker === "beta")).toBe(true)
      bus2.destroy()

      fs.rmSync(dir, { recursive: true, force: true })
    })
  })

  describe("destroy", () => {
    it("clears all subscribers", () => {
      const bus = new MAPEventBus()
      bus.subscribe({ clientId: "a", patterns: ["*"], transport: "poll" })
      bus.subscribe({ clientId: "b", patterns: ["*"], transport: "poll" })

      expect(bus.getSubscriberCount()).toBe(2)
      bus.destroy()
      expect(bus.getSubscriberCount()).toBe(0)
    })
  })

  describe("scope enforcement", () => {
    it("blocks events matching denied patterns", () => {
      const bus = new MAPEventBus()
      const received: MAPEvent[] = []

      bus.subscribe({
        clientId: "lobsters",
        patterns: ["*"],
        transport: "poll",
        callback: (e) => received.push(e),
        scope: {
          consumes: ["eval:scored", "leaderboard:*"],
          denied: ["journal:productrank-phds*", "shadow:*"],
        },
      })

      bus.emit({ type: "eval:scored" as MAPEventType, source: "arena", data: {} })
      bus.emit({ type: "journal:entry" as MAPEventType, source: "journal:productrank-phds-session", data: {} })
      bus.emit({ type: "shadow:strategy" as MAPEventType, source: "shadow", data: {} })
      bus.emit({ type: "leaderboard:updated" as MAPEventType, source: "arena", data: {} })

      expect(received).toHaveLength(2)
      expect(received[0].type).toBe("eval:scored")
      expect(received[1].type).toBe("leaderboard:updated")
      bus.destroy()
    })

    it("allows all events when no scope is set", () => {
      const bus = new MAPEventBus()
      const received: MAPEvent[] = []

      bus.subscribe({
        clientId: "admin",
        patterns: ["*"],
        transport: "poll",
        callback: (e) => received.push(e),
      })

      bus.emit({ type: "journal:entry" as MAPEventType, source: "journal:secret", data: {} })
      bus.emit({ type: "shadow:strategy" as MAPEventType, source: "shadow", data: {} })

      expect(received).toHaveLength(2)
      bus.destroy()
    })

    it("restricts to consumes list when specified", () => {
      const bus = new MAPEventBus()
      const received: MAPEvent[] = []

      bus.subscribe({
        clientId: "seo-agent",
        patterns: ["*"],
        transport: "poll",
        callback: (e) => received.push(e),
        scope: {
          consumes: ["tool-rankings:*"],
        },
      })

      bus.emit({ type: "tool-rankings:aggregate" as MAPEventType, source: "arena", data: {} })
      bus.emit({ type: "journal:entry" as MAPEventType, source: "team", data: {} })

      expect(received).toHaveLength(1)
      expect(received[0].type).toBe("tool-rankings:aggregate")
      bus.destroy()
    })

    it("denied takes precedence over consumes", () => {
      const bus = new MAPEventBus()
      const received: MAPEvent[] = []

      bus.subscribe({
        clientId: "conflicted",
        patterns: ["*"],
        transport: "poll",
        callback: (e) => received.push(e),
        scope: {
          consumes: ["*"],
          denied: ["secret:*"],
        },
      })

      bus.emit({ type: "public:event" as MAPEventType, source: "test", data: {} })
      bus.emit({ type: "secret:event" as MAPEventType, source: "test", data: {} })

      expect(received).toHaveLength(1)
      expect(received[0].type).toBe("public:event")
      bus.destroy()
    })

    it("matches scope patterns against event source", () => {
      const bus = new MAPEventBus()
      const received: MAPEvent[] = []

      bus.subscribe({
        clientId: "lobsters",
        patterns: ["journal:entry"],
        transport: "poll",
        callback: (e) => received.push(e),
        scope: {
          denied: ["journal:productrank-phds*"],
        },
      })

      bus.emit({ type: "journal:entry" as MAPEventType, source: "journal:productrank-lobsters-s1", data: {} })
      bus.emit({ type: "journal:entry" as MAPEventType, source: "journal:productrank-phds-s1", data: {} })

      expect(received).toHaveLength(1)
      expect(received[0].source).toContain("lobsters")
      bus.destroy()
    })
  })
})
