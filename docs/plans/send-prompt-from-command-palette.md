# Plan: Send Prompt to Console from Command Palette

## Overview

Add a command palette feature that allows users to send a prompt directly to either a new agent console or an existing console. The command should also appear as a **fallback option** when the user's search query doesn't match any other commands.

## UX Flow (Target First, Then Prompt)

1. User opens command palette (⌘P)
2. User types "Send Prompt to Console" or triggers fallback by typing something that doesn't match other commands
3. User sees subcommand list: "+ New Console" and existing consoles
4. For "+ New Console": shows agent selection (Claude Code, OpenClaw agents)
5. After selecting target, enters input mode for typing the prompt
6. On Enter, prompt is sent to the selected console

## Key Behaviors

### Normal Access

- Searchable via "send", "prompt", "message", "console", "chat" keywords
- Appears in the console category

### Fallback Behavior

When the user types something in the command palette and **no commands match**, the "Send Prompt to Console" command should appear with the user's query pre-filled. This allows users to quickly send any typed text as a prompt.

**Example Flow:**

1. User opens ⌘P
2. Types "fix the login bug"
3. No commands match → Shows "Send 'fix the login bug' to console"
4. User selects it → sees console selection
5. Selects console → prompt is sent immediately (query becomes the prompt)

---

## Files to Modify

### 1. `/packages/ui/src/stores/workspace.ts`

Add callback registration for sending prompts to consoles.

**Add to `WorkspaceState` interface (around line 615):**

```typescript
// Send prompt to console callback (set by Workspace.tsx)
onSendToConsole: ((prompt: string, consoleId: string) => void) | null;

// Pending prompt for fallback flow
pendingPrompt: string | null;
```

**Add actions:**

```typescript
registerSendToConsoleCallback: (callback: (prompt: string, consoleId: string) => void) => void;
sendToConsole: (prompt: string, consoleId: string) => void;
setPendingPrompt: (prompt: string | null) => void;
```

**Implementation (around line 1127):**

```typescript
// Initial state
onSendToConsole: null,
pendingPrompt: null,

// Register callback
registerSendToConsoleCallback: (callback) => set({ onSendToConsole: callback }),

// Action dispatcher
sendToConsole: (prompt, consoleId) => {
  const { onSendToConsole } = get();
  if (onSendToConsole) {
    onSendToConsole(prompt, consoleId);
  } else {
    console.warn('[WorkspaceStore] No sendToConsole callback registered');
  }
},

// Pending prompt for fallback
setPendingPrompt: (prompt) => set({ pendingPrompt: prompt }),
```

---

### 2. `/packages/ui/src/components/workspace/Workspace.tsx`

Register the send-to-console callback using existing `handleSendTaskToTerminal`.

```typescript
// In the useEffect that registers other callbacks (search for registerConsoleCallback):
useEffect(() => {
  // ... existing callback registrations ...

  useWorkspaceStore.getState().registerSendToConsoleCallback(
    (prompt: string, consoleId: string) => handleSendTaskToTerminal(prompt, consoleId)
  );
}, [handleSendTaskToTerminal]);
```

---

### 3. `/packages/ui/src/lib/commands/default-commands.ts`

Add new "Send Prompt to Console" command.

**Add import:**

```typescript
import { Send } from 'lucide-react';
```

**Add command (after 'search-sessions', around line 291):**

