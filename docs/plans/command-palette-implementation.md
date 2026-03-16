# Command Palette & Keyboard Shortcuts Implementation Plan

> **Status:** Planning
> **Target:** Linear-style command palette for faster workflow

## Overview

Implement a command palette (triggered by `Cmd/Ctrl + K`) with keyboard shortcuts for common actions like creating terminals, adapters, and tasks.

---

## File Structure

```
packages/ui/src/
├── components/
│   └── command-palette/
│       ├── CommandPalette.tsx      # Main modal component
│       ├── CommandItem.tsx         # Individual command row
│       ├── CommandGroup.tsx        # Category grouping
│       └── index.ts
├── stores/
│   └── command-palette.ts          # Zustand store for palette state
└── lib/
    └── commands/
        ├── types.ts                # Command type definitions
        ├── registry.ts             # Command registry with fuzzy search
        └── default-commands.ts     # Built-in commands
```

---

## Commands

### Required Commands

| Command | Category | Shortcut | Action |
|---------|----------|----------|--------|
| New Terminal | terminal | `Cmd+N` | Opens agent selector, then creates terminal |
| New Terminal (Claude Code) | terminal | - | Direct terminal with Claude Code |
| New Adapter (Claude Code) | adapter | - | POST `/adapters/claude-code/init` |
| New Adapter (OpenClaw) | adapter | - | Shows setup instructions |
| Create Task | task | `Cmd+Shift+N` | Input mode for task text |
| Go to Home | navigation | - | `setView('home')` |
| Go to Workspace | navigation | - | `setView('workspace-real')` |
| Go to Planning | navigation | - | `setView('planning')` |

### Suggested Additional Commands

| Command | Category | Action |
|---------|----------|--------|
| Refresh Agents | adapter | Refresh agent connection status |
| Toggle Tasks Panel | workspace | Minimize/expand tasks widget |
| Set Workspace Path | workspace | Input mode for path |
| Close All Terminals | terminal | Close all active terminals |
| Clear Terminal | terminal | Clear focused terminal output |
| Copy Terminal Output | terminal | Copy last output to clipboard |
| Toggle Auto-scroll | terminal | Toggle terminal auto-scroll |
| Interrupt Agent | terminal | Send interrupt signal to running agent |
| Open Folder | workspace | Open folder picker dialog |

---

## Implementation Phases

### Phase 1: Foundation

**Files to create:**

1. **`/packages/ui/src/lib/commands/types.ts`**
   ```typescript
   export type CommandCategory =
     | 'navigation'
     | 'terminal'
     | 'adapter'
     | 'task'
     | 'workspace'
     | 'settings';

   export interface Command {
     id: string;
     label: string;
     description?: string;
     category: CommandCategory;
     icon?: React.ComponentType<{ className?: string }>;
     shortcut?: string;                    // Display string like "⌘N"
     keywords?: string[];                  // Additional search terms
     disabled?: boolean | (() => boolean);
     hidden?: boolean | (() => boolean);
     action: CommandAction;
   }

   export type CommandAction =
     | { type: 'execute'; handler: () => void | Promise<void> }
     | { type: 'subcommand'; commands: () => Command[] }
     | { type: 'input'; placeholder: string; onSubmit: (value: string) => void };
   ```

2. **`/packages/ui/src/lib/commands/registry.ts`**
   - Store commands in a `Map<string, Command>`
   - Implement fuzzy search with scoring:
     - Exact match > Prefix match > Substring > Character match
   - Filter disabled/hidden commands
   - Group by category

3. **`/packages/ui/src/stores/command-palette.ts`**
   ```typescript
   interface CommandPaletteState {
     isOpen: boolean;
     query: string;
     selectedIndex: number;
     inputMode: {
       active: boolean;
       placeholder: string;
       onSubmit: ((value: string) => void) | null;
     };

     // Actions
     open: () => void;
     close: () => void;
     setQuery: (query: string) => void;
     setSelectedIndex: (index: number) => void;
     enterInputMode: (placeholder: string, onSubmit: (value: string) => void) => void;
     exitInputMode: () => void;
   }
   ```
   - Do NOT use persist middleware (ephemeral state)

