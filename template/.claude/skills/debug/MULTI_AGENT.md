# Multi-Agent Debug Workflow

Coordinate multiple agents to debug complex binaries with cross-verification.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       Orchestrator                               │
│  Coordinates agents, merges findings, resolves conflicts         │
└─────────────────────────────────────────────────────────────────┘
        │           │            │            │
        ▼           ▼            ▼            ▼
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│  Static  │ │ Dynamic  │ │ Verifier │ │  Solver  │
│  Analyst │ │  Tracer  │ │          │ │          │
│          │ │          │ │          │ │          │
│ Ghidra   │ │ Frida    │ │ Compare  │ │ Exploit  │
│ Binja    │ │ WinDbg   │ │ Validate │ │ Fix      │
└──────────┘ └──────────┘ └──────────┘ └──────────┘
```

---

## Agent Definitions

### Static Analyst
**Tools:** Ghidra, Binary Ninja
**Role:** Map program structure without execution

**Tasks:**
1. Identify binary type and architecture
2. Find entry point and main functions
3. Map call graph
4. Identify interesting functions (crypto, auth, network)
5. Document string references
6. Note anti-analysis techniques

**Output format:**
```json
{
  "target": "binary_name",
  "type": "ELF64/PE32+/Mach-O",
  "arch": "x86_64/ARM64",
  "functions": [
    {
      "name": "check_license",
      "address": "0x401234",
      "args": ["char* key"],
      "returns": "int",
      "calls": ["strcmp", "decrypt"],
      "called_by": ["main"],
      "notes": "Checks license key against hardcoded value"
    }
  ],
  "strings": [
    {"address": "0x402000", "value": "Invalid license", "xrefs": ["0x401250"]}
  ],
  "imports": ["strcmp", "malloc", "free"],
  "suspicious": ["anti-debug detected at 0x401000"]
}
```

---

### Dynamic Tracer
**Tools:** Frida, WinDbg, GDB
**Role:** Observe runtime behavior

**Tasks:**
1. Hook functions identified by Static Analyst
2. Trace argument values
3. Capture return values
4. Monitor memory operations
5. Track control flow
6. Identify runtime-decrypted values

**Output format:**
```json
{
  "target": "binary_name",
  "traces": [
    {
      "function": "check_license",
      "address": "0x401234",
      "calls": [
        {
          "timestamp": "00:00:01.234",
          "args": ["AAAA-BBBB-CCCC"],
          "return": 0,
          "notes": "Returns 0 for invalid key"
        },
        {
          "timestamp": "00:00:02.567",
          "args": ["VALID-LICENSE-KEY"],
          "return": 1,
          "notes": "Returns 1 for this specific key"
        }
      ]
    }
  ],
  "memory": [
    {"address": "0x603000", "before": "encrypted", "after": "decrypted config"}
  ],
  "network": [
    {"timestamp": "00:00:03.000", "type": "DNS", "query": "license.example.com"}
  ]
}
```

---

### Verifier
**Role:** Cross-check findings, resolve conflicts

**Tasks:**
1. Compare static vs dynamic analysis
2. Identify discrepancies
3. Request clarification from other agents
4. Validate hypotheses
5. Build confidence scores

**Verification checks:**
```markdown
## Verification Report

### Function: check_license (0x401234)

| Property | Static | Dynamic | Match | Confidence |
|----------|--------|---------|-------|------------|
| Arg count | 1 | 1 | ✓ | 100% |
| Return type | int | int | ✓ | 100% |
| Calls strcmp | yes | yes | ✓ | 100% |
| Key format | unknown | XXXX-XXXX-XXXX | partial | 80% |
| Validation logic | XOR + compare | confirmed | ✓ | 95% |

### Discrepancies
- Static showed 2 code paths, dynamic only triggered 1
- ACTION: Tracer to test edge case with empty input

### Confidence: 92%
```

---

### Solver
**Role:** Develop solution based on verified findings

**Tasks:**
1. Use verified findings to develop exploit/patch/keygen
2. Test solution
3. Document approach
4. Handle edge cases

**Output:**
```markdown
## Solution: check_license bypass

### Approach
Based on verified analysis:
- Function at 0x401234 compares input against XOR-decoded key
- Key stored at 0x402000, XOR key is 0x42
- Valid key: "DECODED-LICENSE-KEY"

### Implementation
[Frida hook / patch / keygen code]

### Testing
- Test case 1: ✓ Passes with decoded key
- Test case 2: ✓ Bypass hook works
- Edge case: ✓ Empty input handled

