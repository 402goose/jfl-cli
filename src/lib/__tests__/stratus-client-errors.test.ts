/**
 * Error Handling Tests for Stratus Client
 *
 * Tests API failures, timeouts, malformed responses, and network errors
 *
 * @purpose Test error paths in stratus-client.ts
 */

describe('StratusClient error handling', () => {
  let originalFetch: typeof global.fetch
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    jest.resetModules()
    originalFetch = global.fetch
    originalEnv = { ...process.env }
  })

  afterEach(() => {
    global.fetch = originalFetch
    process.env = originalEnv
    jest.clearAllMocks()
  })

  describe('reason() network errors', () => {
    it('throws on timeout with descriptive message', async () => {
      const { StratusClient } = await import('../stratus-client.js')
      const client = new StratusClient({ timeout: 100 })

      // Simulate a slow response that triggers abort
      global.fetch = jest.fn().mockImplementation(() => {
        return new Promise((_, reject) => {
          const abortError = new Error('The operation was aborted')
          abortError.name = 'AbortError'
          setTimeout(() => reject(abortError), 50)
        })
      })

      await expect(client.reason('test prompt')).rejects.toThrow(
        'Stratus request timed out after 100ms'
      )
    })

    it('throws on connection refused', async () => {
      const { StratusClient } = await import('../stratus-client.js')
      const client = new StratusClient({
        baseUrl: 'http://localhost:59999',
        apiKey: 'test-key',
      })

      global.fetch = jest.fn().mockRejectedValue(
        Object.assign(new Error('fetch failed'), {
          cause: { code: 'ECONNREFUSED' },
        })
      )

      await expect(client.reason('test prompt')).rejects.toThrow('fetch failed')
    })

    it('throws on DNS resolution failure', async () => {
      const { StratusClient } = await import('../stratus-client.js')
      const client = new StratusClient({
        baseUrl: 'https://nonexistent.invalid.domain',
        apiKey: 'test-key',
      })

      global.fetch = jest.fn().mockRejectedValue(
        Object.assign(new Error('getaddrinfo ENOTFOUND nonexistent.invalid.domain'), {
          cause: { code: 'ENOTFOUND' },
        })
      )

      await expect(client.reason('test prompt')).rejects.toThrow(
        'getaddrinfo ENOTFOUND'
      )
    })

    it('throws on network unreachable', async () => {
      const { StratusClient } = await import('../stratus-client.js')
      const client = new StratusClient({ apiKey: 'test-key' })

      global.fetch = jest.fn().mockRejectedValue(
        Object.assign(new Error('Network is unreachable'), {
          cause: { code: 'ENETUNREACH' },
        })
      )

      await expect(client.reason('test prompt')).rejects.toThrow(
        'Network is unreachable'
      )
    })
  })

  describe('reason() API errors', () => {
    it('throws on HTTP 400 Bad Request with error body', async () => {
      const { StratusClient } = await import('../stratus-client.js')
      const client = new StratusClient({ apiKey: 'test-key' })

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Invalid request: prompt too long'),
      })

      await expect(client.reason('test prompt')).rejects.toThrow(
        'Stratus API error (400): Invalid request: prompt too long'
      )
    })

    it('throws on HTTP 401 Unauthorized', async () => {
      const { StratusClient } = await import('../stratus-client.js')
      const client = new StratusClient({ apiKey: 'invalid-key' })

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Invalid API key'),
      })

      await expect(client.reason('test prompt')).rejects.toThrow(
        'Stratus API error (401): Invalid API key'
      )
    })

    it('throws on HTTP 403 Forbidden', async () => {
      const { StratusClient } = await import('../stratus-client.js')
      const client = new StratusClient({ apiKey: 'test-key' })

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Access denied'),
      })

      await expect(client.reason('test prompt')).rejects.toThrow(
        'Stratus API error (403): Access denied'
      )
    })

    it('throws on HTTP 429 Rate Limited', async () => {
      const { StratusClient } = await import('../stratus-client.js')
      const client = new StratusClient({ apiKey: 'test-key' })

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limit exceeded'),
      })

      await expect(client.reason('test prompt')).rejects.toThrow(
        'Stratus API error (429): Rate limit exceeded'
      )
    })

    it('throws on HTTP 500 Internal Server Error', async () => {
      const { StratusClient } = await import('../stratus-client.js')
      const client = new StratusClient({ apiKey: 'test-key' })

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal server error'),
      })

      await expect(client.reason('test prompt')).rejects.toThrow(
        'Stratus API error (500): Internal server error'
      )
    })

    it('throws on HTTP 502 Bad Gateway', async () => {
      const { StratusClient } = await import('../stratus-client.js')
      const client = new StratusClient({ apiKey: 'test-key' })

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: () => Promise.resolve('Bad Gateway'),
      })

      await expect(client.reason('test prompt')).rejects.toThrow(
        'Stratus API error (502): Bad Gateway'
      )
    })

    it('throws on HTTP 503 Service Unavailable', async () => {
      const { StratusClient } = await import('../stratus-client.js')
      const client = new StratusClient({ apiKey: 'test-key' })

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.resolve('Service temporarily unavailable'),
      })

      await expect(client.reason('test prompt')).rejects.toThrow(
        'Stratus API error (503): Service temporarily unavailable'
      )
    })
  })

  describe('reason() malformed responses', () => {
    it('handles empty response body', async () => {
      const { StratusClient } = await import('../stratus-client.js')
      const client = new StratusClient({ apiKey: 'test-key' })

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      })

      const result = await client.reason('test prompt')
      expect(result).toEqual({})
    })

    it('handles response with missing choices array', async () => {
      const { StratusClient } = await import('../stratus-client.js')
      const client = new StratusClient({ apiKey: 'test-key' })

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          id: 'test-id',
          model: 'test-model',
        }),
      })

      const result = await client.reason('test prompt')
      expect(result.choices).toBeUndefined()
    })

    it('handles invalid JSON response', async () => {
      const { StratusClient } = await import('../stratus-client.js')
      const client = new StratusClient({ apiKey: 'test-key' })

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      })

      await expect(client.reason('test prompt')).rejects.toThrow(
        'Unexpected token'
      )
    })

    it('handles response that text() fails', async () => {
      const { StratusClient } = await import('../stratus-client.js')
      const client = new StratusClient({ apiKey: 'test-key' })

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.reject(new Error('Stream closed unexpectedly')),
      })

      await expect(client.reason('test prompt')).rejects.toThrow(
        'Stream closed unexpectedly'
      )
    })
  })

  describe('synthesizeJournalEntries() error paths', () => {
    it('handles empty entries array gracefully', async () => {
      const { StratusClient } = await import('../stratus-client.js')
      const client = new StratusClient({ apiKey: 'test-key' })

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          id: 'test',
          choices: [{
            message: { content: '## Summary\nNo entries provided' },
          }],
        }),
      })

      const result = await client.synthesizeJournalEntries([])
      expect(result.summary).toBe('No entries provided')
    })

    it('handles API error during synthesis', async () => {
      const { StratusClient } = await import('../stratus-client.js')
      const client = new StratusClient({ apiKey: 'test-key' })

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Synthesis failed'),
      })

      await expect(
        client.synthesizeJournalEntries([{ title: 'test', ts: '2024-01-01' }])
      ).rejects.toThrow('Stratus API error (500): Synthesis failed')
    })
  })

  describe('parseStructuredSummary edge cases', () => {
    it('handles content with no recognizable sections', async () => {
      const { StratusClient } = await import('../stratus-client.js')
      const client = new StratusClient({ apiKey: 'test-key' })

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'Random unstructured content' } }],
        }),
      })

      const result = await client.synthesizeJournalEntries([{ title: 'test' }])
      expect(result.summary).toBe('')
      expect(result.decisions).toEqual([])
      expect(result.problemsSolved).toEqual([])
    })

    it('handles malformed decision format', async () => {
      const { StratusClient } = await import('../stratus-client.js')
      const client = new StratusClient({ apiKey: 'test-key' })

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: `## Key Decisions Made
- Decision without colon separator
- Another plain text item`,
            },
          }],
        }),
      })

      const result = await client.synthesizeJournalEntries([{ title: 'test' }])
      expect(result.decisions.length).toBe(2)
      expect(result.decisions[0].rationale).toBe('')
    })

    it('handles empty choices array', async () => {
      const { StratusClient } = await import('../stratus-client.js')
      const client = new StratusClient({ apiKey: 'test-key' })

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          choices: [],
        }),
      })

      const result = await client.synthesizeJournalEntries([{ title: 'test' }])
      expect(result.summary).toBe('')
    })

    it('handles null message content', async () => {
      const { StratusClient } = await import('../stratus-client.js')
      const client = new StratusClient({ apiKey: 'test-key' })

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          choices: [{ message: { content: null } }],
        }),
      })

      const result = await client.synthesizeJournalEntries([{ title: 'test' }])
      expect(result.summary).toBe('')
    })
  })

  describe('constructor configuration', () => {
    it('uses provided options over environment variables', async () => {
      const { StratusClient } = await import('../stratus-client.js')
      const client = new StratusClient({
        baseUrl: 'https://custom.stratus.api',
        apiKey: 'custom-key',
      })

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [] }),
      })

      await client.reason('test')

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://custom.stratus.api'),
        expect.any(Object)
      )
    })

    it('falls back to default URL when env vars not set', async () => {
      delete process.env.STRATUS_API_URL
      delete process.env.STRATUS_API_KEY

      jest.resetModules()
      const { StratusClient } = await import('../stratus-client.js')
      const client = new StratusClient()

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [] }),
      })

      await client.reason('test')

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://api.stratus.run'),
        expect.any(Object)
      )
    })
  })
})
