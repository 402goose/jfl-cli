/**
 * jfl flows — Manage declarative event flows
 *
 * @purpose CLI commands to list, add, test, enable/disable flows
 */

import chalk from "chalk"
import * as fs from "fs"
import * as path from "path"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import type { FlowDefinition, FlowsConfig, FlowExecution } from "../types/flows.js"
import { getProjectPort } from "../utils/context-hub-port.js"

function findProjectRoot(): string | null {
  let dir = process.cwd()
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".jfl", "config.json")) || fs.existsSync(path.join(dir, ".jfl"))) {
      return dir
    }
    dir = path.dirname(dir)
  }
  return null
}

function getFlowsPath(): string {
  const root = findProjectRoot() || process.cwd()
  return path.join(root, ".jfl", "flows.yaml")
}

function loadFlowsConfig(): FlowsConfig {
  const flowsPath = getFlowsPath()
  if (!fs.existsSync(flowsPath)) {
    return { flows: [] }
  }
  try {
    const content = fs.readFileSync(flowsPath, "utf-8")
    const config = parseYaml(content) as FlowsConfig
    return config?.flows ? config : { flows: [] }
  } catch {
    return { flows: [] }
  }
}

function saveFlowsConfig(config: FlowsConfig): void {
  const flowsPath = getFlowsPath()
  const dir = path.dirname(flowsPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(flowsPath, stringifyYaml(config, { lineWidth: 120 }))
}

async function listFlows(): Promise<void> {
  const config = loadFlowsConfig()

  if (config.flows.length === 0) {
    console.log(chalk.gray("\n  No flows configured."))
    console.log(chalk.gray("  Run: jfl flows add\n"))
    return
  }

  console.log(chalk.bold(`\n  Flows (${config.flows.length})\n`))

  for (const flow of config.flows) {
    const status = flow.enabled
      ? chalk.green("enabled ")
      : chalk.gray("disabled")
    const trigger = chalk.cyan(flow.trigger.pattern)
    const actionCount = chalk.gray(`${flow.actions.length} action${flow.actions.length !== 1 ? "s" : ""}`)
    console.log(`  ${status}  ${chalk.bold(flow.name)}`)
    console.log(chalk.gray(`           trigger: ${trigger}  ${actionCount}`))
    if (flow.gate) {
      const gateParts: string[] = []
      if (flow.gate.after) gateParts.push(`after ${flow.gate.after}`)
      if (flow.gate.before) gateParts.push(`before ${flow.gate.before}`)
      if (flow.gate.requires_approval) gateParts.push("requires approval")
      console.log(chalk.yellow(`           gate: ${gateParts.join(", ")}`))
    }
    if (flow.description) {
      console.log(chalk.gray(`           ${flow.description}`))
    }
    console.log()
  }
}

async function addFlow(): Promise<void> {
  const config = loadFlowsConfig()

  const readline = await import("readline")
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, resolve))

  console.log(chalk.bold("\n  Add a new flow\n"))

  const name = await ask(chalk.gray("  Name: "))
  if (!name.trim()) {
    console.log(chalk.red("  Name is required."))
    rl.close()
    return
  }

  const description = await ask(chalk.gray("  Description (optional): "))
  const pattern = await ask(chalk.gray("  Trigger pattern (e.g. hook:tool-use): "))
  if (!pattern.trim()) {
    console.log(chalk.red("  Trigger pattern is required."))
    rl.close()
    return
  }

  const source = await ask(chalk.gray("  Source filter (optional): "))
  const condition = await ask(chalk.gray("  Condition (optional, e.g. data.tool_name == \"Write\"): "))

  console.log(chalk.gray("\n  Action types: log, emit, journal, webhook, command"))
  const actionType = await ask(chalk.gray("  Action type: "))

  let action: any = { type: actionType.trim() }

  switch (actionType.trim()) {
    case "log": {
      const message = await ask(chalk.gray("  Log message (supports {{data.field}}): "))
      action.message = message
      break
    }
    case "emit": {
      const eventType = await ask(chalk.gray("  Event type to emit: "))
      action.event_type = eventType
      action.data = { source: `flow:${name.trim()}` }
      break
    }
    case "journal": {
      const entryType = await ask(chalk.gray("  Journal entry type: "))
      const title = await ask(chalk.gray("  Journal title: "))
      const summary = await ask(chalk.gray("  Journal summary: "))
      action.entry_type = entryType
      action.title = title
      action.summary = summary
      break
    }
    case "webhook": {
      const url = await ask(chalk.gray("  Webhook URL: "))
      action.url = url
      break
    }
    case "command": {
      const cmd = await ask(chalk.gray("  Command: "))
      action.command = cmd
      break
    }
    default: {
      console.log(chalk.red(`  Unknown action type: ${actionType}`))
      rl.close()
      return
    }
  }

  rl.close()

  const flow: FlowDefinition = {
    name: name.trim(),
    description: description.trim() || undefined,
    enabled: true,
    trigger: {
      pattern: pattern.trim(),
      ...(source.trim() ? { source: source.trim() } : {}),
      ...(condition.trim() ? { condition: condition.trim() } : {}),
    },
    actions: [action],
  }

  config.flows.push(flow)
  saveFlowsConfig(config)

  console.log(chalk.green(`\n  Flow "${flow.name}" added and enabled.\n`))
}

