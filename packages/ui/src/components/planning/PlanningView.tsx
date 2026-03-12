import { useState } from 'react';

interface PlanningViewProps {
  onTaskConfirmed: (taskId: string) => void;
}

interface PlanStep {
  index: number;
  description: string;
  agent: string;
}

export function PlanningView({ onTaskConfirmed }: PlanningViewProps) {
  const [input, setInput] = useState('');
  const [isPlanning, setIsPlanning] = useState(false);
  const [plan, setPlan] = useState<PlanStep[] | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    setIsPlanning(true);
    
    // TODO: Call planning API
    // For now, simulate a plan
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    setPlan([
      { index: 1, description: 'Research existing patterns', agent: 'OpenClaw' },
      { index: 2, description: 'Implement core functionality', agent: 'Claude Code' },
      { index: 3, description: 'Write tests', agent: 'Claude Code' },
      { index: 4, description: 'Code review', agent: 'CodeRabbit' },
    ]);
    
    setIsPlanning(false);
  };

  const handleConfirm = () => {
    const taskId = crypto.randomUUID();
    onTaskConfirmed(taskId);
  };

  const handleEdit = () => {
    setPlan(null);
  };

  return (
    <div className="h-full flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <h1 className="text-2xl font-semibold text-center mb-2">
          What would you like to build?
        </h1>
        <p className="text-zinc-500 text-center mb-8">
          Describe your task and I'll break it down for your agents.
        </p>

        {/* Input form */}
        {!plan && (
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
                className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 rounded-lg font-medium transition-colors"
              >
                {isPlanning ? 'Planning...' : 'Create Plan'}
              </button>
            </div>
          </form>
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
  );
}
