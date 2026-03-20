/**
 * Quick Actions Types
 *
 * Types and constants for the Project Starting Point quick actions.
 */

export interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: string;
  prompt: string;
  category: 'base' | 'project';
}

export interface ProjectScript {
  name: string;
  command: string;
  description?: string;
}

export interface RecentCommit {
  hash: string;
  message: string;
  date: string;
  author: string;
}

export type ProjectType = 'node' | 'python' | 'rust' | 'go' | 'ruby' | 'java' | 'unknown';

export interface ProjectContext {
  type: ProjectType;
  name: string;
  scripts: ProjectScript[];
  hasTests: boolean;
  hasDocs: boolean;
  readme?: string;
  recentCommits: RecentCommit[];
  suggestedActions: QuickAction[];
  isGitRepo: boolean;
}

/**
 * Base actions that are always available regardless of project type
 */
export const BASE_ACTIONS: QuickAction[] = [
  {
    id: 'explain',
    label: 'Explain this project',
    description: 'Understand the codebase structure and purpose',
    icon: '📖',
    prompt: 'Explain this project. What does it do, how is it structured, and what are the key components? Give me a high-level overview.',
    category: 'base',
  },
  {
    id: 'find-issues',
    label: 'Find potential issues',
    description: 'Review for bugs, security issues, and improvements',
    icon: '🔍',
    prompt: 'Review this codebase for potential issues including bugs, security vulnerabilities, and performance problems. Focus on the most critical issues first.',
    category: 'base',
  },
  {
    id: 'review-code',
    label: 'Review code quality',
    description: 'Analyze code patterns and suggest improvements',
    icon: '✨',
    prompt: 'Review the code quality of this project. Look at patterns, architecture, naming conventions, and suggest improvements.',
    category: 'base',
  },
];
