import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { ArrowLeft, Loader2, CheckCircle, XCircle, Clock, Zap, Brain, FileSearch, FilePen, Terminal, Check, AlertCircle, Info } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, useAppStore } from '../../stores/app';

interface ExecutionViewProps {
  taskId: string;
  initialStatus?: 'executing' | 'completed' | 'failed';
  initialResult?: string;
  initialAgent?: string;
  onBack: () => void;
  onComplete: () => void;
}

// Timeline entry types
type TimelineEntry = 
  | { kind: 'activity'; id: string; type: ActivityType; label: string; detail?: string; status?: 'running' | 'completed' | 'failed' }
  | { kind: 'working'; id: string }
  | { kind: 'output'; id: string; content: string; isStreaming?: boolean };

type ActivityType = 'thinking' | 'file_read' | 'file_write' | 'command' | 'tool' | 'info' | 'error';

const WS_URL = 'ws://localhost:3333';

// Activity styling
function getActivityIcon(type: ActivityType, status?: string) {
  const baseClass = "w-3 h-3 shrink-0";
  
  if (status === 'running') {
    return <Loader2 className={`${baseClass} text-indigo-400 animate-spin`} />;
  }
  
  switch (type) {
    case 'thinking':
      return <Brain className={`${baseClass} text-purple-400`} />;
    case 'file_read':
      return <FileSearch className={`${baseClass} text-blue-400`} />;
    case 'file_write':
      return <FilePen className={`${baseClass} text-emerald-400`} />;
    case 'command':
      return <Terminal className={`${baseClass} text-amber-400`} />;
    case 'tool':
      return status === 'completed' 
        ? <Check className={`${baseClass} text-emerald-400`} />
        : <Loader2 className={`${baseClass} text-zinc-400 animate-spin`} />;
    case 'error':
      return <AlertCircle className={`${baseClass} text-red-400`} />;
    default:
      return <Info className={`${baseClass} text-zinc-500`} />;
  }
}

function getActivityColor(type: ActivityType): string {
  switch (type) {
    case 'error': return 'text-red-300';
    case 'thinking': return 'text-purple-300/80';
    case 'file_read': return 'text-blue-300/80';
    case 'file_write': return 'text-emerald-300/80';
    case 'command': return 'text-amber-300/80';
    default: return 'text-zinc-400';
  }
}

// Markdown component for output
const MarkdownOutput = memo(function MarkdownOutput({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none">
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children, ...props }) => (
            <pre className="bg-zinc-900 rounded-lg p-3 overflow-x-auto text-sm" {...props}>
              {children}
            </pre>
          ),
          code: ({ children, className, ...props }) => {
            const isInline = !className;
            if (isInline) {
              return <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-sm" {...props}>{children}</code>;
            }
            return <code className={className} {...props}>{children}</code>;
          },
          a: ({ children, href, ...props }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline" {...props}>
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
      {isStreaming && (
        <span className="inline-block w-2 h-4 bg-indigo-400 animate-pulse ml-0.5" />
      )}
    </div>
  );
});

// Activity row component
const ActivityRow = memo(function ActivityRow({ entry }: { entry: TimelineEntry & { kind: 'activity' } }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <div className="mt-0.5">
        {getActivityIcon(entry.type, entry.status)}
      </div>
      <div className="flex-1 min-w-0">
        <span className={`text-[13px] ${getActivityColor(entry.type)}`}>
          {entry.label}
        </span>
        {entry.detail && (
          <span 
            className="ml-2 text-zinc-500/70 truncate inline-block max-w-[60ch] align-bottom font-mono text-xs"
            title={entry.detail}
          >
            {entry.detail}
          </span>
        )}
      </div>
    </div>
  );
});

// Working indicator (animated dots)
const WorkingIndicator = memo(function WorkingIndicator() {
  return (
    <div className="flex items-center gap-2 py-2 pl-1">
      <span className="flex items-center gap-[3px]">
        <span className="h-1.5 w-1.5 rounded-full bg-indigo-400/60 animate-pulse" />
        <span className="h-1.5 w-1.5 rounded-full bg-indigo-400/60 animate-pulse [animation-delay:200ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-indigo-400/60 animate-pulse [animation-delay:400ms]" />
      </span>
      <span className="text-xs text-zinc-500">Working...</span>
    </div>
  );
});

