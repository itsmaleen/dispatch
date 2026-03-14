import { useState, useEffect, useRef } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import {
  Send,
  Plus,
  ChevronDown,
  Play,
  Brain,
  Terminal as TerminalIcon,
  Check,
  Loader2,
  Sparkles,
  ArrowRight,
  X,
  Minus,
  Maximize2,
} from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

type AgentStatus = 'ready' | 'busy' | 'offline';
type TerminalLineType = 'prompt' | 'thinking' | 'tool_call' | 'tool_result' | 'output' | 'error' | 'info' | 'command' | 'system';

interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  icon: string;
}

interface PlanStep {
  id: string;
  text: string;
  agent: string;
  status?: 'pending' | 'running' | 'completed';
}

interface TerminalLine {
  id: string;
  type: TerminalLineType;
  content: string;
  timestamp?: string;
  isStreaming?: boolean;
}

interface TerminalState {
  id: string;
  agent: Agent;
  lines: TerminalLine[];
  isStreaming: boolean;
  currentTask?: string;
}

interface MinimizedWidget {
  id: string;
  type: 'terminal' | 'tasks';
  title: string;
  icon: string;
  data?: TerminalState; // For restoring terminals
  currentTask?: string;
}

// ============================================================================
// FAKE DATA
// ============================================================================

const FAKE_AGENTS: Agent[] = [
  { id: 'claude-code', name: 'Claude Code', status: 'ready', icon: '\u{1F5A5}\uFE0F' },
  { id: 'scout', name: 'scout', status: 'ready', icon: '\u{1F50D}' },
  { id: 'forge', name: 'forge', status: 'ready', icon: '\u{1F528}' },
  { id: 'vera', name: 'vera', status: 'busy', icon: '\u2728' },
];

const FAKE_PLAN_STEPS: PlanStep[] = [
  { id: '1', text: 'Add JWT middleware to Express router', agent: 'claude-code' },
  { id: '2', text: 'Research refresh token best practices', agent: 'scout' },
  { id: '3', text: 'Write integration tests for auth flow', agent: 'forge' },
  { id: '4', text: 'Review changes and create PR', agent: 'claude-code' },
];

function makeTimestamp(offsetMinutes = 0): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - offsetMinutes);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const FAKE_TERMINAL_LINES: TerminalLine[] = [
  { id: '1', type: 'system', content: 'Session started \u2014 claude-sonnet-4-20250514', timestamp: makeTimestamp(5) },
  { id: '2', type: 'prompt', content: 'Add JWT authentication middleware to the Express router', timestamp: makeTimestamp(4) },
  { id: '3', type: 'thinking', content: 'I need to analyze the existing auth setup first. Let me look at the middleware directory and the route definitions to understand the current architecture...', timestamp: makeTimestamp(4) },
  { id: '4', type: 'tool_call', content: 'Read src/middleware/auth.ts', timestamp: makeTimestamp(3) },
  { id: '5', type: 'tool_result', content: 'export const requireAuth = (req, res, next) => {\n  // Basic session check\n  if (!req.session?.user) return res.status(401).end();\n  next();\n};', timestamp: makeTimestamp(3) },
  { id: '6', type: 'tool_call', content: 'Read src/routes/api.ts', timestamp: makeTimestamp(3) },
  { id: '7', type: 'tool_result', content: "import { requireAuth } from '../middleware/auth';\n\nrouter.get('/profile', requireAuth, getProfile);\nrouter.put('/settings', requireAuth, updateSettings);", timestamp: makeTimestamp(3) },
  { id: '8', type: 'thinking', content: "The current auth is session-based. I'll create a new JWT middleware that verifies tokens from the Authorization header, and add refresh token logic.", timestamp: makeTimestamp(2) },
  { id: '9', type: 'tool_call', content: 'Write src/middleware/jwt.ts', timestamp: makeTimestamp(2) },
  { id: '10', type: 'tool_result', content: "export const verifyJWT = (req, res, next) => {\n  const token = req.headers.authorization?.split(' ')[1];\n  if (!token) return res.status(401).json({ error: 'No token' });\n  try {\n    const decoded = jwt.verify(token, process.env.JWT_SECRET);\n    req.user = decoded;\n    next();\n  } catch (err) {\n    return res.status(403).json({ error: 'Invalid token' });\n  }\n};", timestamp: makeTimestamp(1) },
  { id: '11', type: 'tool_call', content: 'Edit src/routes/api.ts', timestamp: makeTimestamp(1) },
  { id: '12', type: 'tool_result', content: 'Updated 2 route handlers to use verifyJWT middleware', timestamp: makeTimestamp(1) },
  { id: '13', type: 'command', content: '$ npm test -- --grep "auth"', timestamp: makeTimestamp(0) },
  { id: '14', type: 'output', content: 'PASS  src/__tests__/auth.test.ts\n  \u2713 rejects requests without token (12ms)\n  \u2713 rejects requests with invalid token (8ms)\n  \u2713 accepts requests with valid token (15ms)\n  \u2713 refreshes token near expiry (22ms)\n\n4 tests passed', timestamp: makeTimestamp(0) },
  { id: '15', type: 'info', content: 'JWT middleware implemented. Created src/middleware/jwt.ts, updated 2 route files. All 4 tests passing.', timestamp: makeTimestamp(0) },
];

