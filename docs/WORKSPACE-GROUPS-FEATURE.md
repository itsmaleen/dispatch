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

## Scaling Problem: From Groups to Canvas

### The Tile Explosion

Groups solve the immediate problem, but create a new one at scale:

| Scenario | Group Count | Tiles per Group | Total Tiles |
|----------|-------------|-----------------|-------------|
| Single feature | 1 | 3-4 | 3-4 |
| Two features | 2 | 3-4 | 6-8 |
| Full-stack + tests | 3 | 3-4 | 9-12 |
| Multi-project | 4+ | 3-4 | 16+ |

**Problem**: Traditional tiled layouts become unmanageable beyond ~8 tiles. You lose spatial awareness and spend more time navigating than working.

### Theo's Observation (The Agentic Code Problem)

From [Theo's tweet](https://x.com/theo/status/2018091358251372601):

> "Our projects are split BETWEEN apps, windows and tabs. There's no natural grouping! If I see some work finish in Claude Code for Project A, I have to go hunt for the right Chrome window/tab to see the results. If I want to check the code, I have to hop between multiple IDE windows trying to find it."

**Core insight**: The problem isn't just grouping — it's **spatial navigation** between groups.

### The Canvas Solution

Instead of tiled windows, treat groups as **nodes on an infinite canvas**:

```
┌──────────────────────────────────────────────────────────────────┐
│                     INFINITE CANVAS                              │
│                                                                  │
│    ┌─────────────┐                    ┌─────────────┐           │
│    │ Feature A   │                    │ Feature B   │           │
│    │ [Agent]     │                    │ [Agent]     │           │
│    │ [Terminal]  │←───────────────────│ [Terminal]  │           │
│    │ [Browser]   │    (relationship)  │ [Browser]   │           │
│    └─────────────┘                    └─────────────┘           │
│                                                                  │
│                        ┌─────────────┐                          │
│                        │ Integration │                          │
│                        │ [Agent]     │                          │
│                        │ [Terminal]  │                          │
│                        └─────────────┘                          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Reference**: Flora Fauna (florafauna.ai) does this for creative AI work:
> "Every text, image and video model on one infinite canvas... a node-based creative workspace"

---

## Canvas Navigation Research

### The "Buggy Canvas" Problem

Canvas UIs often feel:
- **Floaty/imprecise** - hard to land exactly where you want
- **Disorienting** - lose sense of where you are
- **Trackpad-dependent** - not keyboard-friendly
- **Slow** - panning/zooming to find things

### Navigation Patterns from Existing Tools

#### 1. Command Palette / Spotlight Search (Figma, Excalidraw)

**Pattern**: `Cmd+/` or `Cmd+Shift+P` → type name → jump to element

**Figma Spotlight Search plugin**:
> "Find and jump to any Page, Frame, Component, Layer... Use arrow keys and return to move inside the project without lifting your hands"

**Excalidraw**:
> "Cmd-/ or Ctrl-/ to open the command palette... quickly execute actions or find things"

**For Dispatch**: Jump to group by name, jump to specific terminal, jump to agent

#### 2. Named Frames / Bookmarks (Figma, Obsidian)

**Pattern**: Groups have names, can be bookmarked for quick access

**Obsidian feature request**:
> "Right click on a canvas group and select 'Bookmark'. When you click that bookmark, it opens the canvas and zooms to it."

**For Dispatch**: Bookmark active groups, recent groups list, pin important groups

#### 3. Zoom-to-Fit Shortcuts (Excalidraw, Figma)

**Pattern**: One key to zoom to show everything, one key to zoom to selection

**Excalidraw shortcuts**:
- `Shift+1` - Zoom to fit all elements
- `Shift+2` - Zoom to selection
- `Opt/Alt+Arrow` - Move around

**For Dispatch**: `Cmd+0` zoom to all groups, `Cmd+1-9` quick-switch to group N

#### 4. Minimap / Bird's Eye View (VS Code, Figma)

**Pattern**: Small overview in corner showing entire canvas with viewport indicator

**For Dispatch**: Minimap showing all groups as dots/thumbnails, click to jump

#### 5. Breadcrumbs / Context Trail

**Pattern**: Show path of where you've been, click to go back

**For Dispatch**: "Feature A > Terminal 1" breadcrumb, back/forward navigation

#### 6. Keyboard Spatial Navigation

**Pattern**: Arrow keys move between adjacent elements

**From WICG spatial-navigation spec**:
> "Directional focus navigation with arrow keys"

**For Dispatch**: Arrow keys move focus between groups, `Enter` to zoom into group

### Hybrid Approach: Canvas + Keyboard-First

**Don't force trackpad-only navigation.** Best canvas UIs support:

| Action | Trackpad | Keyboard |
|--------|----------|----------|
| Pan | Two-finger drag | Arrow keys / WASD |
| Zoom | Pinch | `+`/`-` or scroll |
| Jump to group | Click | `Cmd+K` → search |
| Switch groups | Click | `Cmd+1-9` or `Tab` |
| Zoom to fit | Double-tap | `Shift+1` |
| Back | — | `Cmd+[` |

---

## Expanded Implementation Plan

### Phase 7: View Mode Tabs (Grid ↔ Canvas)

**Scope**: Tabbed toggle between grid layout and canvas mode

**Tasks**:
1. [ ] Add view mode toggle UI
   - Tab bar or segmented control: `[Grid] [Canvas]`
   - Keyboard shortcut: `Cmd+Shift+V` to toggle
   - Persist preference per workspace
   
2. [ ] Define view mode state
   ```typescript
   type ViewMode = 'grid' | 'canvas';
   
   interface WorkspaceViewState {
     mode: ViewMode;
     gridLayout: GridLayout;      // existing tile arrangement
     canvasLayout: CanvasLayout;  // positions on infinite canvas
   }
   ```

3. [ ] Sync group state between modes
   - Same groups, different spatial representation
   - Adding group in grid → appears in canvas (auto-positioned)
   - Deleting group in canvas → removes from grid
   
4. [ ] Smart defaults
   - Start in grid mode (familiar)
   - Suggest canvas when >4 groups ("Switch to canvas for better overview?")

**Deliverable**: Users can toggle between grid tiles and infinite canvas

### Phase 8: Canvas Implementation

**Scope**: Infinite canvas layout for groups

**Tasks**:
1. [ ] Integrate canvas library (tldraw, react-flow, or custom)
   - tldraw: mature, good accessibility, MIT license
   - react-flow: node-graph focused, good for relationships
   
2. [ ] Define `CanvasGroup` node type
   ```typescript
   interface CanvasGroup {
     id: string;
     position: { x: number; y: number };
     size: { width: number; height: number };
     group: WorkspaceGroup;
     collapsed?: boolean;
   }
   ```

3. [ ] Implement zoom/pan controls
   - Trackpad gestures
   - Keyboard navigation (arrows, +/-, fit commands)
   
4. [ ] Group connections/relationships
   - Visual links between related groups
   - Dependency indicators

**Deliverable**: Groups can be arranged spatially on infinite canvas

### Phase 9: Canvas Navigation System

**Scope**: Fast, keyboard-friendly navigation

**Tasks**:
1. [ ] Command palette for groups (`Cmd+K`)
   - Search groups by name
   - Search terminals within groups
   - Recent groups section
   
2. [ ] Quick-switch shortcuts
   - `Cmd+1-9` jump to group N
   - `Tab` / `Shift+Tab` cycle groups
   - `Cmd+[` / `Cmd+]` back/forward
   
3. [ ] Zoom presets
   - `Shift+1` zoom to fit all
   - `Shift+2` zoom to focused group
   - `Shift+0` zoom 100%
   
4. [ ] Minimap component
   - Bird's eye view of canvas
   - Click to jump
   - Viewport indicator
   
5. [ ] Breadcrumb navigation
   - Current location trail
   - Click to navigate back

**Deliverable**: Canvas navigable without trackpad

### Phase 10: Collapsed Group Views

**Scope**: Summary views when zoomed out

**Tasks**:
1. [ ] Define collapsed group appearance
   - Group name
   - Status indicators (agent busy/idle, errors)
   - Thumbnail preview
   
2. [ ] Auto-collapse at zoom thresholds
   - Below 50%: show collapsed
   - Above 75%: show expanded
   
3. [ ] Activity indicators on collapsed groups
   - Pulsing dot when agent active
   - Red indicator on errors
   - Green checkmark on success

**Deliverable**: Useful at any zoom level

### Phase 11: Canvas Persistence & Sync

**Scope**: Save and restore canvas state

**Tasks**:
1. [ ] Persist canvas layout per workspace
   - Group positions
   - Zoom level
   - Viewport position
   
2. [ ] Layout presets
   - Grid layout (auto-arrange)
   - Flow layout (based on dependencies)
   - Free-form (user arranged)
   
3. [ ] Session restore
   - Remember last viewed group
   - Restore zoom/pan state

**Deliverable**: Canvas state persists across sessions

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

7. **Canvas Library Choice**: tldraw vs react-flow vs custom? Each has tradeoffs:
   - tldraw: whiteboard-first, great UX, but may need customization for structured groups
   - react-flow: node-graph native, good for relationships, less freeform
   - custom: full control, significant effort

8. **Tiles vs Canvas Default**: Should canvas be opt-in or the default experience? Power users may prefer tiles initially.

9. **Group Relationships**: Should groups explicitly declare dependencies/relationships, or infer from agent context?

10. **Keyboard vs Mouse Balance**: How much navigation should require mouse/trackpad vs pure keyboard?

---

## Related Documents

- [WORKSPACE-SCOPED-DATA-PLAN.md](./WORKSPACE-SCOPED-DATA-PLAN.md) - Terminal scoping by workspace
- [TERMINAL-IMPLEMENTATION-PLAN.md](./TERMINAL-IMPLEMENTATION-PLAN.md) - Terminal widget details
- [MULTI-AGENT-IDE-RESEARCH.md](./MULTI-AGENT-IDE-RESEARCH.md) - Broader market research
- [UI-PLAN.md](./UI-PLAN.md) - Overall UI architecture
- [EXECUTION-STATE-UI-SPEC.md](./EXECUTION-STATE-UI-SPEC.md) - Activity feed design

---

## Appendix: Research Sources

### Workspace Groups References
- Warp Terminal: https://www.warp.dev/warp-ai
- TmuxAI: https://github.com/alvinunreal/tmuxai
- Claude Code + tmux patterns: https://www.blle.co/blog/claude-code-tmux-beautiful-terminal
- Windsurf Cascade: https://docs.windsurf.com/windsurf/cascade/cascade
- Coder Dev Containers: https://coder.com/docs/user-guides/devcontainers/

### Canvas / Infinite Canvas References
- Flora Fauna: https://florafauna.ai - AI creative infinite canvas
- tldraw: https://tldraw.dev - Infinite canvas SDK for React
- Excalidraw: https://excalidraw.com - Whiteboard with command palette
- Figma Spotlight Search: https://www.figma.com/community/plugin/831936468026040598
- Obsidian Canvas: https://help.obsidian.md/plugins/canvas
- T3 Code UI Discussion: https://github.com/pingdotgg/t3code/issues/511

### Navigation Pattern References
- WICG Spatial Navigation: https://wicg.github.io/spatial-navigation/
- Figma Keyboard Navigation: https://help.figma.com/hc/en-us/articles/360040328653

### Key Quotes

**On the grouping problem** (Theo):
> "Our projects are split BETWEEN apps, windows and tabs. There's no natural grouping! If I see some work finish in Claude Code for Project A, I have to go hunt for the right Chrome window/tab to see the results."

**On canvas for AI tools** (Flora Fauna):
> "Every text, image and video model on one infinite canvas... a node-based creative workspace"

**On agent UI direction** (T3 Code discussion):
> "What I want most is: understanding what the agent is doing, understanding why it is doing it, seeing progress and decisions across multiple tasks, reviewing results at the right level of abstraction before drilling down into code."

**On command palette navigation** (Figma Spotlight):
> "Find and jump to any Page, Frame, Component, Layer... Use arrow keys and return to move inside the project without lifting your hands"

**On visibility** (Windsurf):
> "Visible — You can see what Cascade intends to do"

**On tmux workflow** (Agent Factory):
> "tmux lets you split your window into multiple panes so you can run an agent, watch its logs, and monitor system resources simultaneously"

**On agent observation** (TmuxAI):
> "Just as a colleague sitting next to you would observe your screen, understand context from what's visible, and help accordingly"

**On parallel visibility** (Warp):
> "Automate repetitive tasks, build on agents, and run them in parallel in the cloud"
