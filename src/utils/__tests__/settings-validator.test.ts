/**
 * Tests for Claude Code Settings Validator
 *
 * @purpose Test settings validation and auto-fix logic
 */

import {
  validateSettings,
  fixSettings,
  isValid,
  getValidationReport,
} from '../settings-validator';

describe('validateSettings', () => {
  it('should accept valid settings with empty matcher', () => {
    const validSettings = {
      hooks: {
        SessionStart: [
          {
            matcher: '',
            hooks: [
              {
                type: 'command',
                command: './scripts/session-init.sh',
              },
            ],
          },
        ],
      },
    };

    const errors = validateSettings(validSettings);
    expect(errors).toHaveLength(0);
  });

  it('should detect missing matcher field', () => {
    const invalidSettings = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: 'command',
                command: './scripts/session-init.sh',
              },
            ],
          },
        ],
      },
    };

    const errors = validateSettings(invalidSettings);
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toContain('missing required "matcher" field');
  });

  it('should detect :service suffix on hook names', () => {
    const invalidSettings = {
      hooks: {
        'SessionStart:service': [
          {
            matcher: '',
            hooks: [
              {
                type: 'command',
                command: './scripts/session-init.sh',
              },
            ],
          },
        ],
      },
    };

    const errors = validateSettings(invalidSettings);
    expect(errors.length).toBeGreaterThan(0);
    const suffixError = errors.find(e => e.error.includes('invalid ":service" suffix'));
    expect(suffixError).toBeDefined();
  });

  it('should detect flat object format instead of array', () => {
    const invalidSettings = {
      hooks: {
        SessionStart: {
          matcher: '',
          hooks: [
            {
              type: 'command',
              command: './scripts/session-init.sh',
            },
          ],
        },
      },
    };

    const errors = validateSettings(invalidSettings);
    expect(errors.length).toBeGreaterThan(0);
    const arrayError = errors.find(e => e.error.includes('must be an array'));
    expect(arrayError).toBeDefined();
  });

  it('should detect missing type field in hook command', () => {
    const invalidSettings = {
      hooks: {
        SessionStart: [
          {
            matcher: '',
            hooks: [
              {
                command: './scripts/session-init.sh',
              },
            ],
          },
        ],
      },
    };

    const errors = validateSettings(invalidSettings);
    expect(errors.length).toBeGreaterThan(0);
    const typeError = errors.find(e => e.error.includes('missing "type" field'));
    expect(typeError).toBeDefined();
  });

  it('should detect missing command field in hook command', () => {
    const invalidSettings = {
      hooks: {
        SessionStart: [
          {
            matcher: '',
            hooks: [
              {
                type: 'command',
              },
            ],
          },
        ],
      },
    };

    const errors = validateSettings(invalidSettings);
    expect(errors.length).toBeGreaterThan(0);
    const cmdError = errors.find(e => e.error.includes('missing "command" field'));
    expect(cmdError).toBeDefined();
  });

  it('should handle missing hooks object', () => {
    const invalidSettings = {};

    const errors = validateSettings(invalidSettings);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].error).toContain('must have a "hooks" object');
  });

  it('should handle null settings', () => {
    const errors = validateSettings(null);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].error).toContain('must be an object');
  });
});

