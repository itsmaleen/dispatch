import { useState, useEffect, useCallback } from "react";
import { HomePage } from "./components/home/HomePage";
import { PlanningView } from "./components/planning/PlanningView";
import { ExecutionView } from "./components/execution/ExecutionView";
import { AgentsPanel } from "./components/agents/AgentsPanel";
import { CommandPalette } from "./components/command-palette";
import { WidgetDemo } from "./components/demo/WidgetDemo";
import { WorkspaceDemo } from "./components/demo/WorkspaceDemo";
import { Workspace } from "./components/workspace/Workspace";
import { useAppStore, api, getServerUrl, discoverServerPort, type Task } from "./stores/app";
import { useCommandPaletteStore } from "./stores/command-palette";
import { useWorkspaceStore } from "./stores/workspace";
import { commandRegistry } from "./lib/commands/registry";
import { createDefaultCommands } from "./lib/commands/default-commands";
import { Settings, FolderOpen, Users, Layout } from "lucide-react";

type View =
  | "home"
  | "planning"
  | "execution"
  | "demo"
  | "workspace"
  | "workspace-real";

// Dynamic server URL (from Electron or default)
const getAccServerUrl = () => getServerUrl().replace('http://', '');

const isElectron =
  typeof window !== "undefined" &&
  !!(window as unknown as { electronAPI?: { server?: unknown } }).electronAPI?.server;

