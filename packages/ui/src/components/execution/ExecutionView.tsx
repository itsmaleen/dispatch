import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Loader2, CheckCircle, XCircle, Clock, Zap, Activity } from 'lucide-react';
import { api, useAppStore, getWsUrl } from '../../stores/app';
import { ActivityLog, type ActivityEntry } from './ActivityLog';

interface ExecutionViewProps {
  taskId: string;
  initialStatus?: 'executing' | 'completed' | 'failed';
  initialResult?: string;
  initialAgent?: string;
  onBack: () => void;
  onComplete: () => void;
}

// Dynamic WebSocket URL for Electron compatibility
const getWebSocketUrl = () => getWsUrl();

export function ExecutionView({ taskId, initialStatus, initialResult, initialAgent, onBack, onComplete }: ExecutionViewProps) {
  const { updateTask } = useAppStore();
  const [agent] = useState<string | undefined>(initialAgent);
  const isAlreadyDone = initialStatus === 'completed' || initialStatus === 'failed';
  const [status, setStatus] = useState<'executing' | 'completed' | 'failed'>(() =>
    isAlreadyDone ? initialStatus : 'executing'
  );
  const [output, setOutput] = useState<string[]>(() => {
    if (initialStatus === 'completed' && initialResult != null) {
      return ['> Execution completed.', '', '--- Output ---', initialResult];
    }
    if (initialStatus === 'failed') {
      return ['> Execution failed.', '', initialResult ?? 'No output'];
    }
    return [];
  });
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [result, setResult] = useState<string | null>(() => initialResult ?? null);
  const [error, setError] = useState<string | null>(null);
  const [startTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const outputRef = useRef<HTMLDivElement>(null);
  const activityRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const executedTaskIdRef = useRef<string | null>(null);

  // Handle incoming WebSocket events
  const handleWsEvent = useCallback((data: any) => {
    if (data.type !== 'event') return;

    const event = data.event;
    if (!event) return;

    // Handle activity events
    if (event.type === 'activity' && event.payload) {
      const newActivity: ActivityEntry = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        activityType: event.payload.activityType,
        label: event.payload.label,
        detail: event.payload.detail,
        status: event.payload.status,
      };
      setActivities(prev => [...prev, newActivity]);
    }

    // Handle content deltas (for output)
    if (event.type === 'content.delta' && event.payload?.delta) {
      // Don't add to output - we get full result at the end
      // But could show streaming content here if wanted
    }

    // Handle item events (tool starts/stops)
    if (event.type === 'item.started' && event.payload) {
      const newActivity: ActivityEntry = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        activityType: event.payload.itemType === 'file_read' ? 'file_read' :
                     event.payload.itemType === 'file_change' ? 'file_write' :
                     event.payload.itemType === 'command_execution' ? 'command' : 'tool_started',
        label: event.payload.title || 'Tool',
        detail: event.payload.detail,
        status: 'running',
      };
      setActivities(prev => [...prev, newActivity]);
    }

    if (event.type === 'item.completed') {
      // Update the last running activity to completed
      setActivities(prev => {
        const updated = [...prev];
        for (let i = updated.length - 1; i >= 0; i--) {
          if (updated[i].status === 'running') {
            updated[i] = { ...updated[i], status: 'completed', activityType: 'tool_completed' };
            break;
          }
        }
        return updated;
      });
    }
  }, []);

  // Set up WebSocket connection
  useEffect(() => {
    if (isAlreadyDone) return;

    const ws = new WebSocket(getWebSocketUrl());
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        handleWsEvent(data);
      } catch {
        // Ignore parse errors
      }
    };

    ws.onerror = () => {
      console.warn('WebSocket error - activities may not stream');
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [isAlreadyDone, handleWsEvent]);

  // Update elapsed time
  useEffect(() => {
    if (status !== 'executing') return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [status, startTime]);

  // Execute task
  useEffect(() => {
    if (isAlreadyDone) {
      setStatus(initialStatus!);
      if (initialResult) {
        setOutput(prev => prev.length ? prev : ['> Execution completed.', '', '--- Output ---', initialResult]);
      }
      return;
    }

    // Prevent double execution
    if (executedTaskIdRef.current === taskId) return;
    executedTaskIdRef.current = taskId;

    const execute = async () => {
      const agentLabel = agent === 'claude-code' ? 'Claude Code' : agent || 'agent';
      setOutput(prev => [...prev, `> Starting execution with ${agentLabel}...`]);
      setActivities([{
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        activityType: 'info',
        label: 'Starting execution',
        detail: agentLabel,
      }]);

      try {
        const { result } = await api.executeTask(taskId, agent);

        setOutput(prev => [...prev, '', '--- Output ---', result]);
        setResult(result);
        setStatus('completed');
        setActivities(prev => [...prev, {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          activityType: 'info',
          label: 'Execution completed',
        }]);

        updateTask(taskId, {
          status: 'completed',
          result,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Execution failed';
        setError(errMsg);
        setStatus('failed');
        setActivities(prev => [...prev, {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          activityType: 'error',
          label: 'Execution failed',
          detail: errMsg,
        }]);

        updateTask(taskId, { status: 'failed' });
      }
    };

    execute();
  }, [taskId, updateTask, isAlreadyDone, initialStatus, initialResult, agent]);

  // Auto-scroll output and activity
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  useEffect(() => {
    if (activityRef.current) {
      activityRef.current.scrollTop = activityRef.current.scrollHeight;
    }
  }, [activities]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-100 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Back</span>
          </button>

          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              {status === 'executing' && (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                  Executing...
                </>
              )}
              {status === 'completed' && (
                <>
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                  Completed
                </>
              )}
              {status === 'failed' && (
                <>
                  <XCircle className="w-4 h-4 text-red-500" />
                  Failed
                </>
              )}
            </h1>
            {agent && (
              <p className="text-sm text-zinc-500">
                Agent: {agent === 'claude-code' ? 'Claude Code' : agent}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5 text-zinc-500">
            <Clock className="w-3.5 h-3.5" />
            <span className="font-mono text-xs">{formatTime(elapsed)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-zinc-600">
            <Zap className="w-3.5 h-3.5" />
            <span className="font-mono text-xs">{taskId.slice(0, 8)}</span>
          </div>
        </div>
      </div>

      {/* Main content - split view */}
      <div className="flex-1 flex overflow-hidden">
        {/* Activity panel */}
        <div className="w-80 border-r border-zinc-800 flex flex-col">
          <div className="p-3 border-b border-zinc-800 flex items-center gap-2">
            <Activity className="w-4 h-4 text-zinc-400" />
            <span className="text-sm font-medium text-zinc-300">Activity</span>
            <span className="text-xs text-zinc-600">({activities.length})</span>
          </div>
          <div
            ref={activityRef}
            className="flex-1 p-3 overflow-y-auto"
          >
            <ActivityLog activities={activities} maxVisible={50} />
          </div>
        </div>

        {/* Output panel */}
        <div className="flex-1 flex flex-col">
          <div className="p-3 border-b border-zinc-800">
            <span className="text-sm font-medium text-zinc-300">Output</span>
          </div>
          <div className="flex-1 p-4 overflow-hidden">
            <div
              ref={outputRef}
              className="h-full bg-zinc-900 rounded-lg p-4 font-mono text-sm overflow-auto"
            >
              {output.map((line, i) => (
                <div key={i} className="text-zinc-300 whitespace-pre-wrap">
                  {line || '\u00A0'}
                </div>
              ))}
              {status === 'executing' && (
                <div className="flex items-center gap-2 text-indigo-400 mt-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Working...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-zinc-800 bg-zinc-900/50 flex justify-between items-center">
        <div className="text-xs text-zinc-500">
          {status === 'completed' && 'Task completed successfully'}
          {status === 'failed' && (error || 'Execution failed')}
          {status === 'executing' && `${activities.length} activities • Agent is working...`}
        </div>

        <div className="flex gap-2">
          {status === 'completed' && (
            <button
              onClick={onComplete}
              className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-medium transition-colors"
            >
              Done
            </button>
          )}
          {status === 'failed' && (
            <>
              <button
                onClick={onBack}
                className="px-3 py-1.5 text-zinc-400 hover:text-zinc-100 text-sm transition-colors"
              >
                Go Back
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors"
              >
                Retry
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
