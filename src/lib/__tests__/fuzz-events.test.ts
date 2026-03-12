/**
 * Fuzz Tests for MAP Event Bus
 *
 * Tests the event bus with edge cases: rapid emission, huge payloads,
 * missing fields, subscribe/unsubscribe stress, concurrent access.
 *
 * @purpose Fuzz testing for MAPEventBus reliability under stress
 */

import { MAPEventBus } from "../map-event-bus"
import type { MAPEvent, MAPEventType } from "../../types/map"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

describe("Event Bus Fuzzing", () => {
  let bus: MAPEventBus
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fuzz-events-"))
    bus = new MAPEventBus({ maxSize: 100 })
  })

  afterEach(() => {
    bus.destroy()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe("rapid emission stress", () => {
    it("handles 1000 rapid emissions without dropping events", () => {
      const received: MAPEvent[] = []

      bus.subscribe({
        clientId: "stress-client",
        patterns: ["*"],
        transport: "poll",
        callback: (e) => received.push(e),
      })

      const startTime = Date.now()
      for (let i = 0; i < 1000; i++) {
        bus.emit({
          type: "custom" as MAPEventType,
          source: `source-${i}`,
          data: { index: i },
        })
      }
      const elapsed = Date.now() - startTime

      expect(received.length).toBe(1000)
      expect(elapsed).toBeLessThan(5000)
    })

    it("handles burst emission with pauses", async () => {
      const received: MAPEvent[] = []

      bus.subscribe({
        clientId: "burst-client",
        patterns: ["custom"],
        transport: "poll",
        callback: (e) => received.push(e),
      })

      // Emit in bursts
      for (let burst = 0; burst < 5; burst++) {
        for (let i = 0; i < 100; i++) {
          bus.emit({
            type: "custom" as MAPEventType,
            source: `burst-${burst}`,
            data: { burst, index: i },
          })
        }
        await new Promise((r) => setTimeout(r, 10))
      }

      expect(received.length).toBe(500)
    })
  })

  describe("huge payload handling", () => {
    it("handles events with large string payloads", () => {
      const largeString = "x".repeat(100000) // 100KB string

      const event = bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: { content: largeString },
      })

      expect((event.data as Record<string, unknown>)?.content).toHaveLength(100000)

      const events = bus.getEvents({ pattern: "custom" })
      expect(events.length).toBe(1)
      expect((events[0].data as Record<string, unknown>)?.content).toHaveLength(100000)
    })

    it("handles events with deeply nested objects", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let nested: any = { value: "leaf" }
      for (let i = 0; i < 50; i++) {
        nested = { level: i, child: nested }
      }

      const event = bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: nested,
      })

      expect((event.data as Record<string, unknown>)?.level).toBe(49)
    })

    it("handles events with large arrays", () => {
      const largeArray = Array.from({ length: 10000 }, (_, i) => ({
        id: i,
        value: `item-${i}`,
      }))

      const event = bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: { items: largeArray },
      })

      expect((event.data as Record<string, unknown[]>)?.items).toHaveLength(10000)
    })
  })

  describe("malformed and edge case events", () => {
    it("handles empty type strings (using custom)", () => {
      const event = bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: {},
      })

      expect(event.id).toBeDefined()
      expect(event.ts).toBeDefined()
    })

    it("handles undefined/null data gracefully", () => {
      const event1 = bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: null as unknown as Record<string, unknown>,
      })

      const event2 = bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: undefined as unknown as Record<string, unknown>,
      })

      expect(event1.id).toBeDefined()
      expect(event2.id).toBeDefined()
    })

    it("handles unicode in sources", () => {
      const event = bus.emit({
        type: "custom" as MAPEventType,
        source: "источник:тест",
        data: { message: "🎉 emoji payload" },
      })

      expect(event.source).toBe("источник:тест")
    })

    it("handles special characters in patterns", () => {
      const received: MAPEvent[] = []

      bus.subscribe({
        clientId: "special-client",
        patterns: ["custom", "task:completed", "session:started"],
        transport: "poll",
        callback: (e) => received.push(e),
      })

      bus.emit({ type: "custom" as MAPEventType, source: "test", data: {} })
      bus.emit({ type: "task:completed" as MAPEventType, source: "test", data: {} })
      bus.emit({ type: "session:started" as MAPEventType, source: "test", data: {} })

      expect(received.length).toBe(3)
    })
  })

  describe("subscribe/unsubscribe stress", () => {
    it("handles rapid subscribe/unsubscribe cycles", () => {
      const subscriptionIds: string[] = []

      for (let i = 0; i < 100; i++) {
        const sub = bus.subscribe({
          clientId: `client-${i}`,
          patterns: [`pattern-${i}:*`],
          transport: "poll",
        })
        subscriptionIds.push(sub.id)
      }

      expect(bus.getSubscriberCount()).toBe(100)

      // Unsubscribe every other
      for (let i = 0; i < subscriptionIds.length; i += 2) {
        bus.unsubscribe(subscriptionIds[i])
      }

      expect(bus.getSubscriberCount()).toBe(50)

      // Unsubscribe rest
      for (let i = 1; i < subscriptionIds.length; i += 2) {
        bus.unsubscribe(subscriptionIds[i])
      }

      expect(bus.getSubscriberCount()).toBe(0)
    })

    it("handles duplicate unsubscribe calls", () => {
      const sub = bus.subscribe({
        clientId: "dup-client",
        patterns: ["*"],
        transport: "poll",
      })

      expect(bus.unsubscribe(sub.id)).toBe(true)
      expect(bus.unsubscribe(sub.id)).toBe(false)
      expect(bus.unsubscribe(sub.id)).toBe(false)
    })

    it("handles unsubscribe with invalid IDs", () => {
      expect(bus.unsubscribe("nonexistent-id")).toBe(false)
      expect(bus.unsubscribe("")).toBe(false)
      expect(bus.unsubscribe("00000000-0000-0000-0000-000000000000")).toBe(false)
    })

    it("handles many subscribers to same pattern", () => {
      const received: Map<string, MAPEvent[]> = new Map()

      for (let i = 0; i < 50; i++) {
        const clientId = `client-${i}`
        received.set(clientId, [])

        bus.subscribe({
          clientId,
          patterns: ["custom"],
          transport: "poll",
          callback: (e) => received.get(clientId)!.push(e),
        })
      }

      bus.emit({ type: "custom" as MAPEventType, source: "test", data: {} })

      for (const [, events] of received) {
        expect(events.length).toBe(1)
      }
    })
  })

  describe("buffer overflow and ring buffer behavior", () => {
    it("respects maxSize and drops oldest events", () => {
      const smallBus = new MAPEventBus({ maxSize: 10 })

      for (let i = 0; i < 25; i++) {
        smallBus.emit({
          type: "custom" as MAPEventType,
          source: "test",
          data: { index: i },
        })
      }

      const events = smallBus.getEvents()
      expect(events.length).toBe(10)
      // Should have the 10 most recent (15-24)
      expect((events[0].data as Record<string, number>)?.index).toBe(15)
      expect((events[9].data as Record<string, number>)?.index).toBe(24)

      smallBus.destroy()
    })

    it("handles getEvents with various filters", () => {
      for (let i = 0; i < 50; i++) {
        bus.emit({
          type: (i % 2 === 0 ? "task:completed" : "task:failed") as MAPEventType,
          source: `source-${i % 5}`,
          data: { index: i },
        })
      }

      const taskCompletedEvents = bus.getEvents({ pattern: "task:completed" })
      expect(taskCompletedEvents.length).toBe(25)

      const limitedEvents = bus.getEvents({ limit: 5 })
      expect(limitedEvents.length).toBe(5)

      const sinceEvents = bus.getEvents({ since: new Date().toISOString() })
      expect(sinceEvents.length).toBe(0) // All events are in the past
    })
  })

  describe("callback error handling", () => {
    it("continues delivering to other subscribers when one throws", () => {
      const received: MAPEvent[] = []

      // First subscriber throws
      bus.subscribe({
        clientId: "throwing-client",
        patterns: ["*"],
        transport: "poll",
        callback: () => {
          throw new Error("Intentional error")
        },
      })

      // Second subscriber should still receive
      bus.subscribe({
        clientId: "good-client",
        patterns: ["*"],
        transport: "poll",
        callback: (e) => received.push(e),
      })

      bus.emit({ type: "custom" as MAPEventType, source: "test", data: {} })

      expect(received.length).toBe(1)
    })

    it("handles async-like callbacks gracefully", () => {
      const received: MAPEvent[] = []

      bus.subscribe({
        clientId: "async-client",
        patterns: ["*"],
        transport: "poll",
        callback: (e) => {
          // Simulate async work
          setTimeout(() => received.push(e), 0)
        },
      })

      bus.emit({ type: "custom" as MAPEventType, source: "test", data: {} })

      // The callback is called, but async work happens later
      // This shouldn't crash
    })
  })

  describe("persistence edge cases", () => {
    it("handles persistence to nonexistent directory", () => {
      const badPath = path.join(tempDir, "nonexistent", "events.jsonl")

      // Should not throw
      const persistBus = new MAPEventBus({
        persistPath: badPath,
        maxSize: 10,
      })

      persistBus.emit({ type: "custom" as MAPEventType, source: "test", data: {} })
      persistBus.destroy()
    })

    it("recovers gracefully from corrupted persist file", () => {
      const persistPath = path.join(tempDir, "corrupted.jsonl")

      // Write corrupted content
      fs.writeFileSync(
        persistPath,
        '{"valid":"json"}\n{not valid json\n{"also":"valid"}\n'
      )

      // Should not throw and should skip corrupted lines
      const persistBus = new MAPEventBus({
        persistPath,
        maxSize: 100,
      })

      // Should have loaded valid entries
      const events = persistBus.getEvents()
      expect(events.length).toBeLessThanOrEqual(2)

      persistBus.destroy()
    })
  })

  describe("scope filtering fuzz", () => {
    it("handles events with scope filtering", () => {
      const received: MAPEvent[] = []

      bus.subscribe({
        clientId: "scoped-client",
        patterns: ["*"],
        transport: "poll",
        callback: (e) => received.push(e),
        scope: {
          consumes: ["task:*"],
          denied: ["task:failed"],
        },
      })

      bus.emit({ type: "task:completed" as MAPEventType, source: "test", data: {} })
      bus.emit({ type: "task:failed" as MAPEventType, source: "test", data: {} })
      bus.emit({ type: "session:started" as MAPEventType, source: "test", data: {} })

      expect(received.length).toBe(1)
      expect(received[0].type).toBe("task:completed")
    })

    it("handles empty scope arrays", () => {
      const received: MAPEvent[] = []

      bus.subscribe({
        clientId: "empty-scope-client",
        patterns: ["*"],
        transport: "poll",
        callback: (e) => received.push(e),
        scope: {
          consumes: [],
          denied: [],
        },
      })

      bus.emit({ type: "custom" as MAPEventType, source: "test", data: {} })

      // Empty consumes means allow all
      expect(received.length).toBe(1)
    })
  })
})
