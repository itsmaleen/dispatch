import { useState, useEffect, useRef, useCallback } from 'react';
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
  MessageSquare,
  LayoutPanelLeft,
  Bot,
  User,
  Minus,
  Maximize2,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { api } from '../../stores/app';

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

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  plan?: PlanStep[];
  isStreaming?: boolean;
}

interface MinimizedWidget {
  id: string;
  type: 'terminal' | 'planning' | 'chat';
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
}: {
  terminal: TerminalState;
  onClose?: () => void;
  onMinimize?: () => void;
  onSendMessage: (terminalId: string, message: string) => void;
}) {
  const outputRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [terminal.lines]);

  const handleSubmit = () => {
    if (input.trim()) {
      onSendMessage(terminal.id, input);
      setInput('');
    }
  };

  return (
    <div className="h-full bg-[#0d1117] border border-zinc-800 rounded-lg flex flex-col overflow-hidden">
      {/* Title Bar */}
      <div className="flex-shrink-0 px-3 py-2 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
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
        {terminal.currentTask && (
          <span className="text-[10px] text-zinc-500 truncate max-w-[200px]">{terminal.currentTask}</span>
        )}
      </div>

      {/* Output */}
      <div ref={outputRef} className="flex-1 overflow-y-auto p-3 font-mono text-sm space-y-0.5">
        {terminal.lines.map((line) => (
          <TerminalLineItem key={line.id} line={line} />
        ))}
      </div>

      {/* Input */}
      <div className="flex-shrink-0 p-2 border-t border-zinc-800">
        <div className="flex items-center gap-2 bg-zinc-900 rounded px-3 py-1.5">
          <span className="text-violet-400 text-sm">❯</span>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="Send message..."
            className="flex-1 bg-transparent text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
          />
          <button onClick={handleSubmit} disabled={!input.trim()} className="text-zinc-500 hover:text-violet-400 disabled:opacity-30">
            <Send className="w-4 h-4" />
          </button>
        </div>
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
// PLANNING WIDGET
// ============================================================================

function PlanningWidget({
  steps,
  agents,
  onExecute,
  isExecuting,
  onStepAgentChange,
  onSendStepToTerminal,
  onMinimize,
}: {
  steps: PlanStep[];
  agents: Agent[];
  onExecute: () => void;
  isExecuting: boolean;
  onStepAgentChange: (stepId: string, agentId: string) => void;
  onSendStepToTerminal: (step: PlanStep) => void;
  onMinimize?: () => void;
}) {
  const [editingStep, setEditingStep] = useState<string | null>(null);

  return (
    <div className="h-full bg-zinc-900 border border-zinc-800 rounded-lg flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-medium">Planning</span>
          <span className="text-xs text-zinc-600">({steps.length} steps)</span>
        </div>
        {onMinimize && (
          <button onClick={onMinimize} className="p-1 text-zinc-500 hover:text-zinc-300 rounded">
            <Minus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {steps.length === 0 ? (
          <div className="h-full flex items-center justify-center text-zinc-600 text-sm">
            No plan yet. Use chat to create one.
          </div>
        ) : (
          steps.map((step, idx) => (
            <div key={step.id} className={`flex items-start gap-2 p-2 rounded border ${
              step.status === 'running' ? 'bg-violet-500/10 border-violet-500/30' :
              step.status === 'completed' ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-zinc-800/50 border-zinc-700/50'
            }`}>
              <span className="text-xs text-zinc-500 w-5">{idx + 1}.</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-200">{step.text}</p>
                <div className="flex items-center gap-2 mt-1">
                  {editingStep === step.id ? (
                    <select
                      value={step.agent}
                      onChange={(e) => { onStepAgentChange(step.id, e.target.value); setEditingStep(null); }}
                      onBlur={() => setEditingStep(null)}
                      autoFocus
                      className="text-[10px] bg-zinc-800 border border-zinc-600 rounded px-1 py-0.5"
                    >
                      {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  ) : (
                    <button onClick={() => setEditingStep(step.id)} className="text-[10px] text-zinc-500 hover:text-zinc-300">
                      {agents.find(a => a.id === step.agent)?.name || step.agent}
                    </button>
                  )}
                  <button onClick={() => onSendStepToTerminal(step)} className="text-[10px] text-violet-400 hover:text-violet-300">
                    → Terminal
                  </button>
                </div>
              </div>
              {step.status === 'running' && <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin" />}
              {step.status === 'completed' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
            </div>
          ))
        )}
      </div>

      <div className="flex-shrink-0 p-2 border-t border-zinc-800">
        <button
          onClick={onExecute}
          disabled={isExecuting || steps.length === 0}
          className="w-full px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-lg text-xs font-medium flex items-center justify-center gap-2"
        >
          {isExecuting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Executing...</> : <><Play className="w-3.5 h-3.5" /> Execute Plan</>}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// ORCHESTRATOR CHAT
// ============================================================================

function OrchestratorChat({
  messages,
  onSendMessage,
  onExecutePlan,
  onMinimize,
  isStreaming,
}: {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  onExecutePlan: (plan: PlanStep[]) => void;
  onMinimize?: () => void;
  isStreaming: boolean;
}) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    onSendMessage(input.trim());
    setInput('');
  };

  return (
    <div className="h-full bg-zinc-900 rounded-lg border border-zinc-800 flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-violet-400" />
          <span className="text-xs font-medium text-zinc-300">Orchestrator</span>
        </div>
        {onMinimize && (
          <button onClick={onMinimize} className="p-1 text-zinc-500 hover:text-zinc-300 rounded">
            <Minus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <Sparkles className="w-8 h-8 text-violet-400/50 mb-2" />
            <p className="text-sm text-zinc-400">Describe your task</p>
            <p className="text-xs text-zinc-600">I'll create a plan and coordinate the agents.</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
            {msg.role === 'assistant' && (
              <div className="w-6 h-6 rounded-full bg-violet-500/20 flex items-center justify-center flex-shrink-0">
                <Bot className="w-3.5 h-3.5 text-violet-400" />
              </div>
            )}
            <div className="max-w-[85%]">
              <div className={`px-3 py-2 rounded-lg text-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-200'}`}>
                {msg.content}
              </div>
              {msg.plan && (
                <div className="mt-2 bg-zinc-800/50 border border-zinc-700 rounded-lg p-2">
                  <div className="text-[10px] text-zinc-500 mb-1">Proposed Plan</div>
                  {msg.plan.map((step, i) => (
                    <div key={step.id} className="flex gap-2 text-xs">
                      <span className="text-zinc-600">{i + 1}.</span>
                      <span className="text-zinc-300">{step.text}</span>
                    </div>
                  ))}
                  <button onClick={() => onExecutePlan(msg.plan!)} className="mt-2 w-full px-2 py-1 bg-indigo-600 hover:bg-indigo-500 rounded text-[10px] flex items-center justify-center gap-1">
                    <Play className="w-3 h-3" /> Execute
                  </button>
                </div>
              )}
              <div className="text-[10px] text-zinc-600 mt-1">{msg.timestamp}</div>
            </div>
            {msg.role === 'user' && (
              <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center flex-shrink-0">
                <User className="w-3.5 h-3.5 text-zinc-400" />
              </div>
            )}
          </div>
        ))}

        {isStreaming && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-violet-500/20 flex items-center justify-center">
              <Bot className="w-3.5 h-3.5 text-violet-400" />
            </div>
            <div className="bg-zinc-800 px-3 py-2 rounded-lg flex gap-1">
              <div className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce" />
              <div className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex-shrink-0 p-2 border-t border-zinc-800">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe your task..."
            disabled={isStreaming}
            className="flex-1 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/50"
          />
          <button type="submit" disabled={!input.trim() || isStreaming} className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-700 rounded-lg">
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
}

// ============================================================================
// MAIN WORKSPACE
// ============================================================================

export function Workspace() {
  // Agents state
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);

  // Terminals state
  const [terminals, setTerminals] = useState<TerminalState[]>([]);
  const [minimizedWidgets, setMinimizedWidgets] = useState<MinimizedWidget[]>([]);

  // Planning state
  const [planSteps, setPlanSteps] = useState<PlanStep[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);

  // Chat state
  const [rightPanelMode, setRightPanelMode] = useState<'planning' | 'chat'>('chat');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatStreaming, setIsChatStreaming] = useState(false);

  // WebSocket ref
  const wsRef = useRef<WebSocket | null>(null);

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

  // WebSocket connection for streaming events
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        handleWsEvent(data);
      } catch {}
    };

    ws.onerror = () => console.warn('WebSocket error');
    ws.onclose = () => console.warn('WebSocket closed');

    return () => ws.close();
  }, []);

  const handleWsEvent = (data: any) => {
    if (data.type !== 'event') return;
    const event = data.event;
    if (!event) return;

    // Find terminal by adapterId or agentId
    const terminalId = data.adapterId || data.agentId;
    if (!terminalId) return;

    if (event.type === 'activity' && event.payload) {
      const line: TerminalLine = {
        id: `${Date.now()}-${Math.random()}`,
        type: event.payload.activityType === 'thinking' ? 'thinking' :
              event.payload.activityType === 'file_read' ? 'tool_call' :
              event.payload.activityType === 'file_write' ? 'tool_call' :
              event.payload.activityType === 'command' ? 'command' : 'info',
        content: event.payload.label,
        timestamp: makeTimestamp(),
      };

      setTerminals(prev => prev.map(t =>
        t.agent.id === terminalId ? { ...t, lines: [...t.lines, line] } : t
      ));
    }

    if (event.type === 'content.delta' && event.payload?.delta) {
      setTerminals(prev => prev.map(t =>
        t.agent.id === terminalId ? {
          ...t,
          lines: [...t.lines, {
            id: `${Date.now()}`,
            type: 'output',
            content: event.payload.delta,
            timestamp: makeTimestamp(),
          }]
        } : t
      ));
    }
  };

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

  const handleCloseTerminal = (terminalId: string) => {
    setTerminals(prev => prev.filter(t => t.id !== terminalId));
  };

  const handleMinimizeTerminal = (terminal: TerminalState) => {
    setMinimizedWidgets(prev => [...prev, { id: terminal.id, type: 'terminal', title: terminal.agent.name, icon: terminal.agent.icon, data: terminal }]);
    setTerminals(prev => prev.filter(t => t.id !== terminal.id));
  };

  const handleTerminalMessage = async (terminalId: string, message: string) => {
    const terminal = terminals.find(t => t.id === terminalId);
    if (!terminal) return;

    // Add prompt line
    setTerminals(prev => prev.map(t =>
      t.id === terminalId ? {
        ...t,
        isStreaming: true,
        currentTask: message,
        lines: [...t.lines, { id: `${Date.now()}`, type: 'prompt', content: message, timestamp: makeTimestamp() }]
      } : t
    ));

    try {
      // Send to adapter
      const res = await fetch(`${API_URL}/adapters/${terminal.agent.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();

      if (data.response) {
        setTerminals(prev => prev.map(t =>
          t.id === terminalId ? {
            ...t,
            isStreaming: false,
            lines: [...t.lines, { id: `${Date.now()}`, type: 'info', content: data.response, timestamp: makeTimestamp() }]
          } : t
        ));
      }
    } catch (err) {
      setTerminals(prev => prev.map(t =>
        t.id === terminalId ? {
          ...t,
          isStreaming: false,
          lines: [...t.lines, { id: `${Date.now()}`, type: 'error', content: `Error: ${err}`, timestamp: makeTimestamp() }]
        } : t
      ));
    }
  };

  const handleSendStepToTerminal = (step: PlanStep) => {
    const agent = agents.find(a => a.id === step.agent) || agents[0];
    if (!agent) return;

    const existingTerminal = terminals.find(t => t.agent.id === agent.id);
    if (existingTerminal) {
      handleTerminalMessage(existingTerminal.id, step.text);
    } else {
      const newTerminal: TerminalState = {
        id: `terminal-${Date.now()}`,
        agent,
        lines: [{ id: `${Date.now()}`, type: 'system', content: `Session started — ${agent.name}`, timestamp: makeTimestamp() }],
        isStreaming: false,
        currentTask: step.text,
      };
      setTerminals(prev => [...prev, newTerminal]);
      setTimeout(() => handleTerminalMessage(newTerminal.id, step.text), 100);
    }

    setPlanSteps(prev => prev.map(s => s.id === step.id ? { ...s, status: 'running' } : s));
  };

  // Planning handlers
  const handleExecute = () => {
    setIsExecuting(true);
    let idx = 0;
    const exec = () => {
      if (idx < planSteps.length) {
        setPlanSteps(prev => prev.map((s, i) => ({ ...s, status: i === idx ? 'running' : i < idx ? 'completed' : 'pending' })));
        handleSendStepToTerminal(planSteps[idx]);
        idx++;
        setTimeout(exec, 3000);
      } else {
        setPlanSteps(prev => prev.map(s => ({ ...s, status: 'completed' })));
        setIsExecuting(false);
      }
    };
    exec();
  };

  const handleStepAgentChange = (stepId: string, agentId: string) => {
    setPlanSteps(prev => prev.map(s => s.id === stepId ? { ...s, agent: agentId } : s));
  };

  // Chat handlers
  const handleChatMessage = async (text: string) => {
    const userMsg: ChatMessage = { id: `${Date.now()}`, role: 'user', content: text, timestamp: makeTimestamp() };
    setChatMessages(prev => [...prev, userMsg]);
    setIsChatStreaming(true);

    const lower = text.toLowerCase();

    // Execute command - run the last plan
    if (lower.includes('run it') || lower.includes('execute') || lower.includes('go ahead') || lower.includes('do it')) {
      const lastPlan = [...chatMessages].reverse().find(m => m.plan);
      if (lastPlan?.plan) {
        setPlanSteps(lastPlan.plan);
        setTimeout(() => handleExecute(), 100);
        setChatMessages(prev => [...prev, { id: `${Date.now()}`, role: 'assistant', content: '🚀 Executing plan. Watch the terminals!', timestamp: makeTimestamp() }]);
      } else {
        setChatMessages(prev => [...prev, { id: `${Date.now()}`, role: 'assistant', content: 'No plan to execute yet. Describe a task first!', timestamp: makeTimestamp() }]);
      }
      setIsChatStreaming(false);
      return;
    }

    // Status query
    if (lower.includes('status') || lower.includes('progress') || lower.includes('what\'s happening')) {
      const busy = terminals.filter(t => t.isStreaming);
      const msg = busy.length > 0
        ? `Currently ${busy.length} terminal(s) active:\n${busy.map(t => `• ${t.agent.name}: ${t.currentTask || 'working...'}`).join('\n')}`
        : planSteps.some(s => s.status === 'running')
          ? `Executing plan: ${planSteps.filter(s => s.status === 'completed').length}/${planSteps.length} steps done`
          : 'All quiet. Ready for a new task!';
      setChatMessages(prev => [...prev, { id: `${Date.now()}`, role: 'assistant', content: msg, timestamp: makeTimestamp() }]);
      setIsChatStreaming(false);
      return;
    }

    // Detect if this is a simple question vs a task
    const isQuestion = lower.includes('?') || 
                       lower.startsWith('what') || 
                       lower.startsWith('how') || 
                       lower.startsWith('why') ||
                       lower.startsWith('can you') ||
                       lower.startsWith('tell me') ||
                       lower.length < 30;

    // For simple questions, ask Claude directly without planning
    if (isQuestion && !lower.includes('build') && !lower.includes('create') && !lower.includes('implement') && !lower.includes('add')) {
      try {
        // Send directly to Claude Code for a quick answer
        const res = await fetch(`${API_URL}/adapters/claude-code-local/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            message: text,
            taskOptions: { taskType: 'planning', effort: 'low', maxTurns: 1 }
          }),
        });
        const data = await res.json();
        
        if (data.ok) {
          // Wait a bit for the response
          setTimeout(async () => {
            const resultRes = await fetch(`${API_URL}/adapters/claude-code-local/result/${data.turnId}`);
            const resultData = await resultRes.json();
            setChatMessages(prev => [...prev, { 
              id: `${Date.now()}`, 
              role: 'assistant', 
              content: resultData.result || 'Let me think about that...', 
              timestamp: makeTimestamp() 
            }]);
            setIsChatStreaming(false);
          }, 2000);
        } else {
          // Fallback to planning mode
          setChatMessages(prev => [...prev, { id: `${Date.now()}`, role: 'assistant', content: `I'll help with that. Let me create a plan...`, timestamp: makeTimestamp() }]);
          await generatePlan(text);
        }
        return;
      } catch {
        // Fallback to planning mode
      }
    }

    // For tasks, generate a plan
    setChatMessages(prev => [...prev, { id: `${Date.now()}-thinking`, role: 'assistant', content: 'Creating a plan...', timestamp: makeTimestamp(), isStreaming: true }]);
    await generatePlan(text);
  };

  const generatePlan = async (text: string) => {
    try {
      const { taskId } = await api.createTask(text);
      const planResult = await api.planTask(taskId, agents[0]?.id);
      
      const steps = planResult.plan.split('\n').filter(Boolean).map((line, i) => ({
        id: `step-${Date.now()}-${i}`,
        text: line.replace(/^\d+\.\s*/, ''),
        agent: agents[i % agents.length]?.id || 'claude-code-local',
      }));

      setChatMessages(prev => [...prev, {
        id: `${Date.now()}`,
        role: 'assistant',
        content: 'Here\'s my plan. Say "run it" to execute.',
        timestamp: makeTimestamp(),
        plan: steps,
      }]);
    } catch (err) {
      setChatMessages(prev => [...prev, {
        id: `${Date.now()}`,
        role: 'assistant',
        content: `Error creating plan: ${err}`,
        timestamp: makeTimestamp(),
      }]);
    }
    setIsChatStreaming(false);
  };

  const handleExecutePlanFromChat = (plan: PlanStep[]) => {
    setPlanSteps(plan);
    setRightPanelMode('planning');
    setTimeout(handleExecute, 100);
  };

  // Minimize/restore handlers
  const handleRestoreWidget = (widget: MinimizedWidget) => {
    setMinimizedWidgets(prev => prev.filter(w => w.id !== widget.id));
    if (widget.type === 'terminal' && widget.data) {
      setTerminals(prev => [...prev, widget.data!]);
    } else if (widget.type === 'chat') {
      setRightPanelMode('chat');
    } else if (widget.type === 'planning') {
      setRightPanelMode('planning');
    }
  };

  const getTerminalCount = (agentId: string) => terminals.filter(t => t.agent.id === agentId).length;

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* Header */}
      <div className="h-11 flex-shrink-0 bg-zinc-900 border-b border-zinc-800 px-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg">🦞</span>
          <span className="text-sm font-medium text-zinc-200">Agent Command Center</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchAgents} disabled={isLoadingAgents} className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded">
            <RefreshCw className={`w-4 h-4 ${isLoadingAgents ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => handleNewTerminal()} disabled={agents.length === 0} className="flex items-center gap-1.5 px-3 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 rounded">
            <Plus className="w-3.5 h-3.5" /> Terminal
          </button>
          <div className="flex bg-zinc-800 rounded overflow-hidden">
            <button onClick={() => setRightPanelMode('planning')} className={`px-3 py-1 text-xs flex items-center gap-1.5 ${rightPanelMode === 'planning' ? 'bg-indigo-600 text-white' : 'text-zinc-400'}`}>
              <LayoutPanelLeft className="w-3.5 h-3.5" /> Plan
            </button>
            <button onClick={() => setRightPanelMode('chat')} className={`px-3 py-1 text-xs flex items-center gap-1.5 ${rightPanelMode === 'chat' ? 'bg-violet-600 text-white' : 'text-zinc-400'}`}>
              <MessageSquare className="w-3.5 h-3.5" /> Chat
            </button>
          </div>
        </div>
      </div>

      {/* Workspace Grid */}
      <div className="flex-1 p-2 overflow-hidden">
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
                      />
                    </div>
                    {index < terminals.length - 1 && <PanelResizeHandle className="h-1 bg-zinc-800 hover:bg-zinc-700" />}
                  </Panel>
                ))}
              </PanelGroup>
            )}
          </Panel>

          <PanelResizeHandle className="w-1 bg-zinc-800 hover:bg-zinc-700" />

          {/* Right: Planning or Chat */}
          <Panel defaultSize={40} minSize={20}>
            {rightPanelMode === 'planning' ? (
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
                  <div className="h-full p-1">
                    <PlanningWidget
                      steps={planSteps}
                      agents={agents}
                      onExecute={handleExecute}
                      isExecuting={isExecuting}
                      onStepAgentChange={handleStepAgentChange}
                      onSendStepToTerminal={handleSendStepToTerminal}
                      onMinimize={() => { setMinimizedWidgets(prev => [...prev, { id: 'planning', type: 'planning', title: 'Planning', icon: '📋' }]); setRightPanelMode('chat'); }}
                    />
                  </div>
                </Panel>
              </PanelGroup>
            ) : (
              <div className="h-full p-1">
                <OrchestratorChat
                  messages={chatMessages}
                  onSendMessage={handleChatMessage}
                  onExecutePlan={handleExecutePlanFromChat}
                  onMinimize={() => { setMinimizedWidgets(prev => [...prev, { id: 'chat', type: 'chat', title: 'Orchestrator', icon: '🤖' }]); setRightPanelMode('planning'); }}
                  isStreaming={isChatStreaming}
                />
              </div>
            )}
          </Panel>
        </PanelGroup>
      </div>

      {/* Minimized Widgets Tab Bar */}
      {minimizedWidgets.length > 0 && (
        <div className="flex-shrink-0 h-9 bg-zinc-900 border-t border-zinc-800 px-2 flex items-center gap-1">
          {minimizedWidgets.map(widget => (
            <div key={widget.id} onClick={() => handleRestoreWidget(widget)} className="flex items-center gap-1 px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-xs cursor-pointer group">
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
