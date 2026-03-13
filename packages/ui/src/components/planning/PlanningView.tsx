import { useState, useEffect } from 'react';
import { ArrowLeft, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { api, useAppStore } from '../../stores/app';

interface PlanningViewProps {
  taskId: string;
  initialMessage: string;
  initialPlan?: string;
  initialAgent?: string;
  onExecute: () => void;
  onBack: () => void;
}

export function PlanningView({ taskId, initialMessage, initialPlan, initialAgent, onExecute, onBack }: PlanningViewProps) {
  const { agents, updateTask } = useAppStore();
  const [status, setStatus] = useState<'planning' | 'planned' | 'error'>(() =>
    initialPlan ? 'planned' : 'planning'
  );
  const [plan, setPlan] = useState<string | null>(() => initialPlan ?? null);
  const [agent, setAgent] = useState<string | null>(() => initialAgent ?? null);
  const [error, setError] = useState<string | null>(null);

  // Request plan when component mounts (skip if we already have a plan)
  useEffect(() => {
    if (initialPlan) {
      setPlan(initialPlan);
      setAgent(initialAgent ?? null);
      setStatus('planned');
      return;
    }
    const requestPlan = async () => {
      try {
        setStatus('planning');
        const result = await api.planTask(taskId);
        setPlan(result.plan);
        setAgent(result.agent);
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

    requestPlan();
  }, [taskId, updateTask, initialPlan, initialAgent]);

  const handleExecute = () => {
    onExecute();
  };

  const handleRetry = async () => {
    setError(null);
    setStatus('planning');
    try {
      const result = await api.planTask(taskId);
      setPlan(result.plan);
      setAgent(result.agent);
      setStatus('planned');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create plan');
      setStatus('error');
    }
  };

  // Normalize plan for display: extract from JSON if needed, then split into steps (handle \n and literal \n)
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
          {/* Planning state */}
          {status === 'planning' && (
            <div className="bg-zinc-800/50 rounded-lg p-8 text-center">
              <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mx-auto mb-4" />
              <h2 className="text-lg font-medium mb-2">Creating plan...</h2>
              <p className="text-zinc-400">
                {agent ? `${agent} is analyzing your task` : 'Connecting to agent...'}
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
                  Retry
                </button>
              </div>
            </div>
          )}

          {/* Planned state */}
          {status === 'planned' && (plan || planSteps.length > 0) && (
            <div className="bg-zinc-800/50 rounded-lg overflow-hidden">
              {/* Plan header */}
              <div className="p-4 border-b border-zinc-700 flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-green-500" />
                <div>
                  <h2 className="font-medium">Plan ready</h2>
                  <p className="text-sm text-zinc-400">
                    {agent} will execute this plan
                  </p>
                </div>
              </div>

              {/* Plan steps: one step per line, clean numbering */}
              <div className="p-4 space-y-3">
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
                  className="px-6 py-2 bg-green-600 hover:bg-green-500 rounded-lg font-medium flex items-center gap-2"
                >
                  Execute Plan
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Agent indicator */}
      {agents.length > 0 && (
        <div className="mt-4 text-center text-sm text-zinc-500">
          {agents.length} agent{agents.length !== 1 ? 's' : ''} available
        </div>
      )}
    </div>
  );
}
