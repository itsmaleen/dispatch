import { Brain, FileSearch, FilePen, Terminal, Loader2, Check, AlertCircle, Info } from 'lucide-react';

export interface ActivityEntry {
  id: string;
  createdAt: string;
  activityType: 'thinking' | 'tool_started' | 'tool_completed' | 'file_read' | 
                'file_write' | 'command' | 'info' | 'error';
  label: string;
  detail?: string;
  status?: 'running' | 'completed' | 'failed';
}

interface ActivityLogProps {
  activities: ActivityEntry[];
  maxVisible?: number;
}

function ActivityIcon({ type, status }: { type: ActivityEntry['activityType']; status?: string }) {
  const baseClass = "w-3.5 h-3.5 shrink-0";
  
  // Running tools show spinner
  if (status === 'running') {
    return <Loader2 className={`${baseClass} text-indigo-400 animate-spin`} />;
  }
  
  switch (type) {
    case 'thinking':
      return <Brain className={`${baseClass} text-purple-400`} />;
    case 'file_read':
      return <FileSearch className={`${baseClass} text-blue-400`} />;
    case 'file_write':
      return <FilePen className={`${baseClass} text-green-400`} />;
    case 'command':
      return <Terminal className={`${baseClass} text-amber-400`} />;
    case 'tool_started':
      return <Loader2 className={`${baseClass} text-zinc-400 animate-spin`} />;
    case 'tool_completed':
      return <Check className={`${baseClass} text-green-400`} />;
    case 'error':
      return <AlertCircle className={`${baseClass} text-red-400`} />;
    case 'info':
    default:
      return <Info className={`${baseClass} text-zinc-500`} />;
  }
}

function getActivityColor(type: ActivityEntry['activityType']): string {
  switch (type) {
    case 'error':
      return 'text-red-400';
    case 'thinking':
      return 'text-purple-300';
    case 'file_read':
      return 'text-blue-300';
    case 'file_write':
      return 'text-green-300';
    case 'command':
      return 'text-amber-300';
    case 'tool_completed':
      return 'text-green-400';
    default:
      return 'text-zinc-400';
  }
}

export function ActivityLog({ activities, maxVisible = 10 }: ActivityLogProps) {
  // Show most recent activities (reversed so newest at bottom)
  const visible = activities.slice(-maxVisible);
  const hiddenCount = Math.max(0, activities.length - maxVisible);
  
  if (activities.length === 0) {
    return (
      <div className="text-zinc-500 text-sm italic">
        Waiting for activity...
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {hiddenCount > 0 && (
        <div className="text-xs text-zinc-600 mb-2">
          + {hiddenCount} earlier {hiddenCount === 1 ? 'activity' : 'activities'}
        </div>
      )}
      
      {visible.map((activity) => (
        <div 
          key={activity.id} 
          className="flex items-start gap-2 text-sm"
        >
          <div className="mt-0.5">
            <ActivityIcon type={activity.activityType} status={activity.status} />
          </div>
          
          <div className="flex-1 min-w-0">
            <span className={getActivityColor(activity.activityType)}>
              {activity.label}
            </span>
            
            {activity.detail && (
              <span 
                className="ml-2 text-zinc-500 truncate inline-block max-w-[250px] align-bottom font-mono text-xs"
                title={activity.detail}
              >
                {activity.detail}
              </span>
            )}
          </div>
          
          {activity.status === 'running' && (
            <span className="text-xs text-indigo-400 shrink-0">
              running
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
