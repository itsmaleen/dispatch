# Agent Personas for Dispatch

> **Goal:** Create specialized AI team members that spawn independent Claude Code sessions, each with distinct roles, capabilities, and personalities.

## Inspiration Sources

### From Paperclip
- **Org chart structure** — Personas have roles, reporting lines, and job descriptions
- **Goal alignment** — Every task traces back to higher-level objectives
- **Heartbeat-based work** — Personas wake on schedule, check for work, act
- **Budget/governance** — Control over what each persona can do
- **Ticket system** — Every conversation traced, every decision explained

### From Symphony
- **Isolated workspaces** — Each persona works in its own context
- **WORKFLOW.md** — Per-persona configuration versioned with code
- **Polling + dispatch** — Orchestrator decides who works on what
- **Concurrency limits** — Control how many personas run simultaneously
- **Retry/recovery** — Graceful handling of failures

---

## Core Concept

```
┌─────────────────────────────────────────────────────────────────┐
│                      Dispatch Personas                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    │
│   │  Arch   │    │  Dev    │    │ Review  │    │  Test   │    │
│   │ itect   │    │ eloper  │    │   er    │    │   er    │    │
│   └────┬────┘    └────┬────┘    └────┬────┘    └────┬────┘    │
│        │              │              │              │          │
│        ▼              ▼              ▼              ▼          │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │              Claude Code Session Manager                 │  │
│   │  (Each persona = independent Claude Code session)       │  │
│   └─────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │                   Shared Context                         │  │
│   │  - Project goals          - Codebase access             │  │
│   │  - Task assignments       - Inter-persona messages      │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Each persona:
1. Has a **PERSONA.md** file defining role, capabilities, and prompt
2. Spawns its own **Claude Code session** via the existing adapter
3. Works in an **isolated worktree** (optional) or shared codebase
4. Can **communicate** with other personas via structured messages
5. Reports **status** back to the orchestrator

---

## Built-in Personas

### 🏗️ Architect
**Role:** High-level design, technical decisions, breaking down features into tasks

```yaml
name: Architect
emoji: 🏗️
capabilities:
  - Read and analyze codebase structure
  - Create technical design documents
  - Break features into implementable tasks
  - Review and approve architectural changes
restrictions:
  - Cannot directly modify production code
  - Must create tasks for implementation work
voice: thoughtful  # For TTS integration
```

**Typical prompts:**
- "Design the authentication system for our app"
- "Review the proposed database schema"
- "Break down the payment integration feature"

### 💻 Developer
**Role:** Implementation, writing code, fixing bugs

```yaml
name: Developer
emoji: 💻
capabilities:
  - Full code read/write access
  - Run tests and build commands
  - Create branches and commits
  - Fix bugs and implement features
restrictions:
  - Cannot merge to main without review
  - Must follow coding standards in CONVENTIONS.md
voice: energetic
```

**Typical prompts:**
- "Implement the user registration flow"
- "Fix the null pointer exception in auth.ts"
- "Add unit tests for the payment module"

### 🔍 Reviewer
**Role:** Code review, quality assurance, suggesting improvements

```yaml
name: Reviewer
emoji: 🔍
capabilities:
  - Read all code and history
  - Comment on changes
  - Approve or request changes
  - Run static analysis tools
restrictions:
  - Cannot modify code directly
  - Can only suggest changes
voice: analytical
```

**Typical prompts:**
- "Review the changes in PR #42"
- "Check the auth module for security issues"
- "Analyze code coverage gaps"

### 🧪 Tester
**Role:** Writing tests, validating functionality, finding edge cases

```yaml
name: Tester
emoji: 🧪
capabilities:
  - Read all code
  - Write and run tests
  - Modify test files only
  - Report bugs and issues
restrictions:
  - Cannot modify production code
  - Must document all findings
voice: precise
```

**Typical prompts:**
- "Write integration tests for the API endpoints"
- "Find edge cases in the date parsing logic"
- "Validate the payment flow end-to-end"

### 📚 Documenter
**Role:** Writing docs, README updates, API documentation

```yaml
name: Documenter
emoji: 📚
capabilities:
  - Read all code
  - Write/modify documentation files
  - Generate API docs
  - Update README and guides
restrictions:
  - Cannot modify code (except docs/comments)
