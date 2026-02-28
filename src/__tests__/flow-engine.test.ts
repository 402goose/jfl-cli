import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { MAPEventBus } from "../lib/map-event-bus.js"
import { FlowEngine } from "../lib/flow-engine.js"
import type { MAPEvent, MAPEventType } from "../types/map.js"

function createTmpProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flow-engine-test-"))
  fs.mkdirSync(path.join(dir, ".jfl"), { recursive: true })
  return dir
}

function writeFlowsYaml(projectRoot: string, content: string): void {
  fs.writeFileSync(path.join(projectRoot, ".jfl", "flows.yaml"), content)
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

describe("FlowEngine", () => {
  let projectRoot: string
  let bus: MAPEventBus
  let engine: FlowEngine

  beforeEach(() => {
    projectRoot = createTmpProject()
    bus = new MAPEventBus()
    engine = new FlowEngine(bus, projectRoot)
  })

  afterEach(() => {
    engine.stop()
    bus.destroy()
    cleanup(projectRoot)
  })

  describe("flow loading", () => {
    it("loads flows from .jfl/flows.yaml", async () => {
      writeFlowsYaml(projectRoot, `
flows:
  - name: test-flow
    enabled: true
    trigger:
      pattern: "hook:tool-use"
    actions:
      - type: log
        message: "Tool used"
`)

      const count = await engine.start()
      expect(count).toBe(1)
      expect(engine.getFlows()).toHaveLength(1)
      expect(engine.getFlows()[0].name).toBe("test-flow")
    })

    it("handles missing flows file (0 flows)", async () => {
      const count = await engine.start()
      expect(count).toBe(0)
      expect(engine.getFlows()).toHaveLength(0)
    })

    it("handles malformed YAML gracefully", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation()

      writeFlowsYaml(projectRoot, `
flows:
  - name: broken
    enabled: true
    trigger:
      pattern:
    [invalid yaml here :::
`)

      const count = await engine.start()
      expect(count).toBe(0)
      consoleSpy.mockRestore()
    })

    it("filters out flows without required fields", async () => {
      writeFlowsYaml(projectRoot, `
flows:
  - name: valid
    enabled: true
    trigger:
      pattern: "custom"
    actions:
      - type: log
        message: "ok"
  - name: no-pattern
    enabled: true
    trigger: {}
    actions:
      - type: log
        message: "missing trigger pattern"
  - enabled: true
    trigger:
      pattern: "custom"
    actions:
      - type: log
        message: "missing name"
`)

      const count = await engine.start()
      expect(engine.getFlows()).toHaveLength(1)
      expect(engine.getFlows()[0].name).toBe("valid")
      expect(count).toBe(1)
    })
  })

  describe("trigger matching", () => {
    it("calls actions when event matches trigger pattern", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation()

      writeFlowsYaml(projectRoot, `
flows:
  - name: on-tool-use
    enabled: true
    trigger:
      pattern: "hook:tool-use"
    actions:
      - type: log
        message: "Tool was used"
`)

      await engine.start()

      bus.emit({
        type: "hook:tool-use" as MAPEventType,
        source: "hook",
        data: { tool_name: "Write" },
      })

      await new Promise(r => setTimeout(r, 50))

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Tool was used")
      )
      consoleSpy.mockRestore()
    })

    it("ignores non-matching events", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation()

      writeFlowsYaml(projectRoot, `
flows:
  - name: on-deploy
    enabled: true
    trigger:
      pattern: "deploy:completed"
    actions:
      - type: log
        message: "Deployed!"
`)

      await engine.start()

      bus.emit({
        type: "hook:tool-use" as MAPEventType,
        source: "hook",
        data: {},
      })

      await new Promise(r => setTimeout(r, 50))

      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("Deployed!")
      )
      consoleSpy.mockRestore()
    })
  })

  describe("self-trigger prevention", () => {
    it("filters out flow:* events to prevent infinite loops", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation()

      writeFlowsYaml(projectRoot, `
flows:
  - name: catch-all
    enabled: true
    trigger:
      pattern: "*"
    actions:
      - type: log
        message: "Caught event"
`)

      await engine.start()

      bus.emit({
        type: "flow:triggered" as MAPEventType,
        source: "flow:other",
        data: {},
      })

      bus.emit({
        type: "flow:completed" as MAPEventType,
        source: "flow:other",
        data: {},
      })

      await new Promise(r => setTimeout(r, 50))

      const logCalls = consoleSpy.mock.calls.filter(
        call => typeof call[0] === "string" && call[0].includes("Caught event")
      )
      expect(logCalls).toHaveLength(0)
      consoleSpy.mockRestore()
    })
  })

  describe("source filtering", () => {
    it("only triggers for events from specified source", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation()

      writeFlowsYaml(projectRoot, `
flows:
  - name: hook-only
    enabled: true
    trigger:
      pattern: "hook:tool-use"
      source: "hook"
    actions:
      - type: log
        message: "From hook"
`)

      await engine.start()

      bus.emit({
        type: "hook:tool-use" as MAPEventType,
        source: "other-source",
        data: {},
      })

      await new Promise(r => setTimeout(r, 50))

      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("From hook")
      )

      bus.emit({
        type: "hook:tool-use" as MAPEventType,
        source: "hook",
        data: {},
      })

      await new Promise(r => setTimeout(r, 50))

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("From hook")
      )
      consoleSpy.mockRestore()
    })
  })

  describe("condition evaluation", () => {
    it("passes when condition matches event data", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation()

      writeFlowsYaml(projectRoot, `
flows:
  - name: write-only
    enabled: true
    trigger:
      pattern: "hook:tool-use"
      condition: 'data.tool_name == "Write"'
    actions:
      - type: log
        message: "Write detected"
`)

      await engine.start()

      bus.emit({
        type: "hook:tool-use" as MAPEventType,
        source: "hook",
        data: { tool_name: "Write" },
      })

      await new Promise(r => setTimeout(r, 50))

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Write detected")
      )
      consoleSpy.mockRestore()
    })

    it("blocks when condition does not match", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation()

      writeFlowsYaml(projectRoot, `
flows:
  - name: write-only
    enabled: true
    trigger:
      pattern: "hook:tool-use"
      condition: 'data.tool_name == "Write"'
    actions:
      - type: log
        message: "Write detected"
`)

      await engine.start()

      bus.emit({
        type: "hook:tool-use" as MAPEventType,
        source: "hook",
        data: { tool_name: "Read" },
      })

      await new Promise(r => setTimeout(r, 50))

      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("Write detected")
      )
      consoleSpy.mockRestore()
    })

    it("!= operator works correctly", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation()

      writeFlowsYaml(projectRoot, `
flows:
  - name: not-error
    enabled: true
    trigger:
      pattern: "custom"
      condition: 'data.status != "error"'
    actions:
      - type: log
        message: "Not error"
`)

      await engine.start()

      bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: { status: "ok" },
      })

      await new Promise(r => setTimeout(r, 50))

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Not error")
      )
      consoleSpy.mockRestore()
    })

    it("contains operator works correctly", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation()

      writeFlowsYaml(projectRoot, `
flows:
  - name: test-contains
    enabled: true
    trigger:
      pattern: "custom"
      condition: 'data.message contains "important"'
    actions:
      - type: log
        message: "Matched"
`)

      await engine.start()

      bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: { message: "this is an important event" },
      })

      await new Promise(r => setTimeout(r, 50))

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Matched")
      )

      consoleSpy.mockClear()

      bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: { message: "this is trivial" },
      })

      await new Promise(r => setTimeout(r, 50))

      const matchedCalls = consoleSpy.mock.calls.filter(
        call => typeof call[0] === "string" && call[0].includes("Matched")
      )
      expect(matchedCalls).toHaveLength(0)
      consoleSpy.mockRestore()
    })

    it("malformed conditions return false (do not trigger flow)", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation()
      const warnSpy = jest.spyOn(console, "warn").mockImplementation()

      writeFlowsYaml(projectRoot, `
flows:
  - name: bad-condition
    enabled: true
    trigger:
      pattern: "custom"
      condition: "this is not valid"
    actions:
      - type: log
        message: "Should not fire"
`)

      await engine.start()

      bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: {},
      })

      await new Promise(r => setTimeout(r, 50))

      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("Should not fire")
      )
      consoleSpy.mockRestore()
      warnSpy.mockRestore()
    })

    it("missing field in condition returns false", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation()

      writeFlowsYaml(projectRoot, `
flows:
  - name: missing-field
    enabled: true
    trigger:
      pattern: "custom"
      condition: 'data.nonexistent == "value"'
    actions:
      - type: log
        message: "Should not fire"
`)

      await engine.start()

      bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: {},
      })

      await new Promise(r => setTimeout(r, 50))

      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("Should not fire")
      )
      consoleSpy.mockRestore()
    })
  })

  describe("action execution", () => {
    it("log action logs message with interpolated values", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation()

      writeFlowsYaml(projectRoot, `
flows:
  - name: log-flow
    enabled: true
    trigger:
      pattern: "hook:tool-use"
    actions:
      - type: log
        message: "Tool: {{data.tool_name}}"
`)

      await engine.start()

      bus.emit({
        type: "hook:tool-use" as MAPEventType,
        source: "hook",
        data: { tool_name: "Write" },
      })

      await new Promise(r => setTimeout(r, 50))

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Tool: Write")
      )
      consoleSpy.mockRestore()
    })

    it("emit action emits new event to the bus", async () => {
      const received: MAPEvent[] = []

      bus.subscribe({
        clientId: "watcher",
        patterns: ["custom"],
        transport: "poll",
        callback: (e) => received.push(e),
      })

      writeFlowsYaml(projectRoot, `
flows:
  - name: emit-flow
    enabled: true
    trigger:
      pattern: "hook:tool-use"
    actions:
      - type: emit
        event_type: "custom"
        data:
          tool: "{{data.tool_name}}"
          origin: "flow"
`)

      await engine.start()

      bus.emit({
        type: "hook:tool-use" as MAPEventType,
        source: "hook",
        data: { tool_name: "Edit" },
      })

      await new Promise(r => setTimeout(r, 50))

      const flowEmitted = received.filter(e => e.data.origin === "flow")
      expect(flowEmitted).toHaveLength(1)
      expect(flowEmitted[0].data.tool).toBe("Edit")
    })

    it("failed actions increment actions_failed and do not crash", async () => {
      const errorSpy = jest.spyOn(console, "error").mockImplementation()

      writeFlowsYaml(projectRoot, `
flows:
  - name: fail-flow
    enabled: true
    trigger:
      pattern: "custom"
    actions:
      - type: webhook
        url: "http://255.255.255.255:1/nope"
      - type: log
        message: "After failure"
`)

      await engine.start()

      bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: {},
      })

      await new Promise(r => setTimeout(r, 500))

      const executions = engine.getExecutions()
      expect(executions.length).toBeGreaterThanOrEqual(1)
      const exec = executions[executions.length - 1]
      expect(exec.actions_failed).toBeGreaterThanOrEqual(1)
      errorSpy.mockRestore()
    })
  })

  describe("template interpolation", () => {
    it("resolves {{data.tool_name}} from event data", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation()

      writeFlowsYaml(projectRoot, `
flows:
  - name: interpolate-test
    enabled: true
    trigger:
      pattern: "custom"
    actions:
      - type: log
        message: "type={{type}} source={{source}}"
`)

      await engine.start()

      bus.emit({
        type: "custom" as MAPEventType,
        source: "my-src",
        data: {},
      })

      await new Promise(r => setTimeout(r, 50))

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("type=custom source=my-src")
      )
      consoleSpy.mockRestore()
    })

    it("missing paths return empty string", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation()

      writeFlowsYaml(projectRoot, `
flows:
  - name: missing-path
    enabled: true
    trigger:
      pattern: "custom"
    actions:
      - type: log
        message: "val=[{{data.nonexistent}}]"
`)

      await engine.start()

      bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: {},
      })

      await new Promise(r => setTimeout(r, 50))

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("val=[]")
      )
      consoleSpy.mockRestore()
    })

    it("nested paths work", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation()

      writeFlowsYaml(projectRoot, `
flows:
  - name: nested-path
    enabled: true
    trigger:
      pattern: "custom"
    actions:
      - type: log
        message: "nested={{data.deep.value}}"
`)

      await engine.start()

      bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: { deep: { value: "found" } },
      })

      await new Promise(r => setTimeout(r, 50))

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("nested=found")
      )
      consoleSpy.mockRestore()
    })
  })

  describe("static validateCondition", () => {
    it("returns valid for well-formed conditions", () => {
      expect(FlowEngine.validateCondition('data.tool_name == "Write"')).toEqual({ valid: true })
      expect(FlowEngine.validateCondition('data.status != "error"')).toEqual({ valid: true })
      expect(FlowEngine.validateCondition('data.message contains "test"')).toEqual({ valid: true })
      expect(FlowEngine.validateCondition('source == "hook"')).toEqual({ valid: true })
    })

    it("returns invalid with error for malformed conditions", () => {
      const r1 = FlowEngine.validateCondition('"this is not valid"')
      expect(r1.valid).toBe(false)
      expect(r1.error).toBeDefined()

      const r2 = FlowEngine.validateCondition("data.tool_name")
      expect(r2.valid).toBe(false)
      expect(r2.error).toBeDefined()

      const r3 = FlowEngine.validateCondition("")
      expect(r3.valid).toBe(false)
      expect(r3.error).toBeDefined()
    })
  })

  describe("enable/disable", () => {
    it("disabled flows do not get subscribers", async () => {
      writeFlowsYaml(projectRoot, `
flows:
  - name: enabled-flow
    enabled: true
    trigger:
      pattern: "custom"
    actions:
      - type: log
        message: "enabled"
  - name: disabled-flow
    enabled: false
    trigger:
      pattern: "custom"
    actions:
      - type: log
        message: "disabled"
`)

      const count = await engine.start()
      expect(count).toBe(1)
      expect(bus.getSubscriberCount()).toBe(1)
    })
  })

  describe("execution tracking", () => {
    it("records executions", async () => {
      jest.spyOn(console, "log").mockImplementation()

      writeFlowsYaml(projectRoot, `
flows:
  - name: tracked
    enabled: true
    trigger:
      pattern: "custom"
    actions:
      - type: log
        message: "tracked"
`)

      await engine.start()

      bus.emit({ type: "custom" as MAPEventType, source: "test", data: {} })
      await new Promise(r => setTimeout(r, 50))

      const execs = engine.getExecutions()
      expect(execs).toHaveLength(1)
      expect(execs[0].flow).toBe("tracked")
      expect(execs[0].actions_executed).toBe(1)
      expect(execs[0].actions_failed).toBe(0)
      expect(execs[0].completed_at).toBeDefined()
    })

    it("caps executions at maxExecutions (200)", async () => {
      jest.spyOn(console, "log").mockImplementation()

      writeFlowsYaml(projectRoot, `
flows:
  - name: heavy
    enabled: true
    trigger:
      pattern: "custom"
    actions:
      - type: log
        message: "x"
`)

      await engine.start()

      for (let i = 0; i < 210; i++) {
        bus.emit({ type: "custom" as MAPEventType, source: "test", data: { i } })
      }
      await new Promise(r => setTimeout(r, 200))

      const execs = engine.getExecutions()
      expect(execs.length).toBeLessThanOrEqual(200)
    })
  })

  describe("flow lifecycle events", () => {
    it("emits flow:triggered and flow:completed events", async () => {
      jest.spyOn(console, "log").mockImplementation()
      const lifecycleEvents: MAPEvent[] = []

      bus.subscribe({
        clientId: "lifecycle-watcher",
        patterns: ["flow:*"],
        transport: "poll",
        callback: (e) => lifecycleEvents.push(e),
      })

      writeFlowsYaml(projectRoot, `
flows:
  - name: lifecycle-test
    enabled: true
    trigger:
      pattern: "custom"
    actions:
      - type: log
        message: "ok"
`)

      await engine.start()

      bus.emit({ type: "custom" as MAPEventType, source: "test", data: {} })
      await new Promise(r => setTimeout(r, 50))

      const triggered = lifecycleEvents.filter(e => e.type === "flow:triggered")
      const completed = lifecycleEvents.filter(e => e.type === "flow:completed")

      expect(triggered).toHaveLength(1)
      expect(triggered[0].data.flow_name).toBe("lifecycle-test")
      expect(completed).toHaveLength(1)
      expect(completed[0].data.flow_name).toBe("lifecycle-test")
      expect(completed[0].data.actions_executed).toBe(1)
    })
  })

  describe("stop", () => {
    it("unsubscribes all flow subscriptions", async () => {
      writeFlowsYaml(projectRoot, `
flows:
  - name: a
    enabled: true
    trigger:
      pattern: "custom"
    actions:
      - type: log
        message: "a"
  - name: b
    enabled: true
    trigger:
      pattern: "custom"
    actions:
      - type: log
        message: "b"
`)

      await engine.start()
      expect(bus.getSubscriberCount()).toBe(2)

      engine.stop()
      expect(bus.getSubscriberCount()).toBe(0)
    })
  })

  describe("gates", () => {
    it("blocks flow when time gate is in the future", async () => {
      const futureDate = new Date(Date.now() + 86400000 * 30).toISOString()
      writeFlowsYaml(projectRoot, `
flows:
  - name: time-gated
    enabled: true
    trigger:
      pattern: "hook:tool-use"
    gate:
      after: "${futureDate}"
    actions:
      - type: log
        message: "should not run"
`)
      await engine.start()

      bus.emit({
        type: "hook:tool-use" as MAPEventType,
        source: "test",
        data: { tool_name: "Write" },
      })

      await new Promise(r => setTimeout(r, 100))

      const execs = engine.getExecutions()
      expect(execs).toHaveLength(1)
      expect(execs[0].gated).toBe("time")
      expect(execs[0].actions_executed).toBe(0)
    })

    it("allows flow when time gate is in the past", async () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString()
      writeFlowsYaml(projectRoot, `
flows:
  - name: time-open
    enabled: true
    trigger:
      pattern: "hook:tool-use"
    gate:
      after: "${pastDate}"
    actions:
      - type: log
        message: "should run"
`)
      await engine.start()

      bus.emit({
        type: "hook:tool-use" as MAPEventType,
        source: "test",
        data: { tool_name: "Write" },
      })

      await new Promise(r => setTimeout(r, 100))

      const execs = engine.getExecutions()
      expect(execs).toHaveLength(1)
      expect(execs[0].gated).toBeUndefined()
      expect(execs[0].actions_executed).toBe(1)
    })

    it("blocks flow when before gate has passed", async () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString()
      writeFlowsYaml(projectRoot, `
flows:
  - name: expired-flow
    enabled: true
    trigger:
      pattern: "hook:tool-use"
    gate:
      before: "${pastDate}"
    actions:
      - type: log
        message: "should not run"
`)
      await engine.start()

      bus.emit({
        type: "hook:tool-use" as MAPEventType,
        source: "test",
        data: { tool_name: "Write" },
      })

      await new Promise(r => setTimeout(r, 100))

      const execs = engine.getExecutions()
      expect(execs).toHaveLength(1)
      expect(execs[0].gated).toBe("time")
      expect(execs[0].actions_executed).toBe(0)
    })

    it("blocks flow when requires_approval is true", async () => {
      writeFlowsYaml(projectRoot, `
flows:
  - name: approval-needed
    enabled: true
    trigger:
      pattern: "hook:tool-use"
    gate:
      requires_approval: true
    actions:
      - type: log
        message: "should not auto-run"
`)
      await engine.start()

      bus.emit({
        type: "hook:tool-use" as MAPEventType,
        source: "test",
        data: { tool_name: "Write" },
      })

      await new Promise(r => setTimeout(r, 100))

      const execs = engine.getExecutions()
      expect(execs).toHaveLength(1)
      expect(execs[0].gated).toBe("approval")
      expect(execs[0].actions_executed).toBe(0)
    })

    it("emits gated status in flow:triggered event", async () => {
      const futureDate = new Date(Date.now() + 86400000 * 30).toISOString()
      writeFlowsYaml(projectRoot, `
flows:
  - name: gated-emit
    enabled: true
    trigger:
      pattern: "hook:tool-use"
    gate:
      after: "${futureDate}"
    actions:
      - type: log
        message: "gated"
`)
      await engine.start()

      const flowEvents: MAPEvent[] = []
      bus.subscribe({
        clientId: "gate-watcher",
        patterns: ["flow:triggered"],
        transport: "poll",
        callback: (e) => flowEvents.push(e),
      })

      bus.emit({
        type: "hook:tool-use" as MAPEventType,
        source: "test",
        data: {},
      })

      await new Promise(r => setTimeout(r, 100))

      expect(flowEvents).toHaveLength(1)
      expect(flowEvents[0].data.gated).toBe("time")
    })
  })
})