async function testFlow(name: string): Promise<void> {
  if (!name) {
    console.log(chalk.red("\n  Usage: jfl flows test <name>\n"))
    return
  }

  const config = loadFlowsConfig()
  const flow = config.flows.find((f) => f.name === name)

  if (!flow) {
    console.log(chalk.red(`\n  Flow "${name}" not found.\n`))
    return
  }

  console.log(chalk.bold(`\n  Testing flow: ${flow.name}`))
  console.log(chalk.gray(`  Trigger: ${flow.trigger.pattern}\n`))

  const { MAPEventBus } = await import("../lib/map-event-bus.js")
  const { FlowEngine } = await import("../lib/flow-engine.js")

  const root = findProjectRoot() || process.cwd()
  const eventBus = new MAPEventBus({ maxSize: 100 })
  const engine = new FlowEngine(eventBus, root)

  const started = await engine.start()
  console.log(chalk.gray(`  Engine started with ${started} flow(s)`))

  const testType = flow.trigger.pattern.replace(/\*/g, "test")
  const testEvent = eventBus.emit({
    type: testType as any,
    source: flow.trigger.source || "test",
    data: {
      tool_name: "Write",
      file_paths: ["/tmp/test-file.ts"],
      hook_event_name: "PostToolUse",
    },
  })

  console.log(chalk.gray(`  Emitted test event: ${testEvent.type} (${testEvent.id})`))

  await new Promise((resolve) => setTimeout(resolve, 500))

  const executions = engine.getExecutions()
  const flowExec = executions.find((e) => e.flow === name)

  if (flowExec) {
    if (flowExec.gated) {
      console.log(chalk.yellow(`\n  Flow triggered but gated: ${flowExec.gated}`))
      if (flowExec.gated === "time") console.log(chalk.gray(`  Time gate not yet open — check gate.after/before`))
      if (flowExec.gated === "approval") console.log(chalk.gray(`  Requires human approval before actions execute`))
    } else {
      console.log(chalk.green(`\n  Flow triggered successfully`))
    }
    console.log(chalk.gray(`  Actions executed: ${flowExec.actions_executed}`))
    console.log(chalk.gray(`  Actions failed: ${flowExec.actions_failed}`))
    if (flowExec.error) {
      console.log(chalk.red(`  Error: ${flowExec.error}`))
    }
  } else {
    console.log(chalk.yellow(`\n  Flow did not trigger.`))
    console.log(chalk.gray(`  Check trigger pattern matches: ${flow.trigger.pattern}`))
    if (flow.trigger.source) {
      console.log(chalk.gray(`  Source filter: ${flow.trigger.source}`))
    }
    if (flow.trigger.condition) {
      console.log(chalk.gray(`  Condition: ${flow.trigger.condition}`))
    }
  }

  engine.stop()
  eventBus.destroy()
  console.log()
}