### Phase 2: Basic Palette UI

4. **`/packages/ui/src/components/command-palette/CommandItem.tsx`**
   ```tsx
   interface CommandItemProps {
     command: Command;
     isSelected: boolean;
     onSelect: () => void;
   }
   ```
   - Hover: `bg-zinc-800`
   - Selected: `bg-violet-600/20 border-l-2 border-violet-500`
   - Icon left, label + description center, shortcut badge right

5. **`/packages/ui/src/components/command-palette/CommandGroup.tsx`**
   - Category header: `text-xs font-medium text-zinc-500 uppercase`
   - Renders list of CommandItems

6. **`/packages/ui/src/components/command-palette/CommandPalette.tsx`**
   ```tsx
   // Modal structure (follow AgentsPanel.tsx pattern)
   <div className="fixed inset-0 bg-black/50 flex items-start justify-center pt-[15vh] z-50">
     <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-xl overflow-hidden shadow-2xl">
       {/* Search input */}
       <div className="px-4 py-3 border-b border-zinc-800">
         <input
           autoFocus
           placeholder="Type a command or search..."
           className="w-full bg-transparent text-zinc-100 outline-none"
         />
       </div>

       {/* Command list */}
       <div className="max-h-[50vh] overflow-y-auto">
         {/* Grouped commands */}
       </div>

       {/* Footer hints */}
       <div className="px-4 py-2 border-t border-zinc-800 text-xs text-zinc-500">
         ↑↓ Navigate • Enter Select • Esc Close
       </div>
     </div>
   </div>
   ```

7. **Add keyboard handler to `App.tsx`**
   ```typescript
   useEffect(() => {
     const handleKeyDown = (e: KeyboardEvent) => {
       // Command palette
       if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
         e.preventDefault();
         useCommandPaletteStore.getState().open();
         return;
       }

       // Quick shortcuts
       if ((e.metaKey || e.ctrlKey) && e.key === 'n' && !e.shiftKey) {
         e.preventDefault();
         // Create new terminal
         return;
       }

       if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'N') {
         e.preventDefault();
         // Create new task
         return;
       }
     };

     window.addEventListener('keydown', handleKeyDown);
     return () => window.removeEventListener('keydown', handleKeyDown);
   }, []);
   ```

8. **Render `<CommandPalette />` in `App.tsx`**

### Phase 3: Wire Up Commands

9. **`/packages/ui/src/lib/commands/default-commands.ts`**
   - Register all commands with the registry
   - Import icons from `lucide-react`

10. **Connect navigation commands**
    - Import `useAppStore` and call `setView()`

11. **Connect terminal commands**
    - **Decision needed:** How to access `handleNewTerminal()`
      - Option A: Lift to Zustand (recommended)
      - Option B: React Context
      - Option C: Custom events

12. **Connect adapter commands**
    - POST to `/adapters/claude-code/init`
    - Call `refreshAgentStatus()`

13. **Connect task commands**
    - Access `handleAddStep()` or equivalent

### Phase 4: Advanced Features

14. **Input mode for Create Task**
    - When selected, palette enters input mode
    - Search input becomes task input
    - Enter submits, Escape cancels

15. **Subcommand mode for agent selection**
    - "New Terminal" shows agent list as subcommands
    - Breadcrumb: "New Terminal > Select Agent"
    - Backspace returns to parent

16. **Additional keyboard shortcuts**
    - `Cmd+N` - New terminal
    - `Cmd+Shift+N` - New task

### Phase 5: Polish

17. **Entry/exit animations**
    - Fade in backdrop
    - Scale up modal

