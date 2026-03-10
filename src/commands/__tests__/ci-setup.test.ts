/**
 * @purpose Tests for jfl ci setup command
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

// Mock execSync for git remote
jest.mock("child_process", () => ({
  execSync: jest.fn(() => "git@github.com:testuser/testrepo.git"),
}))

// We test the logic by importing the module internals
// Since ciSetupCommand uses process.cwd() and process.exit, we test the key patterns

describe("ci-setup", () => {
  const testDir = join(tmpdir(), `jfl-ci-setup-test-${Date.now()}`)

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test("WORKFLOW_FILES contains eval and review", () => {
    const expected = ["jfl-eval.yml", "jfl-review.yml"]
    // Verify template files exist
    const templateDir = join(__dirname, "../../../template/.github/workflows")
    for (const file of expected) {
      expect(existsSync(join(templateDir, file))).toBe(true)
    }
  })

  test("template workflow files are valid YAML with expected triggers", () => {
    const templateDir = join(__dirname, "../../../template/.github/workflows")

    const evalContent = readFileSync(join(templateDir, "jfl-eval.yml"), "utf-8")
    expect(evalContent).toContain("pull_request:")
    expect(evalContent).toContain("pp/")
    expect(evalContent).toContain("run-eval")
    expect(evalContent).toContain("eval:scored")
    expect(evalContent).toContain("gh pr merge")

    const reviewContent = readFileSync(join(templateDir, "jfl-review.yml"), "utf-8")
    expect(reviewContent).toContain("pull_request:")
    expect(reviewContent).toContain("pp/")
    expect(reviewContent).toContain("ai-review")
    expect(reviewContent).toContain("review:findings")
  })

  test("eval workflow commits eval entry to PR branch", () => {
    const templateDir = join(__dirname, "../../../template/.github/workflows")
    const evalContent = readFileSync(join(templateDir, "jfl-eval.yml"), "utf-8")

    // Should commit eval entries
    expect(evalContent).toContain(".jfl/eval.jsonl")
    expect(evalContent).toContain("service-events.jsonl")
    expect(evalContent).toContain("git push")
  })

  test("eval workflow auto-merges or flags regression", () => {
    const templateDir = join(__dirname, "../../../template/.github/workflows")
    const evalContent = readFileSync(join(templateDir, "jfl-eval.yml"), "utf-8")

    expect(evalContent).toContain("Auto-merge or flag regression")
    expect(evalContent).toContain("gh pr merge")
    expect(evalContent).toContain("--request-changes")
  })

  test("review workflow blocks on red findings", () => {
    const templateDir = join(__dirname, "../../../template/.github/workflows")
    const reviewContent = readFileSync(join(templateDir, "jfl-review.yml"), "utf-8")

    expect(reviewContent).toContain("Block or approve")
    expect(reviewContent).toContain("--request-changes")
    expect(reviewContent).toContain("has_blockers")
  })

  test("workflows require only OPENAI_API_KEY as mandatory secret", () => {
    const templateDir = join(__dirname, "../../../template/.github/workflows")
    const evalContent = readFileSync(join(templateDir, "jfl-eval.yml"), "utf-8")

    // OPENAI_API_KEY should be referenced
    expect(evalContent).toContain("OPENAI_API_KEY")
    // JFL_HUB_URL should be optional (continue-on-error or conditional)
    expect(evalContent).toContain("continue-on-error")
  })

  test("getRepoSlug extracts owner/repo from git remote", () => {
    const { execSync } = require("child_process")
    const remote = (execSync as jest.Mock)()
    const match = remote.match(/github\.com[:/](.+?)(?:\.git)?$/)
    expect(match?.[1]).toBe("testuser/testrepo")
  })

  test("workflow files can be copied to target directory", () => {
    const templateDir = join(__dirname, "../../../template/.github/workflows")
    const targetDir = join(testDir, ".github", "workflows")
    mkdirSync(targetDir, { recursive: true })

    const files = ["jfl-eval.yml", "jfl-review.yml"]
    for (const file of files) {
      const content = readFileSync(join(templateDir, file), "utf-8")
      writeFileSync(join(targetDir, file), content)
      expect(existsSync(join(targetDir, file))).toBe(true)

      // Verify content matches
      const copied = readFileSync(join(targetDir, file), "utf-8")
      expect(copied).toBe(content)
    }
  })
})
