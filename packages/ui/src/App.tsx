import { useState, useEffect } from 'react';
import { HomePage } from './components/home/HomePage';
import { PlanningView } from './components/planning/PlanningView';
import { ExecutionView } from './components/execution/ExecutionView';
import { AgentsPanel } from './components/agents/AgentsPanel';
import { useAppStore } from './stores/app';
import { Settings, FolderOpen, Users } from 'lucide-react';

type View = 'home' | 'planning' | 'execution' | 'review';

const ACC_SERVER_URL = 'localhost:3333';

export function App() {
  const { currentProject, setProject, agents, setAgents } = useAppStore();
  const [view, setView] = useState<View>('home');
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [currentTaskMessage, setCurrentTaskMessage] = useState<string>('');
  const [showAgentsPanel, setShowAgentsPanel] = useState(false);

  // Fetch agents from server
  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const res = await fetch(`http://${ACC_SERVER_URL}/agents`);
        const data = await res.json();
        if (data.agents) {
          setAgents(
            data.agents.map((a: any) => ({
              name: a.name,
              capabilities: a.capabilities || [],
              connectedAt: a.connectedAt,
              status: 'idle' as const,
            }))
          );
        }
      } catch (err) {
        console.error('Failed to fetch agents:', err);
      }
    };

    fetchAgents();
    const interval = setInterval(fetchAgents, 3000);
    return () => clearInterval(interval);
  }, [setAgents]);

  const handleStartTask = (message: string) => {
    setCurrentTaskMessage(message);
    setView('planning');
  };

  const handleTaskConfirmed = (taskId: string) => {
    setCurrentTaskId(taskId);
    setView('execution');
  };

  const handleBackToHome = () => {
    setView('home');
    setCurrentTaskId(null);
    setCurrentTaskMessage('');
  };

  const handleSwitchProject = async () => {
    if (window.electronAPI?.openFolder) {
      const path = await window.electronAPI.openFolder();
      if (path) {
        const name = path.split('/').pop() || path;
        setProject({ path, name, lastOpened: Date.now() });
      }
    }
  };

  return (
    <div className="h-screen w-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Title bar area */}
      <div className="h-12 flex-shrink-0 flex items-center justify-between px-4 border-b border-zinc-800 drag-region">
        <div className="flex items-center gap-3 no-drag">
          <span className="text-xl">🦞</span>
          {currentProject ? (
            <>
              <span className="font-semibold">ACC</span>
              <span className="text-zinc-600">•</span>
              <span className="text-zinc-300">{currentProject.name}</span>
            </>
          ) : (
            <span className="font-semibold">Agent Command Center</span>
          )}
        </div>
        
        <div className="flex items-center gap-2 no-drag">
          {currentProject && (
            <button
              onClick={handleSwitchProject}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-md transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
              <span>Switch</span>
            </button>
          )}
          <button 
            onClick={() => setShowAgentsPanel(true)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-md transition-colors"
          >
            <Users className="w-4 h-4" />
            <span>Agents</span>
            {agents.length > 0 && (
              <span className="bg-green-600 text-white text-xs px-1.5 py-0.5 rounded-full">
                {agents.length}
              </span>
            )}
          </button>
          <button className="p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-md transition-colors">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        {view === 'home' && (
          <HomePage onStartTask={handleStartTask} />
        )}
        {view === 'planning' && (
          <PlanningView 
            initialMessage={currentTaskMessage}
            onTaskConfirmed={handleTaskConfirmed}
            onBack={handleBackToHome}
          />
        )}
        {view === 'execution' && currentTaskId && (
          <ExecutionView 
            taskId={currentTaskId} 
            onBack={handleBackToHome}
          />
        )}
      </div>

      {/* Status bar */}
      <div className="h-6 flex-shrink-0 bg-zinc-900 border-t border-zinc-800 px-4 flex items-center justify-between text-xs text-zinc-500">
        <div className="flex items-center gap-4">
          <span>ACC v0.1.0</span>
          {currentProject && (
            <>
              <span className="text-zinc-700">|</span>
              <span className="text-zinc-400">{currentProject.path}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-4">
          {agents.length > 0 ? (
            <span className="text-green-500">
              🟢 {agents.length} agent{agents.length !== 1 ? 's' : ''} connected
            </span>
          ) : (
            <span>⚫ No agents connected</span>
          )}
        </div>
      </div>

      {/* Agents Panel Modal */}
      <AgentsPanel
        isOpen={showAgentsPanel}
        onClose={() => setShowAgentsPanel(false)}
        serverUrl={ACC_SERVER_URL}
      />
    </div>
  );
}
