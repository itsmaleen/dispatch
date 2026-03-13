import { useState, useEffect, useRef } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { 
  Send, 
  Plus, 
  ChevronDown, 
  Play, 
  Square,
  Brain,
  FileSearch,
  FilePen,
  Terminal as TerminalIcon,
  Check,
  Loader2,
  Bot,
  Sparkles,
  GripVertical
} from 'lucide-react';
import { ChatMarkdown } from '../shared/ChatMarkdown';

// ============================================================================
// FAKE DATA
// ============================================================================

const FAKE_AGENTS = [
  { id: 'claude-code', name: 'Claude Code', status: 'ready' as const, icon: '🖥️' },
  { id: 'scout', name: 'scout', status: 'ready' as const, icon: '🔍' },
  { id: 'forge', name: 'forge', status: 'ready' as const, icon: '🔨' },
  { id: 'vera', name: 'vera', status: 'busy' as const, icon: '✨' },
];

const FAKE_PLAN_STEPS = [
  { id: '1', text: 'Add JWT middleware to Express router', agent: 'claude-code' },
  { id: '2', text: 'Research refresh token best practices', agent: 'scout' },
  { id: '3', text: 'Write integration tests for auth flow', agent: 'forge' },
  { id: '4', text: 'Review changes and create PR', agent: 'claude-code' },
];

const FAKE_ACTIVITIES = [
  { id: '1', type: 'file_read' as const, label: 'Reading file', detail: 'src/middleware/auth.ts', status: 'completed' as const },
  { id: '2', type: 'thinking' as const, label: 'Analyzing auth flow...', status: 'completed' as const },
  { id: '3', type: 'file_write' as const, label: 'Editing file', detail: 'src/middleware/jwt.ts', status: 'completed' as const },
  { id: '4', type: 'command' as const, label: 'Running command', detail: 'npm test', status: 'running' as const },
];

const FAKE_OUTPUT = `## Authentication Implementation

I've added JWT middleware to the Express router. Here's what I did:

1. **Created \`src/middleware/jwt.ts\`** - New JWT verification middleware
2. **Updated \`src/routes/api.ts\`** - Applied middleware to protected routes
3. **Added refresh token logic** - Tokens refresh 2 minutes before expiry

\`\`\`typescript
// src/middleware/jwt.ts
export const verifyJWT = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid token' });
  }
};
\`\`\`

Tests are now running...`;

// ============================================================================
// TYPES
// ============================================================================

type AgentStatus = 'ready' | 'busy' | 'offline';
type ActivityType = 'thinking' | 'file_read' | 'file_write' | 'command' | 'info' | 'error';
type ActivityStatus = 'running' | 'completed' | 'failed';

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

interface Activity {
  id: string;
  type: ActivityType;
  label: string;
  detail?: string;
  status: ActivityStatus;
}

interface TerminalState {
  id: string;
  agent: Agent;
  activities: Activity[];
  output: string;
  isStreaming: boolean;
}

// ============================================================================
// COMPONENTS
// ============================================================================

// Activity Icon
function ActivityIcon({ type, status }: { type: ActivityType; status?: ActivityStatus }) {
  const baseClass = "w-3.5 h-3.5";
  
  if (status === 'running') {
    return <Loader2 className={`${baseClass} text-indigo-400 animate-spin`} />;
  }
  
  switch (type) {
    case 'thinking':
      return <Brain className={`${baseClass} text-purple-400`} />;
    case 'file_read':
      return <FileSearch className={`${baseClass} text-blue-400`} />;
    case 'file_write':
      return <FilePen className={`${baseClass} text-emerald-400`} />;
    case 'command':
      return <TerminalIcon className={`${baseClass} text-amber-400`} />;
    default:
      return <Sparkles className={`${baseClass} text-zinc-400`} />;
  }
}

