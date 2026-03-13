# Agent Routing Spec

## Overview

Replace implicit "Claude Code first" priority with explicit agent selection. Users can assign tasks or individual steps to specific agents based on their strengths.

---

## Agent Capabilities Model

```typescript
interface AgentCapabilities {
  // Core capabilities
  filesystem: boolean;      // Can read/write local files
  web: boolean;             // Can browse/search web
  shell: boolean;           // Can execute shell commands
  parallel: boolean;        // Can run multiple tasks concurrently
  
  // Context
  project?: string;         // Bound to specific project path (Claude Code)
  autonomous: boolean;      // Can run without supervision
  
  // Performance hints
  latency: 'low' | 'medium' | 'high';  // Response time expectation
  costTier: 'free' | 'low' | 'medium' | 'high';
}

// Example profiles
const AGENT_PROFILES = {
  'claude-code': {
    filesystem: true,
    web: false,
    shell: true,
    parallel: false,
    autonomous: false,
    latency: 'low',
    costTier: 'low',
  },
  'openclaw-agent': {
    filesystem: true,  // their own workspace
    web: true,
    shell: true,
    parallel: true,
    autonomous: true,
    latency: 'medium',
    costTier: 'medium',
  },
};
```

---

## UI Components

### 1. Agent Selector (Reusable)

```tsx
interface AgentSelectorProps {
  agents: Agent[];
  selected: string | null;
  onSelect: (agentId: string) => void;
  showCapabilities?: boolean;
  suggestedAgent?: string;
  suggestReason?: string;
}

// Renders as dropdown with:
// - Agent name + status indicator (🟢 idle / 🟡 busy / ⚫ offline)
// - Capability badges (📁 files, 🌐 web, ⚡ fast)
// - "Suggested" badge if matches suggestedAgent
```

**Visual:**
```
┌─────────────────────────────────────┐
│ Assign to: [▾ Claude Code (local) ] │
│            ┌───────────────────────┐│
│            │ 🟢 Claude Code        ││
│            │    📁 ⚡ Local project ││
│            │ ─────────────────────  ││
│            │ 🟢 scout              ││
│            │    📁 🌐 Autonomous   ││
│            │ 🟢 forge ★ Suggested  ││
│            │    📁 🌐 Research     ││
│            │ 🟡 vera (busy)        ││
│            │    📁 🌐              ││
│            └───────────────────────┘│
└─────────────────────────────────────┘
```

### 2. Planning View Updates

**Before:** Plan is assigned to one agent automatically

**After:** 
- Default agent selector at top (applies to all steps)
- Per-step override option (click step → reassign)
- "Auto-route" button that suggests optimal assignment

```
┌─────────────────────────────────────────────────────────┐
│ Planning                                                │
│ ───────────────────────────────────────────────────────│
│ Task: Add auth to the API and write tests              │
│                                                         │
│ Default Agent: [▾ Claude Code    ] [Auto-route]        │
│                                                         │
│ Plan:                                                   │
│ ┌─────────────────────────────────────────────────────┐│
│ │ 1. Add JWT middleware to Express router             ││
│ │    [Claude Code] ← click to change                  ││
│ ├─────────────────────────────────────────────────────┤│
│ │ 2. Research refresh token best practices            ││
│ │    [scout 🌐] ← auto-routed (needs web)            ││
│ ├─────────────────────────────────────────────────────┤│
│ │ 3. Write integration tests                          ││
│ │    [forge] ← auto-routed (autonomous, parallel)    ││
│ ├─────────────────────────────────────────────────────┤│
│ │ 4. Review changes and create PR                     ││
│ │    [Claude Code] ← needs local filesystem          ││
│ └─────────────────────────────────────────────────────┘│
│                                                         │
│                           [Cancel]  [Execute Plan →]   │
└─────────────────────────────────────────────────────────┘
```

### 3. Execution View Updates

Show which agent is handling current step:

```
┌─────────────────────────────────────────────────────────┐
│ ● Executing Step 2 of 4                    ⏱ 1:23      │
│ ───────────────────────────────────────────────────────│
│ Agent: scout 🟢                                        │
│ Task: Research refresh token best practices            │
│                                                         │
│ ┌─────────────────────────────────────────────────────┐│
│ │ > Searching for JWT refresh token patterns...       ││
│ │ > Found 3 relevant articles                         ││
│ │ > Analyzing Auth0 documentation...                  ││
│ │ █                                                   ││
│ └─────────────────────────────────────────────────────┘│
│                                                         │
│ Progress: [████████░░░░░░░░] Step 2/4                  │
│                                                         │
│ Next: Step 3 → forge (Write integration tests)         │
└─────────────────────────────────────────────────────────┘
```

