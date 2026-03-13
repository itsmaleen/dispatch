import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { LogWidget } from '../widgets/LogWidget';
import { StatusWidget } from '../widgets/StatusWidget';

export function WidgetDemo() {
  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="h-12 flex-shrink-0 bg-zinc-900 border-b border-zinc-800 px-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-sm text-zinc-500">
            Widget Demo - Multi-Agent Execution View
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 text-sm bg-yellow-600/20 text-yellow-500 hover:bg-yellow-600/30 rounded transition-colors">
            Pause All
          </button>
          <button className="px-3 py-1.5 text-sm bg-red-600/20 text-red-500 hover:bg-red-600/30 rounded transition-colors">
            Cancel
          </button>
        </div>
      </div>

      {/* Widget Grid */}
      <div className="flex-1 p-2">
        <PanelGroup direction="horizontal">
          {/* Left column */}
          <Panel defaultSize={60} minSize={30}>
            <PanelGroup direction="vertical">
              {/* Main log */}
              <Panel defaultSize={70} minSize={20}>
                <div className="h-full p-1">
                  <LogWidget
                    title="Claude Code"
                    adapterId="claude-code-1"
                  />
                </div>
              </Panel>

              <PanelResizeHandle className="h-1 bg-zinc-800 hover:bg-zinc-700 transition-colors" />

              {/* Secondary log */}
              <Panel defaultSize={30} minSize={15}>
                <div className="h-full p-1">
                  <LogWidget
                    title="OpenClaw"
                    adapterId="openclaw-1"
                  />
                </div>
              </Panel>
            </PanelGroup>
          </Panel>

          <PanelResizeHandle className="w-1 bg-zinc-800 hover:bg-zinc-700 transition-colors" />

          {/* Right column */}
          <Panel defaultSize={40} minSize={20}>
            <PanelGroup direction="vertical">
              {/* Status widgets */}
              <Panel defaultSize={30} minSize={15}>
                <div className="h-full p-1 flex gap-2">
                  <StatusWidget
                    adapterId="claude-code-1"
                    name="Claude Code"
                    status="running"
                    currentTask="Implementing auth module"
                  />
                  <StatusWidget
                    adapterId="openclaw-1"
                    name="OpenClaw"
                    status="idle"
                  />
                </div>
              </Panel>

              <PanelResizeHandle className="h-1 bg-zinc-800 hover:bg-zinc-700 transition-colors" />

              {/* Plan progress */}
              <Panel defaultSize={70} minSize={20}>
                <div className="h-full p-1">
                  <div className="h-full bg-zinc-900 border border-zinc-800 rounded-lg p-4 overflow-auto">
                    <h3 className="text-sm font-medium text-zinc-400 mb-3">Plan Progress</h3>
                    <div className="space-y-3">
                      <PlanStep index={1} text="Research existing patterns" status="completed" />
                      <PlanStep index={2} text="Implement core functionality" status="running" />
                      <PlanStep index={3} text="Write tests" status="pending" />
                      <PlanStep index={4} text="Code review" status="pending" />
                    </div>
                  </div>
                </div>
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}

function PlanStep({
  index,
  text,
  status
}: {
  index: number;
  text: string;
  status: 'pending' | 'running' | 'completed'
}) {
  const statusColors = {
    pending: 'bg-zinc-800 text-zinc-500',
    running: 'bg-blue-600/20 text-blue-400 animate-pulse',
    completed: 'bg-green-600/20 text-green-400',
  };

  return (
    <div className="flex items-center gap-3">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${statusColors[status]}`}>
        {status === 'completed' ? '✓' : index}
      </div>
      <span className={`text-sm ${status === 'completed' ? 'text-zinc-500 line-through' : 'text-zinc-300'}`}>
        {text}
      </span>
    </div>
  );
}
