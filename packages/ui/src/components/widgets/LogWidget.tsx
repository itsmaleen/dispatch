import { useEffect, useRef, useState } from 'react';

interface LogLine {
  id: string;
  timestamp: Date;
  level: 'stdout' | 'stderr' | 'info';
  content: string;
}

interface LogWidgetProps {
  title: string;
  adapterId: string;
}

export function LogWidget({ title, adapterId }: LogWidgetProps) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // Simulate incoming logs for demo
  useEffect(() => {
    const demoLines: string[] = [
      '$ claude-code --project /path/to/project',
      'Connecting to Claude Code...',
      'Session started. Model: claude-sonnet-4-20250514',
      '',
      '> Analyzing codebase structure...',
      '> Found 42 TypeScript files',
      '> Reading existing auth implementation...',
      '',
      'Planning authentication changes...',
    ];

    let index = 0;
    const interval = setInterval(() => {
      if (index < demoLines.length) {
        setLines(prev => [...prev, {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          level: 'stdout',
          content: demoLines[index],
        }]);
        index++;
      }
    }, 500);

    return () => clearInterval(interval);
  }, [adapterId]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  return (
    <div className="h-full bg-zinc-900 border border-zinc-800 rounded-lg flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-sm font-medium">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`text-xs px-2 py-0.5 rounded ${
              autoScroll ? 'bg-blue-600/20 text-blue-400' : 'bg-zinc-800 text-zinc-500'
            }`}
          >
            Auto-scroll
          </button>
          <button
            onClick={() => setLines([])}
            className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-500 hover:text-zinc-300"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Log content */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto p-3 font-mono text-xs"
      >
        {lines.map(line => (
          <div
            key={line.id}
            className={`${
              line.level === 'stderr' ? 'text-red-400' : 'text-zinc-300'
            } ${line.content === '' ? 'h-4' : ''}`}
          >
            {line.content}
          </div>
        ))}
        {lines.length === 0 && (
          <div className="text-zinc-600 italic">Waiting for output...</div>
        )}
      </div>
    </div>
  );
}
