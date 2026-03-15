# Effect Migration Plan for Dispatch

## Overview

This plan outlines refactoring Dispatch (Agent Command Center) to use Effect-TS, inspired by T3 Code's architecture.

---

## Phase 1: Foundation (Week 1)

### 1.1 Install Dependencies
```bash
bun add effect @effect/platform @effect/platform-node @effect/schema
```

### 1.2 Project Structure Changes
```
packages/server/src/
├── services/           # Service definitions (tags + shapes)
│   ├── SessionManager.ts
│   ├── ClaudeCodeAdapter.ts
│   └── ThreadStore.ts
├── layers/             # Layer implementations
│   ├── SessionManagerLive.ts
│   ├── ClaudeCodeAdapterLive.ts
│   └── ThreadStoreLive.ts
├── errors.ts           # Typed error algebra
└── serverLayers.ts     # Layer composition
```

### 1.3 Define Error Algebra
```typescript
// errors.ts
import { Data } from "effect"

export class AdapterSessionNotFoundError extends Data.TaggedError("AdapterSessionNotFoundError")<{
  readonly threadId: string
  readonly cause?: unknown
}> {}

export class AdapterProcessError extends Data.TaggedError("AdapterProcessError")<{
  readonly detail: string
  readonly cause?: unknown
}> {}

export class AdapterRequestError extends Data.TaggedError("AdapterRequestError")<{
  readonly method: string
  readonly detail: string
  readonly cause?: unknown
}> {}

export type AdapterError = 
  | AdapterSessionNotFoundError 
  | AdapterProcessError 
  | AdapterRequestError
```

---

## Phase 2: Core Services (Week 2)

### 2.1 Define Service Tags
```typescript
// services/ClaudeCodeAdapter.ts
import { Context, Effect, Stream } from "effect"

export interface ClaudeCodeAdapterShape {
  readonly startSession: (input: StartSessionInput) => Effect.Effect<Session, AdapterError>
  readonly sendTurn: (input: SendTurnInput) => Effect.Effect<{ turnId: string }, AdapterError>
  readonly streamEvents: () => Stream.Stream<SDKMessage, AdapterError>
  readonly interrupt: () => Effect.Effect<void, AdapterError>
  readonly stopSession: () => Effect.Effect<void, AdapterError>
}

export class ClaudeCodeAdapter extends Context.Tag("ClaudeCodeAdapter")<
  ClaudeCodeAdapter,
  ClaudeCodeAdapterShape
>() {}
```

### 2.2 Implement Live Layer
```typescript
// layers/ClaudeCodeAdapterLive.ts
import { Effect, Layer, Stream, Queue, Ref } from "effect"
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk"

export const ClaudeCodeAdapterLive = Layer.scoped(
  ClaudeCodeAdapter,
  Effect.gen(function* () {
    const eventQueue = yield* Queue.unbounded<SDKMessage>()
    const sessionRef = yield* Ref.make<Session | null>(null)
    
    return {
      startSession: (input) => Effect.gen(function* () {
        const claudePath = yield* resolveClaudePath()
        const queryIter = query({
          prompt: makePromptIterable(),
          options: {
            cwd: input.cwd,
            pathToClaudeCodeExecutable: claudePath,
            permissionMode: "bypassPermissions",
          }
        })
        // ... setup event pumping
        return session
      }),
      
      sendTurn: (input) => Effect.gen(function* () {
        // Enqueue prompt, return turnId
      }),
      
      streamEvents: () => Stream.fromQueue(eventQueue),
      
      interrupt: () => Effect.gen(function* () {
        const session = yield* Ref.get(sessionRef)
        if (session?.query) {
          yield* Effect.tryPromise(() => session.query.interrupt())
        }
      }),
      
      stopSession: () => Effect.gen(function* () {
        // Cleanup
      }),
    }
  })
)
```

---

## Phase 3: Persistence Layer (Week 2-3)

### 3.1 ThreadStore Service
```typescript
// services/ThreadStore.ts
export interface ThreadStoreShape {
  readonly createThread: (input: CreateThreadInput) => Effect.Effect<Thread, StoreError>
  readonly getThread: (threadId: string) => Effect.Effect<Thread, StoreError>
  readonly listThreads: (options?: ListOptions) => Effect.Effect<Thread[], StoreError>
  readonly appendMessage: (input: AppendMessageInput) => Effect.Effect<Message, StoreError>
}

export class ThreadStore extends Context.Tag("ThreadStore")<
  ThreadStore,
  ThreadStoreShape
>() {}
```

