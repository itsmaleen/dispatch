# Worktree Detection - Implementation Issues & Learnings

**Date:** 2026-03-26
**Status:** Reverted - Need to Rethink Approach

## Background

We attempted to implement a comprehensive worktree detection and health monitoring system with 3 phases:
1. **Phase 1:** Metadata fallback + database migration
2. **Phase 2:** 2-part detection (database + runtime verification)
3. **Phase 3:** Server-side health validation with real-time monitoring

**Commits Reverted:**
- `8ee7b89` - Implement Phase 2: Robust 2-part worktree detection system
- `f32eeff` - Fix worktree branch detection - Phase 1: Metadata fallback + migration

**Reverted to:** `d13497c` - Fix auto-scroll toggle and worktree branch persistence

## What We Implemented

### Phase 1: Metadata Fallback
- Added Migration 7 to backfill `worktree_branch` from metadata for old threads
- Updated `rowToThread()` in sqlite-store.ts to fallback to metadata when column is NULL
- **Goal:** Ensure existing threads would show branch names

### Phase 2: 2-Part Detection System
- Created `detectWorktree()` function combining:
  1. Database state check (worktreePath, worktreeBranch from thread)
  2. Runtime path verification (console.path === worktreePath)
- Updated `WorktreeButton` to show 3 states:
  - Purple badge: Active worktree (paths match)
  - Amber warning: Path mismatch
  - Gray button: No worktree
- **Goal:** Robust detection that catches path mismatches

### Phase 3: Server-Side Health Validation
- Created `/threads/:id/worktree/status` API endpoint
- Implemented `validateWorktreeStatus()` checking:
  - Filesystem existence
  - Git uncommitted changes count
  - Commits ahead/behind base branch
- Added `worktreeHealth` state in UI with 30-second polling
- Enhanced `WorktreeButton` to display:
  - Red dot: Worktree missing
  - Yellow badge: Uncommitted changes count
  - Green ↑N / Amber ↓N: Commits ahead/behind
  - Green checkmark: Clean and up to date
- **Goal:** Real-time health monitoring with visual indicators

## What Didn't Work

### Critical Issue: Worktree Detection Not Working

**Symptom:**
- Worktree buttons not showing on agent console windows at all
- No branch names displayed even for active worktrees

**Debug Findings:**
We added extensive logging to diagnose:
```javascript
console.log('[detectWorktree]', {
  consoleId,
  dbWorktreePath,
  dbWorktreeBranch,
  consolePath,
  threadId,
  hasHealthData,
});
```

**Expected:** Logs showing worktree paths and branch detection
**Actual:** (User reported detection not working before we could capture logs)

## Root Cause Analysis

### Suspected Issues

1. **Data Flow Problem**
   - `worktreePath` and `worktreeBranch` may not be properly propagating from thread data to `ConsoleState`
   - The path from database → API → ConsoleState → detectWorktree() may be broken

2. **Timing Issue**
   - Health data fetching depends on `terminals.filter(t => t.worktreePath && t.threadId)`
   - If `worktreePath` isn't set on the terminal state, health fetching never starts

3. **State Synchronization**
   - Console state may be getting created before thread data is fetched
   - Resume flow might not be properly populating worktree fields

4. **Type Safety Holes**
   - We had to add type casts (`as Record<string, unknown>`) and explicit `any` types
   - This suggests the data structure may not match expectations

## TypeScript Errors Fixed (But Not Core Issue)

We fixed multiple TypeScript errors:
- `toolInput` type compatibility (Workspace.tsx:4734)
- Implicit `any` types for map callbacks
- Missing properties on WorkspaceState (showNotification, focusWidget)
- Missing FileChange import

However, these were symptoms, not the cause of the detection failure.

## What We Learned

### Architecture Concerns

1. **Too Many Layers**
   - Database → Server API → UI State → Detection Function → Button Component
   - Each layer is a potential point of failure
   - Hard to debug when data doesn't flow through

2. **State Management Complexity**
   - ConsoleState has worktreePath/Branch
   - Separate worktreeHealth Map
   - Detection function combines both
   - Too much state coordination

3. **Missing Validation**
   - No runtime validation that worktree data actually exists
   - No error boundaries when detection fails
   - Silent failures make debugging hard

### Build Process Improvements Made

We did successfully improve the build process:
- Added `build:safe` script with typecheck
- Updated `install:app` to build contracts before typecheck
- Updated `sign:mac` to validate types before signing

## Recommended Next Steps

### 1. Simplify Detection Strategy

Instead of complex 2-part + health validation:
```typescript
// Simple approach: Just check if worktree exists in database
function hasWorktree(console: ConsoleState): boolean {
  return !!(console.worktreePath && console.worktreeBranch);
}
```

Start simple, add complexity only when base case works.

### 2. Debug Console State First

Before adding detection logic, verify:
```typescript
console.log('[Console Created]', {
  id: console.id,
  threadId: console.threadId,
  worktreePath: console.worktreePath,
  worktreeBranch: console.worktreeBranch,
  path: console.path,
});
```

Ensure the data exists at the source.

### 3. Add Explicit Data Loading

Make worktree data loading explicit:
```typescript
// When console is created/resumed
if (threadId) {
  const thread = await fetchThread(threadId);
  if (thread.worktreePath) {
    setWorktreeInfo(thread.worktreePath, thread.worktreeBranch);
  }
}
```

Don't rely on implicit data flow.

### 4. Progressive Enhancement

1. **Step 1:** Just show "Has Worktree" indicator (boolean)
2. **Step 2:** Show branch name once Step 1 works
3. **Step 3:** Add path validation
4. **Step 4:** Add health monitoring

Build incrementally with validation at each step.

### 5. Better Error Handling

```typescript
function detectWorktree(console: ConsoleState): WorktreeStatus | null {
  try {
    if (!console.worktreePath) {
      console.debug('[Worktree] No worktree path found');
      return null;
    }

    if (!console.worktreeBranch) {
      console.warn('[Worktree] Path exists but no branch!', console.worktreePath);
      // Still show something rather than nothing
      return { path: console.worktreePath, branch: 'unknown' };
    }

    return { path: console.worktreePath, branch: console.worktreeBranch };
  } catch (err) {
    console.error('[Worktree] Detection failed:', err);
    return null;
  }
}
```

## Files That Need Review

When re-implementing, focus on these critical files:

### Server-Side
- `packages/server/src/persistence/sqlite-store.ts` - Thread data retrieval
- `packages/server/src/adapters/session-manager.ts` - Thread to console mapping
- `packages/server/src/server.ts` - API endpoints

### Client-Side
- `packages/ui/src/components/workspace/Workspace.tsx` - Console state management
- `packages/ui/src/components/workspace/WorktreePanel.tsx` - UI components
- `packages/ui/src/stores/workspace.ts` - Global state

## Questions to Answer Before Next Implementation

1. **Where is worktree data loaded?**
   - Console creation?
   - Resume flow?
   - Explicit fetch?

2. **How do we verify data exists?**
   - Database query?
   - Console log inspection?
   - Automated test?

3. **What's the minimal working implementation?**
   - Just show branch name?
   - Just show "isolated" badge?
   - What's the absolute minimum?

4. **How do we test it works?**
   - Create worktree → verify button appears
   - Resume session → verify branch name shows
   - Delete worktree → verify warning appears

## Conclusion

The implementation was architecturally sound but failed in execution due to:
1. Insufficient debugging at the data layer
2. Too much complexity added before validating basics
3. No incremental validation of each feature

**Recommendation:** Start over with a minimal implementation and build up only after each layer is validated.
