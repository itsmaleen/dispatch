# Worktree Merge Commit Fix Plan

## Problem Summary

When merging a worktree branch, the commit messages are generic and unhelpful (e.g., "Auto-commit before merge: Merge branch 'agent/foo'"). The intended behavior was to have the agent create a proper commit with a meaningful message summarizing its work before the merge.

## Current Issues

### Issue 1: Pre-merge commit uses direct git command, not the agent session

**Location**: `packages/server/src/services/worktree-manager.ts` lines 446-452

```typescript
// Current behavior - direct git commit with generic message
const hasUncommitted = !(await git.isClean(worktreePath));
if (hasUncommitted) {
  const commitMessage = `Auto-commit before merge: ${message || `Merge branch '${branch}'`}`;
  await git.commitAll(worktreePath, commitMessage);
  console.log(`[WorktreeManager] Auto-committed uncommitted changes in ${branch}`);
}
```

**Problem**: This bypasses the agent entirely. The agent has full context of what it did, but we're not using it to create the commit.

**Expected behavior**: Send a message to the existing agent session asking it to commit its changes with a descriptive message, then wait for completion before proceeding with the merge.

### Issue 2: MergeMessageGenerator has limited/empty conversation history

**Location**: `packages/server/src/adapters/session-manager.ts` lines 1077-1082

```typescript
const messages = this.getMessages(threadId);
const conversationMessages = messages.map(m => ({
  role: m.role as 'user' | 'assistant',
  content: m.content,
}));
```

**Problem**: The `outputBuffer` that gets stored as message content only captures **text blocks** from SDK events:

- `assistant` event: only `block.type === 'text'` content (line 786)
- `stream_event`: only `text_delta` content (line 800)

This means:
- Tool invocations (Edit, Write, Bash, Read, etc.) are NOT captured
- Only Claude's conversational text responses are stored
- For agentic coding work where Claude primarily uses tools, the stored messages may be nearly empty or not representative of the actual work

**Location of text-only capture**: `packages/server/src/adapters/session-manager.ts` lines 781-804

```typescript
case 'assistant': {
  const content = (event.message as any)?.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        // Only text blocks captured - tool_use blocks ignored
        if (!session.outputBuffer.includes(block.text)) {
          session.outputBuffer += block.text;
        }
      }
    }
  }
  break;
}
```

## Proposed Fix

### Step 1: Use the existing session to create the pre-merge commit

In `SessionManager.mergeWorktree()`, before calling `worktreeManager.merge()`:

1. Check if there are uncommitted changes in the worktree
2. If yes, send a message to the existing session asking Claude to commit:
   ```
   "Please commit all your current changes with a descriptive commit message that summarizes what you've accomplished in this session."
   ```
3. Wait for the session to complete (the agent will run `git add` and `git commit`)
4. Then proceed with the merge

**Key insight**: The agent session already has full context via the SDK's `resume` functionality. Even if our stored messages are sparse, the SDK maintains the full conversation history.

### Step 2 (Optional): Improve message storage for future reference

Consider capturing tool use summaries in the stored messages. For each `tool_use` block, store a summary like:
```
[Tool: Edit] file: src/foo.ts
[Tool: Bash] command: npm test
```

This would make the stored conversation more useful for:
- MergeMessageGenerator fallback
- User visibility into what the agent did
- Debugging and auditing

## Implementation Details

### Modified mergeWorktree flow

```typescript
async mergeWorktree(
  threadId: string,
  options: { targetBranch?: string; message?: string; removeAfterMerge?: boolean } = {}
): Promise<MergeResult> {
  const thread = this.getStore().getThread(threadId);
  // ... existing validation ...

  const worktreeManager = getWorktreeManager(thread.projectPath);
  const worktreePath = worktreeManager.getWorktreePath(branch);

  // Check for uncommitted changes
  const hasUncommitted = !(await git.isClean(worktreePath));

  if (hasUncommitted) {
    // NEW: Ask the agent to commit instead of doing it directly
    const session = this.sessions.get(threadId);

    if (session && thread.sessionId) {
      // Send commit request to the existing session
      const commitPrompt = `Please commit all your current changes with a descriptive commit message that summarizes what you've accomplished. Use conventional commit format (feat/fix/refactor/etc).`;

      await this.send(threadId, { message: commitPrompt });

      // Wait for the session to complete
      await this.waitForSessionIdle(threadId, 60000); // 60s timeout
    } else {
      // Fallback: direct commit if no session available
      const commitMessage = `Auto-commit before merge: ${message || `Merge branch '${branch}'`}`;
      await git.commitAll(worktreePath, commitMessage);
    }
  }

  // Proceed with merge (can use simpler message since agent already committed)
  const result = await worktreeManager.merge(branch, {
    targetBranch: options.targetBranch,
    message: options.message || thread.name || `Merge branch '${branch}'`,
  });

  // ... rest of cleanup logic ...
}
```

### New helper method needed

```typescript
/** Wait for a session to become idle (not running) */
private async waitForSessionIdle(threadId: string, timeoutMs: number): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const session = this.sessions.get(threadId);
    if (!session || session.status === 'idle') {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`Timeout waiting for session ${threadId} to become idle`);
}
```

## Files to Modify

1. **`packages/server/src/adapters/session-manager.ts`**
   - Modify `mergeWorktree()` to send commit prompt to session
   - Add `waitForSessionIdle()` helper method
   - Optionally: enhance `handleSDKMessage()` to capture tool use summaries

2. **`packages/server/src/services/worktree-manager.ts`**
   - Remove the auto-commit logic from `merge()` (lines 446-452)
   - Or keep it as a fallback but let SessionManager handle the primary path

3. **`packages/server/src/services/merge-message-generator.ts`** (optional)
   - May no longer be needed if the agent creates proper commits
   - Or simplify to just use thread name for the merge commit message

## Testing

1. Create a worktree session, make some changes via the agent
2. Click "Merge" in the UI
3. Verify the agent receives a commit prompt
4. Verify the agent creates a meaningful commit message
5. Verify the merge completes successfully

## Edge Cases to Handle

- Session not available (fallback to direct commit)
- Session times out (fallback to direct commit)
- Agent fails to commit (detect and handle error)
- No uncommitted changes (skip commit step entirely)
- Session is already running another prompt (wait or queue?)

## Notes

- The SDK's `resume` parameter means the agent has full conversation context even if our stored messages are sparse
- The agent is better positioned to create a meaningful commit because it knows exactly what tools it ran
- This approach leverages the existing session infrastructure rather than adding new AI calls
