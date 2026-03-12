interface StatusWidgetProps {
  adapterId: string;
  name: string;
  status: 'disconnected' | 'connecting' | 'idle' | 'running' | 'error';
  currentTask?: string;
}

export function StatusWidget({ name, status, currentTask }: StatusWidgetProps) {
  const statusConfig = {
    disconnected: { color: 'bg-zinc-600', label: 'Disconnected', pulse: false },
    connecting: { color: 'bg-yellow-500', label: 'Connecting', pulse: true },
    idle: { color: 'bg-green-500', label: 'Ready', pulse: false },
    running: { color: 'bg-blue-500', label: 'Running', pulse: true },
    error: { color: 'bg-red-500', label: 'Error', pulse: false },
  };

  const { color, label, pulse } = statusConfig[status];

  return (
    <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full ${color} ${pulse ? 'animate-pulse' : ''}`} />
        <span className="text-sm font-medium">{name}</span>
      </div>
      <div className="text-xs text-zinc-500">
        Status: <span className="text-zinc-300">{label}</span>
      </div>
      {currentTask && (
        <div className="text-xs text-zinc-500 mt-1 truncate">
          Task: <span className="text-zinc-400">{currentTask}</span>
        </div>
      )}
    </div>
  );
}
