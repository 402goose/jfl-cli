/**
 * JFL Prompts - Wrapper around @clack/prompts with JFL styling
 */

import * as clack from "@clack/prompts"
import { theme } from "./theme.js"
import { renderBanner } from "./banner.js"

// ============================================================================
// STYLED WRAPPERS
// ============================================================================

export function intro(version?: string): void {
  console.log(renderBanner({ version }))
}

export function outro(message: string): void {
  clack.outro(theme.success("✓") + " " + theme.text(message))
}

export function note(message: string, title?: string): void {
  clack.note(message, title)
}

export function cancel(message: string = "Cancelled"): void {
  clack.cancel(theme.dim(message))
}

// Spinner with JFL styling
export function spinner(): ReturnType<typeof clack.spinner> {
  return clack.spinner()
}

// ============================================================================
// PROMPTS - Re-export with simpler types
// ============================================================================

export async function text(opts: {
  message: string
  placeholder?: string
  defaultValue?: string
  validate?: (value: string) => string | undefined
}): Promise<string | symbol> {
  return clack.text(opts)
}

export async function select<T>(opts: {
  message: string
  options: { value: T; label: string; hint?: string }[]
  initialValue?: T
}): Promise<T | symbol> {
  return clack.select(opts as Parameters<typeof clack.select>[0]) as Promise<T | symbol>
}

export async function confirm(opts: {
  message: string
  initialValue?: boolean
}): Promise<boolean | symbol> {
  return clack.confirm(opts)
}

export async function multiselect<T>(opts: {
  message: string
  options: { value: T; label: string; hint?: string }[]
  required?: boolean
  initialValues?: T[]
}): Promise<T[] | symbol> {
  return clack.multiselect(opts as Parameters<typeof clack.multiselect>[0]) as Promise<T[] | symbol>
}

export async function password(opts: {
  message: string
  mask?: string
  validate?: (value: string) => string | undefined
}): Promise<string | symbol> {
  return clack.password(opts)
}

// ============================================================================
// UTILITIES
// ============================================================================

export function isCancel(value: unknown): value is symbol {
  return clack.isCancel(value)
}

export function log(message: string): void {
  clack.log.message(message)
}

export function logStep(message: string): void {
  clack.log.step(message)
}

export function logSuccess(message: string): void {
  clack.log.success(message)
}

export function logWarning(message: string): void {
  clack.log.warn(message)
}

export function logError(message: string): void {
  clack.log.error(message)
}

export function logInfo(message: string): void {
  clack.log.info(message)
}

// ============================================================================
// RE-EXPORT clack for advanced usage
// ============================================================================

export { clack }