voice: clear
```

---

## Architecture

### Package Structure

```
packages/personas/
├── src/
│   ├── index.ts                  # Public API
│   ├── types.ts                  # Core types
│   │
│   ├── registry/
│   │   ├── persona-registry.ts   # Manages available personas
│   │   ├── persona-loader.ts     # Loads PERSONA.md files
│   │   └── builtin/              # Built-in persona definitions
│   │       ├── architect.md
│   │       ├── developer.md
│   │       ├── reviewer.md
│   │       ├── tester.md
│   │       └── documenter.md
│   │
│   ├── orchestrator/
│   │   ├── persona-orchestrator.ts  # Coordinates persona sessions
│   │   ├── task-dispatcher.ts       # Assigns work to personas
│   │   ├── message-bus.ts           # Inter-persona communication
│   │   └── heartbeat.ts             # Polling/wake logic
│   │
│   ├── session/
│   │   ├── persona-session.ts    # Wraps Claude Code session
│   │   ├── context-builder.ts    # Builds persona-specific context
│   │   └── capability-guard.ts   # Enforces restrictions
│   │
│   └── ui/
│       ├── PersonaCard.tsx       # UI component for persona
│       ├── PersonaChat.tsx       # Chat interface per persona
│       └── TeamView.tsx          # Overview of all personas
│
├── package.json
└── README.md
```

### Core Types

```typescript
interface Persona {
  id: string;                    // e.g., 'architect', 'developer-1'
  name: string;                  // Display name
  emoji: string;                 // 🏗️, 💻, etc.
  role: string;                  // Short description
  capabilities: string[];        // What they can do
  restrictions: string[];        // What they cannot do
  promptTemplate: string;        // System prompt for Claude Code
  voice?: string;                // TTS voice ID (for voice integration)
  config: PersonaConfig;         // Runtime configuration
}

interface PersonaConfig {
  maxConcurrentTasks: number;    // How many tasks at once
  heartbeatIntervalMs: number;   // Wake frequency
  timeoutMs: number;             // Max time per task
  worktree: 'isolated' | 'shared'; // Workspace isolation
  autoApprove: boolean;          // Auto-approve certain actions
}

interface PersonaSession {
  persona: Persona;
  sessionId: string;             // Claude Code session ID
  status: 'idle' | 'working' | 'waiting' | 'error';
  currentTask: Task | null;
  messageHistory: Message[];
  tokenUsage: TokenUsage;
  startedAt: Date;
  lastActiveAt: Date;
}

interface PersonaMessage {
  from: string;                  // Persona ID
  to: string | 'all';            // Target persona or broadcast
  type: 'request' | 'response' | 'handoff' | 'info';
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}
```

### PERSONA.md Format

Each persona is defined by a Markdown file with YAML front matter (like Symphony's WORKFLOW.md):

```markdown
---
name: Developer
emoji: 💻
role: Implementation specialist
voice: energetic

capabilities:
  - code:read
  - code:write
  - git:branch
  - git:commit
  - tests:run
  - build:run

restrictions:
  - git:merge:main
  - deploy:*

config:
  maxConcurrentTasks: 3
  heartbeatIntervalMs: 30000
  timeoutMs: 3600000
  worktree: isolated
  autoApprove: false

triggers:
  - label: "needs-implementation"
  - mention: "@developer"
---

# Developer Persona

You are a skilled software developer working on this codebase.

## Your Role
- Implement features according to specifications
- Fix bugs reported by the team
- Write clean, well-tested code
- Follow the project's coding conventions

## Working Style
- Start by understanding the requirements
- Break complex tasks into smaller steps
- Write tests alongside implementation
- Commit frequently with clear messages

## Communication
- Ask the Architect for clarification on design decisions
- Hand off to Reviewer when implementation is complete
- Report blockers to the team immediately

## Constraints
- You cannot merge directly to main
- Always run tests before marking work complete
- Follow patterns established in existing code
```

---

## Integration with Existing Dispatch

### Session Manager Integration

```typescript
// In packages/server/src/services/persona-manager.ts

import { getSessionManager } from '../adapters/session-manager';

class PersonaManager {
  private sessions = new Map<string, PersonaSession>();
  
  async spawnPersona(personaId: string, task?: Task): Promise<PersonaSession> {
    const persona = this.registry.get(personaId);
    const sessionManager = getSessionManager();
    
    // Build persona-specific system prompt
    const systemPrompt = this.buildSystemPrompt(persona, task);
    
    // Create isolated worktree if configured
    let cwd = process.cwd();
    if (persona.config.worktree === 'isolated') {
      cwd = await this.worktreeManager.create(personaId, task?.id);
    }
    
    // Spawn Claude Code session via existing adapter
    const session = await sessionManager.createSession({
      threadId: `persona-${personaId}-${Date.now()}`,
      name: `${persona.emoji} ${persona.name}`,
      cwd,
      systemPrompt,  // Inject persona's role
    });
    
    return {
      persona,
      sessionId: session.threadId,
      status: 'idle',
      currentTask: task,
      messageHistory: [],
      tokenUsage: { input: 0, output: 0 },
      startedAt: new Date(),
      lastActiveAt: new Date(),
    };
  }
  