export function App() {
  const {
    currentProject,
    setProject,
    agents,
    claudeCodeAvailable,
    serverOffline,
    addTask,
    updateTask,
    tasks,
    refreshAgentStatus,
  } = useAppStore();
  const commandPalette = useCommandPaletteStore();
  const [view, setView] = useState<View>("workspace-real");
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [currentTaskMessage, setCurrentTaskMessage] = useState<string>("");
  const [showAgentsPanel, setShowAgentsPanel] = useState(false);
  // In browser dev, discover server port (3333, 3334, ...) before making API calls
  const [serverReady, setServerReady] = useState(isElectron);
  const currentTask = currentTaskId
    ? (tasks.find((t) => t.id === currentTaskId) ?? null)
    : null;

  useEffect(() => {
    if (isElectron) return;
    discoverServerPort().then(() => setServerReady(true));
  }, []);

  // Initialize command registry with default commands (once)
  useEffect(() => {
    commandRegistry.clear();
    commandRegistry.registerAll(createDefaultCommands());
  }, []);

  // Register navigation callback for command palette
  const handleNavigate = useCallback((targetView: string) => {
    setView(targetView as View);
  }, []);

  // Register navigate callback with workspace store (use getState() to avoid
  // subscribing to store updates and triggering an infinite re-render loop)
  useEffect(() => {
    useWorkspaceStore.getState().registerNavigateCallback(handleNavigate);
    return () => {
      useWorkspaceStore.getState().registerNavigateCallback(() => {});
    };
  }, [handleNavigate]);

  // Refresh agent status on mount and periodically (slower when server is offline)
  useEffect(() => {
    if (!serverReady) return;
    refreshAgentStatus();
    const interval = setInterval(
      refreshAgentStatus,
      serverOffline ? 15000 : 5000,
    );
    return () => clearInterval(interval);
  }, [serverReady, refreshAgentStatus, serverOffline]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture shortcuts when typing in inputs (except for Escape and some global shortcuts)
      const target = e.target as HTMLElement;
      const isInInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Escape: close palette > restore maximized > clear focus
      if (e.key === 'Escape') {
        if (commandPalette.isOpen) {
          e.preventDefault();
          commandPalette.close();
          return;
        }
        // If a widget is maximized, restore it
        const maximizedWidgetId = useWorkspaceStore.getState().maximizedWidgetId;
        if (maximizedWidgetId) {
          e.preventDefault();
          useWorkspaceStore.getState().setMaximizedWidget(null);
          return;
        }
        // If a widget is focused and not in an input, clear focus
        const focusedWidgetId = useWorkspaceStore.getState().focusedWidgetId;
        if (focusedWidgetId && !isInInput) {
          e.preventDefault();
          useWorkspaceStore.getState().setFocusedWidget(null, null);
          return;
        }
      }

      // Cmd/Ctrl + K: Toggle command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        commandPalette.toggle();
        return;
      }

      // Cmd/Ctrl + N: New Terminal (opens palette with subcommand)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'n' && !isInInput) {
        e.preventDefault();
        commandPalette.open({ preselectedCommandId: 'new-terminal' });
        return;
      }

      // Cmd/Ctrl + Shift + N: Create Task (opens palette in input mode)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'N' && !isInInput) {
        e.preventDefault();
        commandPalette.open();
        // Find and execute the create-task command to enter input mode
        const createTaskCmd = commandRegistry.getById('create-task');
        if (createTaskCmd && createTaskCmd.action.type === 'input') {
          commandPalette.enterInputMode(
            createTaskCmd.action.placeholder,
            createTaskCmd.action.onSubmit
          );
        }
        return;
      }

      // Cmd/Ctrl + W: Close focused console
      if ((e.metaKey || e.ctrlKey) && e.key === 'w' && !isInInput) {
        e.preventDefault();
        useWorkspaceStore.getState().closeFocusedConsole();
        return;
      }

      // Cmd/Ctrl + Enter: Toggle maximize focused widget
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !isInInput) {
        e.preventDefault();
        useWorkspaceStore.getState().toggleMaximizeFocusedWidget();
        return;
      }

      // Cmd/Ctrl + Shift + D: Toggle demo view
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        setView(view === 'demo' ? 'home' : 'demo');
        return;
      }

      // Arrow key navigation (only when not in input and palette is closed)
      if (!isInInput && !commandPalette.isOpen) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const direction = e.key.replace('Arrow', '').toLowerCase() as 'up' | 'down' | 'left' | 'right';
          useWorkspaceStore.getState().moveFocus(direction);
          return;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [view, commandPalette]);

  const handleStartTask = async (message: string) => {
    try {
      // Create task on server
      const { taskId } = await api.createTask(message);

      // Add to local store
      addTask({
        id: taskId,
        message,
        status: "created",
        createdAt: Date.now(),
      });

      setCurrentTaskId(taskId);
      setCurrentTaskMessage(message);
      setView("planning");
    } catch (err) {
      console.error("Failed to create task:", err);
      alert("Failed to create task. Is the server running?");
    }
  };

  const handleExecute = () => {
    if (currentTaskId) {
      updateTask(currentTaskId, { status: "executing" });
      setView("execution");
    }
  };

  const handleComplete = () => {
    setView("home");
    setCurrentTaskId(null);
    setCurrentTaskMessage("");
  };

  const handleBackToHome = () => {
    setView("home");
    setCurrentTaskId(null);
    setCurrentTaskMessage("");
  };

  const handleOpenTask = (task: Task) => {
    setCurrentTaskId(task.id);
    setCurrentTaskMessage(task.message);
    if (
      task.status === "executing" ||
      task.status === "completed" ||
      task.status === "failed"
    ) {
      setView("execution");
    } else {
      setView("planning");
    }
  };

  const handleSwitchProject = async () => {
    if (window.electronAPI?.openFolder) {
      const path = await window.electronAPI.openFolder();
      if (path) {
        const name = path.split("/").pop() || path;
        setProject({ path, name, lastOpened: Date.now() });
      }
    }
  };

  // Count total available agents (Claude Code + OpenClaw agents)
  const totalAgents = (claudeCodeAvailable ? 1 : 0) + agents.length;

  // In browser dev, wait for server port discovery before rendering
  if (!serverReady) {
    return (
      <div className="h-screen w-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-zinc-400">
          <div className="w-8 h-8 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
          <span>Connecting to server...</span>
        </div>
      </div>
    );
  }

  // Workspace-real is full screen, no chrome
  if (view === "workspace-real") {
    return (
      <div className="h-screen w-screen bg-zinc-950 text-zinc-100 flex flex-col">
        {serverOffline && (
          <div className="shrink-0 bg-amber-900/80 text-amber-200 px-4 py-2 text-sm text-center">
            Server not connected. The app will try to start it automatically. If
            it doesn't, run{" "}
            <code className="bg-zinc-800 px-1 rounded">
              ./scripts/start-server.sh
            </code>{" "}
            from the Dispatch repo.
          </div>
        )}
        <Workspace />
        <CommandPalette />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {serverOffline && (
        <div className="shrink-0 bg-amber-900/80 text-amber-200 px-4 py-2 text-sm text-center">
          Server not connected. Run{" "}
          <code className="bg-zinc-800 px-1 rounded">
            ./scripts/start-server.sh
          </code>{" "}
          from the Dispatch repo, or restart the app.
        </div>
      )}
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
            <span className="font-semibold">Dispatch</span>
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
            {totalAgents > 0 && (
              <span className="bg-green-600 text-white text-xs px-1.5 py-0.5 rounded-full">
                {totalAgents}
              </span>
            )}
          </button>
          <button
            onClick={() => setView(view === "workspace" ? "home" : "workspace")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
              view === "workspace"
                ? "bg-violet-600 text-white"
                : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
            }`}
            title="Workspace Demo (new UI)"
          >
            <Layout className="w-4 h-4" />
            <span>Workspace</span>
          </button>
          <button
            onClick={() => setView(view === "demo" ? "home" : "demo")}
            className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-md transition-colors"
            title="Toggle Widget Demo (⌘⇧D)"
          >
            {view === "demo" ? "Exit Demo" : "Demo"}
          </button>
          <button className="p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-md transition-colors">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        {view === "home" && (
          <HomePage onStartTask={handleStartTask} onOpenTask={handleOpenTask} />
        )}
        {view === "planning" && currentTaskId && (
          <PlanningView
            taskId={currentTaskId}
            initialMessage={currentTaskMessage}
            initialPlan={currentTask?.plan}
            initialAgent={currentTask?.agent}
            onExecute={handleExecute}
            onBack={handleBackToHome}
          />
        )}
        {view === "execution" && currentTaskId && (
          <ExecutionView
            taskId={currentTaskId}
            initialStatus={
              currentTask?.status === "executing" ||
              currentTask?.status === "completed" ||
              currentTask?.status === "failed"
                ? currentTask.status
                : undefined
            }
            initialResult={currentTask?.result}
            initialAgent={currentTask?.agent}
            onBack={handleBackToHome}
            onComplete={handleComplete}
          />
        )}
        {view === "demo" && <WidgetDemo />}
        {view === "workspace" && <WorkspaceDemo />}
      </div>

      {/* Status bar */}
      {
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
            {/* Claude Code status */}
            {claudeCodeAvailable ? (
              <span className="text-indigo-400">🟣 Claude Code</span>
            ) : (
              <span className="text-zinc-600">⚫ Claude Code</span>
            )}

            {/* OpenClaw agents status */}
            {agents.length > 0 ? (
              <span className="text-green-500">
                🟢 {agents.length} OpenClaw
              </span>
            ) : (
              <span className="text-zinc-600">⚫ OpenClaw</span>
            )}
          </div>
        </div>
      }

      {/* Agents Panel Modal */}
      <AgentsPanel
        isOpen={showAgentsPanel}
        onClose={() => setShowAgentsPanel(false)}
        serverUrl={getAccServerUrl()}
      />

      {/* Command Palette Modal */}
      <CommandPalette />
    </div>
  );
}
