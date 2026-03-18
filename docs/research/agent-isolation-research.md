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

### Strategy 3: Metadata Branch (Entire Pattern)

Store checkpoint metadata on a separate git branch, keeping code history clean.

#### Repository
- **GitHub**: https://github.com/entireio/cli

#### How It Works

```
main                    # Clean code commits only
├── feature/auth        # Feature work
└── entire/checkpoints/v1  # Agent session metadata (hidden)
    ├── session-001.json
    ├── session-002.json
    └── checkpoint-abc.json
```

#### Benefits

- Code commits stay clean and human-readable
- Full session context preserved separately
- Can rewind to any checkpoint
- Resume from any previous agent session exactly

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

## Merge Conflict Prevention & Resolution

### Prevention Strategies

#### 1. Task Planning (Most Important)

```yaml
# Good: Tasks touch different files
tasks:
  - agent: claude-1
    scope: src/auth/*

  - agent: claude-2
    scope: src/api/*

# Bad: Overlapping scope
tasks:
  - agent: claude-1
    scope: src/*  # Too broad

  - agent: claude-2
    scope: src/*  # Overlap!
```

#### 2. File Locking (Explicit)

```bash
# Simple lock file approach
echo "claude-1" > src/auth/login.ts.lock

# Before editing, check lock
if [ -f "src/auth/login.ts.lock" ]; then
    echo "File locked by another agent"
    exit 1
fi
```

#### 3. Early Detection with Clash

```bash
# Install Clash
npm install -g @clash-sh/cli

# Detect potential conflicts before they happen
clash detect --worktrees .trees/

# Output:
# ⚠️  Potential conflict detected:
#    .trees/feature-auth/src/config.ts (modified)
#    .trees/feature-api/src/config.ts (modified)
```

### Resolution Strategies

#### Sequential Merging (Recommended)

```bash
# 1. Merge first branch
git checkout main
git merge feature-auth

# 2. Rebase remaining branches on updated main
git checkout feature-api
git rebase main

# 3. Merge next branch
git checkout main
git merge feature-api

# Key: Each merge has full context of previous changes
```

#### AI-Assisted Resolution

For simple conflicts (both agents added to same list):

```bash
# Let AI resolve
claude -p "Resolve the merge conflict in src/routes.ts.
Both branches added new routes - combine them appropriately."
```

#### Tools for AI-Assisted Resolution

| Tool | Capability |
|------|------------|
| **GitKraken** | AI suggestions with explanations |
| **GitHub Copilot Pro+** | Automatic complex conflict resolution |
| **CodeGPT** | Context-aware resolution suggestions |

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

### Phase 2: Checkpointing

```python
class CheckpointManager:
    def __init__(self, worktree_path: str):
        self.worktree_path = worktree_path

    def create(self, message: str) -> str:
        """Create a checkpoint (commit)."""
        subprocess.run(["git", "add", "-A"], cwd=self.worktree_path)
        result = subprocess.run(
            ["git", "commit", "-m", f"checkpoint: {message}"],
            cwd=self.worktree_path,
            capture_output=True
        )
        return self._get_current_commit()

    def rollback(self, commit_id: str = "HEAD^"):
        """Rollback to a previous checkpoint."""
        subprocess.run(
            ["git", "reset", "--hard", commit_id],
            cwd=self.worktree_path
        )

    def list(self, limit: int = 10) -> List[dict]:
        """List recent checkpoints."""
        result = subprocess.run(
            ["git", "log", f"-{limit}", "--oneline"],
            cwd=self.worktree_path,
            capture_output=True,
            text=True
        )
        return self._parse_log(result.stdout)
```

### Phase 3: Multi-Agent Orchestration

```python
class AgentOrchestrator:
    def __init__(self, repo_path: str):
        self.worktree_mgr = WorktreeManager(repo_path)
        self.agents: Dict[str, Agent] = {}

    def spawn_agent(self, task: Task) -> Agent:
        """Spawn a new agent with isolated worktree."""
        # Create worktree
        worktree_path = self.worktree_mgr.create(task.branch_name)

        # Create agent
        agent = Agent(
            worktree_path=worktree_path,
            task=task,
            checkpoint_mgr=CheckpointManager(worktree_path)
        )

        self.agents[task.id] = agent
        return agent

    def run_parallel(self, tasks: List[Task]):
        """Run multiple agents in parallel."""
        with ThreadPoolExecutor() as executor:
            futures = {
                executor.submit(self._run_agent, task): task
                for task in tasks
            }

            for future in as_completed(futures):
                task = futures[future]
                try:
                    result = future.result()
                    self._handle_completion(task, result)
                except Exception as e:
                    self._handle_failure(task, e)

    def _run_agent(self, task: Task) -> Result:
        agent = self.spawn_agent(task)
        return agent.execute()
```

### Starting Small: Recommended Progression

1. **Week 1-2**: Implement basic worktree creation/deletion
2. **Week 3-4**: Add auto-commit checkpointing
3. **Week 5-6**: Add rollback functionality
4. **Week 7-8**: Implement parallel agent spawning
5. **Week 9-10**: Add conflict detection
6. **Week 11-12**: Build orchestration layer

### Key Metrics to Track

| Metric | Description | Target |
|--------|-------------|--------|
| Agent throughput | Tasks completed per hour | Baseline + 3x |
| Conflict rate | % of merges with conflicts | < 10% |
| Rollback frequency | Checkpoints restored per task | < 0.5 |
| Human intervention | % tasks needing human help | < 20% |

---

## API & Code Examples

### Complete Worktree Workflow

```bash
#!/bin/bash
# parallel-agents.sh - Run multiple agents in parallel

REPO_PATH=$(pwd)
TREES_DIR="$REPO_PATH/.trees"

# Ensure .trees is gitignored
echo ".trees/" >> .gitignore

# Create worktrees for each task
create_worktree() {
    local branch=$1
    local path="$TREES_DIR/$branch"

    git worktree add -b "$branch" "$path" 2>/dev/null || \
    git worktree add "$path" "$branch"

    echo "$path"
}

# Run agent in worktree
run_agent() {
    local worktree=$1
    local task=$2

    cd "$worktree"

    # Run Claude Code (or any agent)
    claude -p "$task" \
        --dangerously-skip-permissions \
        --max-turns 20 \
        --output-format json > agent-output.json

    # Auto-commit changes
    git add -A
    git commit -m "Agent: $task"
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