### Confidence: 95%
```

---

## Orchestration Protocol

### Phase 1: Initial Analysis

```
Orchestrator → Static Analyst:
  "Analyze target binary. Identify:
   - Entry point and main flow
   - Authentication/validation functions
   - Interesting strings
   - Anti-analysis techniques"

Static Analyst → Orchestrator:
  [Static analysis output]

Orchestrator → Dynamic Tracer:
  "Here are functions from static analysis.
   Hook and trace:
   - check_license at 0x401234
   - decrypt_config at 0x401500
   Capture args, returns, and any decrypted values."

Dynamic Tracer → Orchestrator:
  [Dynamic trace output]
```

### Phase 2: Cross-Verification

```
Orchestrator → Verifier:
  "Compare these findings:
   - Static: [summary]
   - Dynamic: [summary]
   Identify discrepancies and confidence level."

Verifier → Orchestrator:
  [Verification report]

If discrepancies:
  Orchestrator → [appropriate agent]:
    "Clarify: [specific question]"
```

### Phase 3: Solution Development

```
Orchestrator → Solver:
  "Based on verified findings:
   - Function does X
   - Key is Y
   - Validation is Z
   Develop solution."

Solver → Orchestrator:
  [Solution + test results]

Orchestrator → Verifier:
  "Validate solution works as expected."
```

---

## Conflict Resolution

When agents disagree:

1. **Data conflict**: Re-run analysis with more detail
2. **Interpretation conflict**: Request both to explain reasoning
3. **Tool limitation**: Try different tool
4. **Anti-analysis**: Note as finding, work around

```
Example:
Static: "Function has 2 branches"
Dynamic: "Only saw 1 branch execute"

Resolution:
1. Ask Dynamic to test condition that triggers branch 2
2. If unreachable, note as dead code
3. If anti-debug, note as evasion technique
```

---

## Communication Format

All agents communicate via structured messages:

```json
{
  "from": "static_analyst",
  "to": "orchestrator",
  "type": "finding|question|answer|error",
  "confidence": 0.95,
  "content": {
    "summary": "Brief description",
    "details": { ... },
    "evidence": ["screenshot", "code", "trace"],
    "questions": ["Any open questions"],
    "next_steps": ["Suggested follow-ups"]
  }
}
```

---

## Example Session

```
USER: Debug this crackme binary

ORCHESTRATOR: Starting multi-agent debug session.

[Spawns Static Analyst]
STATIC: Analyzing... Found check_serial at 0x401234.
        Takes 1 arg (serial), returns int.
        Calls custom decrypt function, then strcmp.
        Confidence: 85%

[Spawns Dynamic Tracer]
DYNAMIC: Hooking check_serial...
         Input "TEST" → return 0
         Input "AAAA" → return 0
         Captured decrypted string: "CRACKME-2024"
         Confidence: 95%

[Spawns Verifier]
VERIFIER: Cross-checking...
          ✓ Function signature matches
          ✓ Decryption confirmed
          ✓ Valid serial identified
          Confidence: 93%

[Spawns Solver]
SOLVER: Serial is "CRACKME-2024"
        Verified: ✓
        Keygen possible: Yes (XOR with 0x42)

ORCHESTRATOR: Debug complete.
              Valid serial: CRACKME-2024
              Confidence: 93%
              Full report in outputs/debug/findings/
```

---

## Parallel Execution

For speed, run compatible analyses in parallel:

```
Phase 1 (parallel):
├── Static Analyst: Ghidra analysis
├── Static Analyst: Binary Ninja analysis (cross-check)
└── Dynamic Tracer: Initial trace (known functions)

Phase 2 (after Phase 1):
├── Verifier: Cross-check all findings
└── Dynamic Tracer: Additional hooks (newly identified)

Phase 3 (after Phase 2):
└── Solver: Develop solution
```

---

## Anti-Pattern Detection

Agents should flag suspicious patterns:

| Pattern | Indicator | Response |
|---------|-----------|----------|
| Anti-debug | IsDebuggerPresent, ptrace | Bypass before continuing |
| VM detection | CPUID checks, registry | Note, may need bare metal |
| Timing checks | rdtsc, GetTickCount | Freeze time in hooks |
| Integrity checks | CRC, hash validation | Patch or emulate |
| Obfuscation | Control flow flat, opaque predicates | Note, may need deobfuscation |

---

*"Multiple perspectives reveal the truth."*
