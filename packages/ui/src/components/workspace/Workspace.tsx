import { useState, useEffect, useRef, useCallback } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import {
  Plus,
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
  RefreshCw,
  Wifi,
  WifiOff,
  FolderOpen,
  Pencil,
  MoreVertical,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import { api } from '../../stores/app';
import { ChatInput, type UploadedFile } from './ChatInput';

// ============================================================================
// TYPES
// ============================================================================

const API_URL = 'http://localhost:3333';
const WS_URL = 'ws://localhost:3333/events';

type AgentStatus = 'ready' | 'busy' | 'offline';
type TerminalLineType = 'prompt' | 'thinking' | 'tool_call' | 'tool_result' | 'output' | 'error' | 'info' | 'command' | 'system';

interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  icon: string;
  type: 'claude-code' | 'openclaw';
}

interface PlanStep {
  id: string;
  text: string;
  agent: string | null;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  source?: 'plan' | 'extracted' | 'manual';
  threadId?: string;
  turnId?: string;
  costUsd?: number;
  durationMs?: number;
}

interface TerminalLine {
  id: string;
  type: TerminalLineType;
  content: string;
  timestamp?: string;
  isStreaming?: boolean;
  /** Block index for tool_call lines (used to match input_json_delta updates) */
  blockIndex?: number;
}

interface TerminalState {
  id: string;
  agent: Agent;
  lines: TerminalLine[];
  isStreaming: boolean;
  currentTask?: string;
  /** Plan step id when this terminal is executing a step (for status/cost sync) */
  currentStepId?: string;
  path?: string; // Override workspace path
  // Thread integration (Phase 2/3)
  threadId?: string;
  sessionActive?: boolean;
}

interface MinimizedWidget {
  id: string;
  type: 'terminal' | 'tasks';
  title: string;
  icon: string;
  data?: TerminalState;
}

// ============================================================================
// UTILITIES
// ============================================================================

function makeTimestamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getAgentIcon(agent: { type: string; name: string }): string {
  if (agent.type === 'claude-code') return '🖥️';
  const name = agent.name.toLowerCase();
  if (name.includes('scout')) return '🔍';
  if (name.includes('forge')) return '🔨';
  if (name.includes('vera')) return '✨';
  if (name.includes('echo')) return '📢';
  return '🤖';
}

/** Extract human-readable detail (path, command, etc.) from tool input JSON (full or partial) */
function tryExtractToolDetail(json: string): string | undefined {
  try {
    const input = JSON.parse(json);
    if (input.path) return input.path;
    if (input.file_path) return input.file_path;
    if (input.file) return input.file;
    if (input.command) {
      const cmd = String(input.command);
      return cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
    }
    if (input.pattern) return input.pattern;
    if (input.query) return input.query;
    if (input.regex) return input.regex;
    return undefined;
  } catch {
    const pathMatch = json.match(/"(?:path|file_path|file)"\s*:\s*"([^"]+)"/);
    if (pathMatch) return pathMatch[1];
    const cmdMatch = json.match(/"command"\s*:\s*"([^"]{1,60})/);
    if (cmdMatch) return cmdMatch[1] + (json.includes(cmdMatch[0] + '"') ? '' : '...');
    return undefined;
  }
}

/** Heuristic: extract task-like lines from assistant output (numbered list, "Next steps:", etc.) */
function extractTasksFromText(text: string, maxTasks = 10): string[] {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const tasks: string[] = [];
  let inList = false;
  const numberBullet = /^\d+[.)]\s*(.+)$/;
  const dashBullet = /^[-*]\s+(.+)$/;

  for (const line of lines) {
    const numbered = line.match(numberBullet);
    if (numbered) {
      inList = true;
      tasks.push(numbered[1].trim());
      continue;
    }
    const dashed = line.match(dashBullet);
    if (dashed && inList) {
      tasks.push(dashed[1].trim());
      continue;
    }
    if (/^(next steps?|to do|i will|we can|tasks?):?\s*$/i.test(line)) {
      inList = true;
      continue;
    }
    inList = false;
  }

  const result = tasks.slice(0, maxTasks).filter(t => t.length > 2);
  // If no list found but we have substantial text, use first line as a single summary task
  if (result.length === 0 && text.trim().length > 10) {
    const first = lines[0];
    if (first && first.length > 5 && first.length < 200) result.push(first);
  }
  return result;
}

/** Renders step text with markdown-like formatting: **bold** and `code` (as badges for paths/handlers) */
function PlanStepText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`t-${key++}`}>{text.slice(lastIndex, match.index)}</span>);
    }
    const segment = match[1];
    if (segment.startsWith('**') && segment.endsWith('**')) {
      parts.push(<strong key={`t-${key++}`} className="font-semibold text-zinc-100">{segment.slice(2, -2)}</strong>);
    } else if (segment.startsWith('`') && segment.endsWith('`')) {
      const code = segment.slice(1, -1);
      const isPath = /[/\\]|\.(ts|tsx|js|jsx|md|json|py)(:\d+)?$|:\d+\)?$/.test(code) || code.includes(':');
      parts.push(
        <span
          key={`t-${key++}`}
          className={isPath ? 'inline-flex items-center px-1.5 py-0.5 rounded bg-zinc-700/80 text-amber-200/90 font-mono text-[0.85em]' : 'px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 font-mono text-[0.9em]'}
        >
          {code}
        </span>
      );
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={`t-${key++}`}>{text.slice(lastIndex)}</span>);
  }
  return <span className="text-sm text-zinc-200 leading-snug">{parts.length > 0 ? parts : text}</span>;
}

// ============================================================================
// TERMINAL LINE COMPONENT
// ============================================================================

