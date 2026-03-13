import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { ArrowLeft, Loader2, CheckCircle, XCircle, Clock, Zap, Bot } from 'lucide-react';
import { TimelineRow, type WorkEntry, type WorkTone } from '../shared/TimelineRow';
import { api, useAppStore } from '../../stores/app';

interface ExecutionViewProps {
  taskId: string;
  initialStatus?: 'executing' | 'completed' | 'failed';
  initialResult?: string;
  initialAgent?: string;
  onBack: () => void;
  onComplete: () => void;
}

// Timeline section types
type TimelineSection = 
  | { kind: 'work'; id: string; entries: WorkEntry[] }
  | { kind: 'working'; id: string }
  | { kind: 'message'; id: string; content: string; isStreaming?: boolean };

const WS_URL = 'ws://localhost:3333';

export function ExecutionView({ 
  taskId, 
  initialStatus, 
  initialResult, 
  initialAgent, 
  onBack, 
  onComplete 
}: ExecutionViewProps) {
  const { updateTask } = useAppStore();
  const [agent] = useState<string | undefined>(initialAgent);
  const isAlreadyDone = initialStatus === 'completed' || initialStatus === 'failed';
  const [status, setStatus] = useState<'executing' | 'completed' | 'failed'>(() =>
    isAlreadyDone ? initialStatus : 'executing'
  );
  const [timeline, setTimeline] = useState<TimelineSection[]>([]);
  const [outputContent, setOutputContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [startTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const timelineRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const executedRef = useRef<string | null>(null);

  // Add a work entry to the current work card (or create a new one)
  const addWorkEntry = useCallback((entry: WorkEntry) => {
    setTimeline(prev => {
      const last = prev[prev.length - 1];
      
      // If last section is a work card, add to it
      if (last?.kind === 'work') {
        return [
          ...prev.slice(0, -1),
          { ...last, entries: [...last.entries, entry] }
        ];
      }
      
      // Otherwise create a new work card
      return [
        ...prev,
        { kind: 'work', id: crypto.randomUUID(), entries: [entry] }
      ];
    });
  }, []);

  // Update the last running entry to completed
  const completeLastEntry = useCallback(() => {
    setTimeline(prev => {
      const updated = [...prev];
      for (let i = updated.length - 1; i >= 0; i--) {
        const section = updated[i];
        if (section.kind === 'work') {
          const entries = [...section.entries];
          for (let j = entries.length - 1; j >= 0; j--) {
            if (entries[j].status === 'running') {
              entries[j] = { ...entries[j], status: 'completed' };
              updated[i] = { ...section, entries };
              return updated;
            }
          }
        }
      }
      return prev;
    });
  }, []);

  // Map event types to work tones
  const mapToTone = useCallback((type: string): WorkTone => {
    switch (type) {
      case 'thinking': return 'thinking';
      case 'file_read': return 'file_read';
      case 'file_write':
      case 'file_change': return 'file_write';
      case 'command':
      case 'command_execution': return 'command';
      case 'error': return 'error';
      default: return 'tool';
    }
  }, []);

  // Handle WebSocket events
  const handleWsEvent = useCallback((data: any) => {
    if (data.type !== 'event') return;
    const event = data.event;
    if (!event) return;
    
    // Activity events from adapter
    if (event.type === 'activity' && event.payload) {
      const p = event.payload;
      addWorkEntry({
        id: crypto.randomUUID(),
        tone: mapToTone(p.activityType),
        label: p.label,
        detail: p.detail,
        status: p.status,
      });
    }
    
    // Content streaming
    if (event.type === 'content.delta' && event.payload?.delta) {
      setOutputContent(prev => prev + event.payload.delta);
    }
    
    // Tool/item started
    if (event.type === 'item.started' && event.payload) {
      const p = event.payload;
      addWorkEntry({
        id: crypto.randomUUID(),
        tone: mapToTone(p.itemType || 'tool'),
        label: p.title || 'Tool',
        detail: p.detail,
        status: 'running',
      });
    }
    
    // Tool/item completed
    if (event.type === 'item.completed') {
      completeLastEntry();
    }
  }, [addWorkEntry, completeLastEntry, mapToTone]);

  // WebSocket setup
  useEffect(() => {
    if (isAlreadyDone) return;
    
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        handleWsEvent(data);
      } catch {
        // Ignore parse errors
      }
    };
    
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [isAlreadyDone, handleWsEvent]);

  // Elapsed timer
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
      if (initialResult) setOutputContent(initialResult);
      return;
    }
    
    if (executedRef.current === taskId) return;
    executedRef.current = taskId;

    const execute = async () => {
      const agentLabel = agent === 'claude-code' ? 'Claude Code' : agent || 'agent';
      addWorkEntry({
        id: crypto.randomUUID(),
        tone: 'info',
        label: `Starting execution with ${agentLabel}`,
      });
      
      try {
        const { result } = await api.executeTask(taskId, agent);
        
        setOutputContent(result);
        setStatus('completed');
        addWorkEntry({
          id: crypto.randomUUID(),
          tone: 'info',
          label: 'Execution completed',
          status: 'completed',
        });
        
        updateTask(taskId, { status: 'completed', result });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Execution failed';
        setError(errMsg);
        setStatus('failed');
        addWorkEntry({
          id: crypto.randomUUID(),
          tone: 'error',
          label: 'Execution failed',
          detail: errMsg,
        });
        
        updateTask(taskId, { status: 'failed' });
      }
    };

    execute();
  }, [taskId, agent, isAlreadyDone, initialStatus, initialResult, addWorkEntry, updateTask]);

  // Auto-scroll
  useEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, [timeline, outputContent]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Count total work entries
  const workCount = timeline.reduce((acc, section) => {
    if (section.kind === 'work') return acc + section.entries.length;
    return acc;
  }, 0);

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
          
          <div className="h-4 w-px bg-zinc-700" />
          
          <div className="flex items-center gap-2">
            {status === 'executing' && (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                <span className="text-sm font-medium text-zinc-200">Executing...</span>
              </>
            )}
            {status === 'completed' && (
              <>
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-medium text-emerald-400">Completed</span>
              </>
            )}
            {status === 'failed' && (
              <>
                <XCircle className="w-4 h-4 text-red-400" />
                <span className="text-sm font-medium text-red-400">Failed</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm">
          {agent && (
            <div className="flex items-center gap-1.5 text-zinc-500">
              <Bot className="w-3.5 h-3.5" />
              <span className="text-xs">
                {agent === 'claude-code' ? 'Claude Code' : agent}
              </span>
            </div>
          )}
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

      {/* Timeline */}
      <div 
        ref={timelineRef}
        className="flex-1 overflow-y-auto"
      >
        <div className="max-w-3xl mx-auto px-4 py-4">
          {/* Work sections */}
          {timeline.map((section) => {
            switch (section.kind) {
              case 'work':
                return (
                  <TimelineRow 
                    key={section.id} 
                    type="work" 
                    entries={section.entries} 
                  />
                );
              case 'message':
                return (
                  <TimelineRow 
                    key={section.id} 
                    type="message" 
                    content={section.content}
                    isStreaming={section.isStreaming}
                  />
                );
              default:
                return null;
            }
          })}
          
          {/* Working indicator */}
          {status === 'executing' && workCount > 0 && (
            <TimelineRow type="working" />
          )}
          
          {/* Output / Response */}
          {outputContent && (
            <TimelineRow 
              type="message" 
              content={outputContent}
              isStreaming={status === 'executing'}
            />
          )}
          
          {/* Empty state */}
          {timeline.length === 0 && !outputContent && status === 'executing' && (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
              <Loader2 className="w-6 h-6 animate-spin mb-3 text-indigo-400/50" />
              <p className="text-sm">Waiting for agent...</p>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-zinc-800 bg-zinc-900/50 flex justify-between items-center">
        <div className="text-xs text-zinc-500">
          {status === 'completed' && `Completed • ${workCount} activities`}
          {status === 'failed' && (error || 'Execution failed')}
          {status === 'executing' && `${workCount} activities`}
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
