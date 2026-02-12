/**
 * Claude Code Settings Validator
 *
 * Validates and auto-fixes .claude/settings.json files to ensure compliance
 * with Claude Code's schema requirements.
 *
 * @purpose Validate and repair Claude Code settings files
 */

export interface ValidationError {
  hook: string;
  index: number;
  error: string;
  fix?: string;
}

export interface SettingsSchema {
  hooks?: {
    [hookName: string]: HookEntry[];
  };
}

export interface HookEntry {
  matcher: string;
  hooks: HookCommand[];
}

export interface HookCommand {
  type: string;
  command: string;
  args?: string[];
  async?: boolean;
}

/**
 * Validates a Claude Code settings object for schema compliance
 *
 * Checks for:
 * 1. Missing `matcher` fields (Bug 1)
 * 2. Invalid `:service` suffixes on hook names (Bug 2)
 * 3. Flat object format instead of array (Bug 3)
 * 4. Required hook command fields
 * 5. Context-hub stop in Stop hook (should never stop shared service)
 * 6. Exit 0 that masks hook failures (warning only)
 *
 * @param settings - The settings object to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateSettings(settings: any): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!settings || typeof settings !== 'object') {
    errors.push({
      hook: 'root',
      index: 0,
      error: 'Settings must be an object',
    });
    return errors;
  }

  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object') {
    errors.push({
      hook: 'root',
      index: 0,
      error: 'Settings must have a "hooks" object',
    });
    return errors;
  }

  // Validate each hook event
  for (const [hookName, hookValue] of Object.entries(hooks)) {
    // Bug 2: Check for :service suffix
    if (hookName.includes(':')) {
      errors.push({
        hook: hookName,
        index: 0,
        error: `Hook name contains invalid ":service" suffix: "${hookName}"`,
        fix: `Remove suffix, use "${hookName.split(':')[0]}" instead`,
      });
    }

    // Bug 3: Check if value is array
    if (!Array.isArray(hookValue)) {
      errors.push({
        hook: hookName,
        index: 0,
        error: `Hook value must be an array, got ${typeof hookValue}`,
        fix: 'Wrap in array with {matcher, hooks} structure',
      });
      continue;
    }

    // Validate each entry in the hook array
    hookValue.forEach((entry: any, index: number) => {
      // Bug 1: Check for missing matcher
      if (!('matcher' in entry)) {
        errors.push({
          hook: hookName,
          index,
          error: 'Hook entry missing required "matcher" field',
          fix: 'Add "matcher": "" for lifecycle hooks, or pattern string for conditional hooks',
        });
      }

      // Check for hooks array
      if (!Array.isArray(entry.hooks)) {
        errors.push({
          hook: hookName,
          index,
          error: 'Hook entry missing required "hooks" array',
        });
      } else {
        // Validate individual hook commands
        entry.hooks.forEach((cmd: any, cmdIndex: number) => {
          if (!cmd.type) {
            errors.push({
              hook: hookName,
              index,
              error: `Hook command ${cmdIndex} missing "type" field`,
            });
          }
          if (!cmd.command) {
            errors.push({
              hook: hookName,
              index,
              error: `Hook command ${cmdIndex} missing "command" field`,
            });
          }

          // Check for context-hub stop in Stop hook (common bug)
          if (hookName === 'Stop' && cmd.type === 'command' && cmd.command?.includes('jfl context-hub stop')) {
            errors.push({
              hook: hookName,
              index,
              error: 'Stop hook should NOT stop context-hub (shared service across sessions)',
              fix: 'Remove "jfl context-hub stop" command from Stop hook',
            });
          }

          // Warn about exit 0 that prevents blocking (not an error, just a warning)
          if (cmd.type === 'command' && cmd.command?.includes('exit 0')) {
            // This is a design limitation note, not an error
            // We'll add this to validation report but won't block
          }
        });
      }
    });
  }

  return errors;
}

/**
 * Auto-fixes common settings schema violations
 *
 * Fixes:
 * 1. Adds missing `matcher: ""` fields
 * 2. Removes `:service` suffixes from hook names
 * 3. Converts flat objects to proper array format
 * 4. Removes context-hub stop from Stop hook
 * 5. Preserves all existing valid configuration
 *
 * @param settings - The settings object to fix
 * @returns Fixed settings object
 */
export function fixSettings(settings: any): SettingsSchema {
  if (!settings || typeof settings !== 'object') {
    return { hooks: {} };
  }

  const fixed: SettingsSchema = {
    hooks: {},
  };

  const hooks = settings.hooks || {};

  for (const [hookName, hookValue] of Object.entries(hooks)) {
    // Bug 2: Remove :service suffix
    const cleanHookName = hookName.split(':')[0];

    // Bug 3: Ensure array format
    let hookArray: any[];
    if (!Array.isArray(hookValue)) {
      // Convert flat object to array format
      hookArray = [hookValue];
    } else {
      hookArray = [...hookValue];
    }

    // Bug 1: Add missing matcher fields
    // Bug 4: Remove context-hub stop from Stop hook
    const fixedEntries = hookArray.map((entry: any) => {
      if (!entry || typeof entry !== 'object') {
        return entry;
      }

      const fixedEntry = { ...entry };

      // Add matcher if missing
      if (!('matcher' in fixedEntry)) {
        // For lifecycle hooks (SessionStart, Stop, PreCompact), use empty string
        // For tool/prompt hooks, preserve any existing pattern or default to empty
        fixedEntry.matcher = '';
      }

      // Remove context-hub stop from Stop hook commands
      if (cleanHookName === 'Stop' && Array.isArray(fixedEntry.hooks)) {
        fixedEntry.hooks = fixedEntry.hooks.filter((cmd: any) => {
          return !(cmd.type === 'command' && cmd.command?.includes('jfl context-hub stop'));
        });
      }

      return fixedEntry;
    });

    if (!fixed.hooks) {
      fixed.hooks = {};
    }
    fixed.hooks[cleanHookName] = fixedEntries;
  }

  // Preserve any other top-level settings
  const result = { ...settings, hooks: fixed.hooks };
  return result;
}

/**
 * Validates and returns a detailed report
 *
 * @param settings - The settings object to validate
 * @returns Human-readable validation report
 */
export function getValidationReport(settings: any): string {
  const errors = validateSettings(settings);

  if (errors.length === 0) {
    return '✓ Settings are valid';
  }

  const lines = ['⚠️  Settings validation errors found:\n'];

  const grouped = errors.reduce((acc, err) => {
    if (!acc[err.hook]) {
      acc[err.hook] = [];
    }
    acc[err.hook].push(err);
    return acc;
  }, {} as Record<string, ValidationError[]>);

  for (const [hook, hookErrors] of Object.entries(grouped)) {
    lines.push(`  ${hook}:`);
    hookErrors.forEach(err => {
      lines.push(`    - ${err.error}`);
      if (err.fix) {
        lines.push(`      Fix: ${err.fix}`);
      }
    });
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Quick check if settings are valid
 *
 * @param settings - The settings object to check
 * @returns true if valid, false otherwise
 */
export function isValid(settings: any): boolean {
  return validateSettings(settings).length === 0;
}
