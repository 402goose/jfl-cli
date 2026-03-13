/**
 * Session Lock Registry + Merge Sequencer Tests
 *
 * @purpose Verify file-based session concurrency control
 */

import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  registerSession,
  heartbeat,
  updateClaims,
  unregisterSession,
  getActiveSessions,
  getStaleSessions,
  cleanStaleSessions,
  checkClaimConflict,
  startHeartbeat,
  stopHeartbeat,
  enqueueMerge,
  acquireMergeLock,
  releaseMergeLock,
  emitEvent,
  readRecentEvents,
  validateSessionId,
  SESSION_ID_PATTERN,
  type SessionLock,
} from "../session-lock.js"

function createTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "jfl-session-lock-test-"))
  mkdirSync(join(dir, ".jfl", "sessions"), { recursive: true })
  return dir
}

describe("Session Lock Registry", () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = createTempProject()
  })

  describe("registerSession", () => {
    it("creates a lock file for the session", () => {
      const lock = registerSession(projectRoot, {
        id: "session-test-001",
        pid: process.pid,
        branch: "main",
        worktree: null,
        user: "tester",
        claiming: [],
        started: new Date().toISOString(),
      })

      expect(lock.id).toBe("session-test-001")
      expect(lock.heartbeat).toBeDefined()

      const lockPath = join(projectRoot, ".jfl", "sessions", "session-test-001.lock")
      expect(existsSync(lockPath)).toBe(true)

      const content = JSON.parse(readFileSync(lockPath, "utf-8"))
      expect(content.id).toBe("session-test-001")
      expect(content.pid).toBe(process.pid)
    })

    it("registers multiple sessions without conflict", () => {
      registerSession(projectRoot, {
        id: "session-a",
        pid: process.pid,
        branch: "main",
        worktree: null,
        user: "alice",
        claiming: [],
        started: new Date().toISOString(),
      })

      registerSession(projectRoot, {
        id: "session-b",
        pid: process.pid,
        branch: "feature-x",
        worktree: "/tmp/worktree-b",
        user: "bob",
        claiming: [],
        started: new Date().toISOString(),
      })

      const active = getActiveSessions(projectRoot)
      expect(active.length).toBe(2)
    })
  })

  describe("heartbeat", () => {
    it("updates the heartbeat timestamp", () => {
      registerSession(projectRoot, {
        id: "session-hb",
        pid: process.pid,
        branch: "main",
        worktree: null,
        user: "tester",
        claiming: [],
        started: new Date().toISOString(),
      })

      const before = readFileSync(
        join(projectRoot, ".jfl", "sessions", "session-hb.lock"),
        "utf-8"
      )
      const beforeTs = JSON.parse(before).heartbeat

      const ok = heartbeat(projectRoot, "session-hb")
      expect(ok).toBe(true)

      const after = readFileSync(
        join(projectRoot, ".jfl", "sessions", "session-hb.lock"),
        "utf-8"
      )
      const afterTs = JSON.parse(after).heartbeat
      expect(new Date(afterTs).getTime()).toBeGreaterThanOrEqual(new Date(beforeTs).getTime())
    })

    it("returns false for non-existent session", () => {
      const ok = heartbeat(projectRoot, "does-not-exist")
      expect(ok).toBe(false)
    })
  })

  describe("getActiveSessions", () => {
    it("returns only sessions with alive PIDs and fresh heartbeats", () => {
      registerSession(projectRoot, {
        id: "session-alive",
        pid: process.pid,
        branch: "main",
        worktree: null,
        user: "tester",
        claiming: [],
        started: new Date().toISOString(),
      })

      const active = getActiveSessions(projectRoot)
      expect(active.length).toBe(1)
      expect(active[0].id).toBe("session-alive")
    })

    it("excludes sessions with dead PIDs", () => {
      registerSession(projectRoot, {
        id: "session-dead",
        pid: 999999999,
        branch: "main",
        worktree: null,
        user: "tester",
        claiming: [],
        started: new Date().toISOString(),
      })

      const active = getActiveSessions(projectRoot)
      expect(active.length).toBe(0)
    })

    it("returns empty array when no sessions exist", () => {
      const active = getActiveSessions(projectRoot)
      expect(active.length).toBe(0)
    })
  })

  describe("getStaleSessions", () => {
    it("detects sessions with dead PIDs as stale", () => {
      registerSession(projectRoot, {
        id: "session-stale",
        pid: 999999999,
        branch: "main",
        worktree: null,
        user: "tester",
        claiming: [],
        started: new Date().toISOString(),
      })

      const stale = getStaleSessions(projectRoot)
      expect(stale.length).toBe(1)
      expect(stale[0].id).toBe("session-stale")
    })
  })

  describe("cleanStaleSessions", () => {
    it("removes stale lock files and returns count", () => {
      registerSession(projectRoot, {
        id: "session-cleanup-target",
        pid: 999999999,
        branch: "main",
        worktree: null,
        user: "tester",
        claiming: [],
        started: new Date().toISOString(),
      })

      const lockPath = join(projectRoot, ".jfl", "sessions", "session-cleanup-target.lock")
      expect(existsSync(lockPath)).toBe(true)

      const cleaned = cleanStaleSessions(projectRoot)
      expect(cleaned).toBe(1)
      expect(existsSync(lockPath)).toBe(false)
    })
  })

  describe("unregisterSession", () => {
    it("removes the lock file", () => {
      registerSession(projectRoot, {
        id: "session-unreg",
        pid: process.pid,
        branch: "main",
        worktree: null,
        user: "tester",
        claiming: [],
        started: new Date().toISOString(),
      })

      const lockPath = join(projectRoot, ".jfl", "sessions", "session-unreg.lock")
      expect(existsSync(lockPath)).toBe(true)

      unregisterSession(projectRoot, "session-unreg")
      expect(existsSync(lockPath)).toBe(false)
    })

    it("does not throw for non-existent session", () => {
      expect(() => unregisterSession(projectRoot, "ghost")).not.toThrow()
    })
  })

  describe("updateClaims", () => {
    it("updates claiming array in the lock file", () => {
      registerSession(projectRoot, {
        id: "session-claims",
        pid: process.pid,
        branch: "main",
        worktree: null,
        user: "tester",
        claiming: [],
        started: new Date().toISOString(),
      })

      updateClaims(projectRoot, "session-claims", ["src/", "knowledge/"])

      const lockPath = join(projectRoot, ".jfl", "sessions", "session-claims.lock")
      const content = JSON.parse(readFileSync(lockPath, "utf-8"))
      expect(content.claiming).toEqual(["src/", "knowledge/"])
    })
  })

  describe("checkClaimConflict", () => {
    it("detects overlapping claims between sessions", () => {
      registerSession(projectRoot, {
        id: "session-owner",
        pid: process.pid,
        branch: "main",
        worktree: null,
        user: "alice",
        claiming: ["src/commands/"],
        started: new Date().toISOString(),
      })

      const result = checkClaimConflict(
        projectRoot,
        "session-other",
        ["src/commands/session.ts"]
      )

      expect(result.conflicting).toBe(true)
      expect(result.claimedBy).toContain("session-owner")
    })

    it("allows non-overlapping claims", () => {
      registerSession(projectRoot, {
        id: "session-owner",
        pid: process.pid,
        branch: "main",
        worktree: null,
        user: "alice",
        claiming: ["src/commands/"],
        started: new Date().toISOString(),
      })

      const result = checkClaimConflict(
        projectRoot,
        "session-other",
        ["knowledge/VISION.md"]
      )

      expect(result.conflicting).toBe(false)
    })

    it("ignores claims from the same session", () => {
      registerSession(projectRoot, {
        id: "session-self",
        pid: process.pid,
        branch: "main",
        worktree: null,
        user: "alice",
        claiming: ["src/"],
        started: new Date().toISOString(),
      })

      const result = checkClaimConflict(
        projectRoot,
        "session-self",
        ["src/lib/foo.ts"]
      )

      expect(result.conflicting).toBe(false)
    })
  })
})

