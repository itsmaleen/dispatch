import { useState } from 'react';
import { PlanningView } from './components/planning/PlanningView';
import { ExecutionView } from './components/execution/ExecutionView';

type View = 'planning' | 'execution';

export function App() {
  const [view, setView] = useState<View>('planning');
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);

  const handleTaskConfirmed = (taskId: string) => {
    setCurrentTaskId(taskId);
    setView('execution');
  };

  const handleBackToPlanning = () => {
    setView('planning');
    setCurrentTaskId(null);
  };

  return (
    <div className="h-screen w-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Title bar area (for macOS traffic lights) */}
      <div className="h-8 flex-shrink-0 drag-region" />

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        {view === 'planning' ? (
          <PlanningView onTaskConfirmed={handleTaskConfirmed} />
        ) : (
          <ExecutionView 
            taskId={currentTaskId!} 
            onBack={handleBackToPlanning} 
          />
        )}
      </div>

      {/* Status bar */}
      <div className="h-6 flex-shrink-0 bg-zinc-900 border-t border-zinc-800 px-4 flex items-center justify-between text-xs text-zinc-500">
        <div className="flex items-center gap-4">
          <span>Agent Command Center v0.1.0</span>
          <span className="text-zinc-700">|</span>
          <span>View: {view}</span>
        </div>
        <div className="flex items-center gap-4">
          <span>Claude Code: ⚫ Disconnected</span>
          <span>OpenClaw: ⚫ Disconnected</span>
        </div>
      </div>
    </div>
  );
}