async function toggleFlow(name: string, enabled: boolean): Promise<void> {
  if (!name) {
    console.log(chalk.red(`\n  Usage: jfl flows ${enabled ? "enable" : "disable"} <name>\n`))
    return
  }

  const config = loadFlowsConfig()
  const flow = config.flows.find((f) => f.name === name)

  if (!flow) {
    console.log(chalk.red(`\n  Flow "${name}" not found.\n`))
    return
  }

  flow.enabled = enabled
  saveFlowsConfig(config)

  const status = enabled ? chalk.green("enabled") : chalk.gray("disabled")
  console.log(`\n  Flow "${name}" ${status}.\n`)
}

function getHubAuth(projectRoot: string): { url: string; token: string | null } {
  const port = getProjectPort(projectRoot)
  const tokenPath = path.join(projectRoot, ".jfl", "context-hub.token")
  const token = fs.existsSync(tokenPath)
    ? fs.readFileSync(tokenPath, "utf-8").trim()
    : null
  return { url: `http://localhost:${port}`, token }
}

async function fetchExecutions(hubUrl: string, token: string | null): Promise<FlowExecution[]> {
  const headers: Record<string, string> = {}
  if (token) headers["Authorization"] = `Bearer ${token}`

  const res = await fetch(`${hubUrl}/api/flows/executions`, {
    headers,
    signal: AbortSignal.timeout(5000),
  })

  if (!res.ok) {
    throw new Error(`Hub returned ${res.status}: ${await res.text()}`)
  }

  const data = (await res.json()) as { executions: FlowExecution[] }
  return data.executions
}