describe("Heartbeat Daemon", () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = createTempProject()
  })

  afterEach(() => {
    stopHeartbeat("daemon-test")
  })

  it("starts and stops without error", () => {
    registerSession(projectRoot, {
      id: "daemon-test",
      pid: process.pid,
      branch: "main",
      worktree: null,
      user: "tester",
      claiming: [],
      started: new Date().toISOString(),
    })

    expect(() => startHeartbeat(projectRoot, "daemon-test")).not.toThrow()
    expect(() => stopHeartbeat("daemon-test")).not.toThrow()
  })
})

describe("Merge Sequencer", () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = createTempProject()
  })

  afterEach(() => {
    releaseMergeLock(projectRoot)
  })

  describe("enqueueMerge", () => {
    it("appends to the merge queue file", () => {
      enqueueMerge(projectRoot, "session-branch-1", "main", "session-1")

      const queuePath = join(projectRoot, ".jfl", "sessions", "merge-queue.jsonl")
      expect(existsSync(queuePath)).toBe(true)

      const content = readFileSync(queuePath, "utf-8").trim()
      const entry = JSON.parse(content)
      expect(entry.session).toBe("session-1")
      expect(entry.branch).toBe("session-branch-1")
      expect(entry.targetBranch).toBe("main")
      expect(entry.status).toBe("pending")
    })

    it("appends multiple entries without overwriting", () => {
      enqueueMerge(projectRoot, "branch-a", "main", "session-a")
      enqueueMerge(projectRoot, "branch-b", "main", "session-b")

      const queuePath = join(projectRoot, ".jfl", "sessions", "merge-queue.jsonl")
      const lines = readFileSync(queuePath, "utf-8").trim().split("\n")
      expect(lines.length).toBe(2)
    })
  })

  describe("acquireMergeLock / releaseMergeLock", () => {
    it("acquires lock when no other holder", async () => {
      const acquired = await acquireMergeLock(projectRoot, "session-locker", 5000)
      expect(acquired).toBe(true)

      const lockPath = join(projectRoot, ".jfl", "sessions", "merge.lock")
      expect(existsSync(lockPath)).toBe(true)
    })

    it("releases lock cleanly", async () => {
      await acquireMergeLock(projectRoot, "session-locker", 5000)
      releaseMergeLock(projectRoot)

      const lockPath = join(projectRoot, ".jfl", "sessions", "merge.lock")
      expect(existsSync(lockPath)).toBe(false)
    })

    it("times out when lock is held by another", async () => {
      const lockPath = join(projectRoot, ".jfl", "sessions", "merge.lock")
      writeFileSync(lockPath, JSON.stringify({
        session: "session-holder",
        ts: new Date().toISOString(),
      }))

      const acquired = await acquireMergeLock(projectRoot, "session-waiter", 3000)
      expect(acquired).toBe(false)
    })

    it("recovers stale merge lock", async () => {
      const lockPath = join(projectRoot, ".jfl", "sessions", "merge.lock")
      const staleTs = new Date(Date.now() - 200_000).toISOString()
      writeFileSync(lockPath, JSON.stringify({
        session: "session-old",
        ts: staleTs,
      }))

      const acquired = await acquireMergeLock(projectRoot, "session-new", 5000)
      expect(acquired).toBe(true)
    })
  })
})

