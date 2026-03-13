import { useState, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';

interface PlanningViewProps {
  initialMessage?: string;
  onTaskConfirmed: (taskId: string) => void;
  onBack: () => void;
}

interface PlanStep {
  index: number;
  description: string;
  agent: string;
}

export function PlanningView({ initialMessage, onTaskConfirmed, onBack }: PlanningViewProps) {
  const [input, setInput] = useState(initialMessage || '');
  const [isPlanning, setIsPlanning] = useState(false);
  const [plan, setPlan] = useState<PlanStep[] | null>(null);

  // Auto-plan if we have an initial message
  useEffect(() => {
    if (initialMessage && !plan) {
      handlePlan();
    }
  }, [initialMessage]);

  const handlePlan = async () => {
    if (!input.trim()) return;
    setIsPlanning(true);
    
    // TODO: Call planning API
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    setPlan([
      { index: 1, description: 'Research existing patterns', agent: 'OpenClaw' },
      { index: 2, description: 'Implement core functionality', agent: 'Claude Code' },
      { index: 3, description: 'Write tests', agent: 'Claude Code' },
      { index: 4, description: 'Code review', agent: 'CodeRabbit' },
    ]);
    
    setIsPlanning(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await handlePlan();
  };

  const handleConfirm = () => {
    const taskId = crypto.randomUUID();
    onTaskConfirmed(taskId);
  };

  const handleEdit = () => {
    setPlan(null);
  };

  return (
    <div className="h-full flex flex-col p-8">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-zinc-400 hover:text-zinc-100 mb-4 w-fit"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back</span>
      </button>

      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="w-full max-w-2xl">
          {/* Header */}
          <h1 className="text-2xl font-semibold text-center mb-2">
            Planning: {input.slice(0, 50)}{input.length > 50 ? '...' : ''}
          </h1>
          <p className="text-zinc-500 text-center mb-8">
            {isPlanning ? 'Creating a plan for your task...' : 'Review and confirm the plan below'}
          </p>

          {/* Input form */}
          {!plan && !isPlanning && (
            <form onSubmit={handleSubmit}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="e.g., Add OAuth authentication to the landing page..."
                className="w-full h-32 p-4 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-700 resize-none"
                disabled={isPlanning}
              />
              <div className="mt-4 flex justify-end">
                <button
                  type="submit"
                  disabled={!input.trim() || isPlanning}
                  className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 rounded-lg font-medium transition-colors"
                >
                  Create Plan
                </button>
              </div>
            </form>
          )}

          {/* Loading state */}
          {isPlanning && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-zinc-400">Creating plan...</p>
            </div>
          )}

          {/* Plan display */}
          {plan && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
              <div className="p-4 border-b border-zinc-800">
                <h2 className="font-medium">Task Plan</h2>
                <p className="text-sm text-zinc-500 mt-1">{input}</p>
              </div>
              
              <div className="divide-y divide-zinc-800">
                {plan.map((step) => (
                  <div key={step.index} className="p-4 flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-sm font-medium">
                      {step.index}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm">{step.description}</p>
                    </div>
                    <div className="text-sm text-zinc-500 bg-zinc-800 px-2 py-1 rounded">
                      {step.agent}
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-4 border-t border-zinc-800 flex justify-end gap-3">
                <button
                  onClick={handleEdit}
                  className="px-4 py-2 text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  Edit Plan
                </button>
                <button
                  onClick={handleConfirm}
                  className="px-6 py-2 bg-green-600 hover:bg-green-500 rounded-lg font-medium transition-colors"
                >
                  Confirm & Start
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