18. **Keyboard shortcut badges**
    - Display `⌘K`, `⌘N` etc. in command list

19. **Empty state**
    - "No commands found" with suggestion

---

## Keyboard Shortcuts

### Global Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + K` | Open command palette |
| `Cmd/Ctrl + N` | New terminal (quick) |
| `Cmd/Ctrl + Shift + N` | New task (quick) |
| `Cmd/Ctrl + Shift + D` | Toggle demo (existing) |

### Palette Shortcuts

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate items |
| `Enter` | Execute selected command |
| `Escape` | Close palette / Exit input mode |
| `Backspace` (empty) | Go back from subcommand |

### Avoided Shortcuts (OS/Electron conflicts)

- `Cmd+Q`, `Cmd+W`, `Cmd+H` (OS-level)
- `Cmd+C`, `Cmd+V`, `Cmd+X` (clipboard)
- `Cmd+Z`, `Cmd+Shift+Z` (undo/redo)

---

## Architecture Decision: State Access

**Options for accessing workspace state (terminals, tasks) from commands:**

### Option A: Lift to Zustand (Recommended)

Move terminal/task state from `Workspace.tsx` to Zustand store:

```typescript
// stores/workspace.ts
interface WorkspaceStore {
  terminals: TerminalState[];
  planSteps: PlanStep[];

  createTerminal: (agentId?: string) => void;
  closeTerminal: (id: string) => void;
  createTask: (text: string, agentId?: string) => void;
  // ...
}
```

**Pros:** Cleanest integration, commands call store directly
**Cons:** Requires refactoring Workspace.tsx

### Option B: React Context

```typescript
const WorkspaceContext = createContext<WorkspaceActions>(null);

// In CommandPalette
const { createTerminal } = useContext(WorkspaceContext);
```

**Pros:** Minimal refactoring, keeps state in Workspace
**Cons:** Context dependency, harder to test

### Option C: Event-based

```typescript
// In command
window.dispatchEvent(new CustomEvent('command:new-terminal', { detail: { agentId } }));

// In Workspace
window.addEventListener('command:new-terminal', handleNewTerminal);
```

**Pros:** Most decoupled
**Cons:** More boilerplate, harder to debug

---

## Visual Design

### Colors (following existing theme)

- Background: `bg-zinc-900`
- Border: `border-zinc-700`
- Text primary: `text-zinc-100`
- Text secondary: `text-zinc-400`
- Text muted: `text-zinc-500`
- Selected: `bg-violet-600/20` + `border-l-2 border-violet-500`
- Hover: `bg-zinc-800`
- Shortcut badge: `bg-zinc-800 text-zinc-400 text-xs px-1.5 py-0.5 rounded`

### Icons (lucide-react)

- Navigation: `Home`, `Layout`, `FileText`
- Terminal: `Terminal`, `Plus`, `X`
- Adapter: `Plug`, `Cpu`
- Task: `Sparkles`, `Plus`, `CheckSquare`
- Settings: `Settings`

---

## Files to Modify

| File | Changes |
|------|---------|
| `App.tsx` | Add keyboard handler, render CommandPalette |
| `stores/app.ts` | (If Option A) Add workspace actions |
| `Workspace.tsx` | (If Option A) Use store instead of local state |

---

## Testing Checklist

- [ ] `Cmd+K` opens palette
- [ ] Typing filters commands (fuzzy search)
- [ ] Arrow keys navigate, selection highlights
- [ ] Enter executes command, palette closes
- [ ] Escape closes palette
- [ ] Click outside closes palette
- [ ] "New Terminal" creates terminal with selected agent
- [ ] "Create Task" enters input mode
- [ ] Input mode: Enter submits, Escape cancels
- [ ] `Cmd+N` creates terminal directly
- [ ] `Cmd+Shift+N` opens task input
- [ ] Works in Electron app
- [ ] No conflicts with existing shortcuts