describe("Event Bus", () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = createTempProject()
  })

  it("emits events to events.jsonl", () => {
    emitEvent(projectRoot, { session: "test", event: "test:emit", data: "hello" })

    const eventsFile = join(projectRoot, ".jfl", "sessions", "events.jsonl")
    expect(existsSync(eventsFile)).toBe(true)

    const content = readFileSync(eventsFile, "utf-8").trim()
    const event = JSON.parse(content)
    expect(event.event).toBe("test:emit")
    expect(event.ts).toBeDefined()
  })

  it("reads recent events", () => {
    emitEvent(projectRoot, { session: "a", event: "e1" })
    emitEvent(projectRoot, { session: "b", event: "e2" })
    emitEvent(projectRoot, { session: "c", event: "e3" })

    const events = readRecentEvents(projectRoot, 2)
    expect(events.length).toBe(2)
    expect((events[0] as any).event).toBe("e2")
    expect((events[1] as any).event).toBe("e3")
  })

  it("returns empty array when no events", () => {
    const events = readRecentEvents(projectRoot)
    expect(events.length).toBe(0)
  })
})

describe("Session ID Validation", () => {
  it("accepts valid session IDs", () => {
    const valid = [
      "session-goose-20260125-0240-bea0be",
      "session-test-001",
      "my.session",
      "session_underscored",
      "abc123",
    ]
    for (const id of valid) {
      expect(() => validateSessionId(id)).not.toThrow()
    }
  })

  it("rejects IDs with path traversal", () => {
    expect(() => validateSessionId("../../../etc/passwd")).toThrow("Invalid session ID")
  })

  it("rejects IDs with shell metacharacters", () => {
    const malicious = [
      "; rm -rf /",
      "$(whoami)",
      "session`id`",
      "a | cat /etc/passwd",
      "session\nid",
      "session id",
      "",
    ]
    for (const id of malicious) {
      expect(() => validateSessionId(id)).toThrow("Invalid session ID")
    }
  })

  it("rejects IDs with slashes", () => {
    expect(() => validateSessionId("session/bad")).toThrow("Invalid session ID")
    expect(() => validateSessionId("session\\bad")).toThrow("Invalid session ID")
  })

  it("registerSession rejects bad IDs", () => {
    const projectRoot = createTempProject()
    expect(() =>
      registerSession(projectRoot, {
        id: "../escape",
        pid: process.pid,
        branch: "main",
        worktree: null,
        user: "attacker",
        claiming: [],
        started: new Date().toISOString(),
      })
    ).toThrow("Invalid session ID")
  })

  it("heartbeat rejects bad IDs", () => {
    const projectRoot = createTempProject()
    expect(() => heartbeat(projectRoot, "; rm -rf /")).toThrow("Invalid session ID")
  })

  it("unregisterSession rejects bad IDs", () => {
    const projectRoot = createTempProject()
    expect(() => unregisterSession(projectRoot, "$(whoami)")).toThrow("Invalid session ID")
  })
})