```typescript
// Send Prompt to Console
{
  id: 'send-prompt-to-console',
  label: 'Send Prompt to Console',
  description: 'Send a prompt to a new or existing agent console',
  category: 'console',
  icon: Send,
  keywords: ['send', 'prompt', 'message', 'console', 'agent', 'chat', 'ask'],
  action: {
    type: 'subcommand',
    getCommands: (): Command[] => {
      const { claudeCodeAvailable } = useAppStore.getState();
      const { consoles, agents: workspaceAgents, pendingPrompt } = useWorkspaceStore.getState();

      const subcommands: Command[] = [];

      // === NEW CONSOLE OPTIONS ===
      subcommands.push({
        id: 'prompt-new-console',
        label: '+ New Console',
        description: 'Create a new console and send prompt',
        category: 'console',
        action: {
          type: 'subcommand',
          getCommands: (): Command[] => {
            const { pendingPrompt } = useWorkspaceStore.getState();
            const newConsoleOptions: Command[] = [];

            // Claude Code option
            if (claudeCodeAvailable) {
              newConsoleOptions.push({
                id: 'prompt-new-claude-code',
                label: 'Claude Code',
                description: pendingPrompt
                  ? `Send pending prompt to new Claude Code console`
                  : 'Create new Claude Code console',
                category: 'console',
                action: pendingPrompt ? {
                  // Direct execution when we have a pending prompt
                  type: 'execute',
                  handler: () => {
                    const store = useWorkspaceStore.getState();
                    const prompt = store.pendingPrompt!;
                    store.setPendingPrompt(null);
                    store.createConsole('claude-code-local');
                    setTimeout(() => {
                      const newConsoles = useWorkspaceStore.getState().consoles;
                      const latestConsole = newConsoles[newConsoles.length - 1];
                      if (latestConsole) {
                        store.sendToConsole(prompt, latestConsole.id);
                      }
                    }, 500);
                  },
                } : {
                  type: 'input',
                  placeholder: 'Enter prompt to send...',
                  onSubmit: (prompt: string) => {
                    const store = useWorkspaceStore.getState();
                    store.createConsole('claude-code-local');
                    setTimeout(() => {
                      const newConsoles = useWorkspaceStore.getState().consoles;
                      const latestConsole = newConsoles[newConsoles.length - 1];
                      if (latestConsole) {
                        store.sendToConsole(prompt, latestConsole.id);
                      }
                    }, 500);
                  },
                },
              });
            }

            // OpenClaw/other agents
            for (const agent of workspaceAgents) {
              if (agent.type !== 'claude-code') {
                newConsoleOptions.push({
                  id: `prompt-new-${agent.id}`,
                  label: agent.name,
                  description: pendingPrompt
                    ? `Send pending prompt to new ${agent.type} console`
                    : `Create new ${agent.type} console`,
                  category: 'console',
                  action: pendingPrompt ? {
                    type: 'execute',
                    handler: () => {
                      const store = useWorkspaceStore.getState();
                      const prompt = store.pendingPrompt!;
                      store.setPendingPrompt(null);
                      store.createConsole(agent.id);
                      setTimeout(() => {
                        const newConsoles = useWorkspaceStore.getState().consoles;
                        const latestConsole = newConsoles[newConsoles.length - 1];
                        if (latestConsole) {
                          store.sendToConsole(prompt, latestConsole.id);
                        }
                      }, 500);
                    },
                  } : {
                    type: 'input',
                    placeholder: 'Enter prompt to send...',
                    onSubmit: (prompt: string) => {
                      const store = useWorkspaceStore.getState();
                      store.createConsole(agent.id);
                      setTimeout(() => {
                        const newConsoles = useWorkspaceStore.getState().consoles;
                        const latestConsole = newConsoles[newConsoles.length - 1];
                        if (latestConsole) {
                          store.sendToConsole(prompt, latestConsole.id);
                        }
                      }, 500);
                    },
                  },
                });
              }
            }

            if (newConsoleOptions.length === 0) {
              return [{
                id: 'no-agents-for-prompt',
                label: 'No agents available',
                description: 'Connect an agent first',
                category: 'console',
                action: { type: 'execute', handler: () => {} },
              }];
            }

            return newConsoleOptions;
          },
        },
      });

      // === EXISTING CONSOLES ===
      for (const console of consoles) {
        subcommands.push({
          id: `prompt-to-${console.id}`,
          label: console.agentName,
          description: pendingPrompt
            ? `Send pending prompt to ${console.agentName}`
            : `Send to existing console (${console.id.slice(0, 8)})`,
          category: 'console',
          action: pendingPrompt ? {
            // Direct execution when we have a pending prompt
            type: 'execute',
            handler: () => {
              const store = useWorkspaceStore.getState();
              store.sendToConsole(store.pendingPrompt!, console.id);
              store.setPendingPrompt(null);
            },
          } : {
            type: 'input',
            placeholder: 'Enter prompt to send...',
            onSubmit: (prompt: string) => {
              useWorkspaceStore.getState().sendToConsole(prompt, console.id);
            },
          },
        });
      }

      return subcommands;
    },
  },
},
```

---