describe('fixSettings', () => {
  it('should add missing matcher field', () => {
    const brokenSettings = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: 'command',
                command: './scripts/session-init.sh',
              },
            ],
          },
        ],
      },
    };

    const fixed = fixSettings(brokenSettings);
    expect(fixed.hooks?.SessionStart[0]).toHaveProperty('matcher');
    expect(fixed.hooks?.SessionStart[0].matcher).toBe('');
  });

  it('should remove :service suffix from hook names', () => {
    const brokenSettings = {
      hooks: {
        'SessionStart:service': [
          {
            matcher: '',
            hooks: [
              {
                type: 'command',
                command: './scripts/session-init.sh',
              },
            ],
          },
        ],
      },
    };

    const fixed = fixSettings(brokenSettings);
    expect(fixed.hooks).toHaveProperty('SessionStart');
    expect(fixed.hooks).not.toHaveProperty('SessionStart:service');
  });

  it('should convert flat object to array format', () => {
    const brokenSettings = {
      hooks: {
        SessionStart: {
          matcher: '',
          hooks: [
            {
              type: 'command',
              command: './scripts/session-init.sh',
            },
          ],
        },
      },
    };

    const fixed = fixSettings(brokenSettings);
    expect(Array.isArray(fixed.hooks?.SessionStart)).toBe(true);
    expect(fixed.hooks?.SessionStart).toHaveLength(1);
  });

  it('should preserve existing valid hooks', () => {
    const validSettings = {
      hooks: {
        SessionStart: [
          {
            matcher: '',
            hooks: [
              {
                type: 'command',
                command: './scripts/session-init.sh',
              },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              {
                type: 'command',
                command: 'echo "test"',
              },
            ],
          },
        ],
      },
    };

    const fixed = fixSettings(validSettings);
    expect(fixed.hooks?.SessionStart).toEqual(validSettings.hooks.SessionStart);
    expect(fixed.hooks?.PostToolUse).toEqual(validSettings.hooks.PostToolUse);
  });

  it('should handle multiple bugs at once', () => {
    const brokenSettings = {
      hooks: {
        'SessionStart:service': [
          {
            // Missing matcher
            hooks: [
              {
                type: 'command',
                command: './scripts/session-init.sh',
              },
            ],
          },
        ],
      },
    };

    const fixed = fixSettings(brokenSettings);
    expect(fixed.hooks).toHaveProperty('SessionStart');
    expect(fixed.hooks).not.toHaveProperty('SessionStart:service');
    expect(fixed.hooks?.SessionStart[0]).toHaveProperty('matcher');
    expect(fixed.hooks?.SessionStart[0].matcher).toBe('');
  });

  it('should handle empty settings', () => {
    const fixed = fixSettings({});
    expect(fixed).toHaveProperty('hooks');
    expect(fixed.hooks).toEqual({});
  });

  it('should handle null settings', () => {
    const fixed = fixSettings(null);
    expect(fixed).toHaveProperty('hooks');
    expect(fixed.hooks).toEqual({});
  });
});

describe('isValid', () => {
  it('should return true for valid settings', () => {
    const validSettings = {
      hooks: {
        SessionStart: [
          {
            matcher: '',
            hooks: [
              {
                type: 'command',
                command: './scripts/session-init.sh',
              },
            ],
          },
        ],
      },
    };

    expect(isValid(validSettings)).toBe(true);
  });

  it('should return false for invalid settings', () => {
    const invalidSettings = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: 'command',
                command: './scripts/session-init.sh',
              },
            ],
          },
        ],
      },
    };

    expect(isValid(invalidSettings)).toBe(false);
  });
});

describe('getValidationReport', () => {
  it('should return success message for valid settings', () => {
    const validSettings = {
      hooks: {
        SessionStart: [
          {
            matcher: '',
            hooks: [
              {
                type: 'command',
                command: './scripts/session-init.sh',
              },
            ],
          },
        ],
      },
    };

    const report = getValidationReport(validSettings);
    expect(report).toContain('✓ Settings are valid');
  });

  it('should return detailed errors for invalid settings', () => {
    const invalidSettings = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: 'command',
                command: './scripts/session-init.sh',
              },
            ],
          },
        ],
      },
    };

    const report = getValidationReport(invalidSettings);
    expect(report).toContain('⚠️');
    expect(report).toContain('SessionStart');
    expect(report).toContain('missing required "matcher" field');
  });

  it('should group errors by hook', () => {
    const invalidSettings = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: 'command',
                command: './scripts/session-init.sh',
              },
            ],
          },
        ],
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command: './scripts/session-cleanup.sh',
              },
            ],
          },
        ],
      },
    };

    const report = getValidationReport(invalidSettings);
    expect(report).toContain('SessionStart');
    expect(report).toContain('Stop');
  });
});
