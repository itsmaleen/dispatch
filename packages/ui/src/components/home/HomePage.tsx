import { useState } from "react";
import {
  useAppStore,
  type Project,
  type Agent,
  type Task,
} from "../../stores/app";
import {
  FolderOpen,
  ArrowRight,
  Folder,
  Users,
  Clock,
  Zap,
} from "lucide-react";

interface HomePageProps {
  onStartTask: (message: string) => void;
  onOpenTask?: (task: Task) => void;
}

export function HomePage({ onStartTask, onOpenTask }: HomePageProps) {
  const { currentProject, recentProjects, agents, tasks, setProject } =
    useAppStore();
  const [pathInput, setPathInput] = useState("");
  const [taskInput, setTaskInput] = useState("");

  const handleOpenFolder = async () => {
    // Use Electron's dialog via IPC
    if (window.electronAPI?.openFolder) {
      const path = await window.electronAPI.openFolder();
      if (path) {
        const name = path.split("/").pop() || path;
        setProject({ path, name, lastOpened: Date.now() });
      }
    } else {
      // Fallback for browser dev
      console.log("Open folder dialog (Electron only)");
    }
  };

  const handlePathSubmit = () => {
    if (pathInput.trim()) {
      const path = pathInput.trim();
      const name = path.split("/").pop() || path;
      setProject({ path, name, lastOpened: Date.now() });
      setPathInput("");
    }
  };

  const handleTaskSubmit = () => {
    if (taskInput.trim()) {
      onStartTask(taskInput.trim());
      setTaskInput("");
    }
  };

  const handleRecentProject = (project: Project) => {
    setProject(project);
  };

  // No project loaded - Welcome screen
  if (!currentProject) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8">
        <div className="max-w-lg w-full space-y-8">
          {/* Logo & Welcome */}
          <div className="text-center space-y-4">
            <div className="text-6xl">🦞</div>
            <h1 className="text-2xl font-semibold text-zinc-100">
              Welcome to Merry
            </h1>
            <p className="text-zinc-400">
              Open a project to start working with AI agents
            </p>
          </div>

          {/* Open Folder Button */}
          <button
            onClick={handleOpenFolder}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
          >
            <FolderOpen className="w-5 h-5" />
            <span className="font-medium">Open Folder...</span>
          </button>

          {/* Path Input */}
          <div className="relative">
            <input
              type="text"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handlePathSubmit()}
              placeholder="/path/to/project"
              className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={handlePathSubmit}
              disabled={!pathInput.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-zinc-400 hover:text-zinc-100 disabled:opacity-50"
            >
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
          <p className="text-center text-sm text-zinc-500 -mt-4">
            or paste a path
          </p>

          {/* Recent Projects */}
          {recentProjects.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
                Recent Projects
              </h2>
              <div className="space-y-2">
                {recentProjects.slice(0, 5).map((project) => (
                  <button
                    key={project.path}
                    onClick={() => handleRecentProject(project)}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-zinc-800/50 hover:bg-zinc-800 rounded-lg transition-colors text-left"
                  >
                    <Folder className="w-5 h-5 text-zinc-400" />
                    <div className="flex-1 min-w-0">
                      <div className="text-zinc-100 truncate">
                        {project.name}
                      </div>
                      <div className="text-xs text-zinc-500 truncate">
                        {project.path}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Project loaded - Active state
  const connectedAgents = agents.filter((a) => a.status !== "offline");
  const recentTasks = tasks.slice(0, 5);

  return (
    <div className="h-full flex flex-col p-8">
      {/* Task Input Hero */}
      <div className="flex-1 flex items-center justify-center">
        <div className="max-w-2xl w-full space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-zinc-100 mb-2">
              What would you like to build?
            </h1>
            <p className="text-zinc-400">
              Describe your task and let your agents handle it
            </p>
          </div>

          <div className="relative">
            <textarea
              value={taskInput}
              onChange={(e) => setTaskInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleTaskSubmit();
                }
              }}
              placeholder="Fix the login bug in auth.ts..."
              rows={3}
              className="w-full px-4 py-4 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 resize-none"
            />
            <button
              onClick={handleTaskSubmit}
              disabled={!taskInput.trim()}
              className="absolute right-3 bottom-3 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-md transition-colors flex items-center gap-2"
            >
              <Zap className="w-4 h-4" />
              <span>Start</span>
            </button>
          </div>

          {/* Example tasks */}
          <div className="flex flex-wrap gap-2 justify-center">
            {[
              "Fix the login bug in auth.ts",
              "Add dark mode to settings",
              "Review PR #42",
            ].map((example) => (
              <button
                key={example}
                onClick={() => setTaskInput(example)}
                className="px-3 py-1.5 text-sm bg-zinc-800/50 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 rounded-md transition-colors"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Section: Agents & Tasks */}
      <div className="flex gap-8 mt-8">
        {/* Connected Agents */}
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-400 uppercase tracking-wider">
            <Users className="w-4 h-4" />
            <span>Connected Agents</span>
          </div>
          <div className="flex flex-wrap gap-3">
            {connectedAgents.length > 0 ? (
              connectedAgents.map((agent) => (
                <AgentCard key={agent.name} agent={agent} />
              ))
            ) : (
              <div className="text-zinc-500 text-sm">No agents connected</div>
            )}
            <button className="flex items-center gap-2 px-4 py-3 border border-dashed border-zinc-700 hover:border-zinc-600 rounded-lg text-zinc-500 hover:text-zinc-400 transition-colors">
              <span>+ Add Agent</span>
            </button>
          </div>
        </div>

        {/* Recent Tasks */}
        <div className="w-80 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-400 uppercase tracking-wider">
            <Clock className="w-4 h-4" />
            <span>Recent Tasks</span>
          </div>
          <div className="space-y-2">
            {recentTasks.length > 0 ? (
              recentTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onClick={onOpenTask ? () => onOpenTask(task) : undefined}
                />
              ))
            ) : (
              <div className="text-zinc-500 text-sm">No tasks yet</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  const statusColor = {
    idle: "bg-green-500",
    busy: "bg-amber-500",
    offline: "bg-zinc-500",
  }[agent.status];

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-zinc-800/50 rounded-lg">
      <div className={`w-2 h-2 rounded-full ${statusColor}`} />
      <div>
        <div className="text-zinc-100 font-medium">{agent.name}</div>
        <div className="text-xs text-zinc-500">
          {agent.status === "busy" && agent.currentFiles
            ? agent.currentFiles.join(", ")
            : agent.status}
        </div>
      </div>
    </div>
  );
}

function TaskCard({
  task,
  onClick,
}: {
  task: { id: string; message: string; status: string; createdAt: number };
  onClick?: () => void;
}) {
  const statusIcon =
    {
      planning: "📝",
      executing: "🔄",
      review: "👀",
      completed: "✅",
      failed: "❌",
    }[task.status] || "⏳";

  const timeAgo = getTimeAgo(task.createdAt);

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
      className="flex items-start gap-3 px-3 py-2 bg-zinc-800/50 hover:bg-zinc-800 rounded-lg cursor-pointer transition-colors"
    >
      <span>{statusIcon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-zinc-100 text-sm truncate">{task.message}</div>
        <div className="text-xs text-zinc-500">{timeAgo}</div>
      </div>
    </div>
  );
}

function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Type declaration for Electron API is in src/types/electron.d.ts
