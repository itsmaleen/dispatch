# Workspace Groups: Agent Console + Terminal + Browser Integration

> **Status**: Proposed
> **Created**: 2026-03-20
> **Author**: Marlin (via Molty)

---

## Executive Summary

Workspace Groups is a feature that surfaces the hidden orchestration of AI coding agents. Instead of Claude Code (or similar agents) managing terminals behind the scenes, Dispatch exposes this in the foreground where developers can **watch, steer, and verify** agent work in real-time.

**Core Insight**: The terminal is where you verify your code works. If you can't see it, you can't steer the agent. Current tools treat terminal management as an implementation detail. It should be the primary interface for human-agent collaboration.

---

## Problem Statement

### Current State: Blind Driving

When Claude Code runs a dev server, executes tests, or makes API calls:
1. Agent spawns terminals/processes internally
2. You see: "Running npm run dev..." → "Done ✓"
3. You don't see: The actual logs, errors, timing, expected behaviors

**Result**: You wait for the agent to finish, then discover it missed something obvious in the logs that you would have caught immediately.

### The Information Gap

| What the agent sees | What you see |
|---------------------|--------------|
| Full terminal output | "Running..." |
| Log patterns | Nothing |
| Error messages | Maybe, after the fact |
| Process state | Spinner |

### Real-World Pain

- Agent runs dev server, sees "listening on port 3000"
- You navigate to localhost:3000 → blank page
- Agent didn't notice the React error in console
- 10 minutes wasted because you couldn't see the obvious

---

## Proposed Solution: Workspace Groups

### Concept

A **Workspace Group** is a grouped view containing:
1. **Agent Console** - The agent's conversation/activity
2. **One or more Terminals** - Live terminal output (dev servers, logs, etc.)
3. **Optional Browser** - For web-based development workflows
4. **Goal Overlay** - What the agent is trying to achieve

### Visual Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ [Group: Feature X] [Goal: Get auth working]              [Tabs] │
├─────────────────────────────┬───────────────────────────────────┤
│                             │ Terminal: Backend (3001)          │
│   Agent Console             │ > Server listening on port 3001   │
│                             │ > [auth] POST /login 401 Unauth   │
│   "I'm checking the auth    │ > [auth] Invalid token format     │
│    middleware..."           │ > [auth] POST /login 200 OK       │
│                             ├───────────────────────────────────┤
│   [File change: auth.ts]    │ Terminal: Frontend (3000)         │
│                             │ > Compiled successfully!          │
│                             │ > Warning: useEffect deps...      │
└─────────────────────────────┴───────────────────────────────────┘
```

### Key Capabilities

#### 1. Real-Time Log Visibility
- See terminal output as it happens
- Agent AND human watch the same streams
- No more "I didn't notice that error"

#### 2. Expected Log Highlighting
- Agent declares: "Looking for 'Server ready on port 3000'"
- Terminal highlights when expected pattern appears (or doesn't)
- Deviation detection: "Expected X but got Y"

#### 3. Goal/Intent Visibility
- Hover or sidebar shows:
  - What the agent is trying to do
  - What success looks like
  - What it's watching for in the logs
- Alignment check for human and agent

#### 4. Steering Mid-Execution
- See something wrong → intervene immediately
- "Stop, the error says X, try Y instead"
- No waiting for agent to finish and fail

#### 5. Tabbed Group Views
- Multiple groups for different workflows
- Backend group, Frontend group, Integration group
- Switch context without losing state

---

## Research: Prior Art & Similar Approaches

### 1. Warp Terminal (warp.dev)

**What they do**:
- "Oz" agents can orchestrate multiple terminals
- AI integrated throughout terminal interface
- Reusable workflows saved in Warp Drive
- Full computer use capabilities

**Key insight from Warp**:
> "Oz agents can make complex, multi-repo changes. Ask agents to make cross-repo changes like client/server contracts or updating internal documentation."

**Gap**: Warp is terminal-first, not agent-console-first. You see terminals but agent reasoning is secondary.

### 2. tmux + Claude Code Pattern

The power-user workflow today:

```bash
# Split pane to monitor while Claude works
Ctrl+a |
tail -f logs/app.log

# Split another pane for dev server
Ctrl+a -
npm run dev