// Activity Log Item
function ActivityItem({ activity }: { activity: Activity }) {
  const toneClass = {
    thinking: 'text-purple-300/80',
    file_read: 'text-blue-300/80',
    file_write: 'text-emerald-300/80',
    command: 'text-amber-300/80',
    info: 'text-zinc-400',
    error: 'text-red-300',
  }[activity.type];

  return (
    <div className="flex items-start gap-2 py-1">
      <div className="mt-0.5">
        <ActivityIcon type={activity.type} status={activity.status} />
      </div>
      <div className="flex-1 min-w-0">
        <span className={`text-[13px] ${toneClass}`}>
          {activity.label}
        </span>
        {activity.detail && (
          <span className="ml-2 text-zinc-500/70 font-mono text-xs truncate">
            {activity.detail}
          </span>
        )}
        {activity.status === 'completed' && (
          <Check className="inline-block w-3 h-3 ml-1.5 text-emerald-400/60" />
        )}
      </div>
    </div>
  );
}

// Planning Widget
function PlanningWidget({ 
  steps, 
  agents,
  onExecute,
  isExecuting,
  onStepAgentChange,
}: { 
  steps: PlanStep[];
  agents: Agent[];
  onExecute: () => void;
  isExecuting: boolean;
  onStepAgentChange: (stepId: string, agentId: string) => void;
}) {
  const [taskInput, setTaskInput] = useState('');
  const [showPlan, setShowPlan] = useState(steps.length > 0);
  const [editingStep, setEditingStep] = useState<string | null>(null);

  const handleSubmit = () => {
    if (taskInput.trim()) {
      setShowPlan(true);
    }
  };

  return (
    <div className="h-full bg-zinc-900 border border-zinc-800 rounded-lg flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-zinc-800 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-violet-400" />
        <span className="text-sm font-medium">Planning</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {!showPlan ? (
          // Empty state - task input
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <div className="w-12 h-12 rounded-full bg-violet-500/10 flex items-center justify-center mb-4">
              <Sparkles className="w-6 h-6 text-violet-400" />
            </div>
            <h3 className="text-lg font-medium text-zinc-200 mb-2">What would you like to build?</h3>
            <p className="text-sm text-zinc-500 mb-6 max-w-xs">
              Describe your task and I'll create a plan with optimal agent assignments.
            </p>
            <div className="w-full max-w-sm">
              <textarea
                value={taskInput}
                onChange={(e) => setTaskInput(e.target.value)}
                placeholder="Add authentication to the API..."
                className="w-full h-24 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-violet-500/50 resize-none"
              />
              <button
                onClick={handleSubmit}
                disabled={!taskInput.trim()}
                className="mt-3 w-full px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-lg text-sm font-medium transition-colors"
              >
                Generate Plan
              </button>
            </div>
          </div>
        ) : (
          // Plan steps
          <div className="space-y-2">
            {steps.map((step, index) => {
              const agent = agents.find(a => a.id === step.agent);
              const isEditing = editingStep === step.id;
              
              return (
                <div
                  key={step.id}
                  className={`p-3 rounded-lg border transition-colors ${
                    step.status === 'running' 
                      ? 'border-indigo-500/50 bg-indigo-500/5' 
                      : step.status === 'completed'
                      ? 'border-emerald-500/30 bg-emerald-500/5'
                      : 'border-zinc-800 bg-zinc-800/30 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Step number */}
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium shrink-0 ${
                      step.status === 'completed' 
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : step.status === 'running'
                        ? 'bg-indigo-500/20 text-indigo-400'
                        : 'bg-zinc-700 text-zinc-400'
                    }`}>
                      {step.status === 'completed' ? <Check className="w-3 h-3" /> : index + 1}
                    </div>
                    
                    {/* Step content */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${step.status === 'completed' ? 'text-zinc-500' : 'text-zinc-200'}`}>
                        {step.text}
                      </p>
                      
                      {/* Agent badge - clickable */}
                      <div className="mt-2 relative">
                        <button
                          onClick={() => setEditingStep(isEditing ? null : step.id)}
                          className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-400 transition-colors"
                        >
                          <span>{agent?.icon}</span>
                          <span>{agent?.name || step.agent}</span>
                          <ChevronDown className="w-3 h-3" />
                        </button>
                        
                        {/* Agent dropdown */}
                        {isEditing && (
                          <div className="absolute top-full left-0 mt-1 w-48 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-10 py-1">
                            {agents.filter(a => a.status !== 'offline').map(a => (
                              <button
                                key={a.id}
                                onClick={() => {
                                  onStepAgentChange(step.id, a.id);
                                  setEditingStep(null);
                                }}
                                className={`w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 flex items-center gap-2 ${
                                  a.id === step.agent ? 'text-violet-400' : 'text-zinc-300'
                                }`}
                              >
                                <span>{a.icon}</span>
                                <span>{a.name}</span>
                                {a.status === 'busy' && (
                                  <span className="ml-auto text-xs text-zinc-500">busy</span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Status indicator */}
                    {step.status === 'running' && (
                      <Loader2 className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer - Execute button */}
      {showPlan && (
        <div className="flex-shrink-0 px-3 py-2 border-t border-zinc-800">
          <button
            onClick={onExecute}
            disabled={isExecuting}
            className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          >
            {isExecuting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Executing...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Execute Plan
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// Terminal Widget
function TerminalWidget({ 
  terminal,
  onClose,
}: { 
  terminal: TerminalState;
  onClose?: () => void;
}) {
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [terminal.output]);

  return (
    <div className="h-full bg-zinc-900 border border-zinc-800 rounded-lg flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            terminal.isStreaming ? 'bg-indigo-500 animate-pulse' : 'bg-emerald-500'
          }`} />
          <span className="text-sm">{terminal.agent.icon}</span>
          <span className="text-sm font-medium">{terminal.agent.name}</span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <Square className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Activity Log */}
      {terminal.activities.length > 0 && (
        <div className="flex-shrink-0 px-3 py-2 border-b border-zinc-800/50 bg-zinc-900/50 max-h-32 overflow-y-auto">
          <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">Activity</div>
          {terminal.activities.map(activity => (
            <ActivityItem key={activity.id} activity={activity} />
          ))}
        </div>
      )}

      {/* Output */}
      <div ref={outputRef} className="flex-1 overflow-y-auto p-3">
        {terminal.output ? (
          <ChatMarkdown content={terminal.output} isStreaming={terminal.isStreaming} />
        ) : (
          <div className="h-full flex items-center justify-center text-zinc-600 text-sm">
            {terminal.isStreaming ? (
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Working...</span>
              </div>
            ) : (
              <span>Waiting for task...</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Chat Input Bar
function ChatInputBar({
  agents,
  selectedAgent,
  onAgentChange,
  onSend,
  onNewTerminal,
}: {
  agents: Agent[];
  selectedAgent: string;
  onAgentChange: (agentId: string) => void;
  onSend: (message: string) => void;
  onNewTerminal: () => void;
}) {
  const [input, setInput] = useState('');
  const [showAgentDropdown, setShowAgentDropdown] = useState(false);
  const agent = agents.find(a => a.id === selectedAgent);

  const handleSubmit = () => {
    if (input.trim()) {
      onSend(input);
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
    <div className="h-14 bg-zinc-900 border-t border-zinc-800 px-4 flex items-center gap-3">
      {/* New Terminal Button */}
      <button
        onClick={onNewTerminal}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        <Plus className="w-4 h-4" />
        <span className="hidden sm:inline">Terminal</span>
      </button>

      {/* Input */}
      <div className="flex-1 flex items-center gap-2 bg-zinc-800 rounded-lg px-3 py-1.5">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a task or instruction..."
          className="flex-1 bg-transparent text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none"
        />
      </div>

      {/* Agent Selector */}
      <div className="relative">
        <button
          onClick={() => setShowAgentDropdown(!showAgentDropdown)}
          className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors"
        >
          <span>{agent?.icon}</span>
          <span className="text-zinc-300">{agent?.name}</span>
          <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
        </button>

        {showAgentDropdown && (
          <div className="absolute bottom-full right-0 mb-2 w-48 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-10 py-1">
            {agents.map(a => (
              <button
                key={a.id}
                onClick={() => {
                  onAgentChange(a.id);
                  setShowAgentDropdown(false);
                }}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 flex items-center gap-2 ${
                  a.id === selectedAgent ? 'text-violet-400' : 'text-zinc-300'
                }`}
              >
                <span>{a.icon}</span>
                <span>{a.name}</span>
                <span className={`ml-auto w-2 h-2 rounded-full ${
                  a.status === 'ready' ? 'bg-emerald-500' : 
                  a.status === 'busy' ? 'bg-amber-500' : 'bg-zinc-600'
                }`} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Send Button */}
      <button
        onClick={handleSubmit}
        disabled={!input.trim()}
        className="p-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 rounded-lg transition-colors"
      >
        <Send className="w-4 h-4" />
      </button>
    </div>
  );
}

// ============================================================================
// MAIN WORKSPACE DEMO
// ============================================================================

export function WorkspaceDemo() {
  const [planSteps, setPlanSteps] = useState<PlanStep[]>(FAKE_PLAN_STEPS);
  const [isExecuting, setIsExecuting] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState('claude-code');
  const [terminals, setTerminals] = useState<TerminalState[]>([
    {
      id: 'terminal-1',
      agent: FAKE_AGENTS[0],
      activities: FAKE_ACTIVITIES,
      output: FAKE_OUTPUT,
      isStreaming: false,
    },
  ]);

  const handleExecute = () => {
    setIsExecuting(true);
    
    // Simulate step execution
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

  const handleNewTerminal = () => {
    const agent = FAKE_AGENTS.find(a => a.id === selectedAgent) || FAKE_AGENTS[0];
    setTerminals(prev => [...prev, {
      id: `terminal-${Date.now()}`,
      agent,
      activities: [],
      output: '',
      isStreaming: false,
    }]);
  };

  const handleSend = (message: string) => {
    // Add to active terminal or create new one
    const agent = FAKE_AGENTS.find(a => a.id === selectedAgent) || FAKE_AGENTS[0];
    
    // Find existing terminal for this agent or create new
    const existingTerminal = terminals.find(t => t.agent.id === agent.id);
    
    if (existingTerminal) {
      setTerminals(prev => prev.map(t => 
        t.id === existingTerminal.id 
          ? { ...t, isStreaming: true, activities: [
              { id: Date.now().toString(), type: 'thinking', label: 'Processing...', status: 'running' }
            ]}
          : t
      ));
    } else {
      setTerminals(prev => [...prev, {
        id: `terminal-${Date.now()}`,
        agent,
        activities: [
          { id: Date.now().toString(), type: 'thinking', label: 'Processing...', status: 'running' }
        ],
        output: '',
        isStreaming: true,
      }]);
    }
  };

  const handleCloseTerminal = (terminalId: string) => {
    setTerminals(prev => prev.filter(t => t.id !== terminalId));
  };

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* Header */}
      <div className="h-11 flex-shrink-0 bg-zinc-900 border-b border-zinc-800 px-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg">🦞</span>
          <span className="text-sm font-medium text-zinc-200">Agent Command Center</span>
          <span className="text-zinc-600">•</span>
          <span className="text-sm text-zinc-500">agent-command-center</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="text-xs px-3 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors">
            Settings
          </button>
        </div>
      </div>

      {/* Workspace Grid */}
      <div className="flex-1 p-2 overflow-hidden">
        <PanelGroup direction="horizontal">
          {/* Planning Panel */}
          <Panel defaultSize={35} minSize={25}>
            <div className="h-full pr-1">
              <PlanningWidget
                steps={planSteps}
                agents={FAKE_AGENTS}
                onExecute={handleExecute}
                isExecuting={isExecuting}
                onStepAgentChange={handleStepAgentChange}
              />
            </div>
          </Panel>

          <PanelResizeHandle className="w-1 bg-transparent hover:bg-zinc-700 transition-colors mx-1" />

          {/* Terminals Panel */}
          <Panel defaultSize={65} minSize={40}>
            <PanelGroup direction="vertical">
              {terminals.map((terminal, index) => (
                <Panel key={terminal.id} defaultSize={100 / terminals.length} minSize={20}>
                  <div className={`h-full ${index > 0 ? 'pt-1' : ''}`}>
                    <TerminalWidget
                      terminal={terminal}
                      onClose={terminals.length > 1 ? () => handleCloseTerminal(terminal.id) : undefined}
                    />
                  </div>
                  {index < terminals.length - 1 && (
                    <PanelResizeHandle className="h-1 bg-transparent hover:bg-zinc-700 transition-colors my-1" />
                  )}
                </Panel>
              ))}
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </div>

      {/* Chat Input Bar */}
      <ChatInputBar
        agents={FAKE_AGENTS}
        selectedAgent={selectedAgent}
        onAgentChange={setSelectedAgent}
        onSend={handleSend}
        onNewTerminal={handleNewTerminal}
      />
    </div>
  );
}
