import { useState, useEffect } from 'react';
import { ArrowLeft, Loader2, CheckCircle, AlertCircle, RotateCcw } from 'lucide-react';
import { api, useAppStore } from '../../stores/app';
import { AgentSelector } from '../shared/AgentSelector';

interface PlanningViewProps {
  taskId: string;
  initialMessage: string;
  initialPlan?: string;
  initialAgent?: string;
  onExecute: () => void;
  onBack: () => void;
}

export function PlanningView({ taskId, initialMessage, initialPlan, initialAgent, onExecute, onBack }: PlanningViewProps) {
  const { agents, updateTask, claudeCodeAvailable } = useAppStore();
  const [status, setStatus] = useState<'selecting' | 'planning' | 'planned' | 'error'>(() =>
    initialPlan ? 'planned' : 'selecting'
  );
  const [plan, setPlan] = useState<string | null>(() => initialPlan ?? null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(() => {
    // Default: Claude Code if available, otherwise first OpenClaw agent
    if (initialAgent) return initialAgent;
    if (claudeCodeAvailable) return 'claude-code';
    if (agents.length > 0) return agents[0].name;
    return null;
  });
  const [error, setError] = useState<string | null>(null);

  // Update selected agent when agents list changes (if none selected yet)
  useEffect(() => {
    if (!selectedAgent) {
      if (claudeCodeAvailable) {
        setSelectedAgent('claude-code');
      } else if (agents.length > 0) {
        setSelectedAgent(agents[0].name);
      }
    }
  }, [agents, claudeCodeAvailable, selectedAgent]);

  const handleGeneratePlan = async () => {
    if (!selectedAgent) {
      setError('Please select an agent first');
      return;
    }
    
    try {
      setStatus('planning');
      setError(null);
      const result = await api.planTask(taskId, selectedAgent);
      setPlan(result.plan);
      setSelectedAgent(result.agent); // Server may have adjusted
      setStatus('planned');
      
      // Update task in store
      updateTask(taskId, {
        status: 'planned',
        plan: result.plan,
        agent: result.agent,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create plan');
      setStatus('error');
    }
  };

  const handleExecute = async () => {
    if (!selectedAgent) return;
    
    // Update task with current agent selection before executing
    updateTask(taskId, { agent: selectedAgent });
    onExecute();
  };

  const handleRetry = () => {
    setError(null);
    setStatus('selecting');
  };

  const handleReplan = () => {
    setPlan(null);
    setStatus('selecting');
  };

  // Normalize plan for display
  const normalizedPlan = (() => {
    if (!plan?.trim()) return '';
    const s = plan.trim();
    try {
      const parsed = JSON.parse(s) as unknown;
      if (parsed && typeof parsed === 'object' && 'payloads' in parsed) {
        const payloads = (parsed as { payloads?: Array<{ text?: string }> }).payloads;
        if (Array.isArray(payloads) && payloads.length > 0 && typeof payloads[0]?.text === 'string') {
          return payloads[0].text.replace(/\\n/g, '\n').trim();
        }
      }
      if (parsed && typeof parsed === 'object' && 'text' in parsed && typeof (parsed as { text: string }).text === 'string') {
        return (parsed as { text: string }).text.replace(/\\n/g, '\n').trim();
      }
    } catch {
      /* not JSON */
    }
    return s.replace(/\\n/g, '\n');
  })();
  const planSteps = normalizedPlan ? normalizedPlan.split(/\r?\n/).map(l => l.trim()).filter(Boolean) : [];

  const hasAgents = claudeCodeAvailable || agents.length > 0;

  return (
    <div className="h-full flex flex-col p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-zinc-400 hover:text-zinc-100"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">Planning</h1>
          <p className="text-sm text-zinc-400 truncate">{initialMessage}</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="w-full max-w-2xl">
          
          {/* Agent Selection State */}
          {status === 'selecting' && (
            <div className="bg-zinc-800/50 rounded-lg overflow-hidden">
              <div className="p-6">
                <h2 className="text-lg font-medium mb-2">Select an agent</h2>
                <p className="text-zinc-400 text-sm mb-6">
                  Choose which agent should plan and execute this task
                </p>
                
                {hasAgents ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm text-zinc-400 mb-2">Agent</label>
                      <AgentSelector
                        agents={agents}
                        selected={selectedAgent}
                        onSelect={setSelectedAgent}
                        claudeCodeAvailable={claudeCodeAvailable}
                        className="w-full"
                      />
                    </div>
                    
                    {/* Agent description */}
                    <div className="p-3 bg-zinc-900/50 rounded-lg text-sm text-zinc-400">
                      {selectedAgent === 'claude-code' ? (
                        <p>
                          <strong className="text-zinc-300">Claude Code</strong> runs locally with direct access to your filesystem. 
                          Best for editing code, running tests, and working with the current project.
                        </p>
                      ) : selectedAgent ? (
                        <p>
                          <strong className="text-zinc-300">{selectedAgent}</strong> is an OpenClaw agent that can work autonomously. 
                          Best for research, long-running tasks, or work on other projects.
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="p-4 bg-amber-900/20 border border-amber-800 rounded-lg">
                    <p className="text-amber-300 text-sm">
                      No agents available. Install Claude Code CLI or connect an OpenClaw instance.
                    </p>
                  </div>
                )}
              </div>
              
              <div className="p-4 border-t border-zinc-700 flex justify-end gap-3">
                <button
                  onClick={onBack}
                  className="px-4 py-2 text-zinc-400 hover:text-zinc-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGeneratePlan}
                  disabled={!selectedAgent}
                  className={`
                    px-6 py-2 rounded-lg font-medium
                    ${selectedAgent 
                      ? 'bg-indigo-600 hover:bg-indigo-500 text-white' 
                      : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'}
                  `}
                >
                  Generate Plan
                </button>
              </div>
            </div>
          )}

          {/* Planning state */}
          {status === 'planning' && (
            <div className="bg-zinc-800/50 rounded-lg p-8 text-center">
              <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mx-auto mb-4" />
              <h2 className="text-lg font-medium mb-2">Creating plan...</h2>
              <p className="text-zinc-400">
                {selectedAgent === 'claude-code' 
                  ? 'Claude Code is analyzing your task'
                  : `${selectedAgent} is analyzing your task`}
              </p>
            </div>
          )}

          {/* Error state */}
          {status === 'error' && (
            <div className="bg-red-900/20 border border-red-800 rounded-lg p-8 text-center">
              <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-4" />
              <h2 className="text-lg font-medium mb-2">Planning failed</h2>
              <p className="text-zinc-400 mb-4">{error}</p>
              <div className="flex justify-center gap-3">
                <button
                  onClick={onBack}
                  className="px-4 py-2 text-zinc-400 hover:text-zinc-100"
                >
                  Go Back
                </button>
                <button
                  onClick={handleRetry}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg"
                >
                  Try Again
                </button>
              </div>
            </div>
          )}

          {/* Planned state */}
          {status === 'planned' && (plan || planSteps.length > 0) && (
            <div className="bg-zinc-800/50 rounded-lg overflow-hidden">
              {/* Plan header with agent selector */}
              <div className="p-4 border-b border-zinc-700">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    <h2 className="font-medium">Plan ready</h2>
                  </div>
                  <button
                    onClick={handleReplan}
                    className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Replan
                  </button>
                </div>
                
                {/* Agent selector - can change before execute */}
                <div className="flex items-center gap-3">
                  <span className="text-sm text-zinc-400">Execute with:</span>
                  <AgentSelector
                    agents={agents}
                    selected={selectedAgent}
                    onSelect={setSelectedAgent}
                    claudeCodeAvailable={claudeCodeAvailable}
                  />
                </div>
              </div>

              {/* Plan steps */}
              <div className="p-4 space-y-3 max-h-[400px] overflow-y-auto">
                {planSteps.length > 0 ? (
                  planSteps.map((step, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-medium shrink-0 mt-0.5">
                        {i + 1}
                      </div>
                      <p className="text-zinc-300 leading-relaxed">{step.replace(/^\d+\.\s*/, '').trim()}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-zinc-300 whitespace-pre-wrap">{normalizedPlan || plan}</p>
                )}
              </div>

              {/* Actions */}
              <div className="p-4 border-t border-zinc-700 flex justify-end gap-3">
                <button
                  onClick={onBack}
                  className="px-4 py-2 text-zinc-400 hover:text-zinc-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleExecute}
                  disabled={!selectedAgent}
                  className="px-6 py-2 bg-green-600 hover:bg-green-500 rounded-lg font-medium flex items-center gap-2"
                >
                  Execute Plan
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
