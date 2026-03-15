# Orchestration Engine: Value Summary

> Why adopt T3 Code's event-sourcing patterns in Dispatch

## One-Line Value Prop

**Turn Dispatch from a task runner into a time-traveling, auditable, multi-agent orchestration platform.**

---

## The Core Insight

T3 Code treats coding agent sessions as **durable, replayable event streams** — not ephemeral process outputs. This unlocks capabilities that are impossible with "spawn process, parse stdout" approaches.

---

## What You Get

### 1. **Full Audit Trail** 📜

Every action is an event. Every event is persisted.

```
task.created → task.step.started → task.message.delta (x100) → 
task.tool.called → task.tool.completed → task.step.completed
```

**Value:** Debug any issue by looking at the event log. Compliance-ready. Explainable AI.

### 2. **Undo / Rollback** ⏪

Checkpoints are git-backed snapshots tied to each "turn."

**Value:** Made a mistake 3 steps ago? Revert the workspace and continue from there. No re-running the whole task.

### 3. **Survive Restarts** 🔄

Sessions are persisted, not in-memory only.

**Value:** Deploy a new version of Dispatch without killing active Claude Code sessions. Pick up where you left off.

### 4. **Multi-Agent Ready** 🤖🤖

Clean provider adapter interface abstracts Claude Code, OpenClaw, Codex, etc.

**Value:** Same orchestration layer, swap providers. Run heterogeneous agent teams.

### 5. **Real-Time Activity Feed** 📡

Structured events (not regex-parsed stdout) for tool calls, approvals, errors.

**Value:** Rich Gantt/timeline views. Know exactly what the agent is doing at any moment.

### 6. **Cost Tracking Built-In** 💰

Events carry usage/cost metadata.

**Value:** Per-task, per-step cost attribution. Know which tasks are burning tokens.

### 7. **Projections = Fast Queries** ⚡

Events are the source of truth, but reads hit denormalized tables.

**Value:** Dashboard queries are instant. Can rebuild projections if schema evolves.

---

## What Changes

| Before | After |
|--------|-------|
| Spawn process, parse stdout | Dispatch commands, receive events |
| State lives in memory | State lives in SQLite event store |
| Restart = lose everything | Restart = replay from checkpoint |
| One agent type (Claude Code) | Pluggable provider adapters |
| Manual cost tracking | Automatic from event metadata |
| Debug via logs | Debug via event replay |

---

## Effort vs. Payoff

| Phase | Effort | Unlocks |
|-------|--------|---------|
| Event Store | 3-4 days | Audit trail, replay, foundation for everything |
| Provider Abstraction | 2-3 days | Multi-agent support, cleaner architecture |
| Projections | 2-3 days | Fast queries, dashboard performance |
| Checkpoints | 3-4 days | Undo/rollback, workspace snapshots |
| **Total** | **~2-3 weeks** | Full orchestration platform |

---

## Strategic Value

1. **Differentiation** — Most agent tools are "run and pray." Dispatch becomes "run, observe, rewind, branch."

2. **Enterprise-Ready** — Audit trails and cost tracking are table stakes for enterprise adoption.

3. **Multi-Agent Future** — The provider abstraction means you're ready for whatever agent runtime wins (Claude Code, OpenClaw, Codex, custom).

4. **Debuggability** — When an agent does something weird, you can replay exactly what happened. Essential for building trust.

5. **Extensibility** — New features (branching, parallel tasks, approval workflows) become simple event type additions.

---

## TL;DR

Event sourcing transforms Dispatch from a subprocess wrapper into a **durable orchestration platform** with time-travel, multi-agent support, and full observability.

**The patterns are proven** (T3 Code ships them). **The effort is bounded** (~2-3 weeks). **The payoff is asymmetric** (enables features that would otherwise take months).