export function ExecutionView({ taskId, initialStatus, initialResult, initialAgent, onBack, onComplete }: ExecutionViewProps) {
  const { updateTask } = useAppStore();
  const [agent] = useState<string | undefined>(initialAgent);
  const isAlreadyDone = initialStatus === 'completed' || initialStatus === 'failed';
  const [status, setStatus] = useState<'executing' | 'completed' | 'failed'>(() =>
    isAlreadyDone ? initialStatus : 'executing'
  );
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [outputContent, setOutputContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [startTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const timelineRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const executedRef = useRef<string | null>(null);

  // Add activity to timeline
  const addActivity = useCallback((type: ActivityType, label: string, detail?: string, status?: 'running' | 'completed' | 'failed') => {
    const entry: TimelineEntry = {
      kind: 'activity',
      id: crypto.randomUUID(),
      type,
      label,
      detail,
      status,
    };
    setTimeline(prev => [...prev, entry]);
  }, []);

  // Update last running activity to completed
  const completeLastActivity = useCallback(() => {
    setTimeline(prev => {
      const updated = [...prev];
      for (let i = updated.length - 1; i >= 0; i--) {
        const item = updated[i];
        if (item.kind === 'activity' && item.status === 'running') {
          updated[i] = { ...item, status: 'completed' };
          break;
        }
      }
      return updated;
    });
  }, []);

  // Handle WebSocket events
  const handleWsEvent = useCallback((data: any) => {
    if (data.type !== 'event') return;
    const event = data.event;
    if (!event) return;
    
    if (event.type === 'activity' && event.payload) {
      const p = event.payload;
      addActivity(p.activityType, p.label, p.detail, p.status);
    }
    
    if (event.type === 'content.delta' && event.payload?.delta) {
      setOutputContent(prev => prev + event.payload.delta);
    }
    
    if (event.type === 'item.started' && event.payload) {
      const p = event.payload;
      const type = p.itemType === 'file_read' ? 'file_read' :
                   p.itemType === 'file_change' ? 'file_write' :
                   p.itemType === 'command_execution' ? 'command' : 'tool';
      addActivity(type, p.title || 'Tool', p.detail, 'running');
    }
    
    if (event.type === 'item.completed') {
      completeLastActivity();
    }
  }, [addActivity, completeLastActivity]);

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
        // Ignore
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
      addActivity('info', `Starting execution with ${agentLabel}`);
      
      try {
        const { result } = await api.executeTask(taskId, agent);
        
        setOutputContent(result);
        setStatus('completed');
        addActivity('info', 'Execution completed');
        
        updateTask(taskId, { status: 'completed', result });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Execution failed';
        setError(errMsg);
        setStatus('failed');
        addActivity('error', 'Execution failed', errMsg);
        
        updateTask(taskId, { status: 'failed' });
      }
    };

    execute();
  }, [taskId, agent, isAlreadyDone, initialStatus, initialResult, addActivity, updateTask]);

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

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-zinc-800">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-zinc-400 hover:text-zinc-100"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
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
              <p className="text-xs text-zinc-500">
                {agent === 'claude-code' ? 'Claude Code' : agent}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm text-zinc-400">
          <div className="flex items-center gap-1">
            <Clock className="w-4 h-4" />
            <span>{formatTime(elapsed)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Zap className="w-4 h-4" />
            <span>{taskId.slice(0, 8)}</span>
          </div>
        </div>
      </div>

      {/* Timeline / Terminal */}
      <div 
        ref={timelineRef}
        className="flex-1 overflow-y-auto p-4"
      >
        <div className="max-w-3xl mx-auto space-y-1">
          {/* Activity entries */}
          {timeline.map((entry) => {
            if (entry.kind === 'activity') {
              return <ActivityRow key={entry.id} entry={entry} />;
            }
            return null;
          })}
          
          {/* Working indicator */}
          {status === 'executing' && timeline.length > 0 && (
            <WorkingIndicator />
          )}
          
          {/* Output section */}
          {outputContent && (
            <div className="mt-4 pt-4 border-t border-zinc-800">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">Response</span>
                {status === 'executing' && (
                  <span className="text-xs text-indigo-400">(streaming)</span>
                )}
              </div>
              <div className="bg-zinc-900/50 rounded-lg p-4 border border-zinc-800">
                <MarkdownOutput 
                  content={outputContent} 
                  isStreaming={status === 'executing'} 
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-zinc-800 flex justify-between items-center">
        <div className="text-sm text-zinc-500">
          {status === 'completed' && 'Task completed successfully'}
          {status === 'failed' && error}
          {status === 'executing' && `${timeline.length} activities`}
        </div>
        
        <div className="flex gap-3">
          {status === 'completed' && (
            <button
              onClick={onComplete}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium"
            >
              Done
            </button>
          )}
          {status === 'failed' && (
            <>
              <button
                onClick={onBack}
                className="px-4 py-2 text-zinc-400 hover:text-zinc-100"
              >
                Go Back
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg"
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