const FAKE_SCOUT_LINES: TerminalLine[] = [
  { id: 's1', type: 'system', content: 'Session started \u2014 scout agent', timestamp: makeTimestamp(3) },
  { id: 's2', type: 'prompt', content: 'Research refresh token best practices', timestamp: makeTimestamp(2) },
  { id: 's3', type: 'thinking', content: 'Searching for current best practices on refresh token rotation, storage, and security considerations...', timestamp: makeTimestamp(2) },
  { id: 's4', type: 'tool_call', content: 'Search "refresh token rotation best practices 2024"', timestamp: makeTimestamp(1) },
  { id: 's5', type: 'tool_result', content: 'Found 12 relevant results from OWASP, Auth0, and RFC 6749', timestamp: makeTimestamp(1) },
  { id: 's6', type: 'output', content: 'Key findings:\n\u2022 Use refresh token rotation (new refresh token on each use)\n\u2022 Store refresh tokens server-side, never in localStorage\n\u2022 Set short access token TTL (15min) with longer refresh (7d)\n\u2022 Implement token family tracking for reuse detection', timestamp: makeTimestamp(0), isStreaming: true },
];

// ============================================================================
// TERMINAL LINE COMPONENT
// ============================================================================

function TerminalLineItem({ line }: { line: TerminalLine }) {
  // System messages
  if (line.type === 'system') {
    return (
      <div className="py-1 flex items-center gap-2">
        {line.timestamp && (
          <span className="text-zinc-700 text-[10px] font-mono shrink-0 w-16">{line.timestamp}</span>
        )}
        <span className="text-zinc-600 text-xs italic">{line.content}</span>
      </div>
    );
  }

  // Prompt messages (user input)
  if (line.type === 'prompt') {
    return (
      <div className="py-1.5 mt-1 flex gap-2">
        {line.timestamp && (
          <span className="text-zinc-700 text-[10px] font-mono shrink-0 w-16 pt-0.5">{line.timestamp}</span>
        )}
        <div className="flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-indigo-500 font-bold text-xs">{'\u276F'}</span>
          </div>
          <span className="text-indigo-300 text-sm">{line.content}</span>
        </div>
      </div>
    );
  }

  // Thinking blocks with left border
  if (line.type === 'thinking') {
    return (
      <div className="py-1 flex gap-2">
        {line.timestamp && (
          <span className="text-zinc-700 text-[10px] font-mono shrink-0 w-16 pt-0.5">{line.timestamp}</span>
        )}
        <div className="flex-1 border-l-2 border-purple-500/30 pl-3">
          <div className="flex items-center gap-1.5 text-purple-500/70 text-[10px] uppercase tracking-wider mb-0.5">
            <Brain className="w-3 h-3" />
            <span>thinking</span>
          </div>
          <span className="text-purple-300/80 text-xs leading-relaxed">{line.content}</span>
          {line.isStreaming && (
            <span className="inline-block w-1.5 h-3 bg-purple-400 animate-pulse ml-0.5 align-text-bottom" />
          )}
        </div>
      </div>
    );
  }

  // Tool calls
  if (line.type === 'tool_call') {
    return (
      <div className="py-0.5 flex gap-2">
        {line.timestamp && (
          <span className="text-zinc-700 text-[10px] font-mono shrink-0 w-16 pt-0.5">{line.timestamp}</span>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-amber-500/70 text-xs">{'\u25B6'}</span>
          <span className="text-amber-400 text-xs font-mono">{line.content}</span>
        </div>
      </div>
    );
  }

  // Tool results (indented, dimmer)
  if (line.type === 'tool_result') {
    return (
      <div className="py-0.5 flex gap-2">
        {line.timestamp && (
          <span className="text-zinc-700 text-[10px] font-mono shrink-0 w-16 pt-0.5">{line.timestamp}</span>
        )}
        <div className="flex-1 ml-4 bg-zinc-900/50 rounded px-2 py-1 border border-zinc-800/50">
          <pre className="text-zinc-500 text-[11px] font-mono whitespace-pre-wrap leading-relaxed overflow-x-auto">{line.content}</pre>
        </div>
      </div>
    );
  }

  // Color map for remaining types
  const colorMap: Record<string, string> = {
    output: 'text-zinc-300',
    error: 'text-red-400',
    info: 'text-emerald-400',
    command: 'text-amber-300',
  };

  const prefixMap: Record<string, string> = {
    output: '',
    error: '\u2717',
    info: '\u2713',
    command: '',
  };

  const colorClass = colorMap[line.type] || 'text-zinc-300';
  const prefix = prefixMap[line.type] || '';

  return (
    <div className="py-0.5 flex gap-2">
      {line.timestamp && (
        <span className="text-zinc-700 text-[10px] font-mono shrink-0 w-16 pt-0.5">{line.timestamp}</span>
      )}
      <div className="flex-1 flex gap-1.5">
        {prefix && (
          <span className={`${colorClass} text-xs shrink-0 pt-0.5`}>
            {prefix}
          </span>
        )}
        <pre className={`${colorClass} text-xs font-mono whitespace-pre-wrap leading-relaxed flex-1`}>
          {line.content}
        </pre>
        {line.isStreaming && (
          <span className="inline-block w-1.5 h-3 bg-indigo-400 animate-pulse ml-0.5 align-text-bottom shrink-0" />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// TERMINAL WIDGET
// ============================================================================

function TerminalWidget({
  terminal,
  onClose,
  onMinimize,
  onSendMessage,
}: {
  terminal: TerminalState;
  onClose?: () => void;
  onMinimize?: () => void;
  onSendMessage: (terminalId: string, message: string) => void;
}) {
  const outputRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [terminal.lines, autoScroll]);

  const handleSubmit = () => {
    if (input.trim()) {
      onSendMessage(terminal.id, input);
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="h-full bg-[#0d1117] border border-zinc-800 rounded-lg flex flex-col overflow-hidden">
      {/* Terminal Title Bar */}
      <div className="flex-shrink-0 px-3 py-2 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Traffic light dots */}
          <div className="flex items-center gap-1.5 mr-2">
            <button
              onClick={onClose}
              className="group w-3 h-3 rounded-full bg-red-500/80 hover:bg-red-500 transition-colors flex items-center justify-center"
              title="Close"
            >
              <X className="w-2 h-2 text-red-900 opacity-0 group-hover:opacity-100" />
            </button>
            <button
              onClick={onMinimize}
              className="group w-3 h-3 rounded-full bg-yellow-500/80 hover:bg-yellow-500 transition-colors flex items-center justify-center"
              title="Minimize"
            >
              <Minus className="w-2 h-2 text-yellow-900 opacity-0 group-hover:opacity-100" />
            </button>
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
          </div>
          <div className={`w-2 h-2 rounded-full ${
            terminal.isStreaming ? 'bg-indigo-500 animate-pulse' : 'bg-emerald-500'
          }`} />
          <span className="text-xs">{terminal.agent.icon}</span>
          <span className="text-xs font-medium text-zinc-300">{terminal.agent.name}</span>
          {terminal.currentTask && (
            <>
              <span className="text-zinc-700">{'\u2014'}</span>
              <span className="text-xs text-zinc-500 truncate max-w-[200px]">{terminal.currentTask}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`text-xs px-2 py-0.5 rounded ${
              autoScroll ? 'bg-blue-600/20 text-blue-400' : 'bg-zinc-800 text-zinc-500'
            }`}
          >
            Auto-scroll
          </button>
          {terminal.isStreaming && (
            <div className="flex items-center gap-1.5 text-indigo-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span className="text-[10px] uppercase tracking-wider">streaming</span>
            </div>
          )}
        </div>
      </div>

      {/* Terminal Output */}
      <div
        ref={outputRef}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs"
      >
        {terminal.lines.length > 0 ? (
          terminal.lines.map(line => (
            <TerminalLineItem key={line.id} line={line} />
          ))
        ) : (
          <div className="h-full flex items-center justify-center text-zinc-700 text-xs">
            <span>Waiting for input...</span>
          </div>
        )}
      </div>

      {/* Terminal Input Prompt */}
      <div className="flex-shrink-0 px-3 py-2 border-t border-zinc-800/50 bg-[#0a0e14]">
        <div className="flex items-center gap-2">
          <span className="text-indigo-500 font-bold text-xs shrink-0">{'\u276F'}</span>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message or task..."
            className="flex-1 bg-transparent text-xs text-zinc-300 placeholder:text-zinc-700 focus:outline-none font-mono"
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim()}
            className="text-zinc-600 hover:text-indigo-400 disabled:text-zinc-800 transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// STATUS WIDGET (compact, matching WidgetDemo style)
// ============================================================================

function AgentStatusWidget({ agent, terminalCount }: { agent: Agent; terminalCount: number }) {
  const statusConfig = {
    ready: { color: 'bg-emerald-500', label: 'Ready', pulse: false },
    busy: { color: 'bg-blue-500', label: 'Working', pulse: true },
    offline: { color: 'bg-zinc-600', label: 'Offline', pulse: false },
  };

  const { color, label, pulse } = statusConfig[agent.status];

  return (
    <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full ${color} ${pulse ? 'animate-pulse' : ''}`} />
        <span className="text-xs">{agent.icon}</span>
        <span className="text-sm font-medium">{agent.name}</span>
      </div>
      <div className="text-xs text-zinc-500">
        Status: <span className="text-zinc-300">{label}</span>
      </div>
      {terminalCount > 0 && (
        <div className="text-xs text-zinc-500 mt-1">
          Terminals: <span className="text-zinc-400">{terminalCount}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// TASKS WIDGET (bottom-right, with add task + send to terminal)
// ============================================================================

function TasksWidget({
  steps,
  agents,
  onExecute,
  isExecuting,
  onStepAgentChange,
  onAddStep,
  onSendStepToTerminal,
  onMinimize,
}: {
  steps: PlanStep[];
  agents: Agent[];
  onExecute: () => void;
  isExecuting: boolean;
  onStepAgentChange: (stepId: string, agentId: string) => void;
  onAddStep: (text: string, agentId: string) => void;
  onSendStepToTerminal: (step: PlanStep) => void;
  onMinimize?: () => void;
}) {
  const [editingStep, setEditingStep] = useState<string | null>(null);
  const [showAddInput, setShowAddInput] = useState(false);
  const [newTaskText, setNewTaskText] = useState('');
  const [newTaskAgent, setNewTaskAgent] = useState(agents[0]?.id || '');
  const [showNewTaskAgentDropdown, setShowNewTaskAgentDropdown] = useState(false);

  const handleAddStep = () => {
    if (newTaskText.trim()) {
      onAddStep(newTaskText, newTaskAgent);
      setNewTaskText('');
      setShowAddInput(false);
    }
  };

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAddStep();
    }
    if (e.key === 'Escape') {
      setShowAddInput(false);
      setNewTaskText('');
    }
  };

  return (
    <div className="h-full bg-zinc-900 border border-zinc-800 rounded-lg flex flex-col overflow-hidden">
      {/* Header: minimize left (same as terminal), title center, Add task right */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-zinc-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {onMinimize && (
            <div className="flex items-center gap-1.5 mr-2">
              <button onClick={onMinimize} className="group w-3 h-3 rounded-full bg-yellow-500/80 hover:bg-yellow-500 flex items-center justify-center" title="Minimize">
                <Minus className="w-2 h-2 text-yellow-900 opacity-0 group-hover:opacity-100" />
              </button>
            </div>
          )}
          <Sparkles className="w-4 h-4 text-violet-400 flex-shrink-0" />
          <span className="text-sm font-medium truncate">Tasks</span>
          <span className="text-xs text-zinc-600 flex-shrink-0">({steps.length})</span>
        </div>
        <button
          onClick={() => setShowAddInput(true)}
          className="flex-shrink-0 flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-violet-400 hover:bg-zinc-800 rounded transition-colors"
          title="Add task"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add task</span>
        </button>
      </div>

      {/* Inline Add Task Input - below header when expanded */}
      {showAddInput && (
        <div className="flex-shrink-0 p-2 border-b border-zinc-800">
          <div className="p-2.5 rounded-lg border border-violet-500/30 bg-violet-500/5">
            <input
              type="text"
              value={newTaskText}
              onChange={(e) => setNewTaskText(e.target.value)}
              onKeyDown={handleAddKeyDown}
              placeholder="Describe the task..."
              className="w-full bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none mb-2"
              autoFocus
            />
            <div className="flex items-center justify-between">
              <div className="relative">
                <button
                  onClick={() => setShowNewTaskAgentDropdown(!showNewTaskAgentDropdown)}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-[10px] text-zinc-500 transition-colors"
                >
                  <span>{agents.find(a => a.id === newTaskAgent)?.icon}</span>
                  <span>{agents.find(a => a.id === newTaskAgent)?.name}</span>
                  <ChevronDown className="w-2.5 h-2.5" />
                </button>
                {showNewTaskAgentDropdown && (
                  <div className="absolute top-full left-0 mt-1 w-40 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-10 py-1">
                    {agents.filter(a => a.status !== 'offline').map(a => (
                      <button
                        key={a.id}
                        onClick={() => {
                          setNewTaskAgent(a.id);
                          setShowNewTaskAgentDropdown(false);
                        }}
                        className={`w-full px-2.5 py-1.5 text-left text-xs hover:bg-zinc-700 flex items-center gap-1.5 ${
                          a.id === newTaskAgent ? 'text-violet-400' : 'text-zinc-300'
                        }`}
                      >
                        <span>{a.icon}</span>
                        <span>{a.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => { setShowAddInput(false); setNewTaskText(''); }}
                  className="px-2 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddStep}
                  disabled={!newTaskText.trim()}
                  className="px-2 py-0.5 text-[10px] bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded transition-colors"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Task list */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-1.5">
          {steps.map((step, index) => {
            const agent = agents.find(a => a.id === step.agent);
            const isEditing = editingStep === step.id;

            return (
              <div
                key={step.id}
                className={`p-2.5 rounded-lg border transition-colors group ${
                  step.status === 'running'
                    ? 'border-indigo-500/50 bg-indigo-500/5'
                    : step.status === 'completed'
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : 'border-zinc-800 bg-zinc-800/30 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-start gap-2">
                  {/* Step number */}
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium shrink-0 mt-0.5 ${
                    step.status === 'completed'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : step.status === 'running'
                      ? 'bg-indigo-500/20 text-indigo-400'
                      : 'bg-zinc-700 text-zinc-400'
                  }`}>
                    {step.status === 'completed' ? <Check className="w-2.5 h-2.5" /> : index + 1}
                  </div>

                  {/* Step content */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs leading-relaxed ${step.status === 'completed' ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}>
                      {step.text}
                    </p>

                    {/* Agent badge + send button */}
                    <div className="mt-1.5 relative flex items-center gap-1.5">
                      <button
                        onClick={() => setEditingStep(isEditing ? null : step.id)}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-[10px] text-zinc-500 transition-colors"
                      >
                        <span>{agent?.icon}</span>
                        <span>{agent?.name || step.agent}</span>
                        <ChevronDown className="w-2.5 h-2.5" />
                      </button>

                      {/* Send to terminal button */}
                      {step.status !== 'completed' && step.status !== 'running' && (
                        <button
                          onClick={() => onSendStepToTerminal(step)}
                          className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-600/20 hover:bg-indigo-600/40 text-[10px] text-indigo-400 transition-all"
                          title="Send to terminal"
                        >
                          <ArrowRight className="w-2.5 h-2.5" />
                          <span>Run</span>
                        </button>
                      )}

                      {/* Agent dropdown */}
                      {isEditing && (
                        <div className="absolute top-full left-0 mt-1 w-40 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-10 py-1">
                          {agents.filter(a => a.status !== 'offline').map(a => (
                            <button
                              key={a.id}
                              onClick={() => {
                                onStepAgentChange(step.id, a.id);
                                setEditingStep(null);
                              }}
                              className={`w-full px-2.5 py-1.5 text-left text-xs hover:bg-zinc-700 flex items-center gap-1.5 ${
                                a.id === step.agent ? 'text-violet-400' : 'text-zinc-300'
                              }`}
                            >
                              <span>{a.icon}</span>
                              <span>{a.name}</span>
                              {a.status === 'busy' && (
                                <span className="ml-auto text-[10px] text-zinc-500">busy</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Status indicator */}
                  {step.status === 'running' && (
                    <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin shrink-0" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer - Run tasks button */}
      <div className="flex-shrink-0 px-2 py-2 border-t border-zinc-800">
        <button
          onClick={onExecute}
          disabled={isExecuting || steps.length === 0}
          className="w-full px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/30 disabled:text-zinc-500 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-colors"
        >
          {isExecuting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Executing...
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5" />
              Run tasks
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// (Orchestrator Chat removed — tasks-only right panel)
// ============================================================================


// ============================================================================
// MAIN WORKSPACE DEMO
// ============================================================================

export function WorkspaceDemo() {
  const [planSteps, setPlanSteps] = useState<PlanStep[]>(FAKE_PLAN_STEPS);
  const [isExecuting, setIsExecuting] = useState(false);
  const [tasksWidgetMinimized, setTasksWidgetMinimized] = useState(false);
  const [minimizedWidgets, setMinimizedWidgets] = useState<MinimizedWidget[]>([]);
  const [terminals, setTerminals] = useState<TerminalState[]>([
    {
      id: 'terminal-1',
      agent: FAKE_AGENTS[0],
      lines: FAKE_TERMINAL_LINES,
      isStreaming: false,
      currentTask: 'Add JWT middleware to Express router',
    },
    {
      id: 'terminal-2',
      agent: FAKE_AGENTS[1],
      lines: FAKE_SCOUT_LINES,
      isStreaming: true,
      currentTask: 'Research refresh token best practices',
    },
  ]);

  // Simulate streaming for scout terminal
  useEffect(() => {
    const extraLines: TerminalLine[] = [
      { id: 's7', type: 'thinking', content: 'Let me compile the security recommendations and format them for the team...', timestamp: makeTimestamp(0) },
      { id: 's8', type: 'info', content: 'Research complete. Found 4 key recommendations for refresh token implementation.', timestamp: makeTimestamp(0) },
    ];

    let lineIdx = 0;
    const interval = setInterval(() => {
      if (lineIdx < extraLines.length) {
        const currentIdx = lineIdx;
        setTerminals(prev => prev.map(t =>
          t.id === 'terminal-2'
            ? {
                ...t,
                lines: [...t.lines.map(l => ({ ...l, isStreaming: false })), extraLines[currentIdx]],
                isStreaming: currentIdx < extraLines.length - 1
              }
            : t
        ));
        lineIdx++;
      } else {
        clearInterval(interval);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const handleExecute = () => {
    setIsExecuting(true);

    let stepIndex = 0;
    const executeStep = () => {
      if (stepIndex < planSteps.length) {
        setPlanSteps(prev => prev.map((s, i) => ({
          ...s,
          status: i === stepIndex ? 'running' : i < stepIndex ? 'completed' : 'pending'
        })));
        stepIndex++;
        setTimeout(executeStep, 2000);
      } else {
        setPlanSteps(prev => prev.map(s => ({ ...s, status: 'completed' })));
        setIsExecuting(false);
      }
    };
    executeStep();
  };

  const handleStepAgentChange = (stepId: string, agentId: string) => {
    setPlanSteps(prev => prev.map(s =>
      s.id === stepId ? { ...s, agent: agentId } : s
    ));
  };

  const handleAddStep = (text: string, agentId: string) => {
    setPlanSteps(prev => [...prev, {
      id: `step-${Date.now()}`,
      text,
      agent: agentId,
    }]);
  };

  const handleSendStepToTerminal = (step: PlanStep) => {
    const agent = FAKE_AGENTS.find(a => a.id === step.agent) || FAKE_AGENTS[0];
    const existingTerminal = terminals.find(t => t.agent.id === agent.id);
    const now = makeTimestamp(0);

    if (existingTerminal) {
      setTerminals(prev => prev.map(t =>
        t.id === existingTerminal.id
          ? {
              ...t,
              isStreaming: true,
              currentTask: step.text,
              lines: [
                ...t.lines,
                { id: `${Date.now()}`, type: 'prompt' as const, content: step.text, timestamp: now },
                { id: `${Date.now()}-1`, type: 'thinking' as const, content: 'Processing task...', timestamp: now, isStreaming: true },
              ]
            }
          : t
      ));
    } else {
      setTerminals(prev => [...prev, {
        id: `terminal-${Date.now()}`,
        agent,
        lines: [
          { id: `${Date.now()}-sys`, type: 'system' as const, content: `Session started \u2014 ${agent.name}`, timestamp: now },
          { id: `${Date.now()}`, type: 'prompt' as const, content: step.text, timestamp: now },
          { id: `${Date.now()}-1`, type: 'thinking' as const, content: 'Processing task...', timestamp: now, isStreaming: true },
        ],
        isStreaming: true,
        currentTask: step.text,
      }]);
    }

    // Mark step as running
    setPlanSteps(prev => prev.map(s =>
      s.id === step.id ? { ...s, status: 'running' } : s
    ));
  };

  const handleTerminalMessage = (terminalId: string, message: string) => {
    const now = makeTimestamp(0);
    setTerminals(prev => prev.map(t =>
      t.id === terminalId
        ? {
            ...t,
            isStreaming: true,
            lines: [
              ...t.lines,
              { id: `${Date.now()}`, type: 'prompt' as const, content: message, timestamp: now },
              { id: `${Date.now()}-1`, type: 'thinking' as const, content: 'Processing...', timestamp: now, isStreaming: true },
            ]
          }
        : t
    ));

    // Simulate a response after a delay
    setTimeout(() => {
      setTerminals(prev => prev.map(t =>
        t.id === terminalId
          ? {
              ...t,
              isStreaming: false,
              lines: [
                ...t.lines.map(l => ({ ...l, isStreaming: false })),
                { id: `${Date.now()}-tool`, type: 'tool_call' as const, content: `Search "${message}"`, timestamp: makeTimestamp(0) },
                { id: `${Date.now()}-result`, type: 'tool_result' as const, content: 'Analyzing request and generating response...', timestamp: makeTimestamp(0) },
                { id: `${Date.now()}-out`, type: 'info' as const, content: 'Task acknowledged. Working on it now.', timestamp: makeTimestamp(0) },
              ]
            }
          : t
      ));
    }, 2000);
  };

  const handleNewTerminal = (agentId?: string) => {
    const agent = FAKE_AGENTS.find(a => a.id === (agentId || 'claude-code')) || FAKE_AGENTS[0];
    const now = makeTimestamp(0);
    setTerminals(prev => [...prev, {
      id: `terminal-${Date.now()}`,
      agent,
      lines: [
        { id: `${Date.now()}-sys`, type: 'system' as const, content: `Session started \u2014 ${agent.name}`, timestamp: now },
      ],
      isStreaming: false,
    }]);
  };

  const handleCloseTerminal = (terminalId: string) => {
    setTerminals(prev => prev.filter(t => t.id !== terminalId));
  };

  // Count terminals per agent for status display
  const getTerminalCount = (agentId: string) => terminals.filter(t => t.agent.id === agentId).length;

  // Minimize/restore handlers
  const handleMinimizeTerminal = (terminal: TerminalState) => {
    setMinimizedWidgets(prev => [...prev, {
      id: terminal.id,
      type: 'terminal',
      title: terminal.agent.name,
      icon: terminal.agent.icon,
      data: terminal,
    }]);
    setTerminals(prev => prev.filter(t => t.id !== terminal.id));
  };

  const handleMinimizeTasks = () => {
    setTasksWidgetMinimized(true);
  };

  const handleRestoreWidget = (widget: MinimizedWidget) => {
    setMinimizedWidgets(prev => prev.filter(w => w.id !== widget.id));
    if (widget.type === 'terminal' && widget.data) {
      setTerminals(prev => [...prev, widget.data!]);
    }
  };

  const handleCloseMinimized = (widgetId: string) => {
    setMinimizedWidgets(prev => prev.filter(w => w.id !== widgetId));
  };

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* Header */}
      <div className="h-11 flex-shrink-0 bg-zinc-900 border-b border-zinc-800 px-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg">{'\u{1F99E}'}</span>
          <span className="text-sm font-medium text-zinc-200">Dispatch</span>
          <span className="text-zinc-600">{'\u2022'}</span>
          <span className="text-sm text-zinc-500">agent-command-center</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleNewTerminal()}
            className="flex items-center gap-1.5 px-3 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Terminal</span>
          </button>
          
          <button className="text-xs px-3 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors">
            Settings
          </button>
        </div>
      </div>

      {/* Workspace Grid (WidgetDemo-style layout) */}
      <div className="flex-1 p-2 overflow-hidden">
        <PanelGroup direction="horizontal">
          {/* Left column: Terminals (60%) */}
          <Panel defaultSize={60} minSize={30}>
            <PanelGroup direction="vertical">
              {terminals.map((terminal, index) => (
                <Panel key={terminal.id} defaultSize={Math.floor(100 / terminals.length)} minSize={20}>
                  <div className="h-full p-1">
                    <TerminalWidget
                      terminal={terminal}
                      onClose={() => handleCloseTerminal(terminal.id)}
                      onMinimize={() => handleMinimizeTerminal(terminal)}
                      onSendMessage={handleTerminalMessage}
                    />
                  </div>
                  {index < terminals.length - 1 && (
                    <PanelResizeHandle className="h-1 bg-zinc-800 hover:bg-zinc-700 transition-colors" />
                  )}
                </Panel>
              ))}
            </PanelGroup>
          </Panel>

          <PanelResizeHandle className="w-1 bg-zinc-800 hover:bg-zinc-700 transition-colors" />

          {/* Right column: Tasks (40%) */}
          <Panel defaultSize={40} minSize={20}>
            <PanelGroup direction="vertical">
              {/* Status widgets (top right) */}
              <Panel defaultSize={25} minSize={12}>
                <div className="h-full p-1 flex gap-2">
                  <AgentStatusWidget
                    agent={{ ...FAKE_AGENTS[0], status: terminals.some(t => t.agent.id === 'claude-code' && t.isStreaming) ? 'busy' : 'ready' }}
                    terminalCount={getTerminalCount('claude-code')}
                  />
                  <AgentStatusWidget
                    agent={{ ...FAKE_AGENTS[1], status: terminals.some(t => t.agent.id === 'scout' && t.isStreaming) ? 'busy' : 'ready' }}
                    terminalCount={getTerminalCount('scout')}
                  />
                </div>
              </Panel>

              <PanelResizeHandle className="h-1 bg-zinc-800 hover:bg-zinc-700 transition-colors" />

              {/* Tasks widget (bottom right) - collapses in place when minimized */}
              <Panel defaultSize={75} minSize={30}>
                <div className="h-full p-1 flex flex-col">
                  {tasksWidgetMinimized ? (
                    <div className="flex-shrink-0 h-9 bg-zinc-900 border border-zinc-800 rounded-lg flex items-center justify-between px-3">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-violet-400" />
                        <span className="text-sm font-medium text-zinc-300">Tasks</span>
                        <span className="text-xs text-zinc-600">({planSteps.length})</span>
                      </div>
                      <button
                        onClick={() => setTasksWidgetMinimized(false)}
                        className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200"
                        title="Restore"
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex-1 min-h-0">
                      <TasksWidget
                        steps={planSteps}
                        agents={FAKE_AGENTS}
                        onExecute={handleExecute}
                        isExecuting={isExecuting}
                        onStepAgentChange={handleStepAgentChange}
                        onAddStep={handleAddStep}
                        onSendStepToTerminal={handleSendStepToTerminal}
                        onMinimize={handleMinimizeTasks}
                      />
                    </div>
                  )}
                </div>
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </div>

      {/* Minimized Widgets Tab Bar */}
      {minimizedWidgets.length > 0 && (
        <div className="flex-shrink-0 h-9 bg-zinc-900 border-t border-zinc-800 px-2 flex items-center gap-1 overflow-x-auto">
          {minimizedWidgets.map((widget) => (
            <div
              key={widget.id}
              className="flex items-center gap-1 px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-xs group transition-colors cursor-pointer"
              onClick={() => handleRestoreWidget(widget)}
            >
              <span>{widget.icon}</span>
              <span className="text-zinc-300 max-w-[100px] truncate">{widget.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseMinimized(widget.id);
                }}
                className="ml-1 p-0.5 text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Close"
              >
                <X className="w-3 h-3" />
              </button>
              <Maximize2 className="w-3 h-3 text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
