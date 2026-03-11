/**
 * Tests for Git Utilities
 *
 * @purpose Test pure URL parsing function for GitHub URLs
 */

jest.mock('chalk', () => {
  const passthrough = (s: string) => s
  const chalk: any = new Proxy(passthrough, {
    get: () => chalk,
    apply: (_t: any, _this: any, args: any[]) => args[0],
  })
  chalk.bold = passthrough
  chalk.gray = passthrough
  chalk.dim = passthrough
  chalk.green = passthrough
  chalk.red = passthrough
  chalk.yellow = passthrough
  chalk.cyan = passthrough
  chalk.blue = passthrough
  return { default: chalk, __esModule: true }
})

jest.mock('ora', () => {
  const spinner = () => ({
    start: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
    warn: jest.fn().mockReturnThis(),
    info: jest.fn().mockReturnThis(),
    text: '',
  })
  return { default: spinner, __esModule: true }
})

import { parseGitHubUrl } from '../git'

describe('parseGitHubUrl', () => {
  describe('HTTPS URLs', () => {
    it('parses standard HTTPS URL', () => {
      const result = parseGitHubUrl('https://github.com/owner/repo')

      expect(result).not.toBeNull()
      expect(result!.owner).toBe('owner')
      expect(result!.repo).toBe('repo')
    })

    it('parses HTTPS URL with .git suffix', () => {
      const result = parseGitHubUrl('https://github.com/owner/repo.git')

      expect(result).not.toBeNull()
      expect(result!.owner).toBe('owner')
      expect(result!.repo).toBe('repo')
    })

    it('parses HTTPS URL with trailing slash', () => {
      const result = parseGitHubUrl('https://github.com/owner/repo/')

      expect(result).not.toBeNull()
      expect(result!.owner).toBe('owner')
      expect(result!.repo).toBe('repo')
    })
  })

  describe('SSH URLs', () => {
    it('parses standard SSH URL', () => {
      const result = parseGitHubUrl('git@github.com:owner/repo.git')

      expect(result).not.toBeNull()
      expect(result!.owner).toBe('owner')
      expect(result!.repo).toBe('repo')
    })

    it('parses SSH URL without .git suffix', () => {
      const result = parseGitHubUrl('git@github.com:owner/repo')

      expect(result).not.toBeNull()
      expect(result!.owner).toBe('owner')
      expect(result!.repo).toBe('repo')
    })
  })

  describe('owner and repo name variations', () => {
    it('handles hyphenated owner names', () => {
      const result = parseGitHubUrl('https://github.com/my-org/repo')

      expect(result).not.toBeNull()
      expect(result!.owner).toBe('my-org')
    })

    it('handles hyphenated repo names', () => {
      const result = parseGitHubUrl('https://github.com/owner/my-repo-name')

      expect(result).not.toBeNull()
      expect(result!.repo).toBe('my-repo-name')
    })

    it('handles numeric names', () => {
      const result = parseGitHubUrl('https://github.com/user123/repo456')

      expect(result).not.toBeNull()
      expect(result!.owner).toBe('user123')
      expect(result!.repo).toBe('repo456')
    })

    it('handles underscored names', () => {
      const result = parseGitHubUrl('https://github.com/my_org/my_repo')

      expect(result).not.toBeNull()
      expect(result!.owner).toBe('my_org')
      expect(result!.repo).toBe('my_repo')
    })
  })

  describe('invalid URLs', () => {
    it('returns null for non-GitHub URLs', () => {
      expect(parseGitHubUrl('https://gitlab.com/owner/repo')).toBeNull()
      expect(parseGitHubUrl('https://bitbucket.org/owner/repo')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(parseGitHubUrl('')).toBeNull()
    })

    it('returns null for malformed URLs', () => {
      expect(parseGitHubUrl('not-a-url')).toBeNull()
      expect(parseGitHubUrl('github.com')).toBeNull()
      expect(parseGitHubUrl('https://github.com')).toBeNull()
      expect(parseGitHubUrl('https://github.com/')).toBeNull()
    })

    it('returns null for URLs with only owner', () => {
      expect(parseGitHubUrl('https://github.com/owner')).toBeNull()
    })
  })

  describe('real-world examples', () => {
    it('parses common open source repos', () => {
      const examples = [
        { url: 'https://github.com/facebook/react', owner: 'facebook', repo: 'react' },
        { url: 'https://github.com/vercel/next.js', owner: 'vercel', repo: 'next' },
        { url: 'git@github.com:microsoft/TypeScript.git', owner: 'microsoft', repo: 'TypeScript' },
        { url: 'https://github.com/402goose/jfl-cli', owner: '402goose', repo: 'jfl-cli' },
      ]

      for (const { url, owner, repo } of examples) {
        const result = parseGitHubUrl(url)
        expect(result).not.toBeNull()
        expect(result!.owner).toBe(owner)
        expect(result!.repo).toBe(repo)
      }
    })
  })
})
