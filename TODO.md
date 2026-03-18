# TODO - Agent Command Center (ACC)

> Master tracking document for pending features and improvements.
> See individual plan docs in `/docs/` for detailed implementation plans.

---

## High Priority

### Workspace-Scoped Data System
> **Plan:** [WORKSPACE-SCOPED-DATA-PLAN.md](./docs/WORKSPACE-SCOPED-DATA-PLAN.md)

Terminals and other data should be workspace (project path) specific, not global.

- [ ] **Phase 1: Terminal Persistence & Scoping**
  - [ ] Add `terminals` table to database (migration 5)
  - [ ] Create `TerminalStore` class (CRUD operations)
  - [ ] Add `/terminals` REST API endpoints
  - [ ] Workspace change detection in `Workspace.tsx`
  - [ ] Close terminals when switching workspaces
  - [ ] Load workspace-specific terminals on entry

- [ ] **Phase 2: Per-Workspace Layouts**
  - [ ] Change layout storage key to include workspace path hash
  - [ ] Save/restore layouts per workspace
  - [ ] (Future) Move layouts to database for cross-device sync

- [ ] **Phase 3: Widget Type Expansion**
  - [ ] Create widget registry pattern for extensibility
  - [ ] Support new widget types: `browser`, `files`, `preview`, `logs`, `notes`, `diff`
  - [ ] Generic `widget_instances` table for future widgets

- [ ] **Phase 4: Context Layering**
  - [ ] Create `WorkspaceContext` provider (workspace-scoped state)
  - [ ] Clear separation: App context vs Workspace context vs Widget context

- [ ] **Phase 5: Session Recovery**
  - [ ] Resume Claude Code sessions on workspace load
  - [ ] Store conversation history per terminal
  - [ ] Show "Resuming session..." status during recovery

---

## Medium Priority

### UI/UX Improvements
> **Plan:** [UI-PLAN.md](./docs/UI-PLAN.md)

- [ ] **Phase 1: Home + Agents**
  - [ ] Home page with hero input (Capy-style)
  - [ ] Agent cards (connected/offline status)
  - [ ] Recent projects list

- [ ] **Phase 2: Planning View**
  - [ ] Chat interface for task planning
  - [ ] File preview sidebar
  - [ ] Agent assignment panel
  - [ ] Approve/cancel flow

- [ ] **Phase 3: Execution View**
  - [x] Widget grid layout (react-resizable-panels)
  - [x] Terminal widget (streaming)
  - [ ] Diff widget (file changes preview)
  - [x] Stats widget (time, tokens, cost)
  - [x] Task log widget
  - [x] Pause/stop controls

- [ ] **Phase 4: Review View**
  - [ ] Diff viewer (collapsible files)
  - [ ] CodeRabbit review panel
  - [ ] Commit message editor
  - [ ] Create PR / Commit actions
  - [ ] GitHub integration

---

### Real-Time Sync
> **Plan:** [REALTIME-SYNC-PLAN.md](./docs/REALTIME-SYNC-PLAN.md)

- [x] **Sprint 1: Quick Fixes** - Add missing WebSocket events
- [x] **Sprint 2: Centralized Events** - SyncEventEmitter class
- [x] **Sprint 3: Query Subscriptions** - useRealtimeQuery hook
- [x] **Sprint 4: Reactive Store** - ReactiveTaskStore wrapper

- [ ] **Future Enhancements**
  - [ ] Optimistic updates (apply changes before server confirmation)
  - [ ] Conflict resolution (handle concurrent edits)
  - [ ] Event sourcing (store event log for replay/debugging)
  - [ ] Offline support (queue mutations when disconnected)
  - [ ] Selective sync (only sync actively viewed data)

---

## Low Priority / Future

### Effect-TS Migration
> **Plan:** [EFFECT-MIGRATION-PLAN.md](./docs/EFFECT-MIGRATION-PLAN.md)

