/**
 * JFL Plugin for Clawdbot
 *
 * Single installable unit. Dormant until /jfl activates it.
 * Hooks, commands, tools, and agent instructions — all in one.
 *
 * Install: copy to ~/.clawdbot/plugins/jfl/ or register in config
 * Activate: /jfl in Telegram
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
const execAsync = promisify(execCb);
// ============================================================================
// Agent Instructions — injected into Claude's context on activation
// This is the "brain" that tells the agent HOW to behave as a JFL team member
// ============================================================================
const AGENT_INSTRUCTIONS = `<jfl-agent>
You are a JFL team member. You have persistent memory, sessions, and team coordination.

## What's Happening Automatically
- Context is searched before each of your responses (relevant results injected)
- Decisions you make are captured to the journal
- Your work is auto-committed every ~2 minutes
- Session branch isolates your work from others

## What You Should Do Proactively
- When a decision is made → use jfl_journal tool with type "decision"
- When you finish a task → use jfl_journal tool with type "feature" or "fix"
- When you learn something important → use jfl_journal tool with type "discovery"
- When someone asks "what's next?" → use jfl_context tool to search for roadmap
- When someone mentions the project → use jfl_context tool for relevant info

## Key Principle
You are not a CLI wrapper. You are a team member. Read context, synthesize understanding, make decisions, write journals. The value is in coordination and memory.
</jfl-agent>`;
function readJflConfig(dir) {
    try {
        return JSON.parse(fs.readFileSync(path.join(dir, ".jfl", "config.json"), "utf-8"));
    }
    catch {
        return null;
    }
}
function scanForGtms() {
    const home = os.homedir();
    const searchDirs = [
        path.join(home, "CascadeProjects"),
        path.join(home, "Projects"),
        path.join(home, "code"),
    ];
    const gtms = [];
    for (const dir of searchDirs) {
        if (!fs.existsSync(dir))
            continue;
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory())
                    continue;
                const candidate = path.join(dir, entry.name);
                const config = readJflConfig(candidate);
                if (!config)
                    continue;
                if (config.type === "gtm") {
                    gtms.push({ name: config.name || entry.name, path: candidate, type: "gtm" });
                }
                else if (!config.type && fs.existsSync(path.join(candidate, "knowledge"))) {
                    gtms.push({ name: config.name || entry.name, path: candidate, type: "legacy" });
                }
            }
        }
        catch { /* skip */ }
    }
    return gtms;
}
// Also check OpenClaw registry
function getRegistryGtms() {
    try {
        const regPath = path.join(os.homedir(), ".config", "jfl", "openclaw-agents.json");
        const reg = JSON.parse(fs.readFileSync(regPath, "utf-8"));
        const gtms = [];
        for (const agent of Object.values(reg.agents ?? {})) {
            for (const g of agent.registered_gtms ?? []) {
                if (g.path && fs.existsSync(g.path) && !gtms.some((x) => x.path === g.path)) {
                    gtms.push({ name: g.name || path.basename(g.path), path: g.path, type: "registered" });
                }
            }
        }
        return gtms;
    }
    catch {
        return [];
    }
}
function findAllGtms(configWorkspace) {
    const all = [];
    const seen = new Set();
    // Config override first
    if (configWorkspace) {
        const resolved = configWorkspace.startsWith("~")
            ? path.join(os.homedir(), configWorkspace.slice(1))
            : configWorkspace;
        const config = readJflConfig(resolved);
        if (config) {
            all.push({ name: config.name || path.basename(resolved), path: resolved, type: config.type || "config" });
            seen.add(resolved);
        }
    }
    // Registry
    for (const g of getRegistryGtms()) {
        if (!seen.has(g.path)) {
            all.push(g);
            seen.add(g.path);
        }
    }
    // Filesystem scan
    for (const g of scanForGtms()) {
        if (!seen.has(g.path)) {
            all.push(g);
            seen.add(g.path);
        }
    }
    return all;
}
// ============================================================================
// Context Hub Client — direct HTTP to Context Hub API
// ============================================================================
function createHubClient(workspacePath, port = 4242) {
    let availableCache = null;
    let checkedAt = 0;
    function getToken() {
        try {
            return fs.readFileSync(path.join(workspacePath, ".jfl", "context-hub.token"), "utf-8").trim();
        }
        catch {
            return null;
        }
    }
    async function isAvailable() {
        if (availableCache !== null && Date.now() - checkedAt < 30_000)
            return availableCache;
        try {
            const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) });
            availableCache = res.ok;
        }
        catch {
            availableCache = false;
        }
        checkedAt = Date.now();
        return availableCache;
    }
    async function search(query, limit = 5) {
        if (!(await isAvailable()))
            return [];
        const token = getToken();
        const headers = { "Content-Type": "application/json" };
        if (token)
            headers["Authorization"] = `Bearer ${token}`;
        try {
            const res = await fetch(`http://localhost:${port}/api/context/search`, {
                method: "POST",
                headers,
                body: JSON.stringify({ query, maxItems: limit }),
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok)
                return [];
            const data = (await res.json());
            return (data.items ?? []).map((i) => ({
                source: i.source ?? "unknown",
                title: i.title ?? "",
                content: i.content ?? "",
            }));
        }
        catch {
            return [];
        }
    }
    return { isAvailable, search };
}
// ============================================================================
// CLI helpers — shell out to jfl openclaw
// ============================================================================
async function jflExec(cmd) {
    const { stdout } = await execAsync(`jfl openclaw ${cmd}`, { timeout: 30000 });
    return stdout.trim();
}
async function jflJSON(cmd) {
    return JSON.parse(await jflExec(`${cmd} --json`));
}
async function hasJflCli() {
    try {
        await execAsync("jfl --version", { timeout: 5000 });
        return true;
    }
    catch {
        return false;
    }
}
async function installJflCli() {
    try {
        await execAsync("npm install -g jfl", { timeout: 60000 });
        return true;
    }
    catch {
        return false;
    }
}
const jflPlugin = {
    id: "jfl",
    name: "JFL",
    description: "Project context layer — dormant until /jfl",
    register(api) {
        const cfg = api.pluginConfig ?? {};
        // ── State ─────────────────────────────────────────────────────────
        let active = false;
        let gtmPath = null;
        let gtmName = "";
        let sessionBranch = null;
        let agentId = "cash"; // default, overridden on activation
        let hub = null;
        // ── Activation ────────────────────────────────────────────────────
        async function activate(gtm) {
            gtmPath = gtm.path;
            gtmName = gtm.name;
            hub = createHubClient(gtm.path);
            active = true;
            // Ensure CLI
            if (!(await hasJflCli())) {
                const installed = await installJflCli();
                if (!installed)
                    return `JFL activated: ${gtmName}\n\nWarning: jfl CLI not found. Install with: npm install -g jfl`;
            }
            // Register + start session
            try {
                await jflExec(`register -g "${gtmPath}" -a ${agentId}`);
            }
            catch { /* idempotent, may already be registered */ }
            try {
                const session = await jflJSON(`session-start -a ${agentId} -g "${gtmPath}"`);
                sessionBranch = session.session_id || session.branch || null;
            }
            catch {
                // Session start failed but we're still activated for commands
            }
            api.logger.info(`jfl: activated → ${gtmName} (${gtmPath})`);
            const hubUp = hub ? await hub.isAvailable() : false;
            return [
                `JFL activated: ${gtmName}`,
                ``,
                `Session: ${sessionBranch || "none"}`,
                `Context Hub: ${hubUp ? "running" : "offline"}`,
                ``,
                `What I do now:`,
                `- Search context before each response`,
                `- Capture decisions to journal`,
                `- Auto-commit work`,
                ``,
                `Commands:`,
                `/context <query> — Search project context`,
                `/journal <type> <title> | <summary> — Log work`,
                `/hud — Dashboard`,
                `/jfl — This status`,
            ].join("\n");
        }
        // ── Startup ───────────────────────────────────────────────────────
        api.registerService({
            id: "jfl",
            async start() {
                const gtms = findAllGtms(cfg.workspace);
                api.logger.info(`jfl: ${gtms.length} GTM(s) found, dormant until /jfl`);
            },
            stop() {
                if (active && sessionBranch) {
                    // Best-effort session end
                    try {
                        execCb(`jfl openclaw session-end --sync`, () => { });
                    }
                    catch { }
                }
                api.logger.info("jfl: stopped");
            },
        });
        // ── Hooks (gated by activation) ───────────────────────────────────
        // Inject agent instructions + context on activation
        api.on("before_agent_start", async (event) => {
            if (!active || !hub)
                return;
            const parts = [];
            // Always inject agent instructions so Claude knows how to behave
            parts.push(AGENT_INSTRUCTIONS);
            // Search context relevant to this message
            const prompt = event.prompt;
            if (prompt && prompt.length > 10) {
                const results = await hub.search(prompt.slice(0, 200), 3);
                if (results.length > 0) {
                    const items = results.map((r) => `- [${r.source}] ${r.title}: ${r.content.slice(0, 150)}`).join("\n");
                    parts.push(`<jfl-context>\nRelevant to this message:\n${items}\n</jfl-context>`);
                }
            }
            // Session info
            parts.push(`<jfl-session>GTM: ${gtmName} | Session: ${sessionBranch || "none"}</jfl-session>`);
            return { prependContext: parts.join("\n\n") };
        });
        // Auto-capture decisions after agent responds
        api.on("agent_end", async (event) => {
            if (!active || !gtmPath)
                return;
            // Heartbeat (auto-commit)
            try {
                await jflExec("heartbeat");
            }
            catch { }
            // Scan last assistant message for decision indicators
            if (event.messages && event.messages.length > 0) {
                const last = event.messages[event.messages.length - 1];
                const text = typeof last === "string" ? last : last?.content ?? "";
                const lower = text.toLowerCase();
                const isDecision = /\b(decided|choosing|going with|let's go with|picking)\b/.test(lower);
                const isComplete = /\b(done|completed|finished|shipped|built|implemented)\b/.test(lower);
                if (isDecision || isComplete) {
                    const type = isDecision ? "decision" : "feature";
                    const title = text.slice(0, 80).replace(/\n/g, " ").replace(/"/g, "'");
                    try {
                        await jflExec(`journal --type ${type} --title "${title}" --summary "${title}"`);
                    }
                    catch { }
                }
            }
        });
        // Session lifecycle
        api.on("session_end", async () => {
            if (!active || !sessionBranch)
                return;
            try {
                await jflJSON("session-end --sync");
            }
            catch { }
            sessionBranch = null;
        });
        // ── Tools (Claude can use these proactively) ──────────────────────
        api.registerTool({
            name: "jfl_context",
            description: "Search JFL project context — knowledge docs, journal entries, code. Use when someone asks about the project, past decisions, or what's been done.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Search query" },
                },
                required: ["query"],
            },
            async execute(_id, params) {
                if (!active)
                    return { content: [{ type: "text", text: "JFL not active. User should run /jfl first." }] };
                if (!hub)
                    return { content: [{ type: "text", text: "No workspace set." }] };
                const results = await hub.search(params.query, 5);
                if (results.length === 0) {
                    // Fallback to CLI
                    try {
                        const raw = await jflExec(`context -q "${params.query.replace(/"/g, '\\"')}"`);
                        return { content: [{ type: "text", text: raw || "No results." }] };
                    }
                    catch {
                        return { content: [{ type: "text", text: "No results found." }] };
                    }
                }
                const text = results.map((r, i) => `${i + 1}. [${r.source}] ${r.title}\n   ${r.content.slice(0, 200)}`).join("\n\n");
                return { content: [{ type: "text", text }] };
            },
        });
        api.registerTool({
            name: "jfl_journal",
            description: "Write a journal entry. Use after decisions, task completion, bug fixes, or discoveries. Types: decision, feature, fix, discovery, milestone.",
            parameters: {
                type: "object",
                properties: {
                    type: { type: "string", enum: ["decision", "feature", "fix", "discovery", "milestone"], description: "Entry type" },
                    title: { type: "string", description: "Short title" },
                    summary: { type: "string", description: "What happened, why, what's next" },
                },
                required: ["type", "title", "summary"],
            },
            async execute(_id, params) {
                if (!active)
                    return { content: [{ type: "text", text: "JFL not active." }] };
                try {
                    await jflExec(`journal --type "${params.type}" --title "${params.title.replace(/"/g, "'")}" --summary "${params.summary.replace(/"/g, "'").slice(0, 500)}"`);
                    return { content: [{ type: "text", text: `Journal entry written: [${params.type}] ${params.title}` }] };
                }
                catch (e) {
                    return { content: [{ type: "text", text: `Failed: ${e.message}` }] };
                }
            },
        });
        // ── Commands (show up in Telegram) ────────────────────────────────
        api.registerCommand({
            name: "jfl",
            description: "Activate JFL or show status",
            acceptsArgs: true,
            handler: async (ctx) => {
                const arg = ctx.args?.trim();
                // Already active — show status
                if (active && !arg) {
                    const hubUp = hub ? await hub.isAvailable() : false;
                    return {
                        text: [
                            `JFL active: ${gtmName}`,
                            `Session: ${sessionBranch || "none"}`,
                            `Context Hub: ${hubUp ? "running" : "offline"}`,
                            ``,
                            `Automatic:`,
                            `- Context injected before responses`,
                            `- Decisions captured to journal`,
                            `- Work auto-committed`,
                            ``,
                            `Commands:`,
                            `/context <query> — Search`,
                            `/journal <type> <title> | <summary> — Log`,
                            `/hud — Dashboard`,
                        ].join("\n"),
                    };
                }
                // Find GTMs
                const gtms = findAllGtms(cfg.workspace);
                if (gtms.length === 0) {
                    return {
                        text: [
                            "JFL - Just Fucking Launch",
                            "",
                            "No projects found.",
                            "",
                            "Create one:",
                            "  jfl init -n 'My Project'",
                            "",
                            "Then restart the gateway and run /jfl",
                        ].join("\n"),
                    };
                }
                // User specified which one
                if (arg) {
                    const idx = parseInt(arg) - 1;
                    const match = !isNaN(idx) && idx >= 0 && idx < gtms.length
                        ? gtms[idx]
                        : gtms.find((g) => g.name.toLowerCase().includes(arg.toLowerCase()));
                    if (match)
                        return { text: await activate(match) };
                    return { text: `No project matching "${arg}".\n\n${gtms.map((g, i) => `${i + 1}. ${g.name}`).join("\n")}\n\nUse /jfl <number>` };
                }
                // Single GTM — auto-activate
                if (gtms.length === 1) {
                    return { text: await activate(gtms[0]) };
                }
                // Multiple — list them
                return {
                    text: [
                        "Select a project:",
                        "",
                        ...gtms.map((g, i) => `${i + 1}. ${g.name} (${g.path})`),
                        "",
                        "Use /jfl <number> to activate.",
                    ].join("\n"),
                };
            },
        });
        api.registerCommand({
            name: "context",
            description: "Search project context",
            acceptsArgs: true,
            handler: async (ctx) => {
                if (!active) {
                    // Try auto-activate
                    const gtms = findAllGtms(cfg.workspace);
                    if (gtms.length === 1) {
                        await activate(gtms[0]);
                    }
                    else {
                        return { text: "Use /jfl first to select a project." };
                    }
                }
                const q = ctx.args?.trim();
                if (!q)
                    return { text: "Usage: /context <query>" };
                if (hub) {
                    const results = await hub.search(q, 5);
                    if (results.length > 0) {
                        return {
                            text: results.map((r, i) => `${i + 1}. [${r.source}] ${r.title}\n   ${r.content.slice(0, 150)}`).join("\n\n"),
                        };
                    }
                }
                // Fallback to CLI
                try {
                    const raw = await jflExec(`context -q "${q.replace(/"/g, '\\"')}"`);
                    return { text: raw || "No results." };
                }
                catch {
                    return { text: "No results. Context Hub may be offline." };
                }
            },
        });
        api.registerCommand({
            name: "journal",
            description: "Write a journal entry",
            acceptsArgs: true,
            handler: async (ctx) => {
                if (!active)
                    return { text: "Use /jfl first." };
                const raw = ctx.args?.trim();
                if (!raw)
                    return { text: "Usage: /journal <type> <title> | <summary>\nTypes: feature, fix, decision, discovery, milestone" };
                const pipeIdx = raw.indexOf("|");
                const before = pipeIdx >= 0 ? raw.substring(0, pipeIdx).trim() : raw;
                const summary = pipeIdx >= 0 ? raw.substring(pipeIdx + 1).trim() : "";
                const parts = before.split(/\s+/);
                const type = parts[0] ?? "feature";
                const title = parts.slice(1).join(" ") || "Untitled";
                try {
                    await jflExec(`journal --type "${type}" --title "${title.replace(/"/g, "'")}" --summary "${(summary || title).replace(/"/g, "'")}"`);
                    return { text: `Journal: [${type}] ${title}` };
                }
                catch (e) {
                    return { text: `Failed: ${e.message?.split("\n")[0]}` };
                }
            },
        });
        api.registerCommand({
            name: "hud",
            description: "Project dashboard",
            handler: async () => {
                if (!active)
                    return { text: "Use /jfl first." };
                const hubUp = hub ? await hub.isAvailable() : false;
                return {
                    text: [
                        `--- ${gtmName} ---`,
                        ``,
                        `Session: ${sessionBranch || "none"}`,
                        `Context Hub: ${hubUp ? "running" : "offline"}`,
                        `Workspace: ${gtmPath}`,
                        ``,
                        `/context <query> — Search`,
                        `/journal <type> <title> | <summary> — Log`,
                    ].join("\n"),
                };
            },
        });
        api.logger.info("jfl: loaded (dormant — /jfl to activate)");
    },
};
export default jflPlugin;
//# sourceMappingURL=index.js.map