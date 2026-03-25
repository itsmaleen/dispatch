import { useState, useEffect, useCallback } from "react";
import { HomePage } from "./components/home/HomePage";
import { PlanningView } from "./components/planning/PlanningView";
import { ExecutionView } from "./components/execution/ExecutionView";
import { AgentsPanel } from "./components/agents/AgentsPanel";
import { CommandPalette } from "./components/command-palette";
import { ShortcutsMenu } from "./components/shortcuts/ShortcutsMenu";
import { SettingsPanel } from "./components/settings";
import { WidgetDemo } from "./components/demo/WidgetDemo";
import { WorkspaceDemo } from "./components/demo/WorkspaceDemo";
import { Workspace } from "./components/workspace/Workspace";
import { useAppStore, api, getServerUrl, discoverServerPort, type Task } from "./stores/app";
import { useCommandPaletteStore } from "./stores/command-palette";
import { useWorkspaceStore } from "./stores/workspace";
import { useShortcutsStore, matchesShortcut } from "./stores/shortcuts";
import { useSettingsStore } from "./stores/settings";
import { commandRegistry } from "./lib/commands/registry";
import { createDefaultCommands } from "./lib/commands/default-commands";
import { initSemanticSearch } from "./hooks/useSemanticSearch";
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

  // Initialize with folder path from Electron (for multi-window support)
  useEffect(() => {
    if (!isElectron) return;

    // Check URL params for folder path (passed when creating window)
    const params = new URLSearchParams(window.location.search);
    const folderFromUrl = params.get('folder');

    // Also check Electron API
    const folderFromElectron = window.electronAPI?.window?.getInitialFolderPath?.();

    const initialFolder = folderFromUrl || folderFromElectron;

    if (initialFolder && !currentProject) {
      // Set as current project
      const folderName = initialFolder.split('/').pop() || initialFolder;
      setProject({
        path: initialFolder,
        name: folderName,
        lastOpened: Date.now(),
      });
    }
  }, [isElectron, currentProject, setProject]);

  // Initialize command registry with default commands (once)
  useEffect(() => {
    commandRegistry.clear();
    const commands = createDefaultCommands();
    commandRegistry.registerAll(commands);

    // Initialize semantic search service with command corpus (async, non-blocking)
    if (serverReady) {
      const commandInfos = commands.map(cmd => ({
        id: cmd.id,
        label: cmd.label,
        description: cmd.description,
        keywords: cmd.keywords,
        category: cmd.category,
      }));
      initSemanticSearch(commandInfos).then(result => {
        if (result.ok) {
          console.log('[App] Semantic search initialized successfully');
        } else {
          console.warn('[App] Semantic search init returned error:', result.error);
        }
      }).catch(err => {
        console.warn('[App] Failed to init semantic search:', err);
      });
    }
  }, [serverReady]);

  // Listen for menu:open-settings from Electron menu
  useEffect(() => {
    if (!window.electronAPI?.menu?.onOpenSettings) return;

    const unsubscribe = window.electronAPI.menu.onOpenSettings(() => {
      useSettingsStore.getState().setSettingsOpen(true);
    });

    return () => unsubscribe();
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

  // Global keyboard shortcuts - uses shortcuts store as source of truth
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      const isInTerminal = target.closest('.xterm-container') !== null;

      // Get shortcuts from store
      const shortcutsStore = useShortcutsStore.getState();
      const getShortcut = shortcutsStore.getShortcut;

      // Escape: blur input > close shortcuts menu > close palette > restore maximized > clear focus
      if (e.key === 'Escape') {
        // First, blur any focused input
        if (isInInput && document.activeElement instanceof HTMLElement) {
          e.preventDefault();
          document.activeElement.blur();
          return;
        }
        // Close shortcuts menu
        if (shortcutsStore.isMenuOpen) {
          e.preventDefault();
          shortcutsStore.setMenuOpen(false);
          return;
        }
        if (commandPalette.isOpen) {
          e.preventDefault();
          commandPalette.close();
          return;
        }
        // If a widget is maximized, restore it (but not if user is typing in an input)
        const maximizedWidgetId = useWorkspaceStore.getState().maximizedWidgetId;
        if (maximizedWidgetId && !isInInput) {
          e.preventDefault();
          useWorkspaceStore.getState().setMaximizedWidget(null);
          return;
        }
        // If a widget is focused, clear focus
        const focusedWidgetId = useWorkspaceStore.getState().focusedWidgetId;
        if (focusedWidgetId) {
          e.preventDefault();
          useWorkspaceStore.getState().setFocusedWidget(null, null);
          return;
        }
        return;
      }

      // Command palette shortcuts (work even when in input)
      const cmdPaletteShortcut = getShortcut('command-palette-toggle');
      const cmdPaletteAltShortcut = getShortcut('command-palette-toggle-alt');

      if (cmdPaletteShortcut && matchesShortcut(e, cmdPaletteShortcut)) {
        e.preventDefault();
        if (shortcutsStore.isMenuOpen) {
          shortcutsStore.setMenuOpen(false);
        }
        commandPalette.toggle();
        return;
      }

      if (cmdPaletteAltShortcut && matchesShortcut(e, cmdPaletteAltShortcut)) {
        e.preventDefault();
        if (shortcutsStore.isMenuOpen) {
          shortcutsStore.setMenuOpen(false);
        }
        commandPalette.toggle();
        return;
      }

      // Show keyboard shortcuts menu (works even when in input)
      const showShortcutsShortcut = getShortcut('show-shortcuts');
      if (showShortcutsShortcut && matchesShortcut(e, showShortcutsShortcut)) {
        e.preventDefault();
        if (commandPalette.isOpen) {
          commandPalette.close();
        }
        shortcutsStore.toggleMenu();
        return;
      }

      // Show settings panel (works even when in input)
      const showSettingsShortcut = getShortcut('show-settings');
      if (showSettingsShortcut && matchesShortcut(e, showSettingsShortcut)) {
        e.preventDefault();
        if (commandPalette.isOpen) {
          commandPalette.close();
        }
        if (shortcutsStore.isMenuOpen) {
          shortcutsStore.setMenuOpen(false);
        }
        useSettingsStore.getState().setSettingsOpen(true);
        return;
      }

      // Widget navigation shortcuts (CMD+H/J/K/L) - work even when in input
      const focusLeftShortcut = getShortcut('focus-left');
      const focusDownShortcut = getShortcut('focus-down');
      const focusUpShortcut = getShortcut('focus-up');
      const focusRightShortcut = getShortcut('focus-right');

      if (focusLeftShortcut && matchesShortcut(e, focusLeftShortcut)) {
        e.preventDefault();
        useWorkspaceStore.getState().moveFocus('left');
        return;
      }
      if (focusDownShortcut && matchesShortcut(e, focusDownShortcut)) {
        e.preventDefault();
        useWorkspaceStore.getState().moveFocus('down');
        return;
      }
      if (focusUpShortcut && matchesShortcut(e, focusUpShortcut)) {
        e.preventDefault();
        useWorkspaceStore.getState().moveFocus('up');
        return;
      }
      if (focusRightShortcut && matchesShortcut(e, focusRightShortcut)) {
        e.preventDefault();
        useWorkspaceStore.getState().moveFocus('right');
        return;
      }

      // The following shortcuts don't work when typing in inputs
      if (isInInput) return;

      // New Console shortcut
      const newConsoleShortcut = getShortcut('new-console');
      if (newConsoleShortcut && matchesShortcut(e, newConsoleShortcut)) {
        e.preventDefault();
        commandPalette.open({ preselectedCommandId: 'new-terminal' });
        return;
      }

      // Create Task shortcut
      const createTaskShortcut = getShortcut('create-task');
      if (createTaskShortcut && matchesShortcut(e, createTaskShortcut)) {
        e.preventDefault();
        commandPalette.open();
        const createTaskCmd = commandRegistry.getById('create-task');
        if (createTaskCmd && createTaskCmd.action.type === 'input') {
          commandPalette.enterInputMode(
            createTaskCmd.action.placeholder,
            createTaskCmd.action.onSubmit
          );
        }
        return;
      }

      // Close Widget shortcut
      const closeWidgetShortcut = getShortcut('close-widget');
      if (closeWidgetShortcut && matchesShortcut(e, closeWidgetShortcut)) {
        e.preventDefault();
        useWorkspaceStore.getState().closeFocusedConsole();
        return;
      }

      // Maximize Widget shortcut
      const maximizeWidgetShortcut = getShortcut('maximize-widget');
      if (maximizeWidgetShortcut && matchesShortcut(e, maximizeWidgetShortcut)) {
        e.preventDefault();
        useWorkspaceStore.getState().toggleMaximizeFocusedWidget();
        return;
      }

      // Cmd/Ctrl + Shift + D: Toggle demo view (hardcoded, not customizable)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        setView(view === 'demo' ? 'home' : 'demo');
        return;
      }

      // Arrow key navigation (only when palette is closed)
      if (!commandPalette.isOpen && !shortcutsStore.isMenuOpen) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const direction = e.key.replace('Arrow', '').toLowerCase() as 'up' | 'down' | 'left' | 'right';
          useWorkspaceStore.getState().moveFocus(direction);
          return;
        }
      }

      // Auto-focus input when typing without CMD in terminal/console
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !isInTerminal) {
        const focusedWidgetId = useWorkspaceStore.getState().focusedWidgetId;
        const focusedWidgetType = useWorkspaceStore.getState().focusedWidgetType;

        // Only for console widgets (not terminals which use xterm)
        if (focusedWidgetId && focusedWidgetType === 'agent-console') {
          // Check if it's a printable character
          if (e.key.length === 1 && !e.key.match(/^[F]\d+$/)) {
            // Find the chat input in the focused console and focus it
            const consoleElement = document.querySelector(`[data-console-id="${focusedWidgetId}"]`);
            if (consoleElement) {
              const textarea = consoleElement.querySelector('textarea');
              if (textarea) {
                textarea.focus();
                return;
              }
            }
          }
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
            from the Merry repo.
          </div>
        )}
        <Workspace />
        <CommandPalette />
        <ShortcutsMenu />
        <SettingsPanel />
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
          from the Merry repo, or restart the app.
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
            <span className="font-semibold">Merry</span>
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

      {/* Keyboard Shortcuts Menu */}
      <ShortcutsMenu />

      {/* Settings Panel */}
      <SettingsPanel />
    </div>
  );
}