  async assignTask(personaId: string, task: Task): Promise<void> {
    const session = this.sessions.get(personaId);
    if (!session) {
      throw new Error(`Persona ${personaId} not spawned`);
    }
    
    // Send task to the persona's Claude Code session
    const sessionManager = getSessionManager();
    await sessionManager.sendMessage(session.sessionId, {
      content: this.formatTaskPrompt(task),
      role: 'user',
    });
    
    session.currentTask = task;
    session.status = 'working';
  }
}
```

### Capability Guard

```typescript
// Enforce persona restrictions via Claude Code hooks
class CapabilityGuard {
  shouldApprove(persona: Persona, action: ToolCall): boolean {
    // Check if action matches any restriction
    for (const restriction of persona.restrictions) {
      if (this.matchesPattern(action, restriction)) {
        return false;
      }
    }
    
    // Check if action matches any capability
    for (const capability of persona.capabilities) {
      if (this.matchesPattern(action, capability)) {
        return true;
      }
    }
    
    // Default: require human approval
    return false;
  }
  
  private matchesPattern(action: ToolCall, pattern: string): boolean {
    // Patterns like "code:write", "git:merge:main", "deploy:*"
    const [category, ...rest] = pattern.split(':');
    // ... matching logic
  }
}
```

### Inter-Persona Communication

```typescript
// Message bus for persona coordination
class PersonaMessageBus extends EventEmitter {
  send(message: PersonaMessage): void {
    if (message.to === 'all') {
      this.emit('broadcast', message);
    } else {
      this.emit(`message:${message.to}`, message);
    }
    
    // Log for audit trail
    this.auditLog.append(message);
  }
  
  // Personas can request handoffs
  async handoff(from: string, to: string, context: HandoffContext): Promise<void> {
    const toSession = this.manager.getSession(to);
    
    // Inject handoff context into target persona's session
    await this.manager.injectContext(to, {
      type: 'handoff',
      from,
      context,
    });
    
    this.send({
      from,
      to,
      type: 'handoff',
      content: `Handing off: ${context.summary}`,
      metadata: context,
      timestamp: new Date(),
    });
  }
}
```

---

## UI Components

### Team Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  🏢 Your Team                                        [+ Add]    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ 🏗️ Architect │  │ 💻 Developer │  │ 🔍 Reviewer  │          │
│  │              │  │              │  │              │          │
│  │ ● Planning   │  │ ◉ Working   │  │ ○ Idle       │          │
│  │ auth-design  │  │ fix-login    │  │              │          │
│  │              │  │              │  │              │          │
│  │ 1.2k tokens  │  │ 15k tokens   │  │ 0 tokens     │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐                            │
│  │ 🧪 Tester    │  │ 📚 Documenter│                            │
│  │              │  │              │                            │
│  │ ○ Idle       │  │ ○ Idle       │                            │
│  │              │  │              │                            │
│  │ 0 tokens     │  │ 0 tokens     │                            │
│  └──────────────┘  └──────────────┘                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Persona Chat Panel

```
┌─────────────────────────────────────────────────────────────────┐
│  💻 Developer                                    [⚙️] [✕]       │
│  Working on: fix-login (#123)                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  📨 From Architect (2m ago):                                   │
│  "The auth flow needs to handle expired tokens gracefully.     │
│  See the design doc in /docs/auth-design.md"                   │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  💻 Developer:                                                  │
│  I've analyzed the codebase and found the issue in             │
│  `src/auth/token-refresh.ts`. The error handler isn't          │
│  catching the ExpiredTokenError. I'll fix this now.            │
│                                                                 │
│  📝 [View Changes] [Approve] [Stop]                            │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  [Message Developer...]                              [Send]     │
└─────────────────────────────────────────────────────────────────┘
```

### Persona Configuration

```
┌─────────────────────────────────────────────────────────────────┐
│  Configure: 💻 Developer                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Name:     [Developer                    ]                      │
│  Emoji:    [💻]                                                 │
│  Voice:    [Energetic ▼]                                        │
│                                                                 │
│  ─── Capabilities ───                                           │
│  ☑ code:read        ☑ code:write       ☑ git:branch            │
│  ☑ git:commit       ☑ tests:run        ☑ build:run             │
│  ☐ git:merge:main   ☐ deploy:*                                 │
│                                                                 │
│  ─── Runtime ───                                                │
│  Max concurrent tasks:  [3    ]                                 │
│  Heartbeat interval:    [30s  ]                                 │
│  Task timeout:          [1h   ]                                 │
│  Worktree:             [Isolated ▼]                             │
│                                                                 │
│  ─── System Prompt ───                                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ You are a skilled software developer...                 │   │
│  │                                                         │   │
│  │ [Edit in PERSONA.md]                                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [Cancel]                                        [Save]         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1)
- [ ] Create `packages/personas/` structure
- [ ] Implement PersonaRegistry and PERSONA.md loader
- [ ] Create built-in persona definitions (Architect, Developer, Reviewer)
- [ ] Integrate with existing SessionManager
- [ ] Basic capability guard (allow/deny patterns)

