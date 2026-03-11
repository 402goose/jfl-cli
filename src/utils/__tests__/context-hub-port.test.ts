/**
 * Tests for Context Hub Port Resolution
 *
 * @purpose Test pure port hash computation function
 */

import { computePortFromPath } from '../context-hub-port'

describe('computePortFromPath', () => {
  it('returns a port in the valid range 4200-4999', () => {
    const paths = [
      '/Users/test/project1',
      '/home/user/myproject',
      '/var/www/app',
      '/tmp/test',
      'C:\\Users\\test\\project',
    ]

    for (const path of paths) {
      const port = computePortFromPath(path)
      expect(port).toBeGreaterThanOrEqual(4200)
      expect(port).toBeLessThanOrEqual(4999)
    }
  })

  it('returns deterministic results for the same path', () => {
    const testPath = '/Users/alectaggart/CascadeProjects/jfl-cli'
    const port1 = computePortFromPath(testPath)
    const port2 = computePortFromPath(testPath)
    const port3 = computePortFromPath(testPath)

    expect(port1).toBe(port2)
    expect(port2).toBe(port3)
  })

  it('returns different ports for different paths', () => {
    const port1 = computePortFromPath('/Users/test/project-a')
    const port2 = computePortFromPath('/Users/test/project-b')
    const port3 = computePortFromPath('/Users/test/completely-different')

    // While not guaranteed by hash function, different inputs should typically yield different outputs
    // We can't assert they're all different, but at least some should differ
    const uniquePorts = new Set([port1, port2, port3])
    expect(uniquePorts.size).toBeGreaterThanOrEqual(2)
  })

  it('handles empty string path', () => {
    const port = computePortFromPath('')
    expect(port).toBeGreaterThanOrEqual(4200)
    expect(port).toBeLessThanOrEqual(4999)
  })

  it('handles paths with special characters', () => {
    const paths = [
      '/path/with spaces/project',
      '/path/with-dashes/project',
      '/path/with_underscores/project',
      '/path/with.dots/project',
      '/path/with@symbols/project',
    ]

    for (const path of paths) {
      const port = computePortFromPath(path)
      expect(port).toBeGreaterThanOrEqual(4200)
      expect(port).toBeLessThanOrEqual(4999)
    }
  })

  it('handles very long paths', () => {
    const longPath = '/a'.repeat(1000)
    const port = computePortFromPath(longPath)
    expect(port).toBeGreaterThanOrEqual(4200)
    expect(port).toBeLessThanOrEqual(4999)
  })

  it('treats equivalent paths identically after resolution', () => {
    // computePortFromPath uses path.resolve internally
    // These should resolve to the same absolute path on the test system
    const port1 = computePortFromPath('/tmp/test/../test/project')
    const port2 = computePortFromPath('/tmp/test/project')

    expect(port1).toBe(port2)
  })
})
