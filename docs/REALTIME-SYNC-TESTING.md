# Real-Time Sync Testing Plan

This document outlines how to test the Convex-inspired real-time sync implementation.

## Prerequisites

1. Server running: `npm run dev` in `packages/server`
2. UI running: `npm run dev` in `packages/ui`
3. Browser DevTools open (Console tab)

---

## Test 1: Active Sessions (Prompt Lifecycle)

### Test 1.1: Prompt Appears Immediately
**Steps:**
1. Open the Tasks Widget (should default to "Active" tab)
2. Send a prompt to a terminal
3. Observe the Active tab

**Expected:**
- Session appears within 100ms with a summarized title
- Spinner shows while prompt is running
- Count badge on "Active" tab updates

### Test 1.2: AI Summary Updates
**Steps:**
1. Send a longer prompt (>40 characters)
2. Watch the session card

**Expected:**
- Initial quick summary appears immediately (heuristic)
- AI-generated summary replaces it within 2-5 seconds

### Test 1.3: Prompt Completion
**Steps:**
1. Wait for a prompt to complete

**Expected:**
- Session moves from "Active" to "Recently Completed" section
- Duration shows (e.g., "2.3s")
- No page refresh needed

### Test 1.4: Context Menu
**Steps:**
1. Right-click on an active session

**Expected:**
- Context menu appears with "Highlight Terminal" and "Stop & Delete"
- "Highlight Terminal" focuses the correct terminal
- "Stop & Delete" removes the session

---

## Test 2: Work Items (Tasks)

### Test 2.1: Task Extraction
**Steps:**
1. Send a prompt that generates output mentioning tasks
2. Check the "Work Items" tab

**Expected:**
- Extracted tasks appear automatically
- No page refresh needed

### Test 2.2: Task Actions
**Steps:**
1. Click the checkmark to complete a task
2. Click the X to dismiss a task
3. Click play to start a task

**Expected:**
- Task status updates immediately in UI
- Other connected clients see the change (open in 2 browser windows)

### Test 2.3: Multi-Client Sync
**Steps:**
1. Open the app in two browser windows
2. Complete a task in window 1

**Expected:**
- Task updates in window 2 within 100ms
- No manual refresh needed

---

## Test 3: Goals

### Test 3.1: Create Goal
**Steps:**
1. Go to "Goals" tab
2. Click "+" to create a new goal
3. Enter a title

**Expected:**
- Goal appears immediately in the list
- Other connected clients see the new goal

### Test 3.2: Move Task to Goal
**Steps:**
1. Drag a task from Inbox to a Goal (or use move button)

**Expected:**
- Task moves to goal immediately
- Goal task count updates
- Inbox count decreases

### Test 3.3: Archive Goal
**Steps:**
1. Click delete/archive on a goal

**Expected:**
- Goal disappears from list
- Associated tasks remain (as orphaned in inbox)

---

## Test 4: Query Subscriptions (Advanced)

### Test 4.1: Subscription Messages
**Steps:**
1. Open browser DevTools → Network → WS
2. Find the WebSocket connection
3. Filter messages

**Expected:**
- See `subscribe` messages when component mounts
- See `query.result` messages with data
- See `unsubscribe` on navigation away

### Test 4.2: Dependency Tracking
**Steps:**
1. Complete a task (changes `tasks` table)
2. Watch WebSocket messages

**Expected:**
- `tasks.list`, `tasks.inbox`, `tasks.counts` queries re-run
- `goals.list` re-runs (since goals depend on task counts)
- `sessions.active` does NOT re-run (no dependency)

### Test 4.3: Hash Comparison
**Steps:**
1. Trigger a mutation that doesn't change data (e.g., dismiss already dismissed task)

**Expected:**
- Server logs show query re-run
- No `query.result` sent to client (hash unchanged)

---

## Test 5: Error Handling

### Test 5.1: Server Restart
**Steps:**
1. Stop the server (`Ctrl+C`)
2. Observe UI
3. Restart server

**Expected:**
- UI shows connection lost state (or gracefully handles)
- On reconnect, subscriptions re-establish
- Data syncs correctly

### Test 5.2: Invalid Query
**Steps:**
1. (Dev only) Modify UI to subscribe to non-existent query

**Expected:**
- `query.error` message received
- UI handles gracefully (no crash)

---

## Test 6: Performance

### Test 6.1: Many Active Sessions
**Steps:**
1. Start 5+ prompts simultaneously
2. Watch UI responsiveness

**Expected:**
- UI remains responsive
- All sessions appear and update correctly
- No dropped events

### Test 6.2: Large Task List
**Steps:**
1. Generate 100+ tasks
2. Switch between tabs

**Expected:**
- Tab switches are fast
- Task list renders smoothly
- Real-time updates continue working

---

## Console Commands for Testing

```javascript
// Check current subscriptions (run in browser console)
// Look for [QueryManager] logs in server console

// Manually trigger a task update (requires API access)
fetch('http://localhost:3333/extracted-tasks/TASK_ID/complete', { method: 'POST' })

// Create a test goal
fetch('http://localhost:3333/goals', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Test Goal', createdVia: 'manual' })
})
```

---

## Success Criteria

| Metric | Target |
|--------|--------|
| Update latency | < 100ms |
| Multi-client sync | All clients in sync |
| No manual refresh | All changes auto-update |
| Memory stability | No leaks on long sessions |
| Reconnection | Automatic recovery |

---

## Troubleshooting

### Events not updating UI
1. Check WebSocket connection in DevTools
2. Look for `query.result` messages
3. Check server console for `[QueryManager]` logs
4. Verify `notifyDataChanged` is being called

### Stale data after reconnect
1. Check if subscriptions are re-established
2. Look for initial `query.result` on reconnect
3. Verify client ID tracking on server

### Duplicate updates
1. Check for multiple subscriptions to same query
2. Verify `subscriptionId` matching in client
3. Look for race conditions in useEffect cleanup