### 4. `/packages/ui/src/components/command-palette/CommandPalette.tsx`

Add fallback behavior when no commands match.

**Add import:**

```typescript
import { Send } from 'lucide-react';
```

**Add the FallbackPromptOption component (above the main component):**

```tsx
function FallbackPromptOption({
  query,
  onSelect,
  isSelected,
}: {
  query: string;
  onSelect: () => void;
  isSelected: boolean;
}) {
  return (
    <div className="py-2">
      <button
        onClick={onSelect}
        className={`w-full px-4 py-3 flex items-center gap-3 text-left transition-colors ${
          isSelected ? 'bg-zinc-800' : 'hover:bg-zinc-800'
        }`}
        data-selected={isSelected}
      >
        <Send className="w-4 h-4 text-violet-400" />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-zinc-100 truncate">
            Send "{query.length > 40 ? query.slice(0, 40) + '...' : query}" to console
          </div>
          <div className="text-xs text-zinc-500">
            No matching commands • Send as prompt instead
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-zinc-600" />
      </button>
    </div>
  );
}
```

**Modify the "No commands found" section (around line 357-360):**

Replace:

```tsx
) : flatCommands.length === 0 ? (
  <div className="px-4 py-6 text-center text-zinc-500 text-sm">
    No commands found
  </div>
```

With:

```tsx
) : flatCommands.length === 0 && query.trim() ? (
  // Fallback: offer to send the query as a prompt to a console
  <FallbackPromptOption
    query={query}
    isSelected={true}
    onSelect={() => {
      const sendPromptCmd = commandRegistry.getById('send-prompt-to-console');
      if (sendPromptCmd) {
        useWorkspaceStore.getState().setPendingPrompt(query);
        pushSubcommand(sendPromptCmd);
      }
    }}
  />
) : flatCommands.length === 0 ? (
  <div className="px-4 py-6 text-center text-zinc-500 text-sm">
    No commands found
  </div>
```

**Update handleKeyDown to support Enter on fallback (around line 239):**

In the Enter case, add handling for when flatCommands is empty but we have a query:

```tsx
case 'Enter':
  e.preventDefault();
  if (inputMode.active) {
    if (inputMode.onSubmit && inputValue.trim()) {
      inputMode.onSubmit(inputValue.trim());
      close();
    }
  } else if (flatCommands[selectedIndex]) {
    executeCommand(flatCommands[selectedIndex]);
  } else if (flatCommands.length === 0 && query.trim()) {
    // Fallback: trigger send-prompt-to-console with query
    const sendPromptCmd = commandRegistry.getById('send-prompt-to-console');
    if (sendPromptCmd) {
      useWorkspaceStore.getState().setPendingPrompt(query);
      pushSubcommand(sendPromptCmd);
    }
  }
  break;
```

---

## Implementation Summary

| File | Change |
|------|--------|
| `stores/workspace.ts` | Add `onSendToConsole`, `pendingPrompt`, and related actions |
| `Workspace.tsx` | Register `handleSendTaskToTerminal` as the callback |
| `default-commands.ts` | Add "Send Prompt to Console" command with nested structure |
| `CommandPalette.tsx` | Add fallback option when no commands match + keyboard support |

---

## Verification Steps

1. **Test normal command access:**
   - Open ⌘P, type "send prompt"
   - Should see "Send Prompt to Console" command
   - Select it, see console options

2. **Test fallback behavior:**
   - Open ⌘P, type "fix the authentication bug"
   - No commands should match
   - Should see fallback: "Send 'fix the authentication bug' to console"
   - Select it → console selection → prompt sent

3. **Test existing console flow:**
   - Have at least one console open
   - Use command to send prompt to existing console
   - Verify prompt appears in console

4. **Test new console flow:**
   - Use "+ New Console" option
   - Select agent type
   - Type prompt (or use pending prompt from fallback)
   - Verify new console created with prompt

5. **Test keyboard navigation:**
   - When fallback shows, pressing Enter should trigger it
   - Escape should close the palette

---

## Edge Cases

- **No consoles and no agents**: Show "No agents available" message
- **Very long query**: Truncate in fallback display (40 chars + "...")
- **Empty query**: Don't show fallback (no prompt to send)
- **pendingPrompt cleanup**: Always clear after use to prevent stale prompts
