/**
 * @purpose Type definitions for jfl ide workspace layouts and per-user customization
 */

export interface IdePane {
  title: string
  command?: string
  size?: string
  focus?: boolean
  type?: IdePaneType
  agent?: string
}

export type IdePaneType =
  | "claude"
  | "pi"
  | "shell"
  | "welcome"
  | "agent"
  | "agents"
  | "events"
  | "eval"
  | "training"
  | "topology"
  | "alerts"
  | "service"
  | "flows"
  | "telemetry"
  | "portfolio"
  | "dashboard"
  | "custom"

export interface IdeRow {
  size?: string
  panes: IdePane[]
}

export interface IdeTheme {
  accent?: string
  border?: string
  bg?: string
  fg?: string
}

export interface IdeLayout {
  name: string
  before?: string
  rows: IdeRow[]
  theme?: IdeTheme
}

export interface IdeLayoutPrefs {
  defaultSurfaces?: string[]
  sidebarSections?: string[]
  agentDetail?: "expanded" | "compact" | "hidden"
}

export interface IdeNotificationPrefs {
  agentRoundComplete?: boolean
  agentPrCreated?: boolean
  evalRegression?: boolean
  serviceUnhealthy?: boolean
  flowNeedsApproval?: boolean
}

export interface IdeConfig {
  primary?: "claude" | "pi" | "auto"
  piAsked?: boolean
  backend?: "cmux" | "tmux" | "auto"
  layout?: IdeLayoutPrefs
  notifications?: IdeNotificationPrefs
  theme?: IdeTheme
}