function TerminalLineItem({ line }: { line: TerminalLine }) {
  const getLineStyle = () => {
    switch (line.type) {
      case 'prompt':
        return 'text-blue-400 font-medium';
      case 'thinking':
        return 'text-violet-400 italic';
      case 'tool_call':
        return 'text-amber-400';
      case 'tool_result':
        return 'text-zinc-400 text-xs font-mono bg-zinc-900/50 px-2 py-1 rounded';
      case 'output':
        return 'text-emerald-400';
      case 'error':
        return 'text-red-400';
      case 'info':
        return 'text-zinc-300';
      case 'command':
        return 'text-cyan-400 font-mono';
      case 'system':
        return 'text-zinc-600 text-xs';
      default:
        return 'text-zinc-300';
    }
  };

  const getIcon = () => {
    switch (line.type) {
      case 'thinking':
        return <Brain className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />;
      case 'tool_call':
        return <ArrowRight className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />;
      case 'command':
        return <TerminalIcon className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />;
      case 'error':
        return <X className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />;
      case 'info':
        return <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />;
      default:
        return null;
    }
  };

  return (
    <div className="flex items-start gap-2 py-0.5">
      {line.timestamp && (
        <span className="text-[10px] text-zinc-600 font-mono w-16 flex-shrink-0">
          {line.timestamp}
        </span>
      )}
      {getIcon()}
      <span className={`${getLineStyle()} whitespace-pre-wrap break-words`}>
        {line.content}
        {line.isStreaming && (
          <span className="inline-block w-2 h-4 ml-0.5 bg-current animate-pulse" />
        )}
      </span>
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
  isHighlighted,
}: {
  terminal: TerminalState;
  onClose?: () => void;
  onMinimize?: () => void;
  onSendMessage: (terminalId: string, message: string, files?: UploadedFile[]) => void;
  isHighlighted?: boolean;
}) {
  const outputRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [terminal.lines, autoScroll]);

  const handleSend = (message: string, files?: UploadedFile[]) => {
    onSendMessage(terminal.id, message, files);
  };

  return (
    <div
      className={`h-full bg-[#0d1117] border rounded-lg flex flex-col overflow-hidden transition-[border-color] duration-300 ${
        isHighlighted
          ? 'border-violet-400/60 terminal-outer-highlight-pulse'
          : 'border-zinc-800'
      }`}
    >
      {/* Title Bar */}
      <div
        className={`flex-shrink-0 px-3 py-2 border-b flex items-center justify-between transition-[background-color,border-color] duration-300 ${
          isHighlighted
            ? 'bg-violet-600/50 border-violet-400/70 terminal-title-highlight-pulse'
            : 'bg-zinc-900 border-zinc-800'
        }`}
      >
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 mr-2">
            <button onClick={onClose} className="group w-3 h-3 rounded-full bg-red-500/80 hover:bg-red-500 flex items-center justify-center">
              <X className="w-2 h-2 text-red-900 opacity-0 group-hover:opacity-100" />
            </button>
            <button onClick={onMinimize} className="group w-3 h-3 rounded-full bg-yellow-500/80 hover:bg-yellow-500 flex items-center justify-center">
              <Minus className="w-2 h-2 text-yellow-900 opacity-0 group-hover:opacity-100" />
            </button>
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
          </div>
          <span className="text-sm">{terminal.agent.icon}</span>
          <span className="text-xs font-medium text-zinc-300">{terminal.agent.name}</span>
          {terminal.isStreaming && <Loader2 className="w-3 h-3 text-violet-400 animate-spin" />}
        </div>
        <div className="flex items-center gap-2">
          {terminal.currentTask && (
            <span className="text-[10px] text-zinc-500 truncate max-w-[200px]">{terminal.currentTask}</span>
          )}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`text-xs px-2 py-0.5 rounded ${
              autoScroll ? 'bg-blue-600/20 text-blue-400' : 'bg-zinc-800 text-zinc-500'
            }`}
          >
            Auto-scroll
          </button>
        </div>
      </div>

      {/* Output */}
      <div ref={outputRef} className="flex-1 overflow-y-auto p-3 font-mono text-sm space-y-0.5">
        {terminal.lines.map((line) => (
          <TerminalLineItem key={line.id} line={line} />
        ))}
      </div>

      {/* Input */}
      <div className="flex-shrink-0 p-2 border-t border-zinc-800">
        <ChatInput
          onSend={handleSend}
          placeholder="Send message..."
          disabled={terminal.isStreaming}
          showPrompt={true}
          promptIcon="❯"
        />
      </div>
    </div>
  );
}

// ============================================================================
// AGENT STATUS WIDGET
// ============================================================================