**Deliverable:** Spawn Developer persona, assign a task, see it work

### Phase 2: Orchestration (Week 2)
- [ ] PersonaOrchestrator for managing multiple personas
- [ ] Inter-persona message bus
- [ ] Handoff flow (Developer → Reviewer)
- [ ] Heartbeat-based polling for idle personas
- [ ] Task assignment and completion tracking

**Deliverable:** Architect creates task → Developer implements → Reviewer reviews

### Phase 3: UI Integration (Week 3)
- [ ] Team overview component
- [ ] Individual persona chat panels
- [ ] Persona configuration UI
- [ ] Real-time status updates via WebSocket
- [ ] Token usage and cost tracking per persona

**Deliverable:** Full UI for managing persona team

### Phase 4: Advanced Features (Week 4+)
- [ ] Custom persona creation (user-defined PERSONA.md)
- [ ] Worktree isolation per persona
- [ ] Goal hierarchy (Paperclip-style goal alignment)
- [ ] Budget controls per persona
- [ ] Voice integration (TTS voice per persona)
- [ ] Persona marketplace (import/export definitions)

---

## API Design

### REST Endpoints

```
GET    /personas                    # List all available personas
GET    /personas/:id                # Get persona details
POST   /personas                    # Create custom persona
PUT    /personas/:id                # Update persona
DELETE /personas/:id                # Delete custom persona

POST   /personas/:id/spawn          # Spawn persona session
POST   /personas/:id/stop           # Stop persona session
GET    /personas/:id/status         # Get session status

POST   /personas/:id/tasks          # Assign task to persona
GET    /personas/:id/tasks          # List persona's tasks
POST   /personas/:id/message        # Send message to persona

GET    /team                        # Get team overview
POST   /team/broadcast              # Broadcast to all personas
```

### WebSocket Events

```typescript
// Server → Client
interface PersonaEvent {
  type: 'persona.spawned' | 'persona.stopped' | 'persona.status' |
        'persona.message' | 'persona.task.started' | 'persona.task.completed';
  personaId: string;
  payload: unknown;
  timestamp: string;
}

// Client → Server
interface PersonaCommand {
  type: 'persona.spawn' | 'persona.stop' | 'persona.message' | 'persona.task.assign';
  personaId: string;
  payload: unknown;
}
```

---

## Configuration

### Environment Variables

```bash
# Persona configuration
DISPATCH_PERSONAS_DIR=./personas       # Custom persona definitions
DISPATCH_MAX_PERSONAS=10               # Max concurrent persona sessions
DISPATCH_PERSONA_TIMEOUT_MS=3600000    # Default task timeout

# Per-persona budgets (optional)
DISPATCH_PERSONA_ARCHITECT_BUDGET=100  # Max $ per day
DISPATCH_PERSONA_DEVELOPER_BUDGET=500
```

### Project Configuration (dispatch.config.json)

```json
{
  "personas": {
    "enabled": true,
    "builtIn": ["architect", "developer", "reviewer", "tester", "documenter"],
    "custom": ["./personas/*.md"],
    "defaults": {
      "worktree": "isolated",
      "heartbeatIntervalMs": 30000,
      "autoApprove": false
    },
    "teamStructure": {
      "architect": {
        "canAssignTo": ["developer"],
        "approves": ["developer"]
      },
      "developer": {
        "reportsTo": "architect",
        "handsOffTo": ["reviewer"]
      },
      "reviewer": {
        "approves": ["developer"],
        "canRequestChanges": true
      }
    }
  }
}
```

---

## Success Metrics

- **Engagement:** % of projects using 2+ personas
- **Task completion:** End-to-end task completion rate (Architect → Developer → Reviewer)
- **Handoff efficiency:** Time from Developer complete → Reviewer started
- **Quality:** Reviewer rejection rate (lower = better Developer output)
- **Cost efficiency:** Tokens per completed task vs single-agent baseline

---

## Open Questions

1. **Worktree vs shared:** Should all personas share one codebase or have isolated views?
2. **Conflict resolution:** What happens when Developer and Reviewer disagree?
3. **Human in the loop:** How does user interrupt/guide a persona mid-task?
4. **Persona memory:** Should personas remember context across sessions?
5. **Custom personas:** How much customization to expose in V1?

---

## References

- [Paperclip](https://github.com/paperclipai/paperclip) — Org chart orchestration
- [OpenAI Symphony](https://github.com/openai/symphony) — Issue-based agent coordination
- [Harness Engineering](https://openai.com/index/harness-engineering/) — Making codebases agent-friendly
