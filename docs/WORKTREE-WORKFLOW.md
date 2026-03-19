# Worktree Development Workflow

This document describes the workflow for developing features in git worktrees and merging them back to the main branch.

## Overview

Git worktrees allow parallel development of features in isolated directories, each with its own working tree but sharing the same git history. This is useful for:

- Working on multiple features simultaneously
- Testing changes without affecting the main branch
- Isolating experimental work

## Directory Structure

Worktrees are stored under `~/.acc/worktrees/`:

```
~/.acc/worktrees/
└── agent-command-center/
    ├── agent-tasks/          # Feature branch worktree
    ├── bug-fix-123/          # Another feature branch
    └── experimental/         # Experimental branch
```

## Testing Changes in a Worktree

### 1. Navigate to the Worktree

```bash
cd ~/.acc/worktrees/agent-command-center/<branch-name>
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Run Development Server

```bash
# Start all packages (server + UI) in dev mode
bun run dev
```

This uses Turbo to run all packages concurrently. You should see:
- `@acc/contracts:dev` - TypeScript compilation in watch mode
- `@acc/server:dev` - Server with hot reload
- `@acc/ui:dev` - Electron app with Vite HMR

### 4. Run Individual Packages (Optional)

If you need to run packages separately for debugging:

```bash
# Server only
bun run --filter @acc/server dev

# UI only (requires server running)
bun run --filter @acc/ui dev

# Contracts only (watch mode)
bun run --filter @acc/contracts dev
```

### 5. Type Checking

```bash
# Check all packages
bun run typecheck

# Check specific package
bun run --filter @acc/server typecheck
```

### 6. Build for Production

```bash
bun run build
```

## Merging Worktree Changes

When your feature is complete and tested, merge it back to the main branch.

### 1. Commit All Changes in the Worktree

Before merging, ensure all changes are committed:

```bash
cd ~/.acc/worktrees/agent-command-center/<branch-name>

# Check status
git status

# Stage and commit changes
git add .
git commit -m "feat: description of your changes"
```

### 2. Push to Remote (Optional but Recommended)

```bash
git push origin <branch-name>
```

### 3. Switch to Main Repository

```bash
cd /path/to/main/agent-command-center
```

### 4. Merge the Feature Branch

```bash
# Fetch latest changes
git fetch origin

# Checkout main branch
git checkout main

# Merge the feature branch
git merge <branch-name>

# Or use --squash for a single commit
git merge --squash <branch-name>
git commit -m "feat: merged <branch-name> - description"
```

### 5. Push to Main

```bash
git push origin main
```

### 6. Clean Up the Worktree

After merging, you can remove the worktree:

```bash
# From the main repository
git worktree remove ~/.acc/worktrees/agent-command-center/<branch-name>

# Delete the remote branch (if pushed)
git push origin --delete <branch-name>

# Delete local branch
git branch -d <branch-name>
```

## Quick Reference

| Task | Command |
|------|---------|
| List worktrees | `git worktree list` |
| Create worktree | `git worktree add ~/.acc/worktrees/agent-command-center/<name> -b <branch>` |
| Remove worktree | `git worktree remove <path>` |
| Test in worktree | `cd <worktree-path> && bun install && bun run dev` |
| Commit changes | `git add . && git commit -m "message"` |
| Merge to main | `git checkout main && git merge <branch>` |

## Troubleshooting

### Build Errors with Missing Packages

If you see errors like `Could not resolve "@anthropic-ai/claude-agent-sdk"`:

1. Ensure dependencies are installed: `bun install`
2. Check if the package exists in `package.json`
3. Try cleaning and reinstalling:
   ```bash
   bun run clean
   bun install
   ```

### TypeScript Errors About Missing Types

Run `bun install` to ensure all `@types/*` packages are installed.

### Contracts Not Found

Build contracts first:
```bash
bun run --filter @acc/contracts build
```

### Port Already in Use

The server runs on port 3333. If it's already in use:
```bash
# Find and kill the process
lsof -ti:3333 | xargs kill -9

# Or specify a different port
PORT=3334 bun run --filter @acc/server dev
```
