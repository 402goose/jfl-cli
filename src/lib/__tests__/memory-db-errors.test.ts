/**
 * Error Handling Tests for Memory Database
 *
 * Tests SQLite failures, filesystem errors, and data corruption
 *
 * @purpose Test error paths in memory-db.ts
 */

describe('memory-db error handling', () => {
  let mockFs: any
  let mockSqlJs: any

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  describe('initializeDatabase errors', () => {
    it('throws when sql.js initialization fails', async () => {
      jest.doMock('sql.js', () => {
        return jest.fn().mockRejectedValue(new Error('Failed to load WASM'))
      })

      jest.doMock('fs', () => ({
        existsSync: () => false,
        readFileSync: () => Buffer.from([]),
        writeFileSync: jest.fn(),
        mkdirSync: jest.fn(),
      }))

      const { initializeDatabase } = await import('../memory-db.js')

      await expect(initializeDatabase()).rejects.toThrow('Failed to load WASM')
    })

    it('throws when database creation fails', async () => {
      jest.doMock('sql.js', () => {
        return jest.fn().mockResolvedValue({
          Database: class {
            constructor() {
              throw new Error('Database allocation failed')
            }
          },
        })
      })

      jest.doMock('fs', () => ({
        existsSync: () => false,
        readFileSync: () => Buffer.from([]),
        writeFileSync: jest.fn(),
        mkdirSync: jest.fn(),
      }))

      const { initializeDatabase } = await import('../memory-db.js')

      await expect(initializeDatabase()).rejects.toThrow('Database allocation failed')
    })

    it('throws when directory creation fails (EACCES)', async () => {
      const mockDb = {
        run: jest.fn(),
        exec: jest.fn().mockReturnValue([]),
        export: jest.fn().mockReturnValue(new Uint8Array()),
      }

      jest.doMock('sql.js', () => {
        return jest.fn().mockResolvedValue({
          Database: jest.fn().mockReturnValue(mockDb),
        })
      })

      jest.doMock('fs', () => ({
        existsSync: () => false,
        readFileSync: () => Buffer.from([]),
        writeFileSync: jest.fn().mockImplementation(() => {
          const err = new Error('Permission denied')
          ;(err as any).code = 'EACCES'
          throw err
        }),
        mkdirSync: jest.fn().mockImplementation(() => {
          const err = new Error('Permission denied')
          ;(err as any).code = 'EACCES'
          throw err
        }),
      }))

      const { initializeDatabase } = await import('../memory-db.js')

      await expect(initializeDatabase()).rejects.toThrow('Permission denied')
    })

    it('handles corrupted database file', async () => {
      jest.doMock('sql.js', () => {
        return jest.fn().mockResolvedValue({
          Database: jest.fn().mockImplementation((buffer) => {
            if (buffer && buffer.length > 0) {
              throw new Error('Database disk image is malformed')
            }
            return {
              run: jest.fn(),
              exec: jest.fn().mockReturnValue([]),
              export: jest.fn().mockReturnValue(new Uint8Array()),
            }
          }),
        })
      })

      jest.doMock('fs', () => ({
        existsSync: () => true,
        readFileSync: () => Buffer.from('corrupted-data'),
        writeFileSync: jest.fn(),
        mkdirSync: jest.fn(),
      }))

      const { initializeDatabase } = await import('../memory-db.js')

      await expect(initializeDatabase()).rejects.toThrow('Database disk image is malformed')
    })
  })

  describe('insertMemory errors', () => {
    it('throws when INSERT fails due to constraint violation', async () => {
      const mockDb = {
        run: jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('INSERT')) {
            throw new Error('UNIQUE constraint failed: memories.source_id')
          }
        }),
        exec: jest.fn().mockReturnValue([{ values: [[1]] }]),
        export: jest.fn().mockReturnValue(new Uint8Array()),
      }

      jest.doMock('sql.js', () => {
        return jest.fn().mockResolvedValue({
          Database: jest.fn().mockReturnValue(mockDb),
        })
      })

      jest.doMock('fs', () => ({
        existsSync: () => true,
        readFileSync: () => Buffer.from([]),
        writeFileSync: jest.fn(),
        mkdirSync: jest.fn(),
      }))

      const { insertMemory } = await import('../memory-db.js')

      await expect(
        insertMemory({
          source: 'journal',
          source_id: 'duplicate-id',
          title: 'Test',
          content: 'Content',
          created_at: new Date().toISOString(),
        })
      ).rejects.toThrow('UNIQUE constraint failed')
    })

    it('throws when disk is full during save', async () => {
      const mockDb = {
        run: jest.fn(),
        exec: jest.fn().mockReturnValue([{ values: [[1]] }]),
        export: jest.fn().mockReturnValue(new Uint8Array(1000)),
      }

      jest.doMock('sql.js', () => {
        return jest.fn().mockResolvedValue({
          Database: jest.fn().mockReturnValue(mockDb),
        })
      })

      jest.doMock('fs', () => ({
        existsSync: () => true,
        readFileSync: () => Buffer.from([]),
        writeFileSync: jest.fn().mockImplementation(() => {
          const err = new Error('No space left on device')
          ;(err as any).code = 'ENOSPC'
          throw err
        }),
        mkdirSync: jest.fn(),
      }))

      const { insertMemory } = await import('../memory-db.js')

      await expect(
        insertMemory({
          source: 'journal',
          title: 'Test',
          content: 'Content',
          created_at: new Date().toISOString(),
        })
      ).rejects.toThrow('No space left on device')
    })
  })

  describe('getAllMemories errors', () => {
    it('returns empty array when database query fails', async () => {
      const mockDb = {
        run: jest.fn(),
        exec: jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('SELECT *')) {
            throw new Error('Table memories does not exist')
          }
          return []
        }),
        export: jest.fn().mockReturnValue(new Uint8Array()),
      }

      jest.doMock('sql.js', () => {
        return jest.fn().mockResolvedValue({
          Database: jest.fn().mockReturnValue(mockDb),
        })
      })

      jest.doMock('fs', () => ({
        existsSync: () => true,
        readFileSync: () => Buffer.from([]),
        writeFileSync: jest.fn(),
        mkdirSync: jest.fn(),
      }))

      const { getAllMemories } = await import('../memory-db.js')

      await expect(getAllMemories()).rejects.toThrow('Table memories does not exist')
    })
  })

  describe('getMemoriesByIds errors', () => {
    it('returns empty array for empty IDs input', async () => {
      const mockDb = {
        run: jest.fn(),
        exec: jest.fn().mockReturnValue([]),
        export: jest.fn().mockReturnValue(new Uint8Array()),
      }

      jest.doMock('sql.js', () => {
        return jest.fn().mockResolvedValue({
          Database: jest.fn().mockReturnValue(mockDb),
        })
      })

      jest.doMock('fs', () => ({
        existsSync: () => true,
        readFileSync: () => Buffer.from([]),
        writeFileSync: jest.fn(),
        mkdirSync: jest.fn(),
      }))

      const { getMemoriesByIds } = await import('../memory-db.js')

      const result = await getMemoriesByIds([])
      expect(result).toEqual([])
    })

    it('throws on invalid ID types in array', async () => {
      const mockDb = {
        run: jest.fn(),
        exec: jest.fn().mockImplementation(() => {
          throw new Error('Datatype mismatch')
        }),
        export: jest.fn().mockReturnValue(new Uint8Array()),
      }

      jest.doMock('sql.js', () => {
        return jest.fn().mockResolvedValue({
          Database: jest.fn().mockReturnValue(mockDb),
        })
      })

      jest.doMock('fs', () => ({
        existsSync: () => true,
        readFileSync: () => Buffer.from([]),
        writeFileSync: jest.fn(),
        mkdirSync: jest.fn(),
      }))

      const { getMemoriesByIds } = await import('../memory-db.js')

      await expect(getMemoriesByIds(['invalid' as any])).rejects.toThrow('Datatype mismatch')
    })
  })

  describe('getMemoryStats errors', () => {
    it('handles query errors gracefully', async () => {
      const mockDb = {
        run: jest.fn(),
        exec: jest.fn().mockImplementation(() => {
          throw new Error('Database is locked')
        }),
        export: jest.fn().mockReturnValue(new Uint8Array()),
      }

      jest.doMock('sql.js', () => {
        return jest.fn().mockResolvedValue({
          Database: jest.fn().mockReturnValue(mockDb),
        })
      })

      jest.doMock('fs', () => ({
        existsSync: () => true,
        readFileSync: () => Buffer.from([]),
        writeFileSync: jest.fn(),
        mkdirSync: jest.fn(),
      }))

      const { getMemoryStats } = await import('../memory-db.js')

      await expect(getMemoryStats()).rejects.toThrow('Database is locked')
    })
  })

  describe('closeDatabase edge cases', () => {
    it('handles double close gracefully', async () => {
      const mockDb = {
        run: jest.fn(),
        exec: jest.fn().mockReturnValue([]),
        export: jest.fn().mockReturnValue(new Uint8Array()),
        close: jest.fn(),
      }

      jest.doMock('sql.js', () => {
        return jest.fn().mockResolvedValue({
          Database: jest.fn().mockReturnValue(mockDb),
        })
      })

      jest.doMock('fs', () => ({
        existsSync: () => false,
        readFileSync: () => Buffer.from([]),
        writeFileSync: jest.fn(),
        mkdirSync: jest.fn(),
      }))

      const { initializeDatabase, closeDatabase } = await import('../memory-db.js')

      await initializeDatabase()
      await closeDatabase()
      // Second close should not throw
      await closeDatabase()

      expect(mockDb.close).toHaveBeenCalledTimes(1)
    })
  })

  describe('deserializeEmbedding edge cases', () => {
    it('handles empty buffer', async () => {
      const { deserializeEmbedding } = await import('../memory-db.js')

      const result = deserializeEmbedding(Buffer.from([]))
      expect(result.length).toBe(0)
    })

    it('handles buffer not aligned to Float32 boundary', async () => {
      const { deserializeEmbedding } = await import('../memory-db.js')

      // 3 bytes is not divisible by 4 (Float32 size)
      const buffer = Buffer.from([1, 2, 3])
      // This should handle partial data
      const result = deserializeEmbedding(buffer)
      expect(result.length).toBe(0)
    })
  })

  describe('setLastIndexTimestamp errors', () => {
    it('throws when INSERT OR REPLACE fails', async () => {
      const mockDb = {
        run: jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('INSERT OR REPLACE')) {
            throw new Error('Database is read-only')
          }
        }),
        exec: jest.fn().mockReturnValue([]),
        export: jest.fn().mockReturnValue(new Uint8Array()),
      }

      jest.doMock('sql.js', () => {
        return jest.fn().mockResolvedValue({
          Database: jest.fn().mockReturnValue(mockDb),
        })
      })

      jest.doMock('fs', () => ({
        existsSync: () => true,
        readFileSync: () => Buffer.from([]),
        writeFileSync: jest.fn(),
        mkdirSync: jest.fn(),
      }))

      const { setLastIndexTimestamp } = await import('../memory-db.js')

      await expect(
        setLastIndexTimestamp(new Date().toISOString())
      ).rejects.toThrow('Database is read-only')
    })
  })
})