---

## Server Changes

### 1. Task Schema Update

```typescript
interface Task {
  id: string;
  message: string;
  status: 'created' | 'planning' | 'planned' | 'executing' | 'completed' | 'failed';
  createdAt: Date;
  
  // NEW: Multi-agent support
  defaultAgent: string | null;
  steps: TaskStep[];
}

interface TaskStep {
  id: string;
  index: number;
  description: string;
  agent: string;           // Assigned agent
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: string;
  startedAt?: Date;
  completedAt?: Date;
}
```

### 2. New API Endpoints

```
# Update step assignment
PATCH /tasks/:taskId/steps/:stepId
Body: { agent: "forge" }

# Auto-route all steps
POST /tasks/:taskId/auto-route
Response: { steps: [{ id, suggestedAgent, reason }] }

# Execute single step (for step-by-step mode)
POST /tasks/:taskId/steps/:stepId/execute
Response: { result: string }

# Execute all steps (sequential or parallel where safe)
POST /tasks/:taskId/execute
Query: ?mode=sequential|parallel
```

### 3. Auto-Router Logic

```typescript
interface RouteDecision {
  agent: string;
  reason: string;
  confidence: number;  // 0-1
}

function autoRouteStep(step: string, agents: Agent[]): RouteDecision {
  const keywords = analyzeStep(step);
  
  // Rule-based routing
  if (keywords.needsWeb) {
    const webAgents = agents.filter(a => a.capabilities.web);
    return { 
      agent: webAgents[0]?.name ?? 'claude-code',
      reason: 'Requires web access',
      confidence: 0.9
    };
  }
  
  if (keywords.needsLocalFiles) {
    return {
      agent: 'claude-code',
      reason: 'Needs local filesystem',
      confidence: 0.95
    };
  }
  
  if (keywords.isLongRunning || keywords.isTest) {
    const autonomousAgents = agents.filter(a => a.capabilities.autonomous);
    return {
      agent: autonomousAgents[0]?.name ?? 'claude-code',
      reason: 'Long-running task, better for autonomous agent',
      confidence: 0.7
    };
  }
  
  // Default to Claude Code for everything else
  return {
    agent: 'claude-code',
    reason: 'Default for local development',
    confidence: 0.5
  };
}

function analyzeStep(step: string): StepKeywords {
  const lower = step.toLowerCase();
  return {
    needsWeb: /research|search|look up|find|browse|documentation/.test(lower),
    needsLocalFiles: /edit|create|modify|update|add|file|code/.test(lower),
    isLongRunning: /test|benchmark|deploy|build|compile/.test(lower),
    isTest: /test|spec|integration|e2e|unit/.test(lower),
  };
}
```

---

## Data Flow

```
1. User creates task
   └─→ POST /tasks { message }
   
2. System generates plan
   └─→ POST /tasks/:id/plan
   └─→ Returns steps with default agent assignment
   
3. User can:
   a) Accept defaults → Execute
   b) Click "Auto-route" → System suggests per-step agents
   c) Manually override any step's agent
   
4. Execute
   └─→ POST /tasks/:id/execute
   └─→ Server orchestrates:
       - Sequential by default
       - Parallel if steps are independent + different agents
       
5. Results flow back
   └─→ WebSocket events per step
   └─→ UI updates progress bar + current agent indicator
```

---

## Migration Path

### Phase 1: Agent Picker (Basic)
- [ ] Add `AgentSelector` component
- [ ] Add agent dropdown to PlanningView header
- [ ] Pass selected agent to `/tasks/:id/plan` and `/tasks/:id/execute`
- [ ] Server respects agent param instead of auto-selecting

### Phase 2: Per-Step Routing
- [ ] Update Task schema with `steps[]`
- [ ] Plan endpoint returns structured steps
- [ ] UI renders steps with individual agent badges
- [ ] Click step → mini dropdown to reassign

### Phase 3: Auto-Router
- [ ] Add `/tasks/:id/auto-route` endpoint
- [ ] Keyword analysis for step classification
- [ ] "Auto-route" button in UI
- [ ] Show confidence + reason in UI

### Phase 4: Parallel Execution
- [ ] Detect independent steps
- [ ] Execute in parallel when assigned to different agents
- [ ] UI shows multiple "in progress" indicators

---

## Open Questions

1. **Step dependencies**: Should we detect which steps depend on others? (e.g., "write tests" depends on "add middleware")

2. **Agent queuing**: If an agent is busy, should we queue or suggest an alternative?

3. **Cost visibility**: Show estimated cost per agent before execution?

4. **Learning**: Track which routing decisions worked well for future suggestions?
