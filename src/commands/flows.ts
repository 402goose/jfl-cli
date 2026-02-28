/**
 * jfl flows — Manage declarative event flows
 *
 * @purpose CLI commands to list, add, test, enable/disable flows
 */

import chalk from "chalk"
import * as fs from "fs"
import * as path from "path"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import type { FlowDefinition, FlowsConfig } from "../types/flows.js"

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
    console.log(chalk.green(`\n  Flow triggered successfully`))
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

export async function flowsCommand(action?: string, nameOrArgs?: string): Promise<void> {
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
    default:
      console.log(chalk.bold("\n  jfl flows — Declarative event flows\n"))
      console.log(chalk.gray("  Commands:"))
      console.log("    jfl flows list              Show configured flows")
      console.log("    jfl flows add               Interactive flow builder")
      console.log("    jfl flows test <name>       Test a flow with a synthetic event")
      console.log("    jfl flows enable <name>     Enable a flow")
      console.log("    jfl flows disable <name>    Disable a flow")
      console.log()
  }
}