### 3.2 SQLite Live Layer
```typescript
// layers/ThreadStoreLive.ts
import { DatabaseSync } from "node:sqlite"

export const ThreadStoreLive = Layer.scoped(
  ThreadStore,
  Effect.gen(function* () {
    const db = new DatabaseSync(dbPath)
    
    yield* Effect.addFinalizer(() => 
      Effect.sync(() => db.close())
    )
    
    return {
      createThread: (input) => Effect.try({
        try: () => {
          const stmt = db.prepare(`INSERT INTO threads ...`)
          stmt.run(...)
          return thread
        },
        catch: (e) => new StoreError({ cause: e })
      }),
      // ... other methods
    }
  })
)
```

---

## Phase 4: Server Integration (Week 3)

### 4.1 Compose Layers
```typescript
// serverLayers.ts
export const ServerLive = Layer.mergeAll(
  ClaudeCodeAdapterLive,
  ThreadStoreLive,
  SessionManagerLive,
).pipe(
  Layer.provide(ServerConfigLive)
)
```

### 4.2 Wire to Hono Routes
```typescript
// server.ts
const program = Effect.gen(function* () {
  const sessionManager = yield* SessionManager
  const app = new Hono()
  
  app.post('/threads/:id/send', async (c) => {
    const result = await Effect.runPromise(
      sessionManager.send(threadId, options).pipe(
        Effect.provideLayer(ServerLive)
      )
    )
    return c.json(result)
  })
})
```

---

## Phase 5: Event Streaming (Week 4)

### 5.1 Canonical Event Mapping
Map SDK events to canonical types (like T3 Code does):

```typescript
const mapToCanonicalEvent = (sdkEvent: SDKMessage): ProviderRuntimeEvent => {
  switch (sdkEvent.type) {
    case "assistant":
      return { type: "message.delta", ... }
    case "result":
      return { type: "turn.completed", ... }
    case "stream_event":
      return mapStreamEvent(sdkEvent.event)
  }
}
```

### 5.2 WebSocket Integration
```typescript
const eventStream = adapter.streamEvents().pipe(
  Stream.map(mapToCanonicalEvent),
  Stream.tap((event) => 
    Effect.sync(() => ws.send(JSON.stringify(event)))
  )
)
```

---

## What to Port from T3 Code

### ✅ Port These Docs
| Doc | Why |
|-----|-----|
| `AGENTS.md` | Good task completion requirements |
| `.docs/encyclopedia.md` | Excellent glossary of concepts |
| `.docs/architecture.md` | Clear architecture diagram |
| Error algebra pattern | Typed errors are powerful |

### ✅ Port These Patterns
1. **Service + Layer separation** - Clean DI
2. **Typed error algebra** - `Data.TaggedError` 
3. **Event NDJSON logging** - Debug observability
4. **Schema validation at boundaries** - Type-safe APIs

### ❌ Don't Port (Overkill for Dispatch)
1. Full orchestration engine (decider/projector/reactor)
2. Checkpoint/rollback system
3. Multi-provider abstraction
4. Complex approval flows

---

## Migration Strategy

### Option A: Incremental (Recommended)
1. Add Effect alongside existing code
2. Migrate one service at a time
3. Use `Effect.runPromise` at boundaries
4. Delete old code once new works

### Option B: Big Bang
1. Rewrite server from scratch
2. Higher risk, but cleaner result
3. Good if willing to break things

---

## Estimated Timeline

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Phase 1 | 3-4 days | Foundation, error types |
| Phase 2 | 4-5 days | Core adapter service |
| Phase 3 | 3-4 days | Persistence layer |
| Phase 4 | 3-4 days | Server integration |
| Phase 5 | 3-4 days | Event streaming |
| **Total** | **~3 weeks** | Full Effect migration |

---

## Open Questions

1. **Do we need multi-provider support?** If just Claude Code, simpler is better.
2. **How much orchestration complexity?** Checkpoints? Rollback?
3. **Effect learning curve** - Team needs to learn Effect patterns.

---

## Resources

- [Effect Docs](https://effect.website/docs)
- [T3 Code Source](https://github.com/pingdotgg/t3code) (private, we have local copy)
- [Effect Discord](https://discord.gg/effect-ts)
