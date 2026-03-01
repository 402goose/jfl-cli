jest.mock("../lib/telemetry.js", () => ({
  telemetry: { track: jest.fn() }
}))

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { MAPEventBus } from "../lib/map-event-bus.js"
import { FlowEngine } from "../lib/flow-engine.js"
import type { MAPEventType } from "../types/map.js"

function createTmpProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "condition-eval-test-"))
  fs.mkdirSync(path.join(dir, ".jfl"), { recursive: true })
  return dir
}

function writeFlowsYaml(projectRoot: string, condition: string): void {
  fs.writeFileSync(
    path.join(projectRoot, ".jfl", "flows.yaml"),
    `
flows:
  - name: cond-test
    enabled: true
    trigger:
      pattern: "custom"
      condition: '${condition}'
    actions:
      - type: log
        message: "CONDITION_FIRED"
`
  )
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

describe("FlowEngine.validateCondition (static)", () => {
  const valid = [
    ['data.tool_name == "Write"', "== operator with dotted field"],
    ['data.status != "error"', "!= operator"],
    ['data.message contains "test"', "contains operator"],
    ['source == "hook"', "top-level field =="],
  ]

  const invalid = [
    ['"this is not valid"', "quoted string, no field/operator"],
    ["data.tool_name", "field only, no operator"],
    ['data.tool_name == Write', "unquoted value"],
    ["", "empty string"],
    ['data.x > "5"', "unsupported operator >"],
  ]

  it.each(valid)("VALID: %s (%s)", (condition) => {
    const result = FlowEngine.validateCondition(condition)
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it.each(invalid)("INVALID: %s (%s)", (condition) => {
    const result = FlowEngine.validateCondition(condition)
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
    expect(typeof result.error).toBe("string")
    expect(result.error!.length).toBeGreaterThan(0)
  })
})

describe("condition evaluation at runtime", () => {
  let projectRoot: string
  let bus: MAPEventBus
  let engine: FlowEngine
  let consoleSpy: jest.SpyInstance

  beforeEach(() => {
    projectRoot = createTmpProject()
    bus = new MAPEventBus()
    engine = new FlowEngine(bus, projectRoot)
    consoleSpy = jest.spyOn(console, "log").mockImplementation()
    jest.spyOn(console, "warn").mockImplementation()
  })

  afterEach(() => {
    engine.stop()
    bus.destroy()
    cleanup(projectRoot)
    jest.restoreAllMocks()
  })

  function firedCondition(): boolean {
    return consoleSpy.mock.calls.some(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("CONDITION_FIRED")
    )
  }

  describe("valid conditions that SHOULD trigger", () => {
    it('data.tool_name == "Write" triggers when tool_name is Write', async () => {
      writeFlowsYaml(projectRoot, 'data.tool_name == "Write"')
      await engine.start()

      bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: { tool_name: "Write" },
      })
      await new Promise(r => setTimeout(r, 50))

      expect(firedCondition()).toBe(true)
    })

    it('data.status != "error" triggers when status is ok', async () => {
      writeFlowsYaml(projectRoot, 'data.status != "error"')
      await engine.start()

      bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: { status: "ok" },
      })
      await new Promise(r => setTimeout(r, 50))

      expect(firedCondition()).toBe(true)
    })

    it('data.message contains "important" triggers on substring match', async () => {
      writeFlowsYaml(projectRoot, 'data.message contains "important"')
      await engine.start()

      bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: { message: "this is very important stuff" },
      })
      await new Promise(r => setTimeout(r, 50))

      expect(firedCondition()).toBe(true)
    })

    it('source == "hook" triggers when source matches', async () => {
      writeFlowsYaml(projectRoot, 'source == "hook"')
      await engine.start()

      bus.emit({
        type: "custom" as MAPEventType,
        source: "hook",
        data: {},
      })
      await new Promise(r => setTimeout(r, 50))

      expect(firedCondition()).toBe(true)
    })
  })

  describe("valid conditions that should NOT trigger", () => {
    it('data.tool_name == "Write" does not trigger when tool_name is Read', async () => {
      writeFlowsYaml(projectRoot, 'data.tool_name == "Write"')
      await engine.start()

      bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: { tool_name: "Read" },
      })
      await new Promise(r => setTimeout(r, 50))

      expect(firedCondition()).toBe(false)
    })

    it('data.status != "error" does not trigger when status IS error', async () => {
      writeFlowsYaml(projectRoot, 'data.status != "error"')
      await engine.start()

      bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: { status: "error" },
      })
      await new Promise(r => setTimeout(r, 50))

      expect(firedCondition()).toBe(false)
    })
  })

  describe("invalid conditions cause flow to NOT trigger (not pass through)", () => {
    it('"this is not valid" does not trigger', async () => {
      writeFlowsYaml(projectRoot, "this is not valid")
      await engine.start()

      bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: { tool_name: "Write" },
      })
      await new Promise(r => setTimeout(r, 50))

      expect(firedCondition()).toBe(false)
    })

    it("data.tool_name (no operator) does not trigger", async () => {
      writeFlowsYaml(projectRoot, "data.tool_name")
      await engine.start()

      bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: { tool_name: "Write" },
      })
      await new Promise(r => setTimeout(r, 50))

      expect(firedCondition()).toBe(false)
    })

    it("data.tool_name == Write (unquoted value) does not trigger", async () => {
      writeFlowsYaml(projectRoot, "data.tool_name == Write")
      await engine.start()

      bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: { tool_name: "Write" },
      })
      await new Promise(r => setTimeout(r, 50))

      expect(firedCondition()).toBe(false)
    })

    it("empty string condition is treated as no condition (flow fires)", async () => {
      fs.writeFileSync(
        path.join(projectRoot, ".jfl", "flows.yaml"),
        `
flows:
  - name: cond-test
    enabled: true
    trigger:
      pattern: "custom"
      condition: ""
    actions:
      - type: log
        message: "CONDITION_FIRED"
`
      )
      await engine.start()

      bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: {},
      })
      await new Promise(r => setTimeout(r, 50))

      expect(firedCondition()).toBe(true)
    })

    it('data.x > "5" (unsupported operator) does not trigger', async () => {
      writeFlowsYaml(projectRoot, 'data.x > "5"')
      await engine.start()

      bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: { x: "10" },
      })
      await new Promise(r => setTimeout(r, 50))

      expect(firedCondition()).toBe(false)
    })
  })

  describe("edge cases", () => {
    it("missing field path evaluates to empty string, == check fails", async () => {
      writeFlowsYaml(projectRoot, 'data.missing.deep.field == "value"')
      await engine.start()

      bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: {},
      })
      await new Promise(r => setTimeout(r, 50))

      expect(firedCondition()).toBe(false)
    })

    it("null field in data does not throw", async () => {
      writeFlowsYaml(projectRoot, 'data.field == "val"')
      await engine.start()

      bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: { field: null as any },
      })
      await new Promise(r => setTimeout(r, 50))

      expect(firedCondition()).toBe(false)
    })

    it("numeric field coerced to string for comparison", async () => {
      writeFlowsYaml(projectRoot, 'data.count == "42"')
      await engine.start()

      bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: { count: 42 },
      })
      await new Promise(r => setTimeout(r, 50))

      expect(firedCondition()).toBe(true)
    })

    it("contains on numeric coerced field", async () => {
      writeFlowsYaml(projectRoot, 'data.count contains "4"')
      await engine.start()

      bus.emit({
        type: "custom" as MAPEventType,
        source: "test",
        data: { count: 42 },
      })
      await new Promise(r => setTimeout(r, 50))

      expect(firedCondition()).toBe(true)
    })
  })
})