async function callApprove(
  hubUrl: string,
  token: string | null,
  flowName: string,
  triggerEventId: string
): Promise<FlowExecution> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["Authorization"] = `Bearer ${token}`

  const res = await fetch(`${hubUrl}/api/flows/${encodeURIComponent(flowName)}/approve`, {
    method: "POST",
    headers,
    body: JSON.stringify({ trigger_event_id: triggerEventId }),
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Approve failed (${res.status}): ${body}`)
  }

  return (await res.json()) as FlowExecution
}

function printExecution(exec: FlowExecution, index?: number): void {
  const prefix = index !== undefined ? chalk.bold(`  ${index + 1}.`) : " "
  console.log(`${prefix} ${chalk.bold(exec.flow)}`)
  console.log(chalk.gray(`     trigger: ${exec.trigger_event_type} (${exec.trigger_event_id.slice(0, 8)}…)`))
  console.log(chalk.yellow(`     gated: ${exec.gated}`))
  console.log(chalk.gray(`     started: ${exec.started_at}`))
}

async function approveFlows(options: { flow?: string; all?: boolean }): Promise<void> {
  const root = findProjectRoot()
  if (!root) {
    console.log(chalk.red("\n  Not in a JFL project.\n"))
    return
  }

  const { url: hubUrl, token } = getHubAuth(root)

  let executions: FlowExecution[]
  try {
    executions = await fetchExecutions(hubUrl, token)
  } catch (err: any) {
    console.log(chalk.red(`\n  Could not reach Context Hub: ${err.message}\n`))
    return
  }

  let pending = executions.filter((e) => !!e.gated)
  if (options.flow) {
    pending = pending.filter((e) => e.flow === options.flow)
  }

  if (pending.length === 0) {
    const suffix = options.flow ? ` for flow "${options.flow}"` : ""
    console.log(chalk.gray(`\n  No pending approvals${suffix}.\n`))
    return
  }

  const readline = await import("readline")
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, resolve))

  if (options.all) {
    console.log(chalk.bold(`\n  ${pending.length} pending approval(s):\n`))
    for (let i = 0; i < pending.length; i++) {
      printExecution(pending[i], i)
    }
    console.log()
    const confirm = await ask(chalk.yellow(`  Approve all ${pending.length}? (y/N) `))
    if (confirm.trim().toLowerCase() !== "y") {
      console.log(chalk.gray("  Cancelled.\n"))
      rl.close()
      return
    }

    for (const exec of pending) {
      try {
        const result = await callApprove(hubUrl, token, exec.flow, exec.trigger_event_id)
        console.log(chalk.green(`  ✓ ${exec.flow}`) + chalk.gray(` — ${result.actions_executed} action(s) executed`))
      } catch (err: any) {
        console.log(chalk.red(`  ✗ ${exec.flow}: ${err.message}`))
      }
    }
    console.log()
    rl.close()
    return
  }

  if (pending.length === 1) {
    const exec = pending[0]
    console.log(chalk.bold("\n  Pending approval:\n"))
    printExecution(exec)
    console.log()
    const confirm = await ask(chalk.yellow("  Approve? (y/N) "))
    if (confirm.trim().toLowerCase() !== "y") {
      console.log(chalk.gray("  Cancelled.\n"))
      rl.close()
      return
    }

    try {
      const result = await callApprove(hubUrl, token, exec.flow, exec.trigger_event_id)
      console.log(chalk.green(`\n  Approved.`) + chalk.gray(` ${result.actions_executed} action(s) executed, ${result.actions_failed} failed.\n`))
    } catch (err: any) {
      console.log(chalk.red(`\n  ${err.message}\n`))
    }
    rl.close()
    return
  }

  console.log(chalk.bold(`\n  ${pending.length} pending approval(s):\n`))
  for (let i = 0; i < pending.length; i++) {
    printExecution(pending[i], i)
  }
  console.log()
  const choice = await ask(chalk.yellow(`  Approve which? (1-${pending.length}, or "all") `))
  rl.close()

  if (choice.trim().toLowerCase() === "all") {
    for (const exec of pending) {
      try {
        const result = await callApprove(hubUrl, token, exec.flow, exec.trigger_event_id)
        console.log(chalk.green(`  ✓ ${exec.flow}`) + chalk.gray(` — ${result.actions_executed} action(s) executed`))
      } catch (err: any) {
        console.log(chalk.red(`  ✗ ${exec.flow}: ${err.message}`))
      }
    }
    console.log()
    return
  }

  const idx = parseInt(choice.trim(), 10) - 1
  if (isNaN(idx) || idx < 0 || idx >= pending.length) {
    console.log(chalk.red(`  Invalid selection.\n`))
    return
  }

  const selected = pending[idx]
  try {
    const result = await callApprove(hubUrl, token, selected.flow, selected.trigger_event_id)
    console.log(chalk.green(`\n  Approved.`) + chalk.gray(` ${result.actions_executed} action(s) executed, ${result.actions_failed} failed.\n`))
  } catch (err: any) {
    console.log(chalk.red(`\n  ${err.message}\n`))
  }
}

export async function flowsCommand(action?: string, nameOrArgs?: string, options?: { flow?: string; all?: boolean }): Promise<void> {
  switch (action) {
    case "list":
      await listFlows()
      break
    case "add":
      await addFlow()
      break
    case "test":
      await testFlow(nameOrArgs || "")
      break
    case "enable":
      await toggleFlow(nameOrArgs || "", true)
      break
    case "disable":
      await toggleFlow(nameOrArgs || "", false)
      break
    case "approve":
      await approveFlows(options || {})
      break
    default:
      console.log(chalk.bold("\n  jfl flows — Declarative event flows\n"))
      console.log(chalk.gray("  Commands:"))
      console.log("    jfl flows list              Show configured flows")
      console.log("    jfl flows add               Interactive flow builder")
      console.log("    jfl flows test <name>       Test a flow with a synthetic event")
      console.log("    jfl flows enable <name>     Enable a flow")
      console.log("    jfl flows disable <name>    Disable a flow")
      console.log("    jfl flows approve           Approve gated flow executions")
      console.log(chalk.gray("      --flow <name>             Filter to a specific flow"))
      console.log(chalk.gray("      --all                     Approve all pending"))
      console.log()
  }
}