describe("NaN Heartbeat Guard", () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = createTempProject()
  })

  it("treats sessions with corrupt heartbeat as stale", () => {
    const lockPath = join(projectRoot, ".jfl", "sessions", "session-corrupt.lock")
    const corruptLock = {
      id: "session-corrupt",
      pid: process.pid,
      branch: "main",
      worktree: null,
      user: "tester",
      claiming: [],
      started: new Date().toISOString(),
      heartbeat: "not-a-date",
    }
    writeFileSync(lockPath, JSON.stringify(corruptLock, null, 2))

    const active = getActiveSessions(projectRoot)
    expect(active.find((s) => s.id === "session-corrupt")).toBeUndefined()

    const stale = getStaleSessions(projectRoot)
    expect(stale.find((s) => s.id === "session-corrupt")).toBeDefined()
  })

  it("treats sessions with empty heartbeat as stale", () => {
    const lockPath = join(projectRoot, ".jfl", "sessions", "session-empty-hb.lock")
    const emptyHbLock = {
      id: "session-empty-hb",
      pid: process.pid,
      branch: "main",
      worktree: null,
      user: "tester",
      claiming: [],
      started: new Date().toISOString(),
      heartbeat: "",
    }
    writeFileSync(lockPath, JSON.stringify(emptyHbLock, null, 2))

    const active = getActiveSessions(projectRoot)
    expect(active.find((s) => s.id === "session-empty-hb")).toBeUndefined()
  })

  it("treats sessions with undefined heartbeat as stale", () => {
    const lockPath = join(projectRoot, ".jfl", "sessions", "session-no-hb.lock")
    const noHbLock = {
      id: "session-no-hb",
      pid: process.pid,
      branch: "main",
      worktree: null,
      user: "tester",
      claiming: [],
      started: new Date().toISOString(),
    }
    writeFileSync(lockPath, JSON.stringify(noHbLock, null, 2))

    const stale = getStaleSessions(projectRoot)
    expect(stale.find((s) => s.id === "session-no-hb")).toBeDefined()
  })
})

describe("Bash Script Integration", () => {
  it("session-lock.sh is executable", () => {
    const scriptPath = join(__dirname, "..", "..", "..", "template", "scripts", "session", "session-lock.sh")
    if (existsSync(scriptPath)) {
      const { execSync } = require("child_process")
      const output = execSync(`bash "${scriptPath}" --help`, { encoding: "utf-8" })
      expect(output).toContain("session-lock.sh")
      expect(output).toContain("register")
      expect(output).toContain("merge")
    }
  })
})
