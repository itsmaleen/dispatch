# Agent Isolation & Parallel Execution Research

> **Purpose**: Reference documentation for implementing git worktree isolation, checkpointing, and multi-agent coordination features.
>
> **Last Updated**: March 2026

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Git Worktrees: Core Isolation Pattern](#git-worktrees-core-isolation-pattern)
3. [Open Source Implementations](#open-source-implementations)
4. [Checkpointing & Rollback Strategies](#checkpointing--rollback-strategies)
5. [Container-Based Isolation](#container-based-isolation)
6. [Merge Conflict Prevention & Resolution](#merge-conflict-prevention--resolution)
7. [Multi-Agent Orchestration Patterns](#multi-agent-orchestration-patterns)
8. [Headless/CI Mode Patterns](#headlessci-mode-patterns)
9. [Implementation Recommendations](#implementation-recommendations)
10. [API & Code Examples](#api--code-examples)
11. [Sources & References](#sources--references)

---

## Executive Summary

The open source community has converged on **git worktrees** as the primary isolation mechanism for running multiple AI coding agents in parallel. This approach is supported by major tools including Cursor, Claude Code, and numerous open source orchestrators.

### Key Findings

| Challenge | Solution | Primary Tools |
|-----------|----------|---------------|
| Agent file collisions | Git worktrees (separate directories per branch) | Superset, Agent Orchestrator |
| Rollback/undo changes | Auto-commit checkpoints | Aider, AgentGit |
| Agent state versioning | State commit/revert/branch | AgentGit |
| Maximum isolation | Container sandboxing | OpenHands, Cursor Background Agents |
| Merge conflicts | Early detection + sequential merging | Clash, AI-assisted resolution |
| Orchestration at scale | AI orchestrator agents | Composio Agent Orchestrator |

### Core Insight

> Agents working in separate worktrees are **structurally isolated** — they literally cannot collide because they're not touching the same files.

---

## Git Worktrees: Core Isolation Pattern

### What Are Git Worktrees?

Git worktrees allow you to check out multiple branches of the same repository simultaneously in different directories. Unlike cloning, all worktrees share a single `.git` directory and object store, making them lightweight and keeping branches in sync.

### Basic Commands

```bash
# Create a new worktree for a feature branch
git worktree add ../feature-auth feature/auth

# Create worktree with new branch
git worktree add -b feature/new-api ../feature-api

# List all worktrees
git worktree list

# Remove a worktree (after merging)
git worktree remove ../feature-auth

# Prune stale worktree references
git worktree prune
```

### Directory Organization Pattern

```
my-project/
├── .git/                    # Shared git directory
├── .trees/                  # All worktrees (add to .gitignore)
│   ├── feature-auth/        # Agent 1 workspace
│   ├── feature-api/         # Agent 2 workspace
│   └── bugfix-header/       # Agent 3 workspace
└── src/                     # Main working directory (human)
```

**Important**: Add `.trees/` to `.gitignore` to prevent tracking worktree directories.

### Why Worktrees Over Clones?

| Aspect | Worktrees | Multiple Clones |
|--------|-----------|-----------------|
| Disk space | Shared `.git` objects | Duplicated per clone |
| Branch sync | Automatic | Manual fetch/pull |
| Creation speed | Instant | Slow (full clone) |
| Object integrity | Single source | Potential divergence |

---

## Open Source Implementations

### Tier 1: Full-Featured Orchestrators

#### Superset
- **Repository**: https://github.com/superset-sh/superset
- **License**: Apache 2.0
- **Features**:
  - Run 10+ parallel agents simultaneously
  - Worktree isolation per task
  - Built-in diff viewer
  - Agent monitoring dashboard
  - Universal CLI agent compatibility (Claude Code, Codex, Aider, etc.)
  - Zero telemetry, no API proxying
- **Quick Start**:
  ```bash
  # Installation
  npm install -g superset-cli

  # Start with a task
  superset run "implement user authentication"
  ```

#### Composio Agent Orchestrator
- **Repository**: https://github.com/ComposioHQ/agent-orchestrator
- **License**: MIT
- **Features**:
  - 30+ concurrent agents across 40 worktrees
  - Auto-handles CI failures, merge conflicts, code reviews
  - Agent-agnostic (Claude Code, Codex, Aider)
  - Runtime-agnostic (tmux, Docker)
  - Tracker-agnostic (GitHub, Linear)
  - AI orchestrator agent (not just a dashboard)
- **Quick Start**:
  ```bash
  # Fastest way to start
  ao start https://github.com/your-org/your-repo

  # This will:
  # - Clone the repo
  # - Auto-detect language, package manager, SCM
  # - Generate agent-orchestrator.yaml
  # - Start dashboard at localhost:3000
  ```
- **Configuration Example**:
  ```yaml
  # agent-orchestrator.yaml
  reactions:
    ci-failed:
      auto: true
      action: send-to-agent
      retries: 2

    review-comments:
      auto: true
      action: send-to-agent

    merge-conflict:
      auto: false
      action: notify-human
  ```

#### CCSwarm
- **Repository**: https://github.com/nwiizo/ccswarm
- **Features**:
  - Multi-agent orchestration using Claude Code
  - Git worktree isolation
  - Specialized AI agents for collaborative development

### Tier 2: Specialized Tools

#### Clash (Conflict Detection)
- **Repository**: https://github.com/clash-sh/clash
- **Purpose**: Avoid merge conflicts across git worktrees
- **Use Case**: Run before merging to identify potential conflicts early
- **Commands**:
  ```bash
  clash detect           # Scan worktrees for conflicts
  clash status           # Show worktree status
  ```

#### Emdash
- **Info**: https://firethering.com/emdash-ai-coding-agents/
- **Features**:
  - Open-source agentic IDE
  - Isolated git worktrees
  - GitHub integration
  - Visual diff tools
  - Support for multiple agent CLIs

#### Vibe Kanban
- **Info**: https://app.daily.dev/posts/complete-guide-to-vibe-kanban-for-managing-multiple-ai-coding-agents-simultaneously-git-worktree-ba-wtqoa9med
- **Features**:
  - Kanban board interface for agent management
  - Git worktree-based isolation
  - Visual diff tools for code review

---

## Checkpointing & Rollback Strategies

### Strategy 1: Auto-Commit as Checkpoint (Aider Pattern)

Aider pioneered treating every AI change as a git commit, enabling easy rollback.

#### How It Works

```bash
# Aider automatically commits each change
# Commits are marked with (aider) in author metadata

# Rollback last change
/undo  # Performs: git reset HEAD^

# Rollback multiple changes
/undo 3  # Reset last 3 commits
```

#### Configuration Flags

```bash
aider \
  --auto-commits \                          # Enable auto-commit (default: true)
  --attribute-commit-message-author \       # Prefix messages with 'aider:'
  --attribute-co-authored-by                # Add Co-authored-by trailer
```

#### Commit Message Format

```
aider: Add user authentication endpoint

Co-authored-by: aider (GPT-4) <noreply@aider.chat>
```

#### Benefits

- Full git history of all AI changes
- Easy to cherry-pick, revert, or bisect
- Human-readable audit trail
- Works with existing git workflows

### Strategy 2: Agent State Versioning (AgentGit)

AgentGit brings git-like semantics to **agent internal state**, not just code changes.

#### Repository
- **GitHub**: https://github.com/HKU-MAS-Infra-Layer/Agent-Git
- **Paper**: https://arxiv.org/abs/2511.00628

#### Core Concepts

| Concept | Description |
|---------|-------------|
| **State Commit** | Snapshot of agent state (context, tool usage, history) |
| **State Revert** | Rollback to any previous checkpoint |
| **Branching** | Explore multiple solution trajectories in parallel |
| **External Session** | Logical container holding multiple Internal Sessions |
| **Internal Session** | Single agent instance with rollback ability |

#### What Gets Checkpointed

- Session/conversation history
- Tool invocation records
- Environment variables
- Intermediate reasoning processes
- Current execution state

#### Python API

```python
from agent_git import RollbackAgent, ExternalSession

# Create a session
session = ExternalSession.create()

# Create agent with auto-checkpointing
agent = RollbackAgent(
    external_session_id=session.id,
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[calculate_sum, fetch_data],
    auto_checkpoint=True  # Checkpoint after critical operations
)

# Manual checkpoint
agent.commit("Before risky operation")

# Execute task
result = agent.run("Analyze the dataset")

# Rollback if needed
agent.revert(checkpoint_id="abc123")

# Branch for exploration
branch_a = agent.branch("Try approach A")
branch_b = agent.branch("Try approach B")
```

#### Benefits

- Reduces redundant computation (no re-execution from scratch)
- Fine-grained error recovery
- Deterministic replay for debugging
- Safe experimentation with branching

### Strategy 3: Entire.io — Production-Ready Checkpoint System

Entire.io provides a **complete, production-ready checkpoint solution** that we can leverage directly rather than building from scratch.

#### Repository & License
- **GitHub**: https://github.com/entireio/cli (MIT License, 3.7k stars)
- **Docs**: https://docs.entire.io

#### Architecture Overview

Entire uses a **dual-branch approach** that keeps your code history clean:

```
main                           # Clean code commits only (your work)
├── feature/auth               # Feature branches (untouched by Entire)
│
├── entire/<sessionID>-<worktreeID>   # Shadow branches (temporary, local-only)
│   └── [mid-session checkpoints]     # For rewind during active sessions
│
└── entire/checkpoints/v1      # Checkpoint metadata branch (synced to remote)
    └── sharded-json/          # Session & checkpoint JSON files
        ├── a3/b2c4d5e6f7.json
        └── ...
```

**Key insight**: Entire never creates commits on your active branch — all metadata lives separately.

#### What Gets Captured Per Checkpoint

| Data | Description |
|------|-------------|
| 12-char hex ID | Unique checkpoint identifier (e.g., `a3b2c4d5e6f7`) |
| Session transcripts | Full conversation history (prompts + responses) |
| Tool calls | Every tool invocation with arguments |
| File modifications | Which files changed, with diffs |
| Token metrics | Input, output, cache reads, cache writes, API calls |
| Line attribution | % of code written by AI vs human |
| Timestamps | Session start, end, duration |
| Agent identity | Which AI agent (Claude, Gemini, etc.) |

#### Checkpoint Types

1. **Temporary checkpoints** — Stored on shadow branches during active sessions
   - Enable mid-session rewind (`entire rewind --list`)
   - Never pushed to remote
   - Cleaned up after session ends

2. **Committed checkpoints** — Attached to git commits via trailers
   - Format: `Entire-Checkpoint: a3b2c4d5e6f7`
   - Permanently stored on `entire/checkpoints/v1` branch
   - Synced to GitHub for team visibility

#### Session-Checkpoint Relationships

Entire handles complex real-world patterns:

| Pattern | Description |
|---------|-------------|
| 1:1 | One session → one commit (most common) |
| 1:many | Multiple sessions → one squashed commit |
| many:1 | One long session → multiple commits |
| many:many | Parallel sessions with concurrent commits |

Entire automatically matches checkpoints to sessions across multiple terminals.

#### CLI Commands for Checkpoints

```bash
# Enable Entire in a repo (installs git hooks)
entire enable --agent claude

# View checkpoint status
entire status --detailed

# List checkpoints in current session
entire rewind --list

# Rewind to specific checkpoint
entire rewind --to a3b2c4d5e6f7

# Rewind but only restore logs (not files)
entire rewind --to a3b2c4d5e6f7 --logs-only

# Resume a session from a branch
entire resume feature/auth

# Get AI explanation of a checkpoint
entire explain --checkpoint a3b2c4d5e6f7

# Clean up orphaned data
entire clean --dry-run
```

#### Integration with AI Agents

Entire **automatically detects** supported agents and begins capturing:
- ✅ Claude Code (fully supported)
- ✅ Gemini CLI (fully supported)
- ✅ OpenCode (supported)
- 🔜 Cursor (preview)
- 🔜 GitHub Copilot CLI (preview)
- 🔜 Factory Droid (preview)

Integration works via **git hooks**, not programmatic APIs:
1. `entire enable` installs pre-commit and post-commit hooks
2. Hooks detect active AI agent sessions
3. Checkpoints created automatically on commit
4. No code changes required in agents

#### Limitations & Considerations

| Aspect | Details |
|--------|---------|
| **No public API** | CLI-only; OpenAPI spec is placeholder |
| **Git-commit triggered** | Checkpoints only on commits, not arbitrary saves |
| **Rewind discards changes** | `entire rewind` does `git reset --hard` |
| **Agent detection** | Works via process detection, not hooks we control |
| **Local-first** | Shadow branches stay local; only checkpoint branch syncs |

#### Recommendation: Leverage Entire for Checkpointing

**For ACC (Agent Command Center), we should:**

1. **Use Entire as the checkpoint backend** — Don't reinvent the wheel
   - Install Entire in managed worktrees automatically
   - Let it handle all checkpoint capture and storage
   - Surface checkpoint data in our UI via CLI parsing

2. **Build a thin integration layer:**
   ```typescript
   class EntireCheckpointAdapter {
     // Parse `entire status --detailed` output
     async getCheckpoints(worktreePath: string): Promise<Checkpoint[]>

     // Execute `entire rewind --to <id>`
     async rewind(worktreePath: string, checkpointId: string): Promise<void>

     // Execute `entire rewind --list`
     async listRewindPoints(worktreePath: string): Promise<RewindPoint[]>

     // Parse checkpoint metadata from entire/checkpoints/v1 branch
     async getCheckpointMetadata(checkpointId: string): Promise<CheckpointMeta>
   }
   ```

3. **Extend for our needs:**
   - Add real-time checkpoint notifications (watch git hooks)
   - Build checkpoint diff viewer in ACC UI
   - Add checkpoint comparison across agents
   - Implement "branch from checkpoint" for exploration

4. **Fallback for unsupported agents:**
   - If agent isn't detected by Entire, use our own auto-commit pattern
   - Mirror Aider's approach: `git commit -m "checkpoint: <description>"`

#### Benefits of Using Entire

| Benefit | Impact |
|---------|--------|
| **Battle-tested** | 3.7k stars, active development, MIT license |
| **Rich metadata** | Token usage, line attribution, full transcripts |
| **Clean git history** | No checkpoint commits in your branches |
| **Team visibility** | Checkpoints sync to GitHub, visible in PRs |
| **Multi-agent support** | Already handles Claude, Gemini, etc. |
| **Nested sessions** | Captures sub-agent hierarchies automatically |

---

## Container-Based Isolation

### When to Use Containers vs Worktrees

| Use Case | Worktrees | Containers |
|----------|-----------|------------|
| Simple file isolation | ✅ Preferred | Overkill |
| Different dependencies per task | ❌ Shared env | ✅ Isolated envs |
| Untrusted code execution | ⚠️ Limited safety | ✅ Sandboxed |
| Complex tech stacks | ❌ Manual setup | ✅ Reproducible |
| Cloud scaling | ❌ Local only | ✅ Scalable |

### OpenHands (formerly OpenDevin)

- **Repository**: https://github.com/OpenHands/OpenHands

#### Architecture

```
┌─────────────────────────────────────────┐
│              Agent Runtime              │
├─────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────────┐ │
│  │  Workspace  │    │  Action/Observe │ │
│  │   Manager   │    │     Handler     │ │
│  └─────────────┘    └─────────────────┘ │
├─────────────────────────────────────────┤
│           Docker Container              │
│  - cap-drop ALL                         │
│  - no-new-privileges                    │
│  - Isolated filesystem                  │
└─────────────────────────────────────────┘
```

#### Workspace Types

1. **LocalWorkspace**: Direct filesystem access (fast prototyping)
2. **RemoteWorkspace**: HTTP delegation to containerized Agent Server

#### Security Configuration

```python
# OpenHands sandbox configuration
sandbox_config = {
    "cap_drop": ["ALL"],
    "security_opt": ["no-new-privileges"],
    "network_mode": "none",  # Optional: full isolation
    "read_only": False,      # Allow writes to workspace
}
```

### Cursor Background Agents

Cursor's cloud-based approach:

1. Spawns container in cloud
2. Pulls from GitHub repository
3. Executes agent tasks in isolation
4. Reports results back to local IDE

### Hybrid Approach

Combine worktrees with containers:

```bash
# Each worktree runs in its own container
docker run -v $(pwd)/../feature-auth:/workspace agent-image

# Benefits:
# - Branch isolation (worktrees)
# - Environment isolation (containers)
# - Scalable to cloud
```

---

## Merge Conflicts: Reality Check

### Why Worktrees Don't Eliminate Conflicts

Worktrees provide **runtime isolation** (agents can't step on each other's files during work), but they don't prevent **merge-time conflicts** (incompatible changes when combining branches).

```
Time 0:  main has config.ts
         │
         ├── Agent 1 (worktree A): Adds AUTH_SECRET to config.ts
         │
         └── Agent 2 (worktree B): Adds API_KEY to config.ts

Time 1:  Both agents finish — no problems, they worked in isolation

Time 2:  Merge time → CONFLICT (both modified same lines in config.ts)
```

### Conflict Scenarios by Likelihood

| Scenario | Likelihood | Auto-Resolvable? | Example |
|----------|------------|------------------|---------|
| **Shared config files** | HIGH | Usually yes | Both add to `package.json` dependencies |
| **Import blocks** | Medium | Yes | Both add imports to same file |
| **Same file, different sections** | Medium | Yes (git handles) | Agent 1 edits line 10, Agent 2 edits line 100 |
| **Same file, same lines** | Low* | No | Both modify the same function |
| **Lock files** | HIGH | Regenerate | `package-lock.json`, `bun.lockb` |
| **Structural refactoring** | Low | No | Agent 1 renames file Agent 2 depends on |

*Low if tasks are properly scoped

### When NOT to Worry

**Most parallel agent work won't conflict** if tasks are naturally isolated:

```
Agent 1: src/features/auth/*      → No overlap
Agent 2: src/features/billing/*   → No overlap
Agent 3: src/features/dashboard/* → No overlap
```

**New files never conflict:**
```
Agent 1: Creates src/auth/login.ts     → Can't conflict
Agent 2: Creates src/api/users.ts      → Can't conflict
```

### Realistic Expectations

| Outcome | Expected % | Action |
|---------|------------|--------|
| Clean merge (no conflicts) | **80%** | Just merge |
| Auto-resolvable conflicts | **15%** | Keep both additions |
| Manual intervention needed | **5%** | Human reviews |

### Our Approach: Simple First

Given the low conflict rate with well-scoped tasks, we'll implement conflict handling **incrementally**:

#### MVP (Phase 1): Just Merge
- Sequential merge (one branch at a time)
- If conflict → surface to user with diff view
- User resolves manually or discards

#### Later (Phase 2+): Smart Detection
- Track which files each agent modifies in real-time
- Warn if two agents touch same file
- Auto-resolve trivial cases (both added imports, both added deps)

### Simple Merge Flow (What We're Building)

```typescript
class SimpleMergeFlow {
  async merge(consolesToMerge: AgentConsole[], targetBranch: string) {
    // Checkout target
    await git.checkout(targetBranch);

    // Merge one by one
    for (const console of consolesToMerge) {
      try {
        await git.merge(console.branchName);
        console.status = 'merged';
      } catch (error) {
        if (isConflictError(error)) {
          // Surface conflict to user — they decide what to do
          return {
            status: 'conflict',
            conflictingBranch: console.branchName,
            conflictedFiles: await git.getConflictedFiles()
          };
        }
        throw error;
      }
    }

    return { status: 'success' };
  }
}
```

**We're NOT building (yet):**
- ❌ Clash integration
- ❌ AI-assisted resolution
- ❌ File locking
- ❌ Real-time conflict detection

These can come later if conflicts prove to be a real problem in practice.

### Conflict Resolution Checklist

```markdown
- [ ] Identify which files have conflicts
- [ ] Categorize conflict type:
  - [ ] Additive (both added) → Usually auto-mergeable
  - [ ] Modificative (both changed same lines) → Needs review
  - [ ] Structural (refactoring conflicts) → Manual resolution
- [ ] For additive: Use AI to combine
- [ ] For modificative: Review intent, pick winner or combine
- [ ] For structural: Manual merge, consider re-doing one branch
- [ ] Run tests after resolution
- [ ] Commit resolution with clear message
```

---

## Multi-Agent Orchestration Patterns

### Pattern 1: Team Lead + Teammates (Claude Code)

```
┌─────────────────────────────────────────┐
│           Team Lead Agent               │
│  - Analyzes overall task                │
│  - Breaks into subtasks                 │
│  - Assigns to teammates                 │
│  - Reviews and integrates               │
└─────────────────┬───────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
    ▼             ▼             ▼
┌───────┐    ┌───────┐    ┌───────┐
│Agent 1│    │Agent 2│    │Agent 3│
│Auth   │    │API    │    │UI     │
│Branch │    │Branch │    │Branch │
└───────┘    └───────┘    └───────┘
```

#### Claude Code Implementation

```bash
# Using /batch for parallel execution
claude /batch "migrate src/ from Solid to React"

# Each subtask gets:
# - Own worktree
# - Own branch
# - Own PR
```

### Pattern 2: AI Orchestrator (Composio)

The orchestrator itself is an AI agent that:

```python
class OrchestratorAgent:
    def run(self):
        # 1. Analyze codebase and backlog
        tasks = self.analyze_backlog()

        # 2. Decompose into parallelizable tasks
        subtasks = self.decompose(tasks)

        # 3. Assign to coding agents
        for subtask in subtasks:
            agent = self.spawn_agent(subtask)
            agent.assign_worktree()
            agent.start()

        # 4. Monitor progress
        while self.agents_running():
            self.check_ci_status()
            self.handle_failures()
            self.review_prs()

        # 5. Escalate only when needed
        if self.needs_human_judgment():
            self.notify_human()
```

### Pattern 3: Three-Role Architecture

```
┌────────────────┐
│  Coordinator   │  Plans, distributes, integrates
└───────┬────────┘
        │
        ├──────────────┬──────────────┐
        ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  Specialist  │ │  Specialist  │ │  Specialist  │
│   (Execute)  │ │   (Execute)  │ │   (Execute)  │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
       └────────────────┴────────────────┘
                        │
                        ▼
               ┌──────────────┐
               │   Verifier   │  Validates, tests, approves
               └──────────────┘
```

### Orchestration Configuration Example

```yaml
# multi-agent-config.yaml
orchestrator:
  type: ai-agent
  model: claude-3-opus

agents:
  - name: auth-specialist
    model: claude-3-sonnet
    scope: src/auth/**
    worktree: .trees/auth

  - name: api-specialist
    model: claude-3-sonnet
    scope: src/api/**
    worktree: .trees/api

  - name: ui-specialist
    model: claude-3-sonnet
    scope: src/components/**
    worktree: .trees/ui

verifier:
  type: ai-agent
  model: claude-3-opus
  checks:
    - run_tests
    - lint
    - type_check

workflow:
  on_ci_failure:
    retries: 2
    action: send_to_agent

  on_review_comment:
    action: send_to_agent

  on_merge_conflict:
    action: notify_human
```

---

## ACC Agent Console Launch & Merge Flow

> **This section describes the primary user-facing workflow for ACC**: launching agent consoles that work on features in isolated worktrees, and merging their work back together.

### User Journey Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AGENT COMMAND CENTER                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐      │
│  │ + New Agent │   │  Agent 1    │   │  Agent 2    │   │  Agent 3    │      │
│  │   Console   │   │  Auth 🟢    │   │  API 🟡     │   │  UI 🔵      │      │
│  └─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘      │
│                           │                │                │                │
│                           ▼                ▼                ▼                │
│                    ┌──────────────────────────────────────────────┐         │
│                    │              Merge Dashboard                 │         │
│                    │  ┌─────────┐ ┌─────────┐ ┌─────────┐        │         │
│                    │  │ Auth ✓  │ │ API ... │ │ UI ✓    │        │         │
│                    │  │ Ready   │ │ Running │ │ Ready   │        │         │
│                    │  └─────────┘ └─────────┘ └─────────┘        │         │
│                    │                                              │         │
│                    │  [Check Conflicts] [Merge to Main] [Create PR]│        │
│                    └──────────────────────────────────────────────┘         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase A: Launching Agent Consoles

#### A1. User Interface for Launch

```typescript
interface LaunchAgentOptions {
  // Task definition
  task: string;                    // What the agent should do
  taskTitle?: string;              // Short name for UI (e.g., "Auth Feature")

  // Isolation settings
  branchName?: string;             // Auto-generated if not provided
  baseBranch?: string;             // Default: current branch or 'main'

  // Agent configuration
  agentType?: 'claude' | 'gemini'; // Which AI agent to use
  maxTurns?: number;               // Cost control
  autoCommit?: boolean;            // Commit on completion (default: true)

  // Entire.io integration
  enableCheckpoints?: boolean;     // Default: true
}

// Example: User clicks "+ New Agent Console" button
const agentConsole = await acc.launchAgent({
  task: "Implement user authentication with JWT tokens",
  taskTitle: "Auth Feature",
  branchName: "feature/auth",
  baseBranch: "main",
  agentType: "claude",
  enableCheckpoints: true
});
```

#### A2. What Happens Behind the Scenes

```typescript
class AgentConsoleLauncher {
  async launch(options: LaunchAgentOptions): Promise<AgentConsole> {
    // 1. Create isolated worktree
    const branchName = options.branchName || this.generateBranchName(options.taskTitle);
    const worktreePath = await this.worktreeManager.create(branchName, options.baseBranch);

    // 2. Initialize Entire.io for checkpointing
    if (options.enableCheckpoints) {
      const entire = new EntireIntegration(worktreePath);
      await entire.setup(options.agentType || 'claude');
    }

    // 3. Create PTY terminal in the worktree
    const terminal = await this.terminalManager.create({
      name: options.taskTitle || branchName,
      cwd: worktreePath,
      env: {
        ...process.env,
        ACC_AGENT_TASK: options.task,
        ACC_BRANCH: branchName,
        ACC_WORKTREE: worktreePath
      }
    });

    // 4. Launch the AI agent in the terminal
    const agentCommand = this.buildAgentCommand(options);
    terminal.sendText(agentCommand);

    // 5. Create and return AgentConsole wrapper
    const console = new AgentConsole({
      id: generateId(),
      terminal,
      worktreePath,
      branchName,
      task: options.task,
      status: 'running',
      entire: options.enableCheckpoints ? new EntireIntegration(worktreePath) : null
    });

    // 6. Register in ACC state
    this.activeConsoles.set(console.id, console);
    this.emitEvent('agent:launched', console);

    return console;
  }

  private buildAgentCommand(options: LaunchAgentOptions): string {
    const agent = options.agentType || 'claude';

    if (agent === 'claude') {
      return `claude -p "${options.task}" --output-format stream-json`;
    } else if (agent === 'gemini') {
      return `gemini "${options.task}"`;
    }
    // ... other agents
  }
}
```

#### A3. Agent Console UI Component

```typescript
interface AgentConsoleProps {
  console: AgentConsole;
  onClose: () => void;
  onMerge: () => void;
}

function AgentConsoleWidget({ console }: AgentConsoleProps) {
  return (
    <div className="agent-console">
      {/* Header */}
      <header className="console-header">
        <StatusIndicator status={console.status} />
        <h3>{console.taskTitle}</h3>
        <span className="branch-name">{console.branchName}</span>

        <div className="actions">
          <Button onClick={() => console.pause()}>Pause</Button>
          <Button onClick={() => console.showCheckpoints()}>Checkpoints</Button>
          <Button onClick={() => console.viewDiff()}>View Changes</Button>
          <Button onClick={() => openMergeFlow(console)} disabled={console.status !== 'completed'}>
            Merge
          </Button>
        </div>
      </header>

      {/* Agent output (existing AgentConsole component) */}
      <AgentOutputView console={console} />

      {/* Real terminal for manual intervention */}
      <TerminalView terminal={console.terminal} collapsible />

      {/* Footer with stats */}
      <footer className="console-footer">
        <span>Tokens: {console.tokenUsage.toLocaleString()}</span>
        <span>Checkpoints: {console.checkpointCount}</span>
        <span>Files changed: {console.filesChanged}</span>
      </footer>
    </div>
  );
}
```

### Phase B: Monitoring & Managing Running Agents

#### B1. Agent Status States

```typescript
type AgentStatus =
  | 'initializing'    // Worktree being created, Entire being set up
  | 'running'         // Agent actively working
  | 'waiting_input'   // Agent waiting for user response
  | 'paused'          // User paused the agent
  | 'completed'       // Agent finished successfully
  | 'failed'          // Agent encountered error
  | 'ready_to_merge'; // Completed and changes committed

interface AgentConsoleState {
  id: string;
  status: AgentStatus;

  // Task info
  task: string;
  taskTitle: string;
  startedAt: Date;
  completedAt?: Date;

  // Git state
  branchName: string;
  baseBranch: string;
  worktreePath: string;
  commitCount: number;
  filesChanged: string[];

  // Checkpoint info (from Entire)
  checkpoints: Checkpoint[];
  currentCheckpoint?: string;

  // Metrics
  tokenUsage: TokenMetrics;
  duration: number;

  // Conflict detection
  potentialConflicts?: ConflictCheck;
}
```

#### B2. Real-time Updates via Events

```typescript
// WebSocket events from backend
type AgentEvent =
  | { type: 'agent:output', consoleId: string, data: string }
  | { type: 'agent:status_change', consoleId: string, status: AgentStatus }
  | { type: 'agent:checkpoint', consoleId: string, checkpoint: Checkpoint }
  | { type: 'agent:file_changed', consoleId: string, file: string }
  | { type: 'agent:commit', consoleId: string, commit: CommitInfo }
  | { type: 'agent:conflict_detected', consoleId: string, conflicts: ConflictInfo[] }
  | { type: 'agent:completed', consoleId: string, summary: AgentSummary }
  | { type: 'agent:failed', consoleId: string, error: string };

// Frontend subscription
function useAgentConsole(consoleId: string) {
  const [state, setState] = useState<AgentConsoleState>();

  useEffect(() => {
    const unsubscribe = acc.subscribe(`agent:${consoleId}`, (event) => {
      switch (event.type) {
        case 'agent:status_change':
          setState(prev => ({ ...prev, status: event.status }));
          break;
        case 'agent:checkpoint':
          setState(prev => ({
            ...prev,
            checkpoints: [...prev.checkpoints, event.checkpoint]
          }));
          break;
        // ... handle other events
      }
    });

    return unsubscribe;
  }, [consoleId]);

  return state;
}
```

### Phase C: Merge Flow

#### C1. Pre-Merge Conflict Detection

Before merging, ACC checks for potential conflicts across all active agents:

```typescript
class MergeFlowManager {
  async checkConflicts(consoleIds: string[]): Promise<ConflictReport> {
    const consoles = consoleIds.map(id => this.getConsole(id));

    // 1. Get changed files from each branch
    const changesByConsole = await Promise.all(
      consoles.map(async (c) => ({
        consoleId: c.id,
        branch: c.branchName,
        changedFiles: await this.git.getChangedFiles(c.worktreePath)
      }))
    );

    // 2. Find overlapping files
    const fileMap = new Map<string, string[]>();
    for (const { consoleId, changedFiles } of changesByConsole) {
      for (const file of changedFiles) {
        const existing = fileMap.get(file) || [];
        fileMap.set(file, [...existing, consoleId]);
      }
    }

    // 3. Check for actual conflicts (not just same file)
    const conflicts: ConflictInfo[] = [];
    for (const [file, consoleIds] of fileMap) {
      if (consoleIds.length > 1) {
        // Multiple agents touched this file - check for real conflict
        const conflictDetails = await this.checkFileConflict(file, consoleIds);
        if (conflictDetails.hasConflict) {
          conflicts.push(conflictDetails);
        }
      }
    }

    // 4. Run Clash for deep analysis (if available)
    if (this.clashAvailable) {
      const clashReport = await this.runClash(consoles.map(c => c.worktreePath));
      conflicts.push(...clashReport.conflicts);
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflicts,
      safeToMerge: conflicts.every(c => c.autoResolvable),
      recommendation: this.generateRecommendation(conflicts)
    };
  }
}
```

#### C2. Merge Dashboard UI

```typescript
function MergeDashboard() {
  const consoles = useAgentConsoles();
  const readyToMerge = consoles.filter(c => c.status === 'ready_to_merge');
  const [conflictReport, setConflictReport] = useState<ConflictReport>();
  const [mergeOrder, setMergeOrder] = useState<string[]>([]);

  // Check conflicts when selection changes
  useEffect(() => {
    if (readyToMerge.length > 1) {
      checkConflicts(readyToMerge.map(c => c.id)).then(setConflictReport);
    }
  }, [readyToMerge]);

  return (
    <div className="merge-dashboard">
      <h2>Merge Dashboard</h2>

      {/* Agent cards */}
      <div className="agent-grid">
        {consoles.map(console => (
          <AgentCard
            key={console.id}
            console={console}
            selected={mergeOrder.includes(console.id)}
            onSelect={() => toggleMergeSelection(console.id)}
          />
        ))}
      </div>

      {/* Conflict warnings */}
      {conflictReport?.hasConflicts && (
        <ConflictWarning report={conflictReport} />
      )}

      {/* Merge order (drag to reorder) */}
      <MergeOrderList
        order={mergeOrder}
        onReorder={setMergeOrder}
      />

      {/* Actions */}
      <div className="actions">
        <Button onClick={() => previewMerge(mergeOrder)}>
          Preview Merge
        </Button>
        <Button
          variant="primary"
          onClick={() => executeMerge(mergeOrder)}
          disabled={conflictReport?.hasConflicts && !conflictReport.safeToMerge}
        >
          Merge to {targetBranch}
        </Button>
        <Button onClick={() => createPullRequests(mergeOrder)}>
          Create PRs Instead
        </Button>
      </div>
    </div>
  );
}
```

#### C3. Merge Execution Strategies

```typescript
type MergeStrategy =
  | 'sequential'      // Merge one by one, rebasing each on updated base
  | 'octopus'         // Git octopus merge (all at once, fails on conflict)
  | 'individual_prs'  // Create separate PRs for each
  | 'stacked_prs';    // Create stacked/dependent PRs

class MergeExecutor {
  async executeMerge(
    consoleIds: string[],
    strategy: MergeStrategy,
    targetBranch: string
  ): Promise<MergeResult> {

    switch (strategy) {
      case 'sequential':
        return this.sequentialMerge(consoleIds, targetBranch);

      case 'octopus':
        return this.octopusMerge(consoleIds, targetBranch);

      case 'individual_prs':
        return this.createIndividualPRs(consoleIds, targetBranch);

      case 'stacked_prs':
        return this.createStackedPRs(consoleIds, targetBranch);
    }
  }

  private async sequentialMerge(
    consoleIds: string[],
    targetBranch: string
  ): Promise<MergeResult> {
    const results: BranchMergeResult[] = [];

    // Checkout target branch
    await this.git.checkout(targetBranch);

    for (const consoleId of consoleIds) {
      const console = this.getConsole(consoleId);

      try {
        // Merge this branch
        await this.git.merge(console.branchName, {
          message: `Merge ${console.taskTitle} (${console.branchName})`
        });

        results.push({
          consoleId,
          branch: console.branchName,
          success: true
        });

        // Clean up worktree
        await this.worktreeManager.remove(console.branchName);

      } catch (error) {
        if (this.isConflictError(error)) {
          // Pause and let user resolve
          return {
            status: 'conflict',
            conflictingBranch: console.branchName,
            completedMerges: results,
            pendingMerges: consoleIds.slice(consoleIds.indexOf(consoleId))
          };
        }
        throw error;
      }
    }

    return {
      status: 'success',
      completedMerges: results,
      finalCommit: await this.git.getCurrentCommit()
    };
  }

  private async createIndividualPRs(
    consoleIds: string[],
    targetBranch: string
  ): Promise<MergeResult> {
    const prs: PullRequest[] = [];

    for (const consoleId of consoleIds) {
      const console = this.getConsole(consoleId);

      // Push branch to remote
      await this.git.push(console.branchName);

      // Create PR using gh CLI or GitHub API
      const pr = await this.github.createPR({
        head: console.branchName,
        base: targetBranch,
        title: console.taskTitle,
        body: this.generatePRBody(console)
      });

      prs.push(pr);
    }

    return {
      status: 'prs_created',
      pullRequests: prs
    };
  }

  private generatePRBody(console: AgentConsole): string {
    return `
## Summary

${console.task}

## Changes

${console.filesChanged.map(f => `- \`${f}\``).join('\n')}

## Agent Session

- **Agent**: ${console.agentType}
- **Duration**: ${formatDuration(console.duration)}
- **Tokens used**: ${console.tokenUsage.total.toLocaleString()}
- **Checkpoints**: ${console.checkpoints.length}

${console.entire ? `[View full session on Entire.io](https://entire.io/checkpoint/${console.checkpoints[0]?.id})` : ''}

---
🤖 Generated by Agent Command Center
    `.trim();
  }
}
```

#### C4. Post-Merge Cleanup

```typescript
class PostMergeCleanup {
  async cleanup(consoleIds: string[], options: CleanupOptions): Promise<void> {
    for (const consoleId of consoleIds) {
      const console = this.getConsole(consoleId);

      // 1. Remove worktree
      await this.worktreeManager.remove(console.branchName);

      // 2. Clean up Entire data (optional)
      if (options.cleanEntireData && console.entire) {
        await console.entire.cleanup();
      }

      // 3. Delete local branch (if merged)
      if (options.deleteLocalBranch) {
        await this.git.deleteBranch(console.branchName);
      }

      // 4. Delete remote branch (if PR merged)
      if (options.deleteRemoteBranch) {
        await this.git.deleteRemoteBranch(console.branchName);
      }

      // 5. Archive console state (for history)
      await this.archiveConsole(console);

      // 6. Remove from active consoles
      this.activeConsoles.delete(consoleId);
    }

    this.emitEvent('merge:cleanup_complete', { consoleIds });
  }
}
```

### Implementation Plan: MVP First

We're building incrementally, starting with the core flow and adding complexity only as needed.

#### MVP Scope (What We're Building First)

| Feature | In MVP? | Notes |
|---------|---------|-------|
| Create worktree for agent | ✅ Yes | Core isolation |
| Launch Claude in worktree terminal | ✅ Yes | Core feature |
| Track agent status | ✅ Yes | Running/completed/failed |
| View agent output | ✅ Yes | Existing terminal widget |
| Simple sequential merge | ✅ Yes | One branch at a time |
| Conflict → show to user | ✅ Yes | User resolves manually |
| Worktree cleanup | ✅ Yes | Remove after merge |
| Entire.io checkpoints | ⏳ Phase 2 | Nice to have |
| Real-time conflict detection | ❌ Later | Only if needed |
| AI conflict resolution | ❌ Later | Only if needed |
| Clash integration | ❌ Later | Only if needed |

#### MVP Timeline

| Phase | Duration | What We Build |
|-------|----------|---------------|
| **1** | 3-4 days | `WorktreeManager` — create/list/remove worktrees |
| **2** | 3-4 days | `AgentConsoleLauncher` — spawn agent in worktree terminal |
| **3** | 2-3 days | Agent status tracking & UI updates |
| **4** | 2-3 days | Simple merge flow + cleanup |

**Total MVP: ~2 weeks**

#### Post-MVP (If Needed)

| Feature | When to Add |
|---------|-------------|
| Entire.io integration | When we want checkpoints/rollback |
| Conflict detection | If conflicts become common |
| PR creation flow | When teams want code review |
| Parallel agent comparison | When running multiple agents on same task |

### Commands to Add

```typescript
const agentCommands = [
  // Launch
  { id: 'launch-agent', label: 'Launch New Agent Console', shortcut: 'Cmd+Shift+A' },
  { id: 'launch-agent-from-task', label: 'Launch Agent for Task...', shortcut: 'Cmd+Shift+T' },

  // Monitor
  { id: 'show-all-agents', label: 'Show All Agent Consoles', shortcut: 'Cmd+Shift+G' },
  { id: 'focus-agent', label: 'Focus Agent Console...', shortcut: 'Cmd+G' },
  { id: 'pause-agent', label: 'Pause Current Agent', shortcut: 'Cmd+Shift+P' },
  { id: 'resume-agent', label: 'Resume Paused Agent' },

  // Checkpoints
  { id: 'show-checkpoints', label: 'Show Agent Checkpoints', shortcut: 'Cmd+Shift+C' },
  { id: 'rewind-to-checkpoint', label: 'Rewind to Checkpoint...' },

  // Merge
  { id: 'open-merge-dashboard', label: 'Open Merge Dashboard', shortcut: 'Cmd+Shift+M' },
  { id: 'check-conflicts', label: 'Check for Conflicts' },
  { id: 'merge-agent-to-main', label: 'Merge Agent to Main...' },
  { id: 'create-pr-from-agent', label: 'Create PR from Agent...' },

  // Cleanup
  { id: 'cleanup-agent', label: 'Cleanup Agent Console...' },
  { id: 'cleanup-all-merged', label: 'Cleanup All Merged Agents' },
];
```

---

## Headless/CI Mode Patterns

### Claude Code Headless Execution

```bash
# Basic headless execution
claude -p "fix the bug in auth.ts" --output-format json

# Full automation (skip permission prompts)
claude -p "implement feature X" --dangerously-skip-permissions

# Limit iterations for cost control
claude -p "refactor module Y" --max-turns 10

# Stream output in JSON
claude -p "task" --output-format stream-json
```

### Integration with CI/CD

```yaml
# .github/workflows/ai-fix.yml
name: AI Auto-Fix

on:
  push:
    branches: [main]

jobs:
  auto-fix:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run AI Fix
        run: |
          claude -p "Fix any linting errors" \
            --dangerously-skip-permissions \
            --max-turns 5

      - name: Create PR if changes
        run: |
          if [ -n "$(git status --porcelain)" ]; then
            git checkout -b ai-fix-$(date +%s)
            git add .
            git commit -m "AI: Auto-fix linting errors"
            gh pr create --title "AI Auto-Fix" --body "Automated fixes"
          fi
```

### Aider Headless Mode

```bash
# Run aider non-interactively
aider --yes --message "Add error handling to api.py"

# With specific model
aider --yes --model gpt-4 --message "Refactor database module"
```

---

## Implementation Recommendations

### Phase 1: Basic Worktree Support

```python
# Minimal worktree manager
class WorktreeManager:
    def __init__(self, repo_path: str):
        self.repo_path = repo_path
        self.trees_dir = os.path.join(repo_path, ".trees")

    def create(self, branch_name: str) -> str:
        """Create a new worktree for a branch."""
        worktree_path = os.path.join(self.trees_dir, branch_name)
        subprocess.run([
            "git", "worktree", "add",
            "-b", branch_name,
            worktree_path
        ], cwd=self.repo_path)
        return worktree_path

    def remove(self, branch_name: str):
        """Remove a worktree."""
        worktree_path = os.path.join(self.trees_dir, branch_name)
        subprocess.run([
            "git", "worktree", "remove", worktree_path
        ], cwd=self.repo_path)

    def list(self) -> List[str]:
        """List all worktrees."""
        result = subprocess.run(
            ["git", "worktree", "list", "--porcelain"],
            cwd=self.repo_path,
            capture_output=True,
            text=True
        )
        return self._parse_worktree_list(result.stdout)
```

### Phase 2: Entire.io Integration (Replaces Custom Checkpointing)

Instead of building custom checkpointing, we integrate Entire.io:

```python
class EntireIntegration:
    """Manages Entire.io setup and checkpoint access for worktrees."""

    def __init__(self, worktree_path: str):
        self.worktree_path = worktree_path

    async def setup(self, agent: str = "claude") -> bool:
        """Initialize Entire in a worktree. Call once after worktree creation."""
        result = await self._run_entire(["enable", "--agent", agent])
        return result.returncode == 0

    async def get_checkpoints(self) -> List[Checkpoint]:
        """Get all checkpoints in current session."""
        result = await self._run_entire(["rewind", "--list"])
        return self._parse_checkpoint_list(result.stdout)

    async def rewind(self, checkpoint_id: str, logs_only: bool = False) -> bool:
        """Rewind to a specific checkpoint."""
        args = ["rewind", "--to", checkpoint_id]
        if logs_only:
            args.append("--logs-only")
        result = await self._run_entire(args)
        return result.returncode == 0

    async def get_session_metadata(self, checkpoint_id: str) -> SessionMeta:
        """Get rich metadata from checkpoint (tokens, attribution, transcript)."""
        # Read directly from entire/checkpoints/v1 branch
        return await self._read_checkpoint_json(checkpoint_id)

    async def explain(self, checkpoint_id: str) -> str:
        """Get AI-generated explanation of what happened at checkpoint."""
        result = await self._run_entire(["explain", "--checkpoint", checkpoint_id])
        return result.stdout

    async def resume_session(self, branch: str) -> bool:
        """Resume an agent session from a branch."""
        result = await self._run_entire(["resume", branch])
        return result.returncode == 0

    async def cleanup(self) -> None:
        """Clean up orphaned session data."""
        await self._run_entire(["clean"])

    async def _run_entire(self, args: List[str]) -> subprocess.CompletedProcess:
        return await asyncio.create_subprocess_exec(
            "entire", *args,
            cwd=self.worktree_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

    async def _read_checkpoint_json(self, checkpoint_id: str) -> SessionMeta:
        """Read checkpoint metadata directly from git branch."""
        # Checkpoints stored in sharded format: a3/b2c4d5e6f7.json
        shard = checkpoint_id[:2]
        filename = f"{checkpoint_id}.json"
        result = await asyncio.create_subprocess_exec(
            "git", "show", f"entire/checkpoints/v1:{shard}/{filename}",
            cwd=self.worktree_path,
            stdout=asyncio.subprocess.PIPE
        )
        stdout, _ = await result.communicate()
        return SessionMeta.parse(json.loads(stdout))
```

**What we get for free from Entire:**
- ✅ Automatic checkpoint creation on commits
- ✅ Full session transcripts (prompts + responses)
- ✅ Token usage tracking (input, output, cache)
- ✅ Line attribution (AI vs human)
- ✅ Nested sub-agent session capture
- ✅ Clean git history (no checkpoint commits)
- ✅ GitHub sync for team visibility
- ✅ AI-powered checkpoint explanations
```

### Phase 3: Multi-Agent Orchestration (With Entire Integration)

```python
class AgentOrchestrator:
    """Orchestrates multiple AI agents with worktree isolation and Entire checkpointing."""

    def __init__(self, repo_path: str):
        self.repo_path = repo_path
        self.worktree_mgr = WorktreeManager(repo_path)
        self.agents: Dict[str, ManagedAgent] = {}

    async def spawn_agent(self, task: Task) -> ManagedAgent:
        """Spawn a new agent with isolated worktree + Entire checkpointing."""
        # 1. Create worktree
        worktree_path = self.worktree_mgr.create(task.branch_name)

        # 2. Initialize Entire in the worktree (automatic checkpoint capture)
        entire = EntireIntegration(worktree_path)
        await entire.setup(agent="claude")

        # 3. Create managed agent
        agent = ManagedAgent(
            worktree_path=worktree_path,
            task=task,
            entire=entire  # Entire handles all checkpointing
        )

        self.agents[task.id] = agent
        return agent

    async def run_parallel(self, tasks: List[Task]) -> List[AgentResult]:
        """Run multiple agents in parallel with full checkpoint tracking."""
        # Spawn all agents
        agents = await asyncio.gather(*[
            self.spawn_agent(task) for task in tasks
        ])

        # Execute in parallel
        results = await asyncio.gather(*[
            agent.execute() for agent in agents
        ], return_exceptions=True)

        # Collect checkpoint summaries for each agent
        for agent, result in zip(agents, results):
            if isinstance(result, Exception):
                # On failure, we can rewind or inspect checkpoints
                checkpoints = await agent.entire.get_checkpoints()
                result = AgentResult(
                    task_id=agent.task.id,
                    success=False,
                    error=str(result),
                    checkpoints=checkpoints,  # Full history available
                    can_resume=True  # Can resume from any checkpoint
                )

        return results

    async def compare_agents(self, task_ids: List[str]) -> ComparisonReport:
        """Compare checkpoint data across multiple agents (token usage, etc.)."""
        reports = []
        for task_id in task_ids:
            agent = self.agents[task_id]
            checkpoints = await agent.entire.get_checkpoints()
            for cp in checkpoints:
                meta = await agent.entire.get_session_metadata(cp.id)
                reports.append({
                    "task_id": task_id,
                    "checkpoint": cp.id,
                    "tokens": meta.token_usage,
                    "ai_lines": meta.ai_line_count,
                    "human_lines": meta.human_line_count,
                    "duration": meta.duration_seconds
                })
        return ComparisonReport(reports)

    async def cleanup_all(self):
        """Clean up all worktrees and Entire data."""
        for agent in self.agents.values():
            await agent.entire.cleanup()
            self.worktree_mgr.remove(agent.task.branch_name)
        self.agents.clear()
```

### Updated Implementation Timeline (Leveraging Entire.io)

| Phase | Duration | Focus | What We Build | What Entire Provides |
|-------|----------|-------|---------------|---------------------|
| **1** | Week 1-2 | Worktree basics | `WorktreeManager` | - |
| **2** | Week 3 | Entire integration | `EntireIntegration` adapter | Checkpoints, transcripts, tokens |
| **3** | Week 4 | Checkpoint UI | Checkpoint list, diff viewer | Data via CLI/branch parsing |
| **4** | Week 5-6 | Parallel agents | `AgentOrchestrator` | Per-agent checkpoint isolation |
| **5** | Week 7-8 | Conflict detection | Clash integration | - |
| **6** | Week 9-10 | Advanced features | Resume, compare, branch-from-checkpoint | Session resume, explanations |

**Time saved: ~4 weeks** (originally 12 weeks → now 10 weeks, with richer features)

### Additional Features Enabled by Entire.io

Beyond basic checkpointing, Entire.io enables several advanced features we'd otherwise have to build:

#### 1. Cost Tracking & Analytics
```typescript
// Entire captures token usage per checkpoint
interface TokenMetrics {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  api_calls: number;
}

// We can aggregate across agents for cost dashboards
async function getProjectCosts(worktrees: string[]): Promise<CostReport> {
  const costs = await Promise.all(
    worktrees.map(async (wt) => {
      const entire = new EntireIntegration(wt);
      const checkpoints = await entire.get_checkpoints();
      return checkpoints.map(cp => cp.token_usage);
    })
  );
  return aggregateCosts(costs.flat());
}
```

#### 2. AI Attribution & Code Ownership
```typescript
// Entire tracks which lines were written by AI vs human
interface LineAttribution {
  ai_lines: number;
  human_lines: number;
  ai_percentage: number;
}

// Surface in UI for code review insights
async function getAttributionReport(checkpointId: string): Promise<Attribution> {
  const meta = await entire.get_session_metadata(checkpointId);
  return {
    aiWritten: meta.ai_line_count,
    humanWritten: meta.human_line_count,
    files: meta.file_attributions  // Per-file breakdown
  };
}
```

#### 3. Session Resume (Critical for Long Tasks)
```typescript
// Resume interrupted agent sessions exactly where they left off
async function resumeAgent(branch: string): Promise<void> {
  const entire = new EntireIntegration(worktreePath);

  // This restores:
  // - Conversation context
  // - Tool state
  // - Working directory state
  await entire.resume_session(branch);

  // Agent continues with full context preserved
}
```

#### 4. PR Context Links (GitHub Integration)
```markdown
<!-- Entire adds checkpoint IDs to commits -->
<!-- Reviewers can click through to see AI reasoning -->

Commit: "Add user authentication"
Entire-Checkpoint: a3b2c4d5e6f7

<!-- In PR, reviewer sees: -->
<!-- 🔗 View AI session context → entire.io/checkpoint/a3b2c4d5e6f7 -->
```

#### 5. Nested Sub-Agent Tracking
```typescript
// When Claude Code spawns sub-agents, Entire captures the hierarchy
interface SessionHierarchy {
  parent_session: string;
  child_sessions: SessionHierarchy[];
  depth: number;
}

// Visualize agent spawning patterns in ACC UI
async function getAgentTree(rootCheckpoint: string): Promise<SessionHierarchy> {
  const meta = await entire.get_session_metadata(rootCheckpoint);
  return meta.session_hierarchy;
}
```

#### 6. Checkpoint Comparison (A/B Testing Agents)
```typescript
// Compare two agent runs on the same task
async function compareRuns(
  checkpointA: string,
  checkpointB: string
): Promise<Comparison> {
  const [metaA, metaB] = await Promise.all([
    entire.get_session_metadata(checkpointA),
    entire.get_session_metadata(checkpointB)
  ]);

  return {
    tokenDiff: metaA.tokens - metaB.tokens,
    timeDiff: metaA.duration - metaB.duration,
    lineDiff: metaA.ai_lines - metaB.ai_lines,
    winner: determineWinner(metaA, metaB)
  };
}
```

### Key Metrics to Track

| Metric | Description | Target |
|--------|-------------|--------|
| Agent throughput | Tasks completed per hour | Baseline + 3x |
| Conflict rate | % of merges with conflicts | < 10% |
| Rollback frequency | Checkpoints restored per task | < 0.5 |
| Human intervention | % tasks needing human help | < 20% |

---

## API & Code Examples

### Complete Worktree Workflow (With Entire.io)

```bash
#!/bin/bash
# parallel-agents.sh - Run multiple agents in parallel with Entire checkpointing

REPO_PATH=$(pwd)
TREES_DIR="$REPO_PATH/.trees"

# Ensure .trees is gitignored
grep -q "^.trees/$" .gitignore 2>/dev/null || echo ".trees/" >> .gitignore

# Create worktree and initialize Entire
create_worktree() {
    local branch=$1
    local path="$TREES_DIR/$branch"

    # Create worktree
    git worktree add -b "$branch" "$path" 2>/dev/null || \
    git worktree add "$path" "$branch"

    # Initialize Entire for automatic checkpoint capture
    (cd "$path" && entire enable --agent claude --quiet)

    echo "$path"
}

# Run agent in worktree (Entire captures checkpoints automatically)
run_agent() {
    local worktree=$1
    local task=$2

    cd "$worktree"

    # Run Claude Code - Entire hooks capture everything automatically:
    # - Full conversation transcript
    # - Token usage metrics
    # - Line attribution (AI vs human)
    # - Checkpoint created on commit
    claude -p "$task" \
        --dangerously-skip-permissions \
        --max-turns 20 \
        --output-format json > agent-output.json

    # Commit triggers Entire checkpoint creation
    git add -A
    git commit -m "Agent: $task"

    # Checkpoint ID is now in commit trailer: Entire-Checkpoint: <id>
}

# View checkpoints for a worktree
list_checkpoints() {
    local worktree=$1
    (cd "$worktree" && entire rewind --list)
}

# Rewind agent work to a checkpoint
rewind_to_checkpoint() {
    local worktree=$1
    local checkpoint_id=$2
    (cd "$worktree" && entire rewind --to "$checkpoint_id")
}

# Get AI explanation of what happened
explain_checkpoint() {
    local worktree=$1
    local checkpoint_id=$2
    (cd "$worktree" && entire explain --checkpoint "$checkpoint_id")
}

# Main execution
main() {
    # Create worktrees
    AUTH_TREE=$(create_worktree "feature/auth")
    API_TREE=$(create_worktree "feature/api")
    UI_TREE=$(create_worktree "feature/ui")

    # Run agents in parallel
    run_agent "$AUTH_TREE" "Implement user authentication" &
    run_agent "$API_TREE" "Create REST API endpoints" &
    run_agent "$UI_TREE" "Build React components" &

    # Wait for all agents
    wait

    # Merge sequentially
    git checkout main
    git merge feature/auth
    git merge feature/api
    git merge feature/ui

    # Cleanup
    git worktree remove "$AUTH_TREE"
    git worktree remove "$API_TREE"
    git worktree remove "$UI_TREE"
}

main "$@"
```

### Python Agent Manager

```python
"""
agent_manager.py - Full-featured agent manager with worktrees
"""

import os
import subprocess
import json
from dataclasses import dataclass
from typing import List, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

@dataclass
class Task:
    id: str
    description: str
    branch_name: str
    scope: Optional[List[str]] = None  # File patterns this task can touch

@dataclass
class Checkpoint:
    id: str
    message: str
    timestamp: datetime
    commit_hash: str

@dataclass
class AgentResult:
    task_id: str
    success: bool
    output: str
    checkpoints: List[Checkpoint]
    branch_name: str

class GitWorktree:
    """Manages a single git worktree."""

    def __init__(self, path: str, branch: str):
        self.path = path
        self.branch = branch
        self.checkpoints: List[Checkpoint] = []

    def run_git(self, *args) -> str:
        result = subprocess.run(
            ["git"] + list(args),
            cwd=self.path,
            capture_output=True,
            text=True
        )
        if result.returncode != 0:
            raise Exception(f"Git error: {result.stderr}")
        return result.stdout.strip()

    def checkpoint(self, message: str) -> Checkpoint:
        """Create a checkpoint (commit current state)."""
        self.run_git("add", "-A")

        # Check if there are changes to commit
        status = self.run_git("status", "--porcelain")
        if not status:
            return None  # Nothing to commit

        self.run_git("commit", "-m", f"checkpoint: {message}")
        commit_hash = self.run_git("rev-parse", "HEAD")

        cp = Checkpoint(
            id=f"cp-{len(self.checkpoints)}",
            message=message,
            timestamp=datetime.now(),
            commit_hash=commit_hash
        )
        self.checkpoints.append(cp)
        return cp

    def rollback(self, checkpoint_id: str = None):
        """Rollback to a checkpoint or previous commit."""
        if checkpoint_id:
            cp = next((c for c in self.checkpoints if c.id == checkpoint_id), None)
            if cp:
                self.run_git("reset", "--hard", cp.commit_hash)
        else:
            self.run_git("reset", "--hard", "HEAD^")

    def get_diff(self) -> str:
        """Get current uncommitted changes."""
        return self.run_git("diff")

class AgentManager:
    """Orchestrates multiple agents with worktree isolation."""

    def __init__(self, repo_path: str):
        self.repo_path = os.path.abspath(repo_path)
        self.trees_dir = os.path.join(self.repo_path, ".trees")
        self.worktrees: dict[str, GitWorktree] = {}

        # Ensure trees directory exists
        os.makedirs(self.trees_dir, exist_ok=True)

        # Add to gitignore
        self._ensure_gitignore()

    def _ensure_gitignore(self):
        gitignore = os.path.join(self.repo_path, ".gitignore")
        entry = ".trees/"

        if os.path.exists(gitignore):
            with open(gitignore, "r") as f:
                if entry in f.read():
                    return

        with open(gitignore, "a") as f:
            f.write(f"\n{entry}\n")

    def _run_git(self, *args) -> str:
        result = subprocess.run(
            ["git"] + list(args),
            cwd=self.repo_path,
            capture_output=True,
            text=True
        )
        return result.stdout.strip()

    def create_worktree(self, branch_name: str) -> GitWorktree:
        """Create a new worktree for a branch."""
        worktree_path = os.path.join(self.trees_dir, branch_name.replace("/", "-"))

        # Check if branch exists
        branches = self._run_git("branch", "--list", branch_name)

        if branches:
            # Branch exists, just create worktree
            self._run_git("worktree", "add", worktree_path, branch_name)
        else:
            # Create new branch with worktree
            self._run_git("worktree", "add", "-b", branch_name, worktree_path)

        worktree = GitWorktree(worktree_path, branch_name)
        self.worktrees[branch_name] = worktree
        return worktree

    def remove_worktree(self, branch_name: str):
        """Remove a worktree."""
        if branch_name in self.worktrees:
            worktree = self.worktrees[branch_name]
            self._run_git("worktree", "remove", worktree.path, "--force")
            del self.worktrees[branch_name]

    def run_agent(self, task: Task, agent_command: str) -> AgentResult:
        """Run an agent on a task in an isolated worktree."""
        worktree = self.create_worktree(task.branch_name)

        try:
            # Create initial checkpoint
            worktree.checkpoint("Initial state")

            # Run the agent
            result = subprocess.run(
                agent_command.format(task=task.description),
                shell=True,
                cwd=worktree.path,
                capture_output=True,
                text=True
            )

            # Create final checkpoint
            worktree.checkpoint("Agent completed")

            return AgentResult(
                task_id=task.id,
                success=result.returncode == 0,
                output=result.stdout,
                checkpoints=worktree.checkpoints,
                branch_name=task.branch_name
            )
        except Exception as e:
            # Rollback on failure
            worktree.rollback()
            return AgentResult(
                task_id=task.id,
                success=False,
                output=str(e),
                checkpoints=worktree.checkpoints,
                branch_name=task.branch_name
            )

    def run_parallel(
        self,
        tasks: List[Task],
        agent_command: str = 'claude -p "{task}" --dangerously-skip-permissions'
    ) -> List[AgentResult]:
        """Run multiple agents in parallel."""
        results = []

        with ThreadPoolExecutor(max_workers=len(tasks)) as executor:
            futures = {
                executor.submit(self.run_agent, task, agent_command): task
                for task in tasks
            }

            for future in as_completed(futures):
                result = future.result()
                results.append(result)
                print(f"Task {result.task_id}: {'✓' if result.success else '✗'}")

        return results

    def merge_all(self, base_branch: str = "main") -> bool:
        """Merge all worktree branches into base branch."""
        self._run_git("checkout", base_branch)

        for branch_name in self.worktrees.keys():
            try:
                self._run_git("merge", branch_name, "--no-edit")
                print(f"Merged {branch_name}")
            except Exception as e:
                print(f"Conflict merging {branch_name}: {e}")
                return False

        return True

    def cleanup(self):
        """Remove all worktrees."""
        for branch_name in list(self.worktrees.keys()):
            self.remove_worktree(branch_name)


# Example usage
if __name__ == "__main__":
    manager = AgentManager("/path/to/repo")

    tasks = [
        Task(id="1", description="Add user login", branch_name="feature/login"),
        Task(id="2", description="Create API routes", branch_name="feature/api"),
        Task(id="3", description="Build dashboard UI", branch_name="feature/dashboard"),
    ]

    results = manager.run_parallel(tasks)

    # Check results
    all_success = all(r.success for r in results)

    if all_success:
        manager.merge_all()

    manager.cleanup()
```

---

## Sources & References

### Primary Sources

- [Superset GitHub Repository](https://github.com/superset-sh/superset)
- [Composio Agent Orchestrator GitHub](https://github.com/ComposioHQ/agent-orchestrator)
- [AgentGit GitHub Repository](https://github.com/HKU-MAS-Infra-Layer/Agent-Git)
- [AgentGit Paper - arXiv](https://arxiv.org/abs/2511.00628)
- [Clash - Conflict Detection](https://github.com/clash-sh/clash)
- [OpenHands GitHub](https://github.com/OpenHands/OpenHands)
- [CCSwarm GitHub](https://github.com/nwiizo/ccswarm)
- [Entire CLI](https://github.com/entireio/cli)

### Articles & Guides

- [Git Worktrees: The Secret Weapon for Running Multiple AI Coding Agents in Parallel](https://medium.com/@mabd.dev/git-worktrees-the-secret-weapon-for-running-multiple-ai-coding-agents-in-parallel-e9046451eb96)
- [Running Multiple AI Coding Agents in Parallel](https://zenvanriel.com/ai-engineer-blog/running-multiple-ai-coding-agents-parallel/)
- [The Complete Guide to Running Parallel AI Coding Agents | Superset](https://superset.sh/blog/parallel-coding-agents-guide)
- [Open-Sourcing Agent Orchestrator - pkarnal.com](https://pkarnal.com/blog/open-sourcing-agent-orchestrator)
- [Running 20 AI Agents in Parallel From My Home Directory](https://pkarnal.com/blog/parallel-ai-agents)
- [Using Git Worktrees for Multi-Feature Development with AI Agents](https://www.nrmitchi.com/2025/10/using-git-worktrees-for-multi-feature-development-with-ai-agents/)
- [How Git Worktrees Changed My AI Agent Workflow - Nx Blog](https://nx.dev/blog/git-worktrees-ai-agents)
- [The Role of AI in Merge Conflict Resolution - Graphite](https://www.graphite.com/guides/ai-code-merge-conflict-resolution)
- [Parallelizing AI Coding Agents](https://ainativedev.io/news/how-to-parallelize-ai-coding-agents)
- [My LLM coding workflow going into 2026 - Addy Osmani](https://addyosmani.com/blog/ai-coding-workflow/)

### Documentation

- [Aider Git Integration](https://aider.chat/docs/git.html)
- [Cursor Parallel Agents Documentation](https://cursor.com/docs/configuration/worktrees)
- [Claude Code Sub-agents Documentation](https://code.claude.com/docs/en/sub-agents)
- [Replit Checkpoints and Rollbacks](https://docs.replit.com/replitai/checkpoints-and-rollbacks)

### Tools & IDEs

- [Superset IDE](https://byteiota.com/superset-ide-run-10-parallel-ai-coding-agents-2026/)
- [Emdash IDE](https://firethering.com/emdash-ai-coding-agents/)
- [Vibe Kanban Guide](https://app.daily.dev/posts/complete-guide-to-vibe-kanban-for-managing-multiple-ai-coding-agents-simultaneously-git-worktree-ba-wtqoa9med)
- [GitKraken Merge Tool](https://www.gitkraken.com/features/merge-conflict-resolution-tool)

---

## Appendix: Quick Reference

### Git Worktree Commands

```bash
# Create worktree with new branch
git worktree add -b <branch> <path>

# Create worktree for existing branch
git worktree add <path> <branch>

# List worktrees
git worktree list

# Remove worktree
git worktree remove <path>

# Prune stale references
git worktree prune
```

### Checkpoint Pattern (Aider-style)

```bash
# After each AI change
git add -A
git commit -m "aider: <description>"

# Rollback
git reset --hard HEAD^
```

### Conflict Detection

```bash
# Using Clash
clash detect --worktrees .trees/

# Manual check
for tree in .trees/*; do
  echo "=== $tree ==="
  git -C "$tree" diff --name-only main
done | sort | uniq -d  # Show files modified in multiple trees
```

### Sequential Merge Pattern

```bash
git checkout main
for branch in feature/auth feature/api feature/ui; do
  git merge $branch --no-edit
  # If conflict, resolve then continue
done
```
