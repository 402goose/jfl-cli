/**
 * JFL Prompts - Wrapper around @clack/prompts with JFL styling
 */

import * as clack from "@clack/prompts"
import { theme, colors } from "./theme.js"
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
// PROMPTS
// ============================================================================

interface TextOptions {
  message: string
  placeholder?: string
  defaultValue?: string
  validate?: (value: string) => string | void
}

export async function text(opts: TextOptions): Promise<string | symbol> {
  return clack.text({
    message: opts.message,
    placeholder: opts.placeholder,
    defaultValue: opts.defaultValue,
    validate: opts.validate,
  })
}

interface SelectOption<T> {
  value: T
  label: string
  hint?: string
}

interface SelectOptions<T> {
  message: string
  options: SelectOption<T>[]
  initialValue?: T
}

export async function select<T>(opts: SelectOptions<T>): Promise<T | symbol> {
  return clack.select({
    message: opts.message,
    options: opts.options,
    initialValue: opts.initialValue,
  })
}

interface ConfirmOptions {
  message: string
  initialValue?: boolean
}

export async function confirm(opts: ConfirmOptions): Promise<boolean | symbol> {
  return clack.confirm({
    message: opts.message,
    initialValue: opts.initialValue,
  })
}

interface MultiSelectOption<T> {
  value: T
  label: string
  hint?: string
}

interface MultiSelectOptions<T> {
  message: string
  options: MultiSelectOption<T>[]
  required?: boolean
  initialValues?: T[]
}

export async function multiselect<T>(opts: MultiSelectOptions<T>): Promise<T[] | symbol> {
  return clack.multiselect({
    message: opts.message,
    options: opts.options,
    required: opts.required,
    initialValues: opts.initialValues,
  })
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
// RE-EXPORT isCancel for convenience
// ============================================================================

export { clack }
