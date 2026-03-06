jest.mock("../lib/telemetry.js", () => ({
  telemetry: { track: jest.fn() }
}))

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { MAPEventBus } from "../lib/map-event-bus.js"
import { FlowEngine } from "../lib/flow-engine.js"
import type { MAPEvent, MAPEventType } from "../types/map.js"

function createTmpProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flow-approve-test-"))
  fs.mkdirSync(path.join(dir, ".jfl"), { recursive: true })
  return dir
}

function writeFlowsYaml(projectRoot: string, content: string): void {
  fs.writeFileSync(path.join(projectRoot, ".jfl", "flows.yaml"), content)
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

describe("FlowEngine.approveGated", () => {
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

  it("approves a gated execution and runs actions", async () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation()

    writeFlowsYaml(projectRoot, `
flows:
  - name: approval-flow
    enabled: true
    trigger:
      pattern: "hook:tool-use"
    gate:
      requires_approval: true
    actions:
      - type: log
        message: "Approved action ran"
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

    const result = await engine.approveGated("approval-flow", execs[0].trigger_event_id)

    expect(result).not.toBeNull()
    expect(result!.gated).toBeUndefined()
    expect(result!.actions_executed).toBe(1)
    expect(result!.actions_failed).toBe(0)
    expect(result!.completed_at).toBeDefined()

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Approved action ran")
    )
    consoleSpy.mockRestore()
  })

  it("returns null for non-existent execution", async () => {
    writeFlowsYaml(projectRoot, `
flows:
  - name: some-flow
    enabled: true
    trigger:
      pattern: "custom"
    gate:
      requires_approval: true
    actions:
      - type: log
        message: "x"
`)

    await engine.start()

    const result = await engine.approveGated("some-flow", "nonexistent-id")
    expect(result).toBeNull()
  })

  it("returns null for non-existent flow name", async () => {
    writeFlowsYaml(projectRoot, `
flows:
  - name: real-flow
    enabled: true
    trigger:
      pattern: "custom"
    gate:
      requires_approval: true
    actions:
      - type: log
        message: "x"
`)

    await engine.start()

    bus.emit({
      type: "custom" as MAPEventType,
      source: "test",
      data: {},
    })
    await new Promise(r => setTimeout(r, 50))

    const execs = engine.getExecutions()
    const result = await engine.approveGated("wrong-flow-name", execs[0].trigger_event_id)
    expect(result).toBeNull()
  })

  it("does not approve non-gated executions", async () => {
    jest.spyOn(console, "log").mockImplementation()

    writeFlowsYaml(projectRoot, `
flows:
  - name: ungated
    enabled: true
    trigger:
      pattern: "custom"
    actions:
      - type: log
        message: "ran normally"
`)

    await engine.start()

    bus.emit({
      type: "custom" as MAPEventType,
      source: "test",
      data: {},
    })
    await new Promise(r => setTimeout(r, 50))

    const execs = engine.getExecutions()
    expect(execs).toHaveLength(1)
    expect(execs[0].gated).toBeUndefined()

    const result = await engine.approveGated("ungated", execs[0].trigger_event_id)
    expect(result).toBeNull()
  })

  it("emits flow:completed event on approval", async () => {
    jest.spyOn(console, "log").mockImplementation()
    const completedEvents: MAPEvent[] = []

    bus.subscribe({
      clientId: "approval-watcher",
      patterns: ["flow:completed"],
      transport: "poll",
      callback: (e) => completedEvents.push(e),
    })

    writeFlowsYaml(projectRoot, `
flows:
  - name: emit-test
    enabled: true
    trigger:
      pattern: "custom"
    gate:
      requires_approval: true
    actions:
      - type: log
        message: "approved"
`)

    await engine.start()

    bus.emit({
      type: "custom" as MAPEventType,
      source: "test",
      data: {},
    })
    await new Promise(r => setTimeout(r, 100))

    const execs = engine.getExecutions()
    await engine.approveGated("emit-test", execs[0].trigger_event_id)
    await new Promise(r => setTimeout(r, 50))

    const approved = completedEvents.filter(e => e.data.approved === true)
    expect(approved).toHaveLength(1)
    expect(approved[0].data.flow_name).toBe("emit-test")
    expect(approved[0].data.actions_executed).toBe(1)
  })

  it("handles action failures during approval gracefully", async () => {
    jest.spyOn(console, "error").mockImplementation()

    writeFlowsYaml(projectRoot, `
flows:
  - name: fail-on-approve
    enabled: true
    trigger:
      pattern: "custom"
    gate:
      requires_approval: true
    actions:
      - type: webhook
        url: "http://255.255.255.255:1/nope"
      - type: log
        message: "after fail"
`)

    await engine.start()

    bus.emit({
      type: "custom" as MAPEventType,
      source: "test",
      data: {},
    })
    await new Promise(r => setTimeout(r, 100))

    const execs = engine.getExecutions()
    const result = await engine.approveGated("fail-on-approve", execs[0].trigger_event_id)

    expect(result).not.toBeNull()
    expect(result!.actions_failed).toBeGreaterThanOrEqual(1)
    expect(result!.error).toBeDefined()
  })

  it("time-gated flow can be approved", async () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation()
    const futureDate = new Date(Date.now() + 86400000 * 30).toISOString()

    writeFlowsYaml(projectRoot, `
flows:
  - name: time-gated
    enabled: true
    trigger:
      pattern: "custom"
    gate:
      after: "${futureDate}"
    actions:
      - type: log
        message: "time gate bypassed"
`)

    await engine.start()

    bus.emit({
      type: "custom" as MAPEventType,
      source: "test",
      data: {},
    })
    await new Promise(r => setTimeout(r, 100))

    const execs = engine.getExecutions()
    expect(execs[0].gated).toBe("time")

    const result = await engine.approveGated("time-gated", execs[0].trigger_event_id)
    expect(result).not.toBeNull()
    expect(result!.gated).toBeUndefined()
    expect(result!.actions_executed).toBe(1)

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("time gate bypassed")
    )
    consoleSpy.mockRestore()
  })
})

describe("FlowEngine.getFlows / getExecutions", () => {
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

  it("getFlows returns empty before start", () => {
    expect(engine.getFlows()).toEqual([])
  })

  it("getFlows returns loaded flows after start", async () => {
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
    enabled: false
    trigger:
      pattern: "custom"
    actions:
      - type: log
        message: "b"
`)

    await engine.start()
    const flows = engine.getFlows()
    expect(flows).toHaveLength(2)
    expect(flows[0].name).toBe("a")
    expect(flows[1].name).toBe("b")
  })

  it("getFlows returns a copy (not mutable reference)", async () => {
    writeFlowsYaml(projectRoot, `
flows:
  - name: immutable-test
    enabled: true
    trigger:
      pattern: "custom"
    actions:
      - type: log
        message: "x"
`)

    await engine.start()
    const flows1 = engine.getFlows()
    flows1.push({} as any)
    const flows2 = engine.getFlows()
    expect(flows2).toHaveLength(1)
  })

  it("getExecutions returns empty initially", () => {
    expect(engine.getExecutions()).toEqual([])
  })

  it("getExecutions returns a copy (not mutable reference)", async () => {
    jest.spyOn(console, "log").mockImplementation()

    writeFlowsYaml(projectRoot, `
flows:
  - name: exec-copy
    enabled: true
    trigger:
      pattern: "custom"
    actions:
      - type: log
        message: "x"
`)

    await engine.start()
    bus.emit({ type: "custom" as MAPEventType, source: "test", data: {} })
    await new Promise(r => setTimeout(r, 50))

    const execs1 = engine.getExecutions()
    execs1.push({} as any)
    const execs2 = engine.getExecutions()
    expect(execs2).toHaveLength(1)
  })
})
