import { memo } from 'react';
import { 
  Brain, 
  FileSearch, 
  FilePen, 
  Terminal, 
  Check, 
  AlertCircle, 
  Info,
  Loader2,
  ChevronRight,
  MessageSquare,
  ListTodo
} from 'lucide-react';
import { ChatMarkdown } from './ChatMarkdown';

// Timeline row types (inspired by T3 Code)
export type TimelineRowType = 
  | 'work'           // Activity/tool execution
  | 'message'        // Assistant response
  | 'proposed-plan'  // Plan steps (not executing yet)
  | 'working';       // Animated working indicator

export type WorkTone = 
  | 'thinking' 
  | 'file_read' 
  | 'file_write' 
  | 'command' 
  | 'tool' 
  | 'info' 
  | 'error';

export interface WorkEntry {
  id: string;
  tone: WorkTone;
  label: string;
  detail?: string;
  status?: 'running' | 'completed' | 'failed';
}

export interface TimelineRowProps {
  type: TimelineRowType;
  // For 'work' type
  entries?: WorkEntry[];
  // For 'message' type
  content?: string;
  isStreaming?: boolean;
  // For 'proposed-plan' type
  steps?: string[];
}

// Get Tailwind classes for work entry styling
export function workToneClass(tone: WorkTone): {
  border: string;
  bg: string;
  text: string;
  icon: string;
} {
  switch (tone) {
    case 'thinking':
      return {
        border: 'border-purple-500/30',
        bg: 'bg-purple-500/5',
        text: 'text-purple-300',
        icon: 'text-purple-400',
      };
    case 'file_read':
      return {
        border: 'border-blue-500/30',
        bg: 'bg-blue-500/5',
        text: 'text-blue-300',
        icon: 'text-blue-400',
      };
    case 'file_write':
      return {
        border: 'border-emerald-500/30',
        bg: 'bg-emerald-500/5',
        text: 'text-emerald-300',
        icon: 'text-emerald-400',
      };
    case 'command':
      return {
        border: 'border-amber-500/30',
        bg: 'bg-amber-500/5',
        text: 'text-amber-300',
        icon: 'text-amber-400',
      };
    case 'error':
      return {
        border: 'border-red-500/30',
        bg: 'bg-red-500/5',
        text: 'text-red-300',
        icon: 'text-red-400',
      };
    case 'tool':
      return {
        border: 'border-indigo-500/30',
        bg: 'bg-indigo-500/5',
        text: 'text-indigo-300',
        icon: 'text-indigo-400',
      };
    default:
      return {
        border: 'border-zinc-700',
        bg: 'bg-zinc-800/30',
        text: 'text-zinc-400',
        icon: 'text-zinc-500',
      };
  }
}

// Get icon for work entry
function getWorkIcon(tone: WorkTone, status?: string) {
  const baseClass = "w-3.5 h-3.5 shrink-0";
  
  if (status === 'running') {
    return <Loader2 className={`${baseClass} animate-spin text-indigo-400`} />;
  }
  
  switch (tone) {
    case 'thinking':
      return <Brain className={`${baseClass}`} />;
    case 'file_read':
      return <FileSearch className={`${baseClass}`} />;
    case 'file_write':
      return <FilePen className={`${baseClass}`} />;
    case 'command':
      return <Terminal className={`${baseClass}`} />;
    case 'tool':
      return status === 'completed' 
        ? <Check className={`${baseClass}`} />
        : <Loader2 className={`${baseClass} animate-spin`} />;
    case 'error':
      return <AlertCircle className={`${baseClass}`} />;
    default:
      return <Info className={`${baseClass}`} />;
  }
}

// Single work entry row
const WorkEntryRow = memo(function WorkEntryRow({ entry }: { entry: WorkEntry }) {
  const styles = workToneClass(entry.tone);
  
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <div className={`mt-0.5 ${styles.icon}`}>
        {getWorkIcon(entry.tone, entry.status)}
      </div>
      <div className="flex-1 min-w-0">
        <span className={`text-[13px] ${styles.text}`}>
          {entry.label}
        </span>
        {entry.detail && (
          <span 
            className="ml-2 text-zinc-500/70 truncate inline-block max-w-[50ch] align-bottom font-mono text-xs"
            title={entry.detail}
          >
            {entry.detail}
          </span>
        )}
        {entry.status === 'completed' && (
          <Check className="inline-block w-3 h-3 ml-2 text-emerald-400/70" />
        )}
      </div>
    </div>
  );
});

// Work card (groups related work entries)
const WorkCard = memo(function WorkCard({ entries }: { entries: WorkEntry[] }) {
  if (entries.length === 0) return null;
  
  // Use the primary tone (first entry's tone) for card styling
  const primaryTone = entries[0].tone;
  const styles = workToneClass(primaryTone);
  
  return (
    <div className={`rounded-lg border ${styles.border} ${styles.bg} px-3 py-2 my-2`}>
      {entries.map(entry => (
        <WorkEntryRow key={entry.id} entry={entry} />
      ))}
    </div>
  );
});

// Working indicator (animated dots)
const WorkingIndicator = memo(function WorkingIndicator() {
  return (
    <div className="flex items-center gap-2.5 py-3 px-1">
      <span className="flex items-center gap-[3px]">
        <span className="h-1.5 w-1.5 rounded-full bg-indigo-400/70 animate-pulse" />
        <span className="h-1.5 w-1.5 rounded-full bg-indigo-400/70 animate-pulse [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-indigo-400/70 animate-pulse [animation-delay:300ms]" />
      </span>
      <span className="text-sm text-zinc-500">Working...</span>
    </div>
  );
});

// Message row (assistant response)
const MessageRow = memo(function MessageRow({ 
  content, 
  isStreaming 
}: { 
  content: string; 
  isStreaming?: boolean;
}) {
  return (
    <div className="py-3">
      <div className="flex items-center gap-2 mb-2">
        <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
          Response
        </span>
        {isStreaming && (
          <span className="text-xs text-indigo-400/80">(streaming)</span>
        )}
      </div>
      <div className="bg-zinc-900/40 rounded-lg p-4 border border-zinc-800/80">
        <ChatMarkdown content={content} isStreaming={isStreaming} />
      </div>
    </div>
  );
});

// Proposed plan row
const ProposedPlanRow = memo(function ProposedPlanRow({ steps }: { steps: string[] }) {
  return (
    <div className="py-3">
      <div className="flex items-center gap-2 mb-2">
        <ListTodo className="w-3.5 h-3.5 text-violet-400" />
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
          Proposed Plan
        </span>
      </div>
      <div className="bg-violet-500/5 rounded-lg p-3 border border-violet-500/20">
        <ol className="space-y-1.5">
          {steps.map((step, idx) => (
            <li key={idx} className="flex items-start gap-2 text-sm">
              <span className="shrink-0 w-5 h-5 rounded bg-violet-500/20 text-violet-300 text-xs flex items-center justify-center font-medium mt-0.5">
                {idx + 1}
              </span>
              <span className="text-zinc-300">{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
});

// Main TimelineRow component
export const TimelineRow = memo(function TimelineRow({
  type,
  entries,
  content,
  isStreaming,
  steps,
}: TimelineRowProps) {
  switch (type) {
    case 'work':
      return <WorkCard entries={entries || []} />;
    
    case 'message':
      return <MessageRow content={content || ''} isStreaming={isStreaming} />;
    
    case 'proposed-plan':
      return <ProposedPlanRow steps={steps || []} />;
    
    case 'working':
      return <WorkingIndicator />;
    
    default:
      return null;
  }
});