function AgentStatusWidget({ agent, terminalCount }: { agent: Agent; terminalCount: number }) {
  return (
    <div className={`flex-1 bg-zinc-900 border rounded-lg p-2 ${
      agent.status === 'busy' ? 'border-violet-500/50' : 
      agent.status === 'offline' ? 'border-red-500/30' : 'border-zinc-800'
    }`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{agent.icon}</span>
          <span className="text-xs font-medium text-zinc-300">{agent.name}</span>
        </div>
        <div className={`w-2 h-2 rounded-full ${
          agent.status === 'busy' ? 'bg-violet-400 animate-pulse' : 
          agent.status === 'offline' ? 'bg-red-400' : 'bg-emerald-400'
        }`} />
      </div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-zinc-500 capitalize">{agent.status}</span>
        {terminalCount > 0 && <span className="text-zinc-600">{terminalCount} terminal{terminalCount > 1 ? 's' : ''}</span>}
      </div>
    </div>
  );
}

// ============================================================================
// TASKS WIDGET
// ============================================================================

/** Terminal summary for Run submenu */
interface TerminalOption {
  id: string;
  label: string;
  agentIcon: string;
}

function TasksWidget({
  steps,
  agents,
  terminals,
  highlightedTerminalId,
  onExecute,
  isExecuting,
  onStepAgentChange,
  onSendStepToTerminal,
  onTerminalOptionHover,
  onMenuClose,
  onAddStep,
  onMinimize,
}: {
  steps: PlanStep[];
  agents: Agent[];
  terminals: TerminalOption[];
  highlightedTerminalId?: string | null;
  onExecute: () => void;
  isExecuting: boolean;
  onStepAgentChange: (stepId: string, agentId: string | null) => void;
  onSendStepToTerminal: (step: PlanStep, terminalId?: string) => void;
  onTerminalOptionHover?: (terminalId: string | null) => void;
  onMenuClose?: () => void;
  onAddStep?: (text: string, agentId: string | null) => void;
  onMinimize?: () => void;
}) {
  const [editingStep, setEditingStep] = useState<string | null>(null);
  const [stepMenuOpen, setStepMenuOpen] = useState<string | null>(null);
  const [runSubmenuStepId, setRunSubmenuStepId] = useState<string | null>(null);
  const [showAddInput, setShowAddInput] = useState(false);
  const [newTaskText, setNewTaskText] = useState('');
  const [newTaskAgent, setNewTaskAgent] = useState<string | null>(null);
  const stepMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeMenu = (e: MouseEvent) => {
      if (stepMenuRef.current && !stepMenuRef.current.contains(e.target as Node)) {
        setStepMenuOpen(null);
        setRunSubmenuStepId(null);
        onMenuClose?.();
      }
    };
    if (stepMenuOpen) {
      document.addEventListener('mousedown', closeMenu);
      return () => document.removeEventListener('mousedown', closeMenu);
    }
  }, [stepMenuOpen, onMenuClose]);

  const handleAddStep = () => {
    if (newTaskText.trim() && onAddStep) {
      onAddStep(newTaskText.trim(), newTaskAgent);
      setNewTaskText('');
      setNewTaskAgent(null);
      setShowAddInput(false);
    }
  };

  return (
    <div className="h-full bg-zinc-900 border border-zinc-800 rounded-lg flex flex-col overflow-hidden">
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
        {onAddStep && (
          <button
            onClick={() => setShowAddInput(true)}
            className="flex-shrink-0 flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-violet-400 hover:bg-zinc-800 rounded transition-colors"
            title="Add task"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add task</span>
          </button>
        )}
      </div>

      {showAddInput && onAddStep && (
        <div className="flex-shrink-0 p-2 border-b border-zinc-800 space-y-1.5">
          <input
            type="text"
            value={newTaskText}
            onChange={(e) => setNewTaskText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddStep(); }
              if (e.key === 'Escape') { setShowAddInput(false); setNewTaskText(''); }
            }}
            placeholder="Task description..."
            className="w-full px-2 py-1 text-xs bg-zinc-800 border border-zinc-600 rounded text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-violet-500"
            autoFocus
          />
          <div className="flex items-center gap-1">
            <select
              value={newTaskAgent ?? ''}
              onChange={(e) => setNewTaskAgent(e.target.value || null)}
              className="text-[10px] bg-zinc-800 border border-zinc-600 rounded px-1 py-0.5"
            >
              <option value="">Unassigned</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button onClick={handleAddStep} className="text-[10px] text-violet-400 hover:text-violet-300 px-1.5">Add</button>
            <button onClick={() => { setShowAddInput(false); setNewTaskText(''); }} className="text-[10px] text-zinc-500 hover:text-zinc-300">Cancel</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {steps.length === 0 ? (
          <div className="h-full flex items-center justify-center text-zinc-600 text-sm">
            No tasks yet. Add tasks or they will appear from terminal output.
          </div>
        ) : (
          steps.map((step, idx) => {
            const stepHoverLines = [
              `Agent: ${step.agent ? (agents.find(a => a.id === step.agent)?.name ?? step.agent) : 'Unassigned'}`,
              step.costUsd != null ? `Cost: $${step.costUsd.toFixed(4)}` : null,
              step.durationMs != null ? `Duration: ${(step.durationMs / 1000).toFixed(1)}s` : null,
              `Source: ${step.source === 'extracted' ? 'Terminal' : step.source === 'manual' ? 'Manual' : step.source === 'plan' ? 'Plan' : 'Plan'}`,
            ].filter(Boolean);
            return (
            <div
              key={step.id}
              title={stepHoverLines.join('\n')}
              className={`flex items-start gap-2 p-2 rounded border ${
                step.status === 'running' ? 'bg-violet-500/10 border-violet-500/30' :
                step.status === 'completed' ? 'bg-emerald-500/10 border-emerald-500/30' :
                step.status === 'failed' ? 'bg-red-500/10 border-red-500/30' : 'bg-zinc-800/50 border-zinc-700/50'
              }`}
            >
              <span className="text-xs text-zinc-500 w-5">{idx + 1}.</span>
              <div className="flex-1 min-w-0">
                <PlanStepText text={step.text} />
                <div className="flex items-center gap-2 mt-1">
                  {editingStep === step.id ? (
                    <select
                      value={step.agent ?? ''}
                      onChange={(e) => { onStepAgentChange(step.id, e.target.value || null); setEditingStep(null); }}
                      onBlur={() => setEditingStep(null)}
                      autoFocus
                      className="text-[10px] bg-zinc-800 border border-zinc-600 rounded px-1 py-0.5"
                    >
                      <option value="">Unassigned</option>
                      {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  ) : (
                    <button onClick={() => setEditingStep(step.id)} className="text-[10px] text-zinc-500 hover:text-zinc-300">
                      {step.agent ? (agents.find(a => a.id === step.agent)?.name ?? step.agent) : 'Unassigned'}
                    </button>
                  )}
                </div>
              </div>
              <div className="relative flex items-center gap-0.5 shrink-0" ref={stepMenuOpen === step.id ? stepMenuRef : undefined}>
                {step.status === 'running' && <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin" />}
                {step.status === 'completed' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                {step.status === 'failed' && <X className="w-3.5 h-3.5 text-red-400" />}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const closing = stepMenuOpen === step.id;
                    setStepMenuOpen(closing ? null : step.id);
                    if (closing) onMenuClose?.();
                    setRunSubmenuStepId(null);
                  }}
                  className="p-1 text-zinc-500 hover:text-zinc-300 rounded"
                  title="Task actions"
                >
                  <MoreVertical className="w-3.5 h-3.5" />
                </button>
                {stepMenuOpen === step.id && (
                  <div className="absolute top-full right-0 mt-0.5 py-1 bg-zinc-800 border border-zinc-700 rounded shadow-lg z-10 min-w-[200px]">
                    {runSubmenuStepId === step.id ? (
                      <>
                        <button
                          onClick={() => { setRunSubmenuStepId(null); onTerminalOptionHover?.(null); }}
                          className="w-full px-3 py-1.5 text-left text-xs text-zinc-400 hover:bg-zinc-700 flex items-center gap-2"
                        >
                          <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
                          Back
                        </button>
                        <div className="border-t border-zinc-700 my-0.5" />
                        <button
                          onClick={() => {
                            onSendStepToTerminal(step);
                            setStepMenuOpen(null);
                            setRunSubmenuStepId(null);
                            onTerminalOptionHover?.(null);
                          }}
                          className="w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
                        >
                          <Plus className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                          New terminal
                        </button>
                        {terminals.map((t) => (
                          <button
                            key={t.id}
                            onClick={() => {
                              onSendStepToTerminal(step, t.id);
                              setStepMenuOpen(null);
                              setRunSubmenuStepId(null);
                              onTerminalOptionHover?.(null);
                            }}
                            onMouseEnter={() => onTerminalOptionHover?.(t.id)}
                            onMouseLeave={() => onTerminalOptionHover?.(null)}
                            onFocus={() => onTerminalOptionHover?.(t.id)}
                            onBlur={() => onTerminalOptionHover?.(null)}
                            className={`w-full px-3 py-1.5 text-left text-xs text-zinc-300 flex items-center gap-2 transition-colors ${
                              highlightedTerminalId === t.id
                                ? 'bg-violet-500/20 text-violet-200'
                                : 'hover:bg-zinc-700'
                            }`}
                          >
                            <span className="shrink-0">{t.agentIcon}</span>
                            <span className="truncate">{t.label}</span>
                          </button>
                        ))}
                      </>
                    ) : (
                      <button
                        onClick={() => setRunSubmenuStepId(step.id)}
                        className="w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700 flex items-center justify-between gap-2"
                      >
                        <span className="flex items-center gap-2">
                          <TerminalIcon className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                          Run
                        </span>
                        <ChevronRight className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            );
          })
        )}
      </div>

      <div className="flex-shrink-0 p-2 border-t border-zinc-800">
        <button
          onClick={onExecute}
          disabled={isExecuting || steps.length === 0 || !steps.some(s => s.agent)}
          className="w-full px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-lg text-xs font-medium flex items-center justify-center gap-2"
        >
          {isExecuting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Executing...</> : <><Play className="w-3.5 h-3.5" /> Run tasks</>}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN WORKSPACE
// ============================================================================

export function Workspace() {
  // Workspace state
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const pathInputRef = useRef<HTMLInputElement>(null);

  // Agents state
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);

  // Terminals state
  const [terminals, setTerminals] = useState<TerminalState[]>([]);
  const [minimizedWidgets, setMinimizedWidgets] = useState<MinimizedWidget[]>([]);
  const [highlightedTerminalId, setHighlightedTerminalId] = useState<string | null>(null);

  // Tasks state
  const [planSteps, setPlanSteps] = useState<PlanStep[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [tasksWidgetMinimized, setTasksWidgetMinimized] = useState(false);

  // WebSocket ref
  const wsRef = useRef<WebSocket | null>(null);
  const terminalsRef = useRef<TerminalState[]>(terminals);
  terminalsRef.current = terminals;
  /** Accumulate tool input JSON per block index (for input_json_delta) */
  const toolInputByBlockRef = useRef<Record<number, string>>({});

  // Fetch agents on mount
  const fetchAgents = useCallback(async () => {
    setIsLoadingAgents(true);
    try {
      // Check Claude Code
      const ccStatus = await api.checkClaudeCode();
      
      // Fetch OpenClaw agents
      const res = await fetch(`${API_URL}/agents`);
      const data = await res.json();
      const openclawAgents = (data.agents || []).map((a: any) => ({
        id: a.name,
        name: a.name,
        status: a.status || 'ready',
        icon: getAgentIcon({ type: 'openclaw', name: a.name }),
        type: 'openclaw' as const,
      }));

      const allAgents: Agent[] = [];
      
      if (ccStatus.available) {
        allAgents.push({
          id: 'claude-code-local', // Must match adapter ID on server
          name: 'Claude Code',
          status: 'ready',
          icon: '🖥️',
          type: 'claude-code',
        });
      }
      
      allAgents.push(...openclawAgents);
      setAgents(allAgents);
    } catch (err) {
      console.error('Failed to fetch agents:', err);
    } finally {
      setIsLoadingAgents(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 10000);
    return () => clearInterval(interval);
  }, [fetchAgents]);

  const handleWsEvent = useCallback((data: any) => {
    if (data.type !== 'event') return;
    const event = data.event;
    if (!event) return;

    // Support both adapterId (legacy) and threadId (Phase 2/3)
    const adapterId = event.adapterId;
    const threadId = event.threadId;
    
    // For thread events, find terminal by threadId
    const findTerminal = (terminals: TerminalState[]) => {
      if (threadId) {
        return terminals.find(t => t.threadId === threadId);
      }
      if (adapterId) {
        return terminals.find(t => t.agent.id === adapterId);
      }
      return null;
    };

    const matchesTerminal = (t: TerminalState) => {
      if (threadId) return t.threadId === threadId;
      if (adapterId) return t.agent.id === adapterId;
      return false;
    };

    if (!adapterId && !threadId) return;

    console.log('[WS Event]', event.type, { adapterId, threadId }, event.payload);

    // Handle session.message (raw SDK events from thread)
    if (event.type === 'session.message' && event.payload) {
      const msg = event.payload;
      
      // Process SDK message types for thread sessions
      if (msg.type === 'stream_event') {
        const streamEvent = msg.event;
        const blockIndex = streamEvent?.index;

        // content_block_start: thinking or tool_use → add terminal line
        if (streamEvent?.type === 'content_block_start') {
          const block = streamEvent.content_block;
          const blockType = block?.type;
          const blockId = block?.id ?? `block_${blockIndex ?? 0}`;

          if (blockType === 'thinking') {
            const line: TerminalLine = {
              id: `thinking-${blockId}`,
              type: 'thinking',
              content: 'Thinking...',
              timestamp: makeTimestamp(),
              isStreaming: true,
            };
            setTerminals(prev => prev.map(t =>
              matchesTerminal(t) ? { ...t, lines: [...t.lines, line], isStreaming: true } : t
            ));
          } else if (blockType === 'tool_use' || blockType === 'server_tool_use') {
            const toolName = block?.name ?? 'Tool';
            const idx = blockIndex ?? 0;
            toolInputByBlockRef.current[idx] = '';
            const line: TerminalLine = {
              id: `tool-${blockId}`,
              type: 'tool_call',
              content: toolName,
              timestamp: makeTimestamp(),
              isStreaming: true,
              blockIndex: idx,
            };
            setTerminals(prev => prev.map(t =>
              matchesTerminal(t) ? { ...t, lines: [...t.lines, line], isStreaming: true } : t
            ));
          }
        }

        // content_block_delta: text_delta, thinking_delta, or input_json_delta
        if (streamEvent?.type === 'content_block_delta') {
          const delta = streamEvent.delta;
          const deltaType = delta?.type;

          if (deltaType === 'text_delta' && delta.text) {
            // Append text delta to terminal output
            setTerminals(prev => prev.map(t => {
              if (!matchesTerminal(t)) return t;
              const lastLine = t.lines[t.lines.length - 1];
              if (lastLine?.type === 'output' && lastLine.isStreaming) {
                return {
                  ...t,
                  lines: t.lines.map((l, i) =>
                    i === t.lines.length - 1
                      ? { ...l, content: l.content + delta.text }
                      : l
                  ),
                };
              }
              return {
                ...t,
                lines: [...t.lines, {
                  id: `${Date.now()}`,
                  type: 'output' as const,
                  content: delta.text,
                  timestamp: makeTimestamp(),
                  isStreaming: true,
                }],
              };
            }));
          } else if (deltaType === 'thinking_delta' && delta.thinking) {
            // Append to last thinking line or create one
            setTerminals(prev => prev.map(t => {
              if (!matchesTerminal(t)) return t;
              let idx = -1;
              for (let i = t.lines.length - 1; i >= 0; i--) {
                if (t.lines[i].type === 'thinking') {
                  idx = i;
                  break;
                }
              }
              if (idx >= 0) {
                return {
                  ...t,
                  lines: t.lines.map((l, i) =>
                    i === idx
                      ? { ...l, content: l.content + delta.thinking, isStreaming: true }
                      : l
                  ),
                  isStreaming: true,
                };
              }
              return {
                ...t,
                lines: [...t.lines, {
                  id: `thinking-${Date.now()}`,
                  type: 'thinking' as const,
                  content: delta.thinking,
                  timestamp: makeTimestamp(),
                  isStreaming: true,
                }],
                isStreaming: true,
              };
            }));
          } else if (deltaType === 'input_json_delta' && delta.partial_json != null) {
            // Accumulate tool input JSON and update tool_call line with human-readable detail
            const blockIdx = streamEvent?.index;
            if (typeof blockIdx === 'number') {
              const acc = (toolInputByBlockRef.current[blockIdx] || '') + delta.partial_json;
              toolInputByBlockRef.current[blockIdx] = acc;
              const detail = tryExtractToolDetail(acc);
              if (detail != null) {
                setTerminals(prev => prev.map(t => {
                  if (!matchesTerminal(t)) return t;
                  const lineIdx = t.lines.findIndex(
                    (l) => l.type === 'tool_call' && l.blockIndex === blockIdx
                  );
                  if (lineIdx < 0) return t;
                  const line = t.lines[lineIdx];
                  const baseContent = line.content.includes(': ') ? line.content.split(': ')[0] : line.content;
                  return {
                    ...t,
                    lines: t.lines.map((l, i) =>
                      i === lineIdx ? { ...l, content: `${baseContent}: ${detail}` } : l
                    ),
                  };
                }));
              }
            }
          }
        }
      }
      return;
    }

    if (event.type === 'activity' && event.payload) {
      const activityType = event.payload.activityType;
      const lineType: TerminalLineType = 
        activityType === 'thinking' ? 'thinking' :
        activityType === 'file_read' ? 'tool_call' :
        activityType === 'file_write' ? 'tool_call' :
        activityType === 'command' ? 'command' : 'info';

      const line: TerminalLine = {
        id: `${Date.now()}-${Math.random()}`,
        type: lineType,
        content: event.payload.label + (event.payload.detail ? `: ${event.payload.detail}` : ''),
        timestamp: makeTimestamp(),
        isStreaming: event.payload.status === 'running',
      };

      setTerminals(prev => prev.map(t =>
        matchesTerminal(t) ? { 
          ...t, 
          lines: [...t.lines, line],
          isStreaming: event.payload.status === 'running',
        } : t
      ));
    }

    if (event.type === 'content.delta' && event.payload?.delta) {
      // Append to last output line or create new one
      setTerminals(prev => prev.map(t => {
        if (!matchesTerminal(t)) return t;
        
        const lastLine = t.lines[t.lines.length - 1];
        if (lastLine?.type === 'output' && lastLine.isStreaming) {
          // Append to existing streaming output
          return {
            ...t,
            lines: t.lines.map((l, i) => 
              i === t.lines.length - 1 
                ? { ...l, content: l.content + event.payload.delta }
                : l
            ),
          };
        } else {
          // Create new output line
          return {
            ...t,
            lines: [...t.lines, {
              id: `${Date.now()}`,
              type: 'output' as const,
              content: event.payload.delta,
              timestamp: makeTimestamp(),
              isStreaming: true,
            }],
          };
        }
      }));
    }

    // Handle turn/item completion: update terminal streaming state and sync plan step + cost
    if (event.type === 'turn.completed' || event.type === 'item.completed') {
      if (event.type === 'turn.completed') toolInputByBlockRef.current = {};
      const matchedTerminal = terminalsRef.current.find(matchesTerminal);
      const stepIdToComplete = matchedTerminal?.currentStepId;
      const usage = event.type === 'turn.completed' ? event.payload?.usage : undefined;

      setTerminals(prev => prev.map(t =>
        !matchesTerminal(t) ? t : {
          ...t,
          isStreaming: false,
          currentStepId: undefined,
          lines: t.lines.map(l => ({ ...l, isStreaming: false })),
        }
      ));

      if (stepIdToComplete && usage) {
        setPlanSteps(prev => prev.map(s =>
          s.id === stepIdToComplete
            ? { ...s, status: 'completed' as const, costUsd: usage.costUsd ?? s.costUsd }
            : s
        ));
      }

      // Extract suggested tasks from assistant result and merge as unassigned steps
      if (event.type === 'turn.completed' && event.payload?.result) {
        const extracted = extractTasksFromText(event.payload.result);
        if (extracted.length > 0) {
          setPlanSteps(prev => {
            const existingNormalized = new Set(prev.map(s => s.text.trim().toLowerCase()));
            const newSteps: PlanStep[] = extracted
              .filter(t => {
                const n = t.trim().toLowerCase();
                if (existingNormalized.has(n)) return false;
                existingNormalized.add(n);
                return true;
              })
              .map((text, i) => ({
                id: `step-extracted-${Date.now()}-${i}`,
                text: text.trim(),
                agent: null as string | null,
                status: 'pending' as const,
                source: 'extracted' as const,
              }));
            return prev.length === 0 && newSteps.length > 0 ? newSteps : [...prev, ...newSteps];
          });
        }
      }
    }
  }, []);

  // WebSocket connection for streaming events
  useEffect(() => {
    console.log('[WS] Connecting to', WS_URL);
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => console.log('[WS] Connected');
    
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        handleWsEvent(data);
      } catch (err) {
        console.error('[WS] Parse error:', err);
      }
    };

    ws.onerror = (e) => console.warn('[WS] Error:', e);
    ws.onclose = () => console.warn('[WS] Closed');

    return () => ws.close();
  }, [handleWsEvent]);

  // Terminal handlers
  const handleNewTerminal = (agentId?: string) => {
    const agent = agents.find(a => a.id === agentId) || agents[0];
    if (!agent) return;

    setTerminals(prev => [...prev, {
      id: `terminal-${Date.now()}`,
      agent,
      lines: [{ id: `${Date.now()}`, type: 'system', content: `Session started — ${agent.name}`, timestamp: makeTimestamp() }],
      isStreaming: false,
    }]);
  };

  const handleCloseTerminal = async (terminalId: string) => {
    const terminal = terminals.find(t => t.id === terminalId);
    
    // Close thread session if exists
    if (terminal?.threadId) {
      try {
        await fetch(`${API_URL}/threads/${terminal.threadId}/close`, { method: 'POST' });
      } catch (err) {
        console.warn('Failed to close thread session:', err);
      }
    }
    
    setTerminals(prev => prev.filter(t => t.id !== terminalId));
  };

  const handleMinimizeTerminal = (terminal: TerminalState) => {
    setMinimizedWidgets(prev => [...prev, { id: terminal.id, type: 'terminal', title: terminal.agent.name, icon: terminal.agent.icon, data: terminal }]);
    setTerminals(prev => prev.filter(t => t.id !== terminal.id));
  };

  const handleTerminalMessage = async (terminalId: string, message: string, files?: UploadedFile[]) => {
    const terminal = terminals.find(t => t.id === terminalId);
    if (!terminal) return;

    const cwd = terminal.path || workspacePath || (typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : null) || '/';

    // Build prompt content with file info
    let promptContent = message;
    if (files && files.length > 0) {
      const fileNames = files.map(f => f.name).join(', ');
      promptContent = `${message}\n📎 Attached: ${fileNames}`;
    }

    // Add prompt line and extract current task into plan widget (so it shows and syncs on completion)
    const extractedStepId = `step-extracted-${Date.now()}`;
    setPlanSteps(prev => [...prev, {
      id: extractedStepId,
      text: message,
      agent: terminal.agent.id,
      status: 'running',
      source: 'extracted',
    }]);
    setTerminals(prev => prev.map(t =>
      t.id === terminalId ? {
        ...t,
        isStreaming: true,
        currentTask: message,
        currentStepId: extractedStepId,
        lines: [...t.lines, { id: `${Date.now()}`, type: 'prompt', content: promptContent, timestamp: makeTimestamp() }]
      } : t
    ));

    try {
      let threadId = terminal.threadId;

      // Create thread/session if needed (Phase 2/3)
      if (!threadId) {
        threadId = `thread-${terminalId}`;
        const sessionRes = await fetch(`${API_URL}/threads/${threadId}/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            cwd,
            name: `${terminal.agent.name} - ${new Date().toLocaleString()}`,
          }),
        });
        const sessionData = await sessionRes.json();
        
        if (!sessionData.ok) {
          throw new Error(sessionData.error || 'Failed to create session');
        }
        setTerminals(prev => prev.map(t =>
          t.id === terminalId ? { ...t, threadId, sessionActive: true, currentStepId: extractedStepId } : t
        ));
      }

      // Send via thread API (persistent session)
      let res = await fetch(`${API_URL}/threads/${threadId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      let data = await res.json();

      // If server restarted, session is gone; create session and retry send once
      if (!data.ok && data.error === 'No active session for thread' && terminal.threadId) {
        setTerminals(prev => prev.map(t =>
          t.id === terminalId ? { ...t, threadId: undefined, sessionActive: false } : t
        ));
        const sessionRes = await fetch(`${API_URL}/threads/${threadId}/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cwd, name: `${terminal.agent.name} - ${new Date().toLocaleString()}` }),
        });
        const sessionData = await sessionRes.json();
        if (!sessionData.ok) throw new Error(sessionData.error || 'Failed to create session');
        setTerminals(prev => prev.map(t =>
          t.id === terminalId ? { ...t, threadId, sessionActive: true } : t
        ));
        res = await fetch(`${API_URL}/threads/${threadId}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        });
        data = await res.json();
      }

      if (!data.ok) {
        throw new Error(data.error || 'Send failed');
      }

    } catch (err) {
      setTerminals(prev => prev.map(t =>
        t.id === terminalId ? {
          ...t,
          isStreaming: false,
          currentStepId: undefined,
          lines: [...t.lines, { id: `${Date.now()}`, type: 'error', content: `Error: ${err}`, timestamp: makeTimestamp() }]
        } : t
      ));
      setPlanSteps(prev => prev.map(s =>
        s.id === extractedStepId ? { ...s, status: 'failed' as const } : s
      ));
    }
  };

  const handleSendStepToTerminal = (step: PlanStep, terminalId?: string) => {
    const agent = step.agent ? agents.find(a => a.id === step.agent) : agents[0];
    if (!agent) return;

    if (terminalId) {
      const terminal = terminals.find(t => t.id === terminalId);
      if (terminal) {
        setTerminals(prev => prev.map(t =>
          t.id === terminalId ? { ...t, currentTask: step.text, currentStepId: step.id } : t
        ));
        handleTerminalMessage(terminalId, step.text);
      } else {
        const minimized = minimizedWidgets.find(w => w.type === 'terminal' && w.id === terminalId && w.data);
        if (minimized?.data) {
          const restored: TerminalState = {
            ...minimized.data,
            currentTask: step.text,
            currentStepId: step.id,
          };
          setMinimizedWidgets(prev => prev.filter(w => w.id !== terminalId));
          setTerminals(prev => [...prev, restored]);
          setTimeout(() => handleTerminalMessage(terminalId, step.text), 0);
        }
      }
    } else {
      const newTerminal: TerminalState = {
        id: `terminal-${Date.now()}`,
        agent,
        lines: [{ id: `${Date.now()}`, type: 'system', content: `Session started — ${agent.name}`, timestamp: makeTimestamp() }],
        isStreaming: false,
        currentTask: step.text,
        currentStepId: step.id,
      };
      setTerminals(prev => [...prev, newTerminal]);
      setTimeout(() => handleTerminalMessage(newTerminal.id, step.text), 100);
    }

    setPlanSteps(prev => prev.map(s => s.id === step.id ? { ...s, status: 'running' } : s));
  };

  // Tasks handlers
  const handleExecute = () => {
    const stepsWithAgent = planSteps.filter(s => s.agent);
    if (stepsWithAgent.length === 0) return;
    setIsExecuting(true);
    let idx = 0;
    const exec = () => {
      if (idx < stepsWithAgent.length) {
        const step = stepsWithAgent[idx];
        const stepIdsCompleted = new Set(stepsWithAgent.slice(0, idx).map(s => s.id));
        setPlanSteps(prev => prev.map(s =>
          s.id === step.id ? { ...s, status: 'running' as const }
            : stepIdsCompleted.has(s.id) ? { ...s, status: 'completed' as const }
            : s
        ));
        handleSendStepToTerminal(step);
        idx++;
        setTimeout(exec, 3000);
      } else {
        setPlanSteps(prev => prev.map(s => (s.agent ? { ...s, status: 'completed' as const } : s)));
        setIsExecuting(false);
      }
    };
    exec();
  };

  const handleStepAgentChange = (stepId: string, agentId: string | null) => {
    setPlanSteps(prev => prev.map(s => s.id === stepId ? { ...s, agent: agentId } : s));
  };

  const handleAddStep = (text: string, agentId: string | null) => {
    setPlanSteps(prev => [...prev, {
      id: `step-${Date.now()}-${prev.length}`,
      text,
      agent: agentId,
      status: 'pending',
      source: 'manual',
    }]);
  };

  // Minimize/restore handlers
  const handleRestoreWidget = (widget: MinimizedWidget) => {
    setMinimizedWidgets(prev => prev.filter(w => w.id !== widget.id));
    if (widget.type === 'terminal' && widget.data) {
      setTerminals(prev => [...prev, widget.data!]);
    }
    // Tasks widget restore: right panel is always tasks; no mode to set
  };

  const getTerminalCount = (agentId: string) => terminals.filter(t => t.agent.id === agentId).length;

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* Header */}
      <div className="h-11 flex-shrink-0 bg-zinc-900 border-b border-zinc-800 px-4 flex items-center justify-between drag-region">
        {/* Left: macOS traffic lights spacing */}
        <div className="w-20" />

        {/* Center: Title & Workspace Path */}
        <div className="flex items-center gap-3 flex-1 justify-center">
          <div className="flex items-center gap-2">
            <span className="text-lg">📡</span>
            <span className="text-sm font-semibold text-zinc-100 tracking-wide">Dispatch</span>
          </div>

          <span className="text-zinc-700">|</span>

          {/* Workspace Path */}
          {isEditingPath ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setWorkspacePath(pathInput.trim() || null);
                setIsEditingPath(false);
              }}
              className="flex items-center gap-1 no-drag"
            >
              <FolderOpen className="w-3.5 h-3.5 text-zinc-500" />
              <input
                ref={pathInputRef}
                type="text"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                onBlur={() => {
                  setWorkspacePath(pathInput.trim() || null);
                  setIsEditingPath(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setIsEditingPath(false);
                    setPathInput(workspacePath || '');
                  }
                }}
                placeholder="/path/to/project"
                className="w-64 px-2 py-0.5 text-xs bg-zinc-800 border border-zinc-600 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500"
                autoFocus
              />
              <button type="submit" className="text-xs text-violet-400 hover:text-violet-300 px-1">
                Save
              </button>
            </form>
          ) : (
            <button
              onClick={() => {
                setPathInput(workspacePath || '');
                setIsEditingPath(true);
              }}
              className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors group no-drag"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span className="max-w-[200px] truncate">
                {workspacePath || 'Set workspace path'}
              </span>
              <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2 no-drag">
          <button onClick={fetchAgents} disabled={isLoadingAgents} className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded">
            <RefreshCw className={`w-4 h-4 ${isLoadingAgents ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => handleNewTerminal()} disabled={agents.length === 0} className="flex items-center gap-1.5 px-3 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 rounded">
            <Plus className="w-3.5 h-3.5" /> Terminal
          </button>
        </div>
      </div>

      {/* Workspace Grid */}
      <div className="flex-1 p-2 overflow-hidden">
        {!workspacePath ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <FolderOpen className="w-12 h-12 text-zinc-600 mb-3" />
            <p className="text-sm font-medium text-zinc-300 mb-1">Set a workspace path to get started</p>
            <p className="text-xs text-zinc-500 max-w-sm">Click the path in the header above to choose your project folder. Agents run in this workspace.</p>
          </div>
        ) : (
        <PanelGroup direction="horizontal">
          {/* Left: Terminals */}
          <Panel defaultSize={60} minSize={30}>
            {terminals.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4">
                <TerminalIcon className="w-10 h-10 text-zinc-700 mb-3" />
                <p className="text-sm text-zinc-500 mb-2">No terminals open</p>
                <button onClick={() => handleNewTerminal()} disabled={agents.length === 0} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" /> New Terminal
                </button>
                {agents.length === 0 && <p className="text-xs text-zinc-600 mt-2">No agents connected</p>}
              </div>
            ) : (
              <PanelGroup direction="vertical">
                {terminals.map((terminal, index) => (
                  <Panel key={terminal.id} defaultSize={Math.floor(100 / terminals.length)} minSize={20}>
                    <div className="h-full p-1">
                      <TerminalWidget
                        terminal={terminal}
                        onClose={() => handleCloseTerminal(terminal.id)}
                        onMinimize={() => handleMinimizeTerminal(terminal)}
                        onSendMessage={handleTerminalMessage}
                        isHighlighted={highlightedTerminalId === terminal.id}
                      />
                    </div>
                    {index < terminals.length - 1 && <PanelResizeHandle className="h-1 bg-zinc-800 hover:bg-zinc-700" />}
                  </Panel>
                ))}
              </PanelGroup>
            )}
          </Panel>

          <PanelResizeHandle className="w-1 bg-zinc-800 hover:bg-zinc-700" />

          {/* Right: Tasks (agent status + tasks widget) */}
          <Panel defaultSize={40} minSize={20}>
            <PanelGroup direction="vertical">
              <Panel defaultSize={25} minSize={12}>
                <div className="h-full p-1 flex gap-2">
                  {agents.slice(0, 2).map(agent => (
                    <AgentStatusWidget
                      key={agent.id}
                      agent={{ ...agent, status: terminals.some(t => t.agent.id === agent.id && t.isStreaming) ? 'busy' : agent.status }}
                      terminalCount={getTerminalCount(agent.id)}
                    />
                  ))}
                  {agents.length === 0 && (
                    <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg flex items-center justify-center">
                      <div className="text-center">
                        <WifiOff className="w-5 h-5 text-zinc-600 mx-auto mb-1" />
                        <p className="text-xs text-zinc-500">No agents</p>
                      </div>
                    </div>
                  )}
                </div>
              </Panel>
              <PanelResizeHandle className="h-1 bg-zinc-800 hover:bg-zinc-700" />
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
                      agents={agents}
                      terminals={[
                        ...terminals.map((t) => {
                          const sameAgent = terminals.filter(x => x.agent.id === t.agent.id);
                          const idx = sameAgent.findIndex(x => x.id === t.id) + 1;
                          const suffix = sameAgent.length > 1 ? ` — ${idx}` : '';
                          return {
                            id: t.id,
                            label: `${t.agent.name}${suffix}`,
                            agentIcon: t.agent.icon,
                          };
                        }),
                        ...minimizedWidgets
                          .filter((w): w is MinimizedWidget & { type: 'terminal'; data: TerminalState } => w.type === 'terminal' && !!w.data)
                          .map((w) => ({
                            id: w.id,
                            label: `${w.title} (minimized)`,
                            agentIcon: w.icon,
                          })),
                      ]}
                      highlightedTerminalId={highlightedTerminalId}
                      onExecute={handleExecute}
                      isExecuting={isExecuting}
                      onStepAgentChange={handleStepAgentChange}
                      onSendStepToTerminal={handleSendStepToTerminal}
                      onTerminalOptionHover={setHighlightedTerminalId}
                      onMenuClose={() => setHighlightedTerminalId(null)}
                      onAddStep={handleAddStep}
                      onMinimize={() => setTasksWidgetMinimized(true)}
                    />
                    </div>
                  )}
                </div>
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
        )}
      </div>

      {/* Minimized Widgets Tab Bar */}
      {minimizedWidgets.length > 0 && (
        <div className="flex-shrink-0 h-9 bg-zinc-900 border-t border-zinc-800 px-2 flex items-center gap-1">
          {minimizedWidgets.map(widget => (
            <div
              key={widget.id}
              onClick={() => handleRestoreWidget(widget)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer group transition-all duration-150 ${
                widget.type === 'terminal' && highlightedTerminalId === widget.id
                  ? 'ring-1 ring-violet-400/50 terminal-tab-highlight-pulse'
                  : 'bg-zinc-800 hover:bg-zinc-700'
              }`}
            >
              <span>{widget.icon}</span>
              <span className="text-zinc-300 max-w-[100px] truncate">{widget.title}</span>
              <button onClick={(e) => { e.stopPropagation(); setMinimizedWidgets(prev => prev.filter(w => w.id !== widget.id)); }} className="text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
