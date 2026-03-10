import * as path from 'path'

describe('hub-client', () => {
  describe('getHubConfig', () => {
    let origExistsSync: typeof import('fs').existsSync
    let origReadFileSync: typeof import('fs').readFileSync

    beforeEach(() => {
      jest.resetModules()
    })

    it('returns null when no port file exists', async () => {
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        existsSync: () => false,
        readFileSync: () => '',
      }))
      const { getHubConfig } = await import('../hub-client.js')
      const config = getHubConfig('/tmp/nonexistent')
      expect(config).toBeNull()
    })

    it('returns null when port file contains invalid data', async () => {
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        existsSync: (p: string) => {
          const s = String(p)
          return s.includes('config.json') || s.includes('context-hub.port')
        },
        readFileSync: () => 'not-a-number',
      }))
      const { getHubConfig } = await import('../hub-client.js')
      const config = getHubConfig('/tmp/test')
      expect(config).toBeNull()
    })

    it('returns config with correct port and baseUrl', async () => {
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        existsSync: (p: string) => {
          const s = String(p)
          return s.includes('config.json') ||
                 s.includes('context-hub.port') ||
                 s.includes('context-hub.token') ||
                 s.endsWith('.jfl')
        },
        readFileSync: (p: string) => {
          const s = String(p)
          if (s.includes('context-hub.port')) return '4358\n'
          if (s.includes('context-hub.token')) return 'test-token\n'
          return ''
        },
      }))
      const { getHubConfig } = await import('../hub-client.js')
      const config = getHubConfig('/tmp/test')
      expect(config).not.toBeNull()
      expect(config!.port).toBe(4358)
      expect(config!.token).toBe('test-token')
      expect(config!.baseUrl).toBe('http://localhost:4358')
    })

    it('returns empty token when token file missing', async () => {
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        existsSync: (p: string) => {
          const s = String(p)
          if (s.includes('context-hub.token')) return false
          return s.includes('config.json') || s.includes('context-hub.port') || s.endsWith('.jfl')
        },
        readFileSync: (p: string) => {
          if (String(p).includes('context-hub.port')) return '9999\n'
          return ''
        },
      }))
      const { getHubConfig } = await import('../hub-client.js')
      const config = getHubConfig('/tmp/test')
      expect(config).not.toBeNull()
      expect(config!.port).toBe(9999)
      expect(config!.token).toBe('')
    })
  })
})
