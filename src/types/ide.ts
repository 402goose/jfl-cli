/**
 * IDE Layout Types
 *
 * Declarative workspace layout for jfl ide. Maps to tmux-ide's ide.yml format
 * with JFL-specific extensions for agent resolution and built-in pane types.
 *
 * @purpose Type definitions for jfl ide workspace layouts
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
  | "events"
  | "eval"
  | "training"
  | "topology"
  | "alerts"
  | "service"
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

export interface IdeConfig {
  primary?: "claude" | "pi" | "auto"
  piAsked?: boolean
  claudeCommand?: string
}