# Claude continues in main pane
# Manual coordination required
```

**Key insight from tmux users**:
> "tmux lets you split your window into multiple panes so you can run an agent, watch its logs, and monitor system resources simultaneously."

**Gap**: Manual setup, no integration between agent awareness and terminal views.

### 3. TmuxAI (github.com/alvinunreal/tmuxai)

**What they do**:
- AI that "observes" all visible tmux panes
- Dedicated chat pane for interaction
- Execution pane for commands (with permission)

**Key concept**:
> "Just as a colleague sitting next to you would observe your screen, understand context from what's visible, and help accordingly, TmuxAI observes: Reads the visible content in all your panes."

**Gap**: Bolt-on to tmux, not a first-class integrated experience.

### 4. Windsurf Cascade

**What they do**:
- Cascade can see terminal output and file edits
- "Leveraging information from terminal commands, file edits, and clipboard"
- Real-time diffs visible in editor panel

**Key insight from Windsurf**:
> "Visible — You can see what Cascade intends to do"

**Gap**: Still IDE-centric, terminal is secondary. No explicit grouping concept.

### 5. Coder Dev Containers

**What they do**:
- Dev containers appear as "sub-agents" with their own apps
- Visual representation of running environments
- Integrated visibility and control

**Key insight**:
> "Safely integrate any AI tool into your development workflow, on your infrastructure, without losing control, visibility, or adaptability."

**Gap**: Container-level, not terminal-level granularity.

### 6. VS Code Terminal + Tasks

**What they do**:
- Problem matcher patterns detect errors in terminal output
- Tasks can watch and respond to output
- Split terminal views

**Gap**: Not agent-aware, no goal/intent overlay.

---

## Key Differentiators for Dispatch

| Feature | tmux | Warp | Windsurf | **Dispatch Groups** |
|---------|------|------|----------|---------------------|
| Agent + Terminal unified | ❌ | Partial | Partial | ✅ |
| Goal/intent visibility | ❌ | ❌ | Partial | ✅ |
| Expected log patterns | ❌ | ❌ | ❌ | ✅ |
| Agent watches terminals | ❌ | ✅ | ✅ | ✅ |
| Human steers via logs | Manual | Partial | Partial | ✅ |
| Persistent groups | Session | Session | ❌ | ✅ |
| Browser integration | ❌ | ❌ | ✅ | ✅ |

---

## Implementation Plan

### Phase 1: Core Group Model (Foundation)

**Scope**: Data model and basic grouping

**Tasks**:
1. [ ] Define `WorkspaceGroup` schema
   ```typescript
   interface WorkspaceGroup {
     id: string;
     name: string;
     projectPath: string;
     goal?: string;           // What agent is trying to achieve
     expectedPatterns?: string[]; // Log patterns to watch for
     members: GroupMember[];
     layout: GroupLayout;
     createdAt: number;
     updatedAt: number;
   }
   
   type GroupMember = 
     | { type: 'agent-console'; adapterId: string }
     | { type: 'terminal'; terminalId: string; label?: string }
     | { type: 'browser'; url?: string };
   
   interface GroupLayout {
     preset: 'side-by-side' | 'stacked' | 'master-detail' | 'custom';
     splits?: SplitConfig[];
   }
   ```

2. [ ] Add `workspace_groups` table to database (migration)
3. [ ] Create `GroupStore` with CRUD operations
4. [ ] Add `/groups` REST API endpoints

**Deliverable**: Groups can be created, persisted, and retrieved

### Phase 2: Group UI Components

**Scope**: Visual rendering of groups

**Tasks**:
1. [ ] Create `<WorkspaceGroupView>` component
   - Renders members in configured layout
   - Handles resize between members
   
2. [ ] Create `<GroupHeader>` component
   - Group name, goal display
   - Tab strip for multiple groups
   - Quick actions (rename, add member, delete)
   
3. [ ] Create `<GroupMemberPanel>` component
   - Wrapper for agent console / terminal / browser
   - Member-specific controls
   
4. [ ] Implement layout presets
   - Side-by-side (50/50)
   - Master-detail (30/70)
   - Stacked (agent top, terminals bottom)

**Deliverable**: Groups render with configurable layouts

### Phase 3: Goal & Intent System

**Scope**: Agent declares what it's doing, UI surfaces it

**Tasks**:
1. [ ] Define goal/intent protocol
   ```typescript
   interface AgentIntent {
     goal: string;           // "Get authentication working"
     currentStep?: string;   // "Testing login endpoint"
     watching?: WatchPattern[];
   }
   
   interface WatchPattern {
     pattern: string | RegExp;
     terminal?: string;      // Which terminal to watch
     expectation: 'should-appear' | 'should-not-appear';
     description?: string;   // "Server should log 'listening'"
   }
   ```

2. [ ] Extend adapter protocol to emit intent updates
3. [ ] Create `<GoalOverlay>` component
   - Shows on hover or pinned
   - Lists current goal, step, watch patterns
   
4. [ ] Implement pattern matching in terminal streams
   - Highlight matching/missing patterns
   - Visual indicators (✓ appeared, ⚠️ missing, ✕ unexpected)

**Deliverable**: Agent goals visible, expected patterns highlighted

### Phase 4: Terminal Stream Integration

**Scope**: Terminals feed into group view, agent can watch

**Tasks**:
1. [ ] Extend terminal widget for group context
   - Pass output events to group coordinator
   - Receive highlight commands from pattern matcher
   
2. [ ] Create `TerminalStreamService`
   - Aggregates output from group terminals
   - Pattern matching against watch patterns
   - Emits match/mismatch events
   
3. [ ] Enable agent to subscribe to terminal streams
   - Adapter receives terminal output
   - Can react to patterns programmatically
   
4. [ ] Add log annotation UI
   - Click to highlight/annotate for agent
   - "Pay attention to this line"

**Deliverable**: Bidirectional awareness between agent and terminals

### Phase 5: Browser Integration

**Scope**: Browser panel in groups for web dev workflows

**Tasks**:
1. [ ] Create `<BrowserPanel>` component
   - Embedded webview or external browser connection
   - URL bar, navigation controls
   - DevTools console view (optional)
   
2. [ ] Define browser member type in groups
3. [ ] Optional: Screenshot/DOM capture for agent context
4. [ ] Optional: Browser automation hooks (click tracking, etc.)

**Deliverable**: Groups can include browser for full-stack visibility

### Phase 6: Group Templates & Presets

**Scope**: Quick-start group configurations

**Tasks**:
1. [ ] Define common group templates:
   - **Full-Stack Web**: Agent + Backend terminal + Frontend terminal + Browser
   - **API Dev**: Agent + Server terminal + Request log terminal
   - **Testing**: Agent + Test runner terminal + Coverage terminal
   - **Monorepo**: Agent + multiple package terminals
   
2. [ ] Create template selection UI
3. [ ] Auto-detect project type → suggest template
4. [ ] Save custom templates to workspace or user settings

**Deliverable**: One-click group setup for common workflows

---

## Success Metrics

1. **Time to Issue Detection**: How quickly do users catch problems vs baseline (agent-only)?
2. **Steering Frequency**: How often do users intervene mid-execution (indicates visibility value)?
3. **Session Completion Rate**: Do grouped sessions complete more successfully?
4. **User Preference**: Do users return to grouped view vs ungrouped?

---

## Open Questions

1. **Agent Protocol**: How do we standardize goal/intent emission across different agent adapters (Claude Code, OpenClaw, etc.)?

2. **Terminal Ownership**: Who "owns" terminals in a group - the agent or the user? Can both create/close?

3. **Pattern Language**: What's the right format for expected log patterns - regex, glob, natural language?

4. **Browser Security**: Embedded browser vs external browser connection - what are the tradeoffs?

5. **Performance**: With multiple terminals streaming + pattern matching, what's the performance impact?

6. **Mobile/Remote**: How do groups work when accessing Dispatch remotely or on smaller screens?

---

## Related Documents

- [WORKSPACE-SCOPED-DATA-PLAN.md](./WORKSPACE-SCOPED-DATA-PLAN.md) - Terminal scoping by workspace
- [TERMINAL-IMPLEMENTATION-PLAN.md](./TERMINAL-IMPLEMENTATION-PLAN.md) - Terminal widget details
- [MULTI-AGENT-IDE-RESEARCH.md](./MULTI-AGENT-IDE-RESEARCH.md) - Broader market research
- [UI-PLAN.md](./UI-PLAN.md) - Overall UI architecture
- [EXECUTION-STATE-UI-SPEC.md](./EXECUTION-STATE-UI-SPEC.md) - Activity feed design

---

## Appendix: Research Sources

### Primary References
- Warp Terminal: https://www.warp.dev/warp-ai
- TmuxAI: https://github.com/alvinunreal/tmuxai
- Claude Code + tmux patterns: https://www.blle.co/blog/claude-code-tmux-beautiful-terminal
- Windsurf Cascade: https://docs.windsurf.com/windsurf/cascade/cascade
- Coder Dev Containers: https://coder.com/docs/user-guides/devcontainers/

### Key Quotes

**On visibility** (Windsurf):
> "Visible — You can see what Cascade intends to do"

**On tmux workflow** (Agent Factory):
> "tmux lets you split your window into multiple panes so you can run an agent, watch its logs, and monitor system resources simultaneously"

**On agent observation** (TmuxAI):
> "Just as a colleague sitting next to you would observe your screen, understand context from what's visible, and help accordingly"

**On parallel visibility** (Warp):
> "Automate repetitive tasks, build on agents, and run them in parallel in the cloud"
