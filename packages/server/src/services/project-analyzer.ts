/**
 * Project Analyzer Service
 *
 * Analyzes a project directory to extract context for the Project Starting Point.
 * Detects project type, available scripts, documentation, and recent git activity.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { isGitRepo, gitExec } from './git';

// ============================================================================
// TYPES
// ============================================================================

export type ProjectType = 'node' | 'python' | 'rust' | 'go' | 'ruby' | 'java' | 'unknown';

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

export interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: string;
  prompt: string;
  category: 'base' | 'project';
}

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

// ============================================================================
// BASE ACTIONS (always available)
// ============================================================================

const BASE_ACTIONS: QuickAction[] = [
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

// ============================================================================
// PROJECT DETECTION
// ============================================================================

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function readTextFile(filePath: string, maxLength: number = 1000): Promise<string | undefined> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    if (content.length > maxLength) {
      return content.substring(0, maxLength) + '...';
    }
    return content;
  } catch {
    return undefined;
  }
}

async function detectProjectType(projectPath: string): Promise<ProjectType> {
  // Check for various project indicators in order of specificity
  const checks: [string, ProjectType][] = [
    ['package.json', 'node'],
    ['Cargo.toml', 'rust'],
    ['go.mod', 'go'],
    ['pyproject.toml', 'python'],
    ['requirements.txt', 'python'],
    ['setup.py', 'python'],
    ['Gemfile', 'ruby'],
    ['pom.xml', 'java'],
    ['build.gradle', 'java'],
  ];

  for (const [file, type] of checks) {
    if (await fileExists(path.join(projectPath, file))) {
      return type;
    }
  }

  return 'unknown';
}

// ============================================================================
// SCRIPT EXTRACTION
// ============================================================================

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
}

interface CargoToml {
  package?: {
    name?: string;
  };
}

async function extractNodeScripts(projectPath: string): Promise<ProjectScript[]> {
  const packageJson = await readJsonFile<PackageJson>(path.join(projectPath, 'package.json'));
  if (!packageJson?.scripts) return [];

  return Object.entries(packageJson.scripts).map(([name, command]) => ({
    name,
    command: `npm run ${name}`,
    description: command,
  }));
}

async function extractMakefileTargets(projectPath: string): Promise<ProjectScript[]> {
  const makefilePath = path.join(projectPath, 'Makefile');
  if (!(await fileExists(makefilePath))) return [];

  try {
    const content = await fs.readFile(makefilePath, 'utf-8');
    const targets: ProjectScript[] = [];

    // Match target definitions like "target:" or "target: deps"
    const targetRegex = /^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/gm;
    let match;

    while ((match = targetRegex.exec(content)) !== null) {
      const targetName = match[1];
      // Skip common internal targets
      if (!targetName.startsWith('.') && !targetName.startsWith('_')) {
        targets.push({
          name: targetName,
          command: `make ${targetName}`,
        });
      }
    }

    return targets.slice(0, 10); // Limit to 10 targets
  } catch {
    return [];
  }
}

async function extractScripts(projectPath: string, projectType: ProjectType): Promise<ProjectScript[]> {
  const scripts: ProjectScript[] = [];

  // Type-specific scripts
  if (projectType === 'node') {
    scripts.push(...await extractNodeScripts(projectPath));
  }

  // Makefile targets (common across project types)
  scripts.push(...await extractMakefileTargets(projectPath));

  return scripts;
}

// ============================================================================
// PROJECT NAME
// ============================================================================

async function getProjectName(projectPath: string, projectType: ProjectType): Promise<string> {
  // Try to get name from config files first
  if (projectType === 'node') {
    const packageJson = await readJsonFile<PackageJson>(path.join(projectPath, 'package.json'));
    if (packageJson?.name) return packageJson.name;
  }

  if (projectType === 'rust') {
    // Simple TOML parsing for package name
    try {
      const content = await fs.readFile(path.join(projectPath, 'Cargo.toml'), 'utf-8');
      const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
      if (nameMatch) return nameMatch[1];
    } catch {
      // Fall through to directory name
    }
  }

  // Fallback to directory name
  return path.basename(projectPath);
}

// ============================================================================
// DOCUMENTATION DETECTION
// ============================================================================

async function hasDocumentation(projectPath: string): Promise<{ hasTests: boolean; hasDocs: boolean }> {
  const testDirs = ['test', 'tests', '__tests__', 'spec', 'specs'];
  const docDirs = ['docs', 'doc', 'documentation'];

  let hasTests = false;
  let hasDocs = false;

  for (const dir of testDirs) {
    if (await fileExists(path.join(projectPath, dir))) {
      hasTests = true;
      break;
    }
  }

  for (const dir of docDirs) {
    if (await fileExists(path.join(projectPath, dir))) {
      hasDocs = true;
      break;
    }
  }

  return { hasTests, hasDocs };
}

async function getReadme(projectPath: string): Promise<string | undefined> {
  const readmeNames = ['README.md', 'README.txt', 'README', 'readme.md'];

  for (const name of readmeNames) {
    const content = await readTextFile(path.join(projectPath, name), 500);
    if (content) return content;
  }

  return undefined;
}

// ============================================================================
// GIT HISTORY
// ============================================================================

async function getRecentCommits(projectPath: string, limit: number = 10): Promise<RecentCommit[]> {
  if (!(await isGitRepo(projectPath))) {
    return [];
  }

  try {
    // Format: hash|message|date|author
    const result = await gitExec(
      ['log', '--oneline', `--format=%h|%s|%ar|%an`, `-${limit}`],
      { cwd: projectPath }
    );

    if (result.exitCode !== 0 || !result.stdout) {
      return [];
    }

    return result.stdout.split('\n').filter(Boolean).map(line => {
      const [hash, message, date, author] = line.split('|');
      return { hash, message, date, author };
    });
  } catch {
    return [];
  }
}

// ============================================================================
// SUGGESTED ACTIONS GENERATION
// ============================================================================

function generateSuggestedActions(
  projectType: ProjectType,
  scripts: ProjectScript[],
  hasTests: boolean
): QuickAction[] {
  const actions: QuickAction[] = [];

  // Add test action if tests are detected
  if (hasTests) {
    // Find a test script if available
    const testScript = scripts.find(s =>
      s.name === 'test' ||
      s.name === 'tests' ||
      s.name.includes('test')
    );

    actions.push({
      id: 'run-tests',
      label: 'Run tests',
      description: testScript?.command || 'Execute the test suite',
      icon: '🧪',
      prompt: `Run the tests for this project${testScript ? ` using "${testScript.command}"` : ''}. Show me the results and explain any failures.`,
      category: 'project',
    });
  }

  // Add build action for relevant project types
  const buildScript = scripts.find(s => s.name === 'build' || s.name === 'compile');
  if (buildScript || projectType === 'rust' || projectType === 'go' || projectType === 'java') {
    actions.push({
      id: 'build-project',
      label: 'Build project',
      description: buildScript?.command || 'Compile the project',
      icon: '🔨',
      prompt: `Build this project${buildScript ? ` using "${buildScript.command}"` : ''}. Let me know if there are any errors.`,
      category: 'project',
    });
  }

  // Add lint action if lint script exists
  const lintScript = scripts.find(s => s.name === 'lint' || s.name === 'eslint');
  if (lintScript) {
    actions.push({
      id: 'lint-code',
      label: 'Lint code',
      description: lintScript.command,
      icon: '🧹',
      prompt: `Run the linter on this project using "${lintScript.command}". Fix any issues found.`,
      category: 'project',
    });
  }

  // Add dev server action for web projects
  const devScript = scripts.find(s =>
    s.name === 'dev' ||
    s.name === 'start' ||
    s.name === 'serve'
  );
  if (devScript) {
    actions.push({
      id: 'start-dev',
      label: 'Start dev server',
      description: devScript.command,
      icon: '🚀',
      prompt: `Start the development server using "${devScript.command}".`,
      category: 'project',
    });
  }

  return actions;
}

// ============================================================================
// MAIN ANALYZER FUNCTION
// ============================================================================

export async function analyzeProject(projectPath: string): Promise<ProjectContext> {
  // Run detections in parallel where possible
  const [
    projectType,
    { hasTests, hasDocs },
    readme,
    recentCommits,
    isGit,
  ] = await Promise.all([
    detectProjectType(projectPath),
    hasDocumentation(projectPath),
    getReadme(projectPath),
    getRecentCommits(projectPath),
    isGitRepo(projectPath),
  ]);

  // These depend on projectType
  const [name, scripts] = await Promise.all([
    getProjectName(projectPath, projectType),
    extractScripts(projectPath, projectType),
  ]);

  // Generate contextual actions
  const suggestedActions = generateSuggestedActions(projectType, scripts, hasTests);

  return {
    type: projectType,
    name,
    scripts,
    hasTests,
    hasDocs,
    readme,
    recentCommits,
    suggestedActions,
    isGitRepo: isGit,
  };
}
