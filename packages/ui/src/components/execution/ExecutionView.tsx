import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Loader2, CheckCircle, XCircle, Clock, Zap } from 'lucide-react';
import { api, useAppStore } from '../../stores/app';

interface ExecutionViewProps {
  taskId: string;
  onBack: () => void;
  onComplete: () => void;
}

export function ExecutionView({ taskId, onBack, onComplete }: ExecutionViewProps) {
  const { updateTask } = useAppStore();
  const [status, setStatus] = useState<'executing' | 'completed' | 'failed'>('executing');
  const [output, setOutput] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const outputRef = useRef<HTMLDivElement>(null);

  // Update elapsed time
  useEffect(() => {
    if (status !== 'executing') return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [status, startTime]);

  // Execute task on mount
  useEffect(() => {
    const execute = async () => {
      try {
        setOutput(prev => [...prev, '> Starting execution...']);
        
        // TODO: Use WebSocket for streaming
        // For now, just poll or wait for result
        const { result } = await api.executeTask(taskId);
        
        setOutput(prev => [...prev, '', '--- Output ---', result]);
        setResult(result);
        setStatus('completed');
        
        updateTask(taskId, {
          status: 'completed',
          result,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Execution failed';
        setOutput(prev => [...prev, '', `❌ Error: ${errMsg}`]);
        setError(errMsg);
        setStatus('failed');
        
        updateTask(taskId, { status: 'failed' });
      }
    };

    execute();
  }, [taskId, updateTask]);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-full flex flex-col">
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
                  <CheckCircle className="w-4 h-4 text-green-500" />
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
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm text-zinc-400">
          <div className="flex items-center gap-1">
            <Clock className="w-4 h-4" />
            <span>{formatTime(elapsed)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Zap className="w-4 h-4" />
            <span>Task {taskId.slice(0, 8)}</span>
          </div>
        </div>
      </div>

      {/* Output terminal */}
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

      {/* Footer */}
      <div className="p-4 border-t border-zinc-800 flex justify-between items-center">
        <div className="text-sm text-zinc-500">
          {status === 'completed' && 'Task completed successfully'}
          {status === 'failed' && error}
          {status === 'executing' && 'Agent is working on your task...'}
        </div>
        
        <div className="flex gap-3">
          {status === 'completed' && (
            <button
              onClick={onComplete}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg font-medium"
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
