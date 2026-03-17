# Multi-Agent IDE Research: Goals, Pain Points & Missing Features

> **Purpose**: Research document for building the next-generation multi-agent IDE/orchestration platform.
> **Last Updated**: 2026-03-17

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Main Goals](#main-goals)
3. [Critical Pain Points in 2026](#critical-pain-points-in-2026)
4. [Missing Features Analysis](#missing-features-analysis)
5. [Current Position Assessment](#current-position-assessment)
6. [Recommended Priority Stack](#recommended-priority-stack)
7. [Competitive Landscape](#competitive-landscape)
8. [Research Sources](#research-sources)
9. [Open Questions](#open-questions)

---

## Executive Summary

The agentic IDE market is undergoing its "microservices revolution" - moving from monolithic single-agent tools to orchestrated multi-agent systems. Key statistics:

- **40%** of enterprise apps will feature task-specific AI agents by 2026 (up from <5% in 2025)
- **1,445%** surge in multi-agent system inquiries (Q1 2024 → Q2 2025, Gartner)
- **40%+** of agentic AI projects projected to be cancelled by 2027 due to complexity
- **72%** of developers say vibe coding is NOT part of their professional work (Stack Overflow 2025)

**The core insight**: Most tools are still "spawn process, hope for the best." The market needs **orchestration platforms** that treat agents as durable distributed systems, not ephemeral chat sessions.

---

## Main Goals

### 1. From Task Runner → Orchestration Platform

Transform from "spawn process, parse stdout" to a **durable, replayable event-sourced system**:

| Capability | Current State | Target State |
|------------|--------------|--------------|
| State Management | Ephemeral sessions | Persistent, resumable |
| Debugging | Console logs | Time-travel replay |
| Audit | None | Full event history |
| Recovery | Start over | Checkpoint rollback |
| Multi-agent | One at a time | Parallel with coordination |

### 2. Smart Agent Routing

Assign tasks/steps to optimal agents based on capabilities:

```
┌─────────────────────────────────────────────────────────┐
│ Task: "Research competitors and update landing page"    │
├─────────────────────────────────────────────────────────┤
│ Step 1: Research competitors     → Web-enabled agent    │
│ Step 2: Analyze findings         → Analysis agent       │
│ Step 3: Update landing page      → Local FS agent       │
│ Step 4: Run tests                → CI/autonomous agent  │
└─────────────────────────────────────────────────────────┘
```

Key routing dimensions:
- **Web access** (browsing, search)
- **Filesystem access** (local, sandboxed, none)
- **Autonomy level** (supervised, semi-autonomous, fully autonomous)
- **Specialization** (coding, research, testing, deployment)
- **Cost tier** (fast/cheap vs slow/expensive)

### 3. Hierarchical Task Management

Three-tier information architecture:

```
┌─────────────────────────────────────────────────┐
│ TIER 1: Active Sessions                         │
│ What's running RIGHT NOW                        │
│ - Live agent executions                         │
│ - Real-time status, progress, activity          │
├─────────────────────────────────────────────────┤
│ TIER 2: Work Items                              │
│ Extracted actionable tasks                      │
│ - Pending / In Progress / Done / Blocked        │
│ - Source tracking (which conversation)          │
│ - Dependencies between items                    │
├─────────────────────────────────────────────────┤
│ TIER 3: Goals                                   │
│ Organizing containers                           │
│ - Group related work items                      │
│ - High-level project objectives                 │
│ - Auto-summarization                            │
└─────────────────────────────────────────────────┘
```

### 4. Full Observability

Developers need to SEE what agents are doing:

- **Activity Feed**: Real-time tool calls, file operations, thinking states
- **Cost Attribution**: Per-task, per-step token and dollar tracking
- **Diff Preview**: See file changes as they happen
- **Progress Indicators**: Steps completed, ETA, blocking issues

### 5. Human-in-the-Loop Controls

Balance automation with safety:

- **Permission callbacks**: Approve/deny individual tool uses
- **Approval gates**: Pause before destructive actions
- **Configurable autonomy**: Per-agent trust levels
- **Rollback controls**: One-click revert to any checkpoint

---

## Critical Pain Points in 2026

### 1. Context & Memory Loss

> *"Agents forgetting everything between sessions"*

**Symptoms**:
- Re-explaining project context every conversation
- No awareness of past decisions or patterns
- Sessions die with server restarts
- Can't continue conversations across days

**Impact**: Massive productivity loss, user frustration

**What good looks like**: Claude Agent SDK supports `resume` + `resumeSessionAt` for conversation continuity. Most tools don't use it.

---

### 2. Multi-Agent Coordination Chaos

> *"Git version control issues, depleting context windows faster, and response quality degradation when running subagents"*

**Symptoms**:
| Problem | Impact |
|---------|--------|
| No unified view of parallel work | Users blind to agent activity |
| Conflicting code modifications | Agents overwrite each other |
| No conflict resolution | Manual merge hell |
| Context window depletion | Quality degrades over time |
| Subagent cascading failures | One failure breaks everything |

**Impact**: Multi-agent work is unreliable and frustrating

---

### 3. Inconsistent Agent Communication

> *"Multi-agent workflows often fail because agents exchange messy language or inconsistent JSON"*

**Symptoms**:
- Field names change between agents
- Data types don't match expectations
- No schema enforcement
- Cascading failures from bad state propagation
- Silent data corruption

**Impact**: Workflows fail unpredictably, hard to debug

---

### 4. Skill Gap for Parallel Work

> *"Only senior+ engineers are using parallel agents successfully"*

**Symptoms**:
- Multi-agent orchestration requires tech-lead skills
- Most tools are "vibe-coded" and buggy
- Frameworks lack team collaboration features
- Documentation assumes expert knowledge

**Impact**: Technology inaccessible to most developers

---

### 5. Lack of Observability & Control

**Current state** (typical tool):
```
> Starting execution...
> Working...
> Done
```

**What's missing**:
- Real-time activity feeds
- Cost tracking per task/step
- Pause/resume/rollback controls
- Human-in-the-loop approval gates
- Structured event logs (not regex-parsed stdout)

**Impact**: Users feel out of control, can't debug issues

---

### 6. No Rollback / Undo

> *"Checkpoint systems enabling instant rewind when agents modify multiple files"*

**Symptoms**:
- Made a mistake 3 steps ago? Start over completely
- No git-backed snapshots tied to conversation turns
- Can't branch to explore alternatives
- Fear of letting agents run autonomously

**Impact**: Users don't trust agents with significant work

---

### 7. Pricing Chaos

> *"2025 saw pricing chaos with Cursor's usage-based shift, Claude Code's restrictive limits"*

**Symptoms**:
- Token costs are opaque
- Per-session vs per-prompt confusion
- Surprise bills from long-running agents
- Enterprise teams can't budget effectively
- No cost visibility during execution

**Impact**: Unpredictable costs limit adoption

---

### 8. Quality Degradation with AI

**From Google's 2025 DORA Report**:
- 90% AI adoption increase correlates with:
  - **9%** increase in bug rates
  - **91%** increase in code review time
  - **154%** increase in PR size

**Root cause**: "AI slop" - code that works but increases technical debt

**Impact**: Velocity gains offset by quality problems

---

## Missing Features Analysis

### Category 1: Session & State Management

| Feature | Description | Priority |
|---------|-------------|----------|
| **Persistent Sessions** | Survive server restarts, continue conversations | Critical |
| **Event Sourcing** | Full replay, audit, debugging capability | Critical |
| **Thread-Keyed Checkpoints** | Git snapshots tied to conversation turns | Critical |
| **Branching/Forking** | "What if I tried this approach instead?" | High |
| **Session Resume** | Continue from specific point in history | High |

### Category 2: Multi-Agent Orchestration

| Feature | Description | Priority |
|---------|-------------|----------|
| **Agent Capability Profiles** | Match tasks to agent strengths | Critical |
| **Per-Step Agent Assignment** | Route sub-tasks optimally | Critical |
| **Auto-Router** | AI suggests best agent per step | High |
| **Parallel Execution** | Run independent steps simultaneously | High |
| **Conflict Detection** | Identify overlapping modifications | High |
| **Coordinator/Specialist/Verifier** | Decompose → execute → verify pattern | Medium |
| **Agent Queue Management** | When busy, queue or suggest alternatives | Medium |

### Category 3: Observability

| Feature | Description | Priority |
|---------|-------------|----------|
| **Real-time Activity Feed** | Tool calls, file ops, thinking states | Critical |
| **Cost Attribution** | Per-task, per-step token/$ tracking | High |
| **Diff Preview** | See changes during execution | High |
| **Progress Indicators** | Steps completed, ETA | Medium |
| **Structured Logging** | Not regex-parsed stdout | Medium |

### Category 4: Human-in-the-Loop

| Feature | Description | Priority |
|---------|-------------|----------|
| **Permission Callbacks** | Approve/deny tool usage | Critical |
| **Approval Gates** | Pause before destructive actions | High |
| **Rollback Controls** | One-click revert to checkpoint | High |
| **Configurable Autonomy** | Per-agent trust settings | Medium |

### Category 5: Developer Experience

| Feature | Description | Priority |
|---------|-------------|----------|
| **Background Agents** | Queue tasks, return to review PRs | High |
| **Spec-Driven Development** | requirements.md, design.md as contracts | High |
| **Skills (Reusable Workflows)** | "Prompts for exploration, skills for repetition" | Medium |
| **MCP Integration** | Connect to external tools seamlessly | Medium |
| **Predictable Pricing UI** | Token usage per prompt, cost per session | Medium |

### Category 6: Team & Enterprise

| Feature | Description | Priority |
|---------|-------------|----------|
| **Multi-User Collaboration** | Shared sessions, handoffs | Medium |
| **Shared Agent Pools** | Team access to specialized agents | Medium |
| **Governance & Audit** | ISO/IEC 42001 compliance | Low (initially) |
| **Typed Schemas** | Schema enforcement for agent communication | Medium |

---

## Current Position Assessment

### What We're Building Right

| Capability | Status | Notes |
|------------|--------|-------|
| Event-sourcing architecture | Planned | ORCHESTRATION-MIGRATION-PLAN |
| Agent routing with capabilities | Designed | AGENT-ROUTING-SPEC |
| Three-tier task management | Designed | TASK-WIDGET-REDESIGN |
| Activity feed with events | Designed | EXECUTION-STATE-UI-SPEC |
| SDK integration | Identified | T3CODE-COMPARISON |
| Multi-provider adapters | In progress | OpenClaw, Claude Code |

### Gaps to Address

| Gap | Impact | Effort |
|-----|--------|--------|
| Session resume/restore | High | Medium |
| Checkpoint/rollback system | High | High |
| Parallel execution + conflict detection | High | High |
| Typed schemas for agent comms | Medium | Medium |
| Skills/reusable workflows | Medium | Medium |
| Background agents | High | Medium |
| Cost tracking UI | Medium | Low |
| Team features | Medium | High |

---

## Recommended Priority Stack

### Phase 1: Foundation (Critical)

**Timeline**: First

1. **Event store + projections**
   - Everything else depends on this
   - Enables replay, audit, time-travel

2. **Session persistence**
   - Survive restarts
   - Resume conversations

3. **Checkpoint service**
   - Git snapshots per turn
   - Enable rollback

### Phase 2: Orchestration

**Timeline**: After foundation

4. **Per-step agent routing**
   - Smart task distribution
   - Capability matching

5. **Activity feed UI**
   - Real-time observability
   - Tool calls, file ops, costs

6. **Parallel execution**
   - Independent step parallelization
   - Conflict detection

### Phase 3: Developer Experience

**Timeline**: After orchestration

7. **Background agents**
   - Queue tasks for later
   - Overnight execution

8. **Cost attribution UI**
   - Per-task tracking
   - Enterprise readiness

9. **Skills system**
   - Reusable workflows
   - Team sharing

### Phase 4: Enterprise

**Timeline**: After DX

10. **Multi-user support**
    - Team collaboration
    - Session sharing

11. **Typed agent communication**
    - Schema enforcement
    - Validation

12. **Governance/audit**
    - Compliance features
    - Access controls

---

## Competitive Landscape

### Current Players (2026)

| Tool | Approach | Strengths | Weaknesses |
|------|----------|-----------|------------|
| **Cursor** | Single-agent IDE | Individual velocity, polish | No multi-agent, single-user |
| **Windsurf** | Agentic IDE | Good UX, flows | Limited orchestration |
| **Intent** | Spec-driven multi-agent | Coordinator pattern, specs | Enterprise-focused |
| **Gas Town** | "K8s for agents" | Structured management | Vibe-coded, buggy |
| **Multiclaude** | Parallel Claude instances | Simple parallelism | No coordination |
| **Kiro** | Spec-driven | Requirements.md approach | New, unproven |
| **Warp 2.0** | Terminal-first | Team features | Terminal only |

### Differentiation Opportunities

1. **Event-sourced orchestration** - Few tools treat agents as durable systems
2. **Smart routing** - Most tools are single-agent or manual selection
3. **Checkpoint/rollback** - Major gap in current tools
4. **Three-tier task model** - Novel UX approach
5. **Multi-provider** - Not locked to one AI provider

---

## Research Sources

### Primary Sources

- [RedMonk: 10 Things Developers Want from Agentic IDEs (2025)](https://redmonk.com/kholterhoff/2025/12/22/10-things-developers-want-from-their-agentic-ides-in-2025/)
- [GitHub Blog: Multi-Agent Workflows Often Fail](https://github.blog/ai-and-ml/generative-ai/multi-agent-workflows-often-fail-heres-how-to-engineer-ones-that-dont/)
- [Deloitte: AI Agent Orchestration Predictions 2026](https://www.deloitte.com/us/en/insights/industry/technology/technology-media-and-telecom-predictions/2026/ai-agent-orchestration.html)
- [Anthropic: 2026 Agentic Coding Trends Report](https://resources.anthropic.com/hubfs/2026%20Agentic%20Coding%20Trends%20Report.pdf)

### Secondary Sources

- [Shipyard: Multi-Agent Orchestration for Claude Code](https://shipyard.build/blog/claude-code-multi-agent/)
- [Augment Code: Intent vs GitHub Copilot](https://www.augmentcode.com/tools/intent-vs-github-copilot)
- [DataCamp: Best Agentic IDEs in 2026](https://www.datacamp.com/blog/best-agentic-ide)
- [NxCode: Agentic Engineering Complete Guide](https://www.nxcode.io/resources/news/agentic-engineering-complete-guide-vibe-coding-ai-agents-2026)
- [Mike Mason: AI Coding Agents - Coherence Through Orchestration](https://mikemason.ca/writing/ai-coding-agents-jan-2026/)
- [DEV Community: How to Build Multi-Agent Systems Guide](https://dev.to/eira-wexford/how-to-build-multi-agent-systems-complete-2026-guide-1io6)
- [Augment Code: Best Agentic Development Environments](https://www.augmentcode.com/tools/best-agentic-development-environments)

### Internal References

- `docs/T3CODE-COMPARISON.md` - SDK comparison analysis
- `docs/AGENT-ROUTING-SPEC.md` - Agent routing design
- `docs/ORCHESTRATION-MIGRATION-PLAN.md` - Event sourcing plan
- `docs/TASK-WIDGET-REDESIGN.md` - Task management UX
- `docs/EXECUTION-STATE-UI-SPEC.md` - Activity feed design

---

## Open Questions

### Technical

- [ ] How do we handle conflict resolution when parallel agents modify the same file?
- [ ] What's the right granularity for checkpoints (per-turn vs per-tool-call)?
- [ ] How do we manage context windows across long-running multi-agent sessions?
- [ ] What schema format for typed agent-to-agent communication?

### Product

- [ ] Should we support "overnight" background agents? What's the UX?
- [ ] How do we make multi-agent accessible to non-senior developers?
- [ ] What's the right pricing model for multi-agent workloads?
- [ ] How do we balance autonomy with safety/control?

### Market

- [ ] Who are our primary users? Individual devs vs teams vs enterprises?
- [ ] What's the minimum viable orchestration feature set?
- [ ] How do we differentiate from Gas Town / Multiclaude?
- [ ] Should we build a VS Code extension or standalone app?

---

## Next Steps

1. [ ] Deep-dive on conflict resolution strategies
2. [ ] Prototype checkpoint/rollback system
3. [ ] Interview developers about multi-agent pain points
4. [ ] Analyze Intent's coordinator pattern in detail
5. [ ] Research MCP integration requirements
6. [ ] Define MVP feature set for launch

---

*Document maintained by: [Your Name]*
*Contributions welcome - add findings to relevant sections*