Refactor server to use Effect-TS for better error handling and composability.

- [ ] **Phase 1: Foundation**
  - [ ] Install Effect dependencies
  - [ ] Define error algebra (typed errors)
  - [ ] Project structure for services/layers

- [ ] **Phase 2: Core Services**
  - [ ] ClaudeCodeAdapter service + live layer
  - [ ] Define service tags and shapes

- [ ] **Phase 3: Persistence Layer**
  - [ ] ThreadStore service
  - [ ] SQLite live layer with finalizers

- [ ] **Phase 4: Server Integration**
  - [ ] Compose layers (ServerLive)
  - [ ] Wire to Hono routes

- [ ] **Phase 5: Event Streaming**
  - [ ] Canonical event mapping (SDK → app events)
  - [ ] WebSocket integration with Effect streams

---

### Orchestration Engine
> **Plan:** [ORCHESTRATION-MIGRATION-PLAN.md](./docs/ORCHESTRATION-MIGRATION-PLAN.md)

Adopt T3 Code's event-sourcing patterns for durable task history.

- [ ] **Phase 1: Event Store Foundation**
  - [ ] Define event schema (task events)
  - [ ] Create event store (SQLite)
  - [ ] Command router (command → event mapping)

- [ ] **Phase 2: Provider Adapter Abstraction**
  - [ ] Provider adapter interface
  - [ ] Claude Code adapter (SDK-based)
  - [ ] Runtime ingestion service (provider events → orchestration commands)

- [ ] **Phase 3: Projections & Read Models**
  - [ ] Projection tables (denormalized for fast queries)
  - [ ] Projector service (apply events → update projections)

- [ ] **Phase 4: Checkpoints & Rollback**
  - [ ] Checkpoint service (git-backed snapshots)
  - [ ] Diff storage
  - [ ] Revert to any turn capability

- [ ] **Phase 5: UI Integration**
  - [ ] Snapshot API (WebSocket method)
  - [ ] Real-time event push to clients
  - [ ] Activity feed / timeline view
  - [ ] Checkpoint diff viewer

---

## Completed

- [x] Terminal streaming with Claude Code SDK
- [x] WebSocket event broadcasting
- [x] Task persistence with SQLite
- [x] Goals and task grouping
- [x] Agent status panel
- [x] Command palette (Cmd+K)
- [x] Resizable panel layout (tmux-style)
- [x] Widget focus management (arrow keys)
- [x] Layout presets (default, master-stack, quad, etc.)
- [x] Real-time query subscriptions (useRealtimeQuery)
- [x] Reactive task store (auto-emit on mutations)

---

## Notes

### Design Principles
1. **Follow the task pattern** - Use `project_path` column consistently for workspace scoping
2. **Graceful degradation** - If DB fails, still work with local state
3. **Session cleanup** - Always close sessions before switching workspaces
4. **Extensibility** - Widget registry supports future widget types

### Open Questions
- Multi-window support: Should different Electron windows share terminals?
- Terminal history limits: How many messages to persist per terminal?
- Workspace deletion: What happens to terminals when a project is removed?
- Remote workspaces: How to handle SSH/remote project paths?
- Widget plugins: Should third-party widgets be supported?

---

## References

- [WORKSPACE-SCOPED-DATA-PLAN.md](./docs/WORKSPACE-SCOPED-DATA-PLAN.md) - Terminal/widget workspace scoping
- [REALTIME-SYNC-PLAN.md](./docs/REALTIME-SYNC-PLAN.md) - WebSocket sync architecture
- [EFFECT-MIGRATION-PLAN.md](./docs/EFFECT-MIGRATION-PLAN.md) - Effect-TS refactor
- [ORCHESTRATION-MIGRATION-PLAN.md](./docs/ORCHESTRATION-MIGRATION-PLAN.md) - Event sourcing patterns
- [UI-PLAN.md](./docs/UI-PLAN.md) - Frontend UI/UX design
