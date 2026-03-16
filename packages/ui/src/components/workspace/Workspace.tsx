import { useState, useEffect, useRef, useCallback, Fragment } from 'react';
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelGroupHandle } from 'react-resizable-panels';
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import {
  Plus,
  Play,
  Brain,
  Terminal as TerminalIcon,
  Check,
  Loader2,
  Sparkles,
  ArrowRight,
  X,
  Minus,
  Maximize2,
  RefreshCw,
  Wifi,
  WifiOff,
  FolderOpen,
  Pencil,
  MoreVertical,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Globe,
  Settings,
  Eye,
  EyeOff,
  Palette,
  SplitSquareHorizontal,
  SplitSquareVertical,
  LayoutGrid,
  GripVertical,
} from 'lucide-react';
import { AgentsPanel } from '../agents/AgentsPanel';
import { api, getServerUrl, getWsUrl } from '../../stores/app';
import { useWorkspaceStore, type LayoutNode, type LayoutLeaf, type LayoutGroup, layoutHelpers } from '../../stores/workspace';
import { ChatInput, type UploadedFile } from './ChatInput';

// ============================================================================
// TYPES
// ============================================================================

// Dynamic URLs - resolved at runtime for Electron compatibility
const getApiUrl = () => getServerUrl();
const getWebSocketUrl = () => `${getWsUrl()}/events`;

type AgentStatus = 'ready' | 'busy' | 'offline';
type TerminalLineType = 'prompt' | 'thinking' | 'tool_call' | 'tool_result' | 'output' | 'error' | 'info' | 'command' | 'system';

interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  icon: string;
  type: 'claude-code' | 'openclaw';
}

interface PlanStep {
  id: string;
  text: string;
  agent: string | null;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  source?: 'plan' | 'extracted' | 'manual';
  threadId?: string;
  turnId?: string;
  costUsd?: number;
  durationMs?: number;
}

interface TerminalLine {
  id: string;
  type: TerminalLineType;
  content: string;
  timestamp?: string;
  isStreaming?: boolean;
  /** Block index for tool_call lines (used to match input_json_delta updates) */
  blockIndex?: number;
}

/** Terminal display settings */
interface TerminalSettings {
  label?: string; // Custom name for the terminal
  accentColor?: string; // Accent color for visual distinction
  showThinking?: boolean; // Show thinking lines
  showToolCalls?: boolean; // Show tool call lines
  showToolResults?: boolean; // Show tool result lines
  showTimestamps?: boolean; // Show timestamps on lines
}

const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  showThinking: true,
  showToolCalls: true,
  showToolResults: true,
  showTimestamps: true,
};

const ACCENT_COLORS = [
  { id: 'default', label: 'Default', class: 'bg-zinc-500' },
  { id: 'blue', label: 'Blue', class: 'bg-blue-500' },
  { id: 'green', label: 'Green', class: 'bg-emerald-500' },
  { id: 'purple', label: 'Purple', class: 'bg-violet-500' },
  { id: 'orange', label: 'Orange', class: 'bg-orange-500' },
  { id: 'pink', label: 'Pink', class: 'bg-pink-500' },
  { id: 'cyan', label: 'Cyan', class: 'bg-cyan-500' },
];

interface QueuedMessage {
  message: string;
  files?: UploadedFile[];
}

interface TerminalState {
  id: string;
  agent: Agent;
  lines: TerminalLine[];
  isStreaming: boolean;
  currentTask?: string;
  /** Plan step id when this terminal is executing a step (for status/cost sync) */
  currentStepId?: string;
  path?: string; // Override workspace path
  // Thread integration (Phase 2/3)
  threadId?: string;
  sessionActive?: boolean;
  // Settings
  settings?: TerminalSettings;
  // Message queue - allows typing while terminal is busy
  queuedMessage?: QueuedMessage | null;
}

interface MinimizedWidget {
  id: string;
  type: 'terminal' | 'tasks';
  title: string;
  icon: string;
  data?: TerminalState;
}

// ============================================================================
// UTILITIES
// ============================================================================

function makeTimestamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getAgentIcon(agent: { type: string; name: string }): string {
  if (agent.type === 'claude-code') return '🖥️';
  const name = agent.name.toLowerCase();
  if (name.includes('scout')) return '🔍';
  if (name.includes('forge')) return '🔨';
  if (name.includes('vera')) return '✨';
  if (name.includes('echo')) return '📢';
  return '🤖';
}

/** Extract human-readable detail (path, command, etc.) from tool input JSON (full or partial) */
function tryExtractToolDetail(json: string): string | undefined {
  try {
    const input = JSON.parse(json);
    if (input.path) return input.path;
    if (input.file_path) return input.file_path;
    if (input.file) return input.file;
    if (input.command) {
      const cmd = String(input.command);
      return cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
    }
    if (input.pattern) return input.pattern;
    if (input.query) return input.query;
    if (input.regex) return input.regex;
    return undefined;
  } catch {
    const pathMatch = json.match(/"(?:path|file_path|file)"\s*:\s*"([^"]+)"/);
    if (pathMatch) return pathMatch[1];
    const cmdMatch = json.match(/"command"\s*:\s*"([^"]{1,60})/);
    if (cmdMatch) return cmdMatch[1] + (json.includes(cmdMatch[0] + '"') ? '' : '...');
    return undefined;
  }
}

/** Renders step text with markdown-like formatting: **bold** and `code` (as badges for paths/handlers) */
function PlanStepText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`t-${key++}`}>{text.slice(lastIndex, match.index)}</span>);
    }
    const segment = match[1];
    if (segment.startsWith('**') && segment.endsWith('**')) {
      parts.push(<strong key={`t-${key++}`} className="font-semibold text-zinc-100">{segment.slice(2, -2)}</strong>);
    } else if (segment.startsWith('`') && segment.endsWith('`')) {
      const code = segment.slice(1, -1);
      const isPath = /[/\\]|\.(ts|tsx|js|jsx|md|json|py)(:\d+)?$|:\d+\)?$/.test(code) || code.includes(':');
      parts.push(
        <span
          key={`t-${key++}`}
          className={isPath ? 'inline-flex items-center px-1.5 py-0.5 rounded bg-zinc-700/80 text-amber-200/90 font-mono text-[0.85em]' : 'px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 font-mono text-[0.9em]'}
        >
          {code}
        </span>
      );
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={`t-${key++}`}>{text.slice(lastIndex)}</span>);
  }
  return <span className="text-sm text-zinc-200 leading-snug">{parts.length > 0 ? parts : text}</span>;
}

// ============================================================================
// TERMINAL LINE COMPONENT
// ============================================================================

function TerminalLineItem({ line, showTimestamp = true }: { line: TerminalLine; showTimestamp?: boolean }) {
  const getLineStyle = () => {
    switch (line.type) {
      case 'prompt':
        return 'text-blue-400 font-medium';
      case 'thinking':
        return 'text-violet-400 italic';
      case 'tool_call':
        return 'text-amber-400';
      case 'tool_result':
        return 'text-zinc-400 text-xs font-mono bg-zinc-900/50 px-2 py-1 rounded';
      case 'output':
        return 'text-emerald-400';
      case 'error':
        return 'text-red-400';
      case 'info':
        return 'text-zinc-300';
      case 'command':
        return 'text-cyan-400 font-mono';
      case 'system':
        return 'text-zinc-600 text-xs';
      default:
        return 'text-zinc-300';
    }
  };

  const getIcon = () => {
    switch (line.type) {
      case 'thinking':
        return <Brain className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />;
      case 'tool_call':
        return <ArrowRight className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />;
      case 'command':
        return <TerminalIcon className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />;
      case 'error':
        return <X className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />;
      case 'info':
        return <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />;
      default:
        return null;
    }
  };

  return (
    <div className="flex items-start gap-2 py-0.5">
      {showTimestamp && line.timestamp && (
        <span className="text-[10px] text-zinc-600 font-mono w-16 flex-shrink-0">
          {line.timestamp}
        </span>
      )}
      {getIcon()}
      <span className={`${getLineStyle()} whitespace-pre-wrap break-words`}>
        {line.content}
        {line.isStreaming && (
          <span className="inline-block w-2 h-4 ml-0.5 bg-current animate-pulse" />
        )}
      </span>
    </div>
  );
}

// ============================================================================
// TERMINAL SETTINGS POPOVER
// ============================================================================

function TerminalSettingsPopover({
  settings,
  onSettingsChange,
  terminalLabel,
  onLabelChange,
  onClose,
}: {
  settings: TerminalSettings;
  onSettingsChange: (settings: TerminalSettings) => void;
  terminalLabel: string;
  onLabelChange: (label: string) => void;
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [localLabel, setLocalLabel] = useState(terminalLabel);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleLabelBlur = () => {
    if (localLabel !== terminalLabel) {
      onLabelChange(localLabel);
    }
  };

  const toggleSetting = (key: keyof TerminalSettings) => {
    onSettingsChange({ ...settings, [key]: !settings[key] });
  };

  return (
    <div
      ref={popoverRef}
      className="absolute top-full right-0 mt-1 w-64 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-2 border-b border-zinc-700">
        <span className="text-xs font-medium text-zinc-300">Terminal Settings</span>
      </div>

      <div className="p-3 space-y-3">
        {/* Terminal Label */}
        <div className="space-y-1">
          <label className="text-[10px] text-zinc-500 uppercase tracking-wide">Label</label>
          <input
            type="text"
            value={localLabel}
            onChange={(e) => setLocalLabel(e.target.value)}
            onBlur={handleLabelBlur}
            onKeyDown={(e) => { if (e.key === 'Enter') handleLabelBlur(); }}
            placeholder="Terminal name..."
            className="w-full px-2 py-1 text-xs bg-zinc-900 border border-zinc-600 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500"
          />
        </div>

        {/* Accent Color */}
        <div className="space-y-1">
          <label className="text-[10px] text-zinc-500 uppercase tracking-wide">Accent Color</label>
          <div className="flex items-center gap-1.5">
            {ACCENT_COLORS.map((color) => (
              <button
                key={color.id}
                onClick={() => onSettingsChange({ ...settings, accentColor: color.id })}
                className={`w-5 h-5 rounded-full ${color.class} ${
                  (settings.accentColor || 'default') === color.id
                    ? 'ring-2 ring-white ring-offset-1 ring-offset-zinc-800'
                    : 'hover:scale-110'
                } transition-transform`}
                title={color.label}
              />
            ))}
          </div>
        </div>

        {/* Output Filters */}
        <div className="space-y-1">
          <label className="text-[10px] text-zinc-500 uppercase tracking-wide">Show in Output</label>
          <div className="space-y-1">
            <label className="flex items-center gap-2 cursor-pointer hover:bg-zinc-700/50 px-1 py-0.5 rounded">
              <input
                type="checkbox"
                checked={settings.showThinking !== false}
                onChange={() => toggleSetting('showThinking')}
                className="w-3 h-3 rounded border-zinc-600 bg-zinc-900 text-violet-500 focus:ring-violet-500 focus:ring-offset-0"
              />
              <span className="text-xs text-zinc-300">Thinking</span>
              <Brain className="w-3 h-3 text-violet-400 ml-auto" />
            </label>
            <label className="flex items-center gap-2 cursor-pointer hover:bg-zinc-700/50 px-1 py-0.5 rounded">
              <input
                type="checkbox"
                checked={settings.showToolCalls !== false}
                onChange={() => toggleSetting('showToolCalls')}
                className="w-3 h-3 rounded border-zinc-600 bg-zinc-900 text-violet-500 focus:ring-violet-500 focus:ring-offset-0"
              />
              <span className="text-xs text-zinc-300">Tool Calls</span>
              <ArrowRight className="w-3 h-3 text-amber-400 ml-auto" />
            </label>
            <label className="flex items-center gap-2 cursor-pointer hover:bg-zinc-700/50 px-1 py-0.5 rounded">
              <input
                type="checkbox"
                checked={settings.showToolResults !== false}
                onChange={() => toggleSetting('showToolResults')}
                className="w-3 h-3 rounded border-zinc-600 bg-zinc-900 text-violet-500 focus:ring-violet-500 focus:ring-offset-0"
              />
              <span className="text-xs text-zinc-300">Tool Results</span>
              <Check className="w-3 h-3 text-zinc-400 ml-auto" />
            </label>
            <label className="flex items-center gap-2 cursor-pointer hover:bg-zinc-700/50 px-1 py-0.5 rounded">
              <input
                type="checkbox"
                checked={settings.showTimestamps !== false}
                onChange={() => toggleSetting('showTimestamps')}
                className="w-3 h-3 rounded border-zinc-600 bg-zinc-900 text-violet-500 focus:ring-violet-500 focus:ring-offset-0"
              />
              <span className="text-xs text-zinc-300">Timestamps</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// TERMINAL CONTEXT MENU
// ============================================================================

interface ContextMenuPosition {
  x: number;
  y: number;
}

function TerminalContextMenu({
  position,
  onClose,
  onMaximize,
  onMinimize,
  onCloseTerminal,
  onClear,
  onSettings,
  onSplitRight,
  onSplitBelow,
}: {
  position: ContextMenuPosition;
  onClose: () => void;
  onMaximize?: () => void;
  onMinimize?: () => void;
  onCloseTerminal?: () => void;
  onClear?: () => void;
  onSettings?: () => void;
  onSplitRight?: () => void;
  onSplitBelow?: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Adjust position if menu would go off screen
  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    top: position.y,
    left: position.x,
    zIndex: 100,
  };

  return (
    <div
      ref={menuRef}
      style={menuStyle}
      className="bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 min-w-[160px] animate-in fade-in zoom-in-95 duration-100"
    >
      {onMaximize && (
        <button
          onClick={() => { onMaximize(); onClose(); }}
          className="w-full px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
        >
          <Maximize2 className="w-4 h-4 text-green-400" />
          Maximize
        </button>
      )}
      {onMinimize && (
        <button
          onClick={() => { onMinimize(); onClose(); }}
          className="w-full px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
        >
          <Minus className="w-4 h-4 text-yellow-400" />
          Minimize
        </button>
      )}
      {onCloseTerminal && (
        <button
          onClick={() => { onCloseTerminal(); onClose(); }}
          className="w-full px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
        >
          <X className="w-4 h-4 text-red-400" />
          Close
        </button>
      )}
      {(onMaximize || onMinimize || onCloseTerminal) && (onSplitRight || onSplitBelow) && (
        <div className="border-t border-zinc-700 my-1" />
      )}
      {onSplitRight && (
        <button
          onClick={() => { onSplitRight(); onClose(); }}
          className="w-full px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
        >
          <SplitSquareHorizontal className="w-4 h-4 text-blue-400" />
          Split Right
          <span className="ml-auto text-xs text-zinc-500">⌘D</span>
        </button>
      )}
      {onSplitBelow && (
        <button
          onClick={() => { onSplitBelow(); onClose(); }}
          className="w-full px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
        >
          <SplitSquareVertical className="w-4 h-4 text-blue-400" />
          Split Below
          <span className="ml-auto text-xs text-zinc-500">⌘⇧D</span>
        </button>
      )}
      {(onSplitRight || onSplitBelow) && (onClear || onSettings) && (
        <div className="border-t border-zinc-700 my-1" />
      )}
      {onClear && (
        <button
          onClick={() => { onClear(); onClose(); }}
          className="w-full px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
        >
          <TerminalIcon className="w-4 h-4 text-zinc-400" />
          Clear Output
        </button>
      )}
      {onSettings && (
        <button
          onClick={() => { onSettings(); onClose(); }}
          className="w-full px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
        >
          <Settings className="w-4 h-4 text-zinc-400" />
          Settings
        </button>
      )}
    </div>
  );
}

// ============================================================================
// DRAGGABLE PANEL WRAPPER
// ============================================================================

interface DraggablePanelProps {
  panelId: string;
  children: React.ReactNode;
  isDragging?: boolean;
}

function DraggableHandle({ panelId }: { panelId: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: panelId,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`cursor-grab active:cursor-grabbing p-1 rounded hover:bg-zinc-700/50 transition-colors ${
        isDragging ? 'opacity-50' : ''
      }`}
      title="Drag to reorder"
    >
      <GripVertical className="w-3.5 h-3.5 text-zinc-500" />
    </div>
  );
}

function DroppablePanel({ panelId, children, isOver }: { panelId: string; children: React.ReactNode; isOver?: boolean }) {
  const { setNodeRef, isOver: dropping } = useDroppable({
    id: `drop-${panelId}`,
  });

  const showDropIndicator = isOver || dropping;

  return (
    <div
      ref={setNodeRef}
      className={`h-full relative ${showDropIndicator ? 'ring-2 ring-blue-400/50 ring-inset' : ''}`}
    >
      {children}
      {showDropIndicator && (
        <div className="absolute inset-0 bg-blue-500/10 pointer-events-none rounded-lg" />
      )}
    </div>
  );
}

// ============================================================================
// TERMINAL WIDGET
// ============================================================================

function TerminalWidget({
  terminal,
  onClose,
  onMinimize,
  onMaximize,
  onClear,
  onSendMessage,
  onSettingsChange,
  onQueueMessage,
  onClearQueue,
  isHighlighted,
  isFocused,
  onFocus,
  onMouseEnter,
  onMouseLeave,
  isHovered,
  panelId,
  onSplitRight,
  onSplitBelow,
}: {
  terminal: TerminalState;
  onClose?: () => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
  onClear?: () => void;
  onSendMessage: (terminalId: string, message: string, files?: UploadedFile[]) => void;
  onSettingsChange?: (terminalId: string, settings: TerminalSettings) => void;
  onQueueMessage?: (terminalId: string, message: string, files?: UploadedFile[]) => void;
  onClearQueue?: (terminalId: string) => void;
  isHighlighted?: boolean;
  isFocused?: boolean;
  onFocus?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  isHovered?: boolean;
  // Layout split actions
  panelId?: string;
  onSplitRight?: () => void;
  onSplitBelow?: () => void;
}) {
  const outputRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null);

  const settings = { ...DEFAULT_TERMINAL_SETTINGS, ...terminal.settings };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [terminal.lines, autoScroll]);

  const handleSend = (message: string, files?: UploadedFile[]) => {
    onSendMessage(terminal.id, message, files);
  };

  // Filter lines based on settings
  const filteredLines = terminal.lines.filter((line) => {
    if (line.type === 'thinking' && settings.showThinking === false) return false;
    if (line.type === 'tool_call' && settings.showToolCalls === false) return false;
    if (line.type === 'tool_result' && settings.showToolResults === false) return false;
    return true;
  });

  // Get accent color class for border
  const accentColor = ACCENT_COLORS.find(c => c.id === settings.accentColor);
  const hasAccent = accentColor && accentColor.id !== 'default';

  // Determine visual state: highlighted (task hover) > focused > hovered > default
  const getBorderClass = () => {
    if (isHighlighted) return 'border-violet-400/60 terminal-outer-highlight-pulse';
    if (isFocused) return 'border-blue-400/60 ring-1 ring-blue-400/30';
    if (isHovered) return 'border-zinc-600';
    return 'border-zinc-800';
  };

  const getTitleBarClass = () => {
    if (isHighlighted) return 'bg-violet-600/50 border-violet-400/70 terminal-title-highlight-pulse';
    if (isFocused) return 'bg-blue-900/30 border-blue-400/40';
    if (isHovered) return 'bg-zinc-800 border-zinc-700';
    return 'bg-zinc-900 border-zinc-800';
  };

  const displayName = settings.label || terminal.agent.name;

  return (
    <div
      className={`h-full bg-[#0d1117] border rounded-lg flex flex-col overflow-hidden transition-all duration-150 ${getBorderClass()}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onContextMenu={handleContextMenu}
    >
      {/* Context Menu */}
      {contextMenu && (
        <TerminalContextMenu
          position={contextMenu}
          onClose={() => setContextMenu(null)}
          onMaximize={onMaximize}
          onMinimize={onMinimize}
          onCloseTerminal={onClose}
          onClear={onClear}
          onSettings={() => setShowSettings(true)}
          onSplitRight={onSplitRight}
          onSplitBelow={onSplitBelow}
        />
      )}

      {/* Accent color indicator */}
      {hasAccent && (
        <div className={`h-0.5 ${accentColor.class}`} />
      )}

      {/* Title Bar - clicking here sets focus */}
      <div
        className={`flex-shrink-0 px-3 py-2 border-b flex items-center justify-between transition-all duration-150 cursor-pointer ${getTitleBarClass()}`}
        onClick={(e) => { e.stopPropagation(); onFocus?.(); }}
      >
        <div className="flex items-center gap-2">
          {/* Drag handle */}
          {panelId && <DraggableHandle panelId={panelId} />}
          <div className="flex items-center gap-1.5 mr-2">
            <button onClick={onClose} className="group w-3 h-3 rounded-full bg-red-500/80 hover:bg-red-500 flex items-center justify-center">
              <X className="w-2 h-2 text-red-900 opacity-0 group-hover:opacity-100" />
            </button>
            <button onClick={onMinimize} className="group w-3 h-3 rounded-full bg-yellow-500/80 hover:bg-yellow-500 flex items-center justify-center">
              <Minus className="w-2 h-2 text-yellow-900 opacity-0 group-hover:opacity-100" />
            </button>
            <button onClick={onMaximize} className="group w-3 h-3 rounded-full bg-green-500/80 hover:bg-green-500 flex items-center justify-center">
              <Maximize2 className="w-2 h-2 text-green-900 opacity-0 group-hover:opacity-100" />
            </button>
          </div>
          <span className="text-sm">{terminal.agent.icon}</span>
          <span className="text-xs font-medium text-zinc-300">{displayName}</span>
          {settings.label && (
            <span className="text-[10px] text-zinc-600">({terminal.agent.name})</span>
          )}
          {terminal.isStreaming && <Loader2 className="w-3 h-3 text-violet-400 animate-spin" />}
        </div>
        <div className="flex items-center gap-2">
          {terminal.currentTask && (
            <span className="text-[10px] text-zinc-500 truncate max-w-[200px]">{terminal.currentTask}</span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setAutoScroll(!autoScroll); }}
            className={`text-xs px-2 py-0.5 rounded ${
              autoScroll ? 'bg-blue-600/20 text-blue-400' : 'bg-zinc-800 text-zinc-500'
            }`}
          >
            Auto-scroll
          </button>
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); }}
              className="p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 rounded transition-colors"
              title="Terminal Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
            {showSettings && onSettingsChange && (
              <TerminalSettingsPopover
                settings={settings}
                onSettingsChange={(newSettings) => onSettingsChange(terminal.id, newSettings)}
                terminalLabel={settings.label || ''}
                onLabelChange={(label) => onSettingsChange(terminal.id, { ...settings, label: label || undefined })}
                onClose={() => setShowSettings(false)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Output */}
      <div ref={outputRef} className="flex-1 overflow-y-auto p-3 font-mono text-sm space-y-0.5">
        {filteredLines.map((line) => (
          <TerminalLineItem key={line.id} line={line} showTimestamp={settings.showTimestamps !== false} />
        ))}
      </div>

      {/* Input */}
      <div className="flex-shrink-0 p-2 border-t border-zinc-800">
        <ChatInput
          onSend={handleSend}
          placeholder="Send message..."
          disabled={terminal.isStreaming}
          showPrompt={true}
          promptIcon="❯"
          allowQueue={true}
          queuedMessage={terminal.queuedMessage}
          onQueue={onQueueMessage ? (message, files) => onQueueMessage(terminal.id, message, files) : undefined}
          onClearQueue={onClearQueue ? () => onClearQueue(terminal.id) : undefined}
        />
      </div>
    </div>
  );
}

// ============================================================================
// UNIFIED AGENT STATUS WIDGET
// ============================================================================

function UnifiedAgentStatusWidget({
  agents,
  terminals,
  onClose,
  onMinimize,
  onMaximize,
  isFocused,
  isHovered,
  onFocus,
  onMouseEnter,
  onMouseLeave,
  panelId,
}: {
  agents: Agent[];
  terminals: TerminalState[];
  onClose?: () => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
  isFocused?: boolean;
  isHovered?: boolean;
  onFocus?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  panelId?: string;
}) {
  const getTerminalCount = (agentId: string) => terminals.filter(t => t.agent.id === agentId).length;

  const getBorderClass = () => {
    if (isFocused) return 'border-blue-400/60 ring-1 ring-blue-400/30';
    if (isHovered) return 'border-zinc-600';
    return 'border-zinc-800';
  };

  const getHeaderClass = () => {
    if (isFocused) return 'bg-blue-900/30 border-blue-400/40';
    if (isHovered) return 'bg-zinc-800 border-zinc-700';
    return 'border-zinc-800';
  };

  return (
    <div
      className={`h-full bg-zinc-900 border rounded-lg flex flex-col overflow-hidden transition-all duration-150 ${getBorderClass()}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Header - clicking here sets focus */}
      <div
        className={`flex-shrink-0 px-3 py-2 border-b flex items-center justify-between transition-all duration-150 cursor-pointer ${getHeaderClass()}`}
        onClick={(e) => { e.stopPropagation(); onFocus?.(); }}
      >
        <div className="flex items-center gap-2">
          {/* Draggable handle - first */}
          {panelId && <DraggableHandle panelId={panelId} />}
          {/* Window controls - after drag handle */}
          <div className="flex items-center gap-1.5 mr-2">
            {onClose && (
              <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="group w-3 h-3 rounded-full bg-red-500/80 hover:bg-red-500 flex items-center justify-center" title="Close">
                <X className="w-2 h-2 text-red-900 opacity-0 group-hover:opacity-100" />
              </button>
            )}
            {onMinimize && (
              <button onClick={(e) => { e.stopPropagation(); onMinimize(); }} className="group w-3 h-3 rounded-full bg-yellow-500/80 hover:bg-yellow-500 flex items-center justify-center" title="Minimize">
                <Minus className="w-2 h-2 text-yellow-900 opacity-0 group-hover:opacity-100" />
              </button>
            )}
            {onMaximize && (
              <button onClick={(e) => { e.stopPropagation(); onMaximize(); }} className="group w-3 h-3 rounded-full bg-green-500/80 hover:bg-green-500 flex items-center justify-center" title="Maximize">
                <Maximize2 className="w-2 h-2 text-green-900 opacity-0 group-hover:opacity-100" />
              </button>
            )}
          </div>
          <Wifi className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-medium text-zinc-300">Agent Status</span>
          <span className="text-xs text-zinc-600">({agents.length})</span>
        </div>
      </div>

      {/* Agent List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {agents.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center">
            <div>
              <WifiOff className="w-6 h-6 text-zinc-600 mx-auto mb-2" />
              <p className="text-xs text-zinc-500">No agents connected</p>
            </div>
          </div>
        ) : (
          agents.map(agent => {
            const terminalCount = getTerminalCount(agent.id);
            const isBusy = terminals.some(t => t.agent.id === agent.id && t.isStreaming);
            const status = isBusy ? 'busy' : agent.status;

            return (
              <div
                key={agent.id}
                className={`flex items-center justify-between p-2 rounded border ${
                  status === 'busy' ? 'bg-violet-500/10 border-violet-500/30' :
                  status === 'offline' ? 'bg-red-500/5 border-red-500/20' :
                  'bg-zinc-800/50 border-zinc-700/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">{agent.icon}</span>
                  <span className="text-xs font-medium text-zinc-300">{agent.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  {terminalCount > 0 && (
                    <span className="text-[10px] text-zinc-500">
                      {terminalCount} terminal{terminalCount > 1 ? 's' : ''}
                    </span>
                  )}
                  <div className="flex items-center gap-1">
                    <div className={`w-2 h-2 rounded-full ${
                      status === 'busy' ? 'bg-violet-400 animate-pulse' :
                      status === 'offline' ? 'bg-red-400' :
                      'bg-emerald-400'
                    }`} />
                    <span className="text-[10px] text-zinc-500 capitalize">{status}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ============================================================================
// TASKS WIDGET
// ============================================================================

/** Terminal summary for Run submenu */
interface TerminalOption {
  id: string;
  label: string;
  agentIcon: string;
}

function TasksWidget({
  steps,
  agents,
  terminals,
  highlightedTerminalId,
  onExecute,
  isExecuting,
  onStepAgentChange,
  onSendStepToTerminal,
  onTerminalOptionHover,
  onMenuClose,
  onAddStep,
  onClose,
  onMaximize,
  isFocused,
  isHovered,
  onFocus,
  onMouseEnter,
  onMouseLeave,
  panelId,
}: {
  steps: PlanStep[];
  agents: Agent[];
  terminals: TerminalOption[];
  highlightedTerminalId?: string | null;
  onExecute: () => void;
  isExecuting: boolean;
  onStepAgentChange: (stepId: string, agentId: string | null) => void;
  onSendStepToTerminal: (step: PlanStep, terminalId?: string) => void;
  onTerminalOptionHover?: (terminalId: string | null) => void;
  onMenuClose?: () => void;
  onAddStep?: (text: string, agentId: string | null) => void;
  onClose?: () => void;
  onMaximize?: () => void;
  isFocused?: boolean;
  isHovered?: boolean;
  onFocus?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  panelId?: string;
}) {
  const [editingStep, setEditingStep] = useState<string | null>(null);
  const [stepMenuOpen, setStepMenuOpen] = useState<string | null>(null);
  const [runSubmenuStepId, setRunSubmenuStepId] = useState<string | null>(null);
  const [showAddInput, setShowAddInput] = useState(false);
  const [newTaskText, setNewTaskText] = useState('');
  const [newTaskAgent, setNewTaskAgent] = useState<string | null>(null);
  const stepMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeMenu = (e: MouseEvent) => {
      if (stepMenuRef.current && !stepMenuRef.current.contains(e.target as Node)) {
        setStepMenuOpen(null);
        setRunSubmenuStepId(null);
        onMenuClose?.();
      }
    };
    if (stepMenuOpen) {
      document.addEventListener('mousedown', closeMenu);
      return () => document.removeEventListener('mousedown', closeMenu);
    }
  }, [stepMenuOpen, onMenuClose]);

  const handleAddStep = () => {
    if (newTaskText.trim() && onAddStep) {
      onAddStep(newTaskText.trim(), newTaskAgent);
      setNewTaskText('');
      setNewTaskAgent(null);
      setShowAddInput(false);
    }
  };

  // Determine visual state for tasks widget
  const getBorderClass = () => {
    if (isFocused) return 'border-blue-400/60 ring-1 ring-blue-400/30';
    if (isHovered) return 'border-zinc-600';
    return 'border-zinc-800';
  };

  const getHeaderClass = () => {
    if (isFocused) return 'bg-blue-900/30 border-blue-400/40';
    if (isHovered) return 'bg-zinc-800 border-zinc-700';
    return 'border-zinc-800';
  };

  return (
    <div
      className={`h-full bg-zinc-900 border rounded-lg flex flex-col overflow-hidden transition-all duration-150 ${getBorderClass()}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Header - clicking here sets focus */}
      <div
        className={`flex-shrink-0 px-3 py-2 border-b flex items-center justify-between gap-2 transition-all duration-150 cursor-pointer ${getHeaderClass()}`}
        onClick={(e) => { e.stopPropagation(); onFocus?.(); }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {/* Draggable handle - first */}
          {panelId && <DraggableHandle panelId={panelId} />}
          {/* Window controls - after drag handle (close and maximize only, no minimize) */}
          <div className="flex items-center gap-1.5 mr-2">
            {onClose && (
              <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="group w-3 h-3 rounded-full bg-red-500/80 hover:bg-red-500 flex items-center justify-center" title="Close">
                <X className="w-2 h-2 text-red-900 opacity-0 group-hover:opacity-100" />
              </button>
            )}
            {onMaximize && (
              <button onClick={(e) => { e.stopPropagation(); onMaximize(); }} className="group w-3 h-3 rounded-full bg-green-500/80 hover:bg-green-500 flex items-center justify-center" title="Maximize">
                <Maximize2 className="w-2 h-2 text-green-900 opacity-0 group-hover:opacity-100" />
              </button>
            )}
          </div>
          <Sparkles className="w-4 h-4 text-violet-400 flex-shrink-0" />
          <span className="text-sm font-medium truncate">Tasks</span>
          <span className="text-xs text-zinc-600 flex-shrink-0">({steps.length})</span>
        </div>
        {onAddStep && (
          <button
            onClick={() => setShowAddInput(true)}
            className="flex-shrink-0 flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-violet-400 hover:bg-zinc-800 rounded transition-colors"
            title="Add task"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add task</span>
          </button>
        )}
      </div>

      {showAddInput && onAddStep && (
        <div className="flex-shrink-0 p-2 border-b border-zinc-800 space-y-1.5">
          <input
            type="text"
            value={newTaskText}
            onChange={(e) => setNewTaskText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddStep(); }
              if (e.key === 'Escape') { setShowAddInput(false); setNewTaskText(''); }
            }}
            placeholder="Task description..."
            className="w-full px-2 py-1 text-xs bg-zinc-800 border border-zinc-600 rounded text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-violet-500"
            autoFocus
          />
          <div className="flex items-center gap-1">
            <select
              value={newTaskAgent ?? ''}
              onChange={(e) => setNewTaskAgent(e.target.value || null)}
              className="text-[10px] bg-zinc-800 border border-zinc-600 rounded px-1 py-0.5"
            >
              <option value="">Unassigned</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button onClick={handleAddStep} className="text-[10px] text-violet-400 hover:text-violet-300 px-1.5">Add</button>
            <button onClick={() => { setShowAddInput(false); setNewTaskText(''); }} className="text-[10px] text-zinc-500 hover:text-zinc-300">Cancel</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {steps.length === 0 ? (
          <div className="h-full flex items-center justify-center text-zinc-600 text-sm">
            No tasks yet. Add tasks manually or send a message to track the current step.
          </div>
        ) : (
          steps.map((step, idx) => {
            const stepHoverLines = [
              `Agent: ${step.agent ? (agents.find(a => a.id === step.agent)?.name ?? step.agent) : 'Unassigned'}`,
              step.costUsd != null ? `Cost: $${step.costUsd.toFixed(4)}` : null,
              step.durationMs != null ? `Duration: ${(step.durationMs / 1000).toFixed(1)}s` : null,
              `Source: ${step.source === 'extracted' ? 'Terminal' : step.source === 'manual' ? 'Manual' : step.source === 'plan' ? 'Plan' : 'Plan'}`,
            ].filter(Boolean);
            return (
            <div
              key={step.id}
              title={stepHoverLines.join('\n')}
              className={`flex items-start gap-2 p-2 rounded border ${
                step.status === 'running' ? 'bg-violet-500/10 border-violet-500/30' :
                step.status === 'completed' ? 'bg-emerald-500/10 border-emerald-500/30' :
                step.status === 'failed' ? 'bg-red-500/10 border-red-500/30' : 'bg-zinc-800/50 border-zinc-700/50'
              }`}
            >
              <span className="text-xs text-zinc-500 w-5">{idx + 1}.</span>
              <div className="flex-1 min-w-0">
                <PlanStepText text={step.text} />
                <div className="flex items-center gap-2 mt-1">
                  {editingStep === step.id ? (
                    <select
                      value={step.agent ?? ''}
                      onChange={(e) => { onStepAgentChange(step.id, e.target.value || null); setEditingStep(null); }}
                      onBlur={() => setEditingStep(null)}
                      autoFocus
                      className="text-[10px] bg-zinc-800 border border-zinc-600 rounded px-1 py-0.5"
                    >
                      <option value="">Unassigned</option>
                      {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  ) : (
                    <button onClick={() => setEditingStep(step.id)} className="text-[10px] text-zinc-500 hover:text-zinc-300">
                      {step.agent ? (agents.find(a => a.id === step.agent)?.name ?? step.agent) : 'Unassigned'}
                    </button>
                  )}
                </div>
              </div>
              <div className="relative flex items-center gap-0.5 shrink-0" ref={stepMenuOpen === step.id ? stepMenuRef : undefined}>
                {step.status === 'running' && <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin" />}
                {step.status === 'completed' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                {step.status === 'failed' && <X className="w-3.5 h-3.5 text-red-400" />}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const closing = stepMenuOpen === step.id;
                    setStepMenuOpen(closing ? null : step.id);
                    if (closing) onMenuClose?.();
                    setRunSubmenuStepId(null);
                  }}
                  className="p-1 text-zinc-500 hover:text-zinc-300 rounded"
                  title="Task actions"
                >
                  <MoreVertical className="w-3.5 h-3.5" />
                </button>
                {stepMenuOpen === step.id && (
                  <div className="absolute top-full right-0 mt-0.5 py-1 bg-zinc-800 border border-zinc-700 rounded shadow-lg z-10 min-w-[200px]">
                    {runSubmenuStepId === step.id ? (
                      <>
                        <button
                          onClick={() => { setRunSubmenuStepId(null); onTerminalOptionHover?.(null); }}
                          className="w-full px-3 py-1.5 text-left text-xs text-zinc-400 hover:bg-zinc-700 flex items-center gap-2"
                        >
                          <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
                          Back
                        </button>
                        <div className="border-t border-zinc-700 my-0.5" />
                        <button
                          onClick={() => {
                            onSendStepToTerminal(step);
                            setStepMenuOpen(null);
                            setRunSubmenuStepId(null);
                            onTerminalOptionHover?.(null);
                          }}
                          className="w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
                        >
                          <Plus className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                          New terminal
                        </button>
                        {terminals.map((t) => (
                          <button
                            key={t.id}
                            onClick={() => {
                              onSendStepToTerminal(step, t.id);
                              setStepMenuOpen(null);
                              setRunSubmenuStepId(null);
                              onTerminalOptionHover?.(null);
                            }}
                            onMouseEnter={() => onTerminalOptionHover?.(t.id)}
                            onMouseLeave={() => onTerminalOptionHover?.(null)}
                            onFocus={() => onTerminalOptionHover?.(t.id)}
                            onBlur={() => onTerminalOptionHover?.(null)}
                            className={`w-full px-3 py-1.5 text-left text-xs text-zinc-300 flex items-center gap-2 transition-colors ${
                              highlightedTerminalId === t.id
                                ? 'bg-violet-500/20 text-violet-200'
                                : 'hover:bg-zinc-700'
                            }`}
                          >
                            <span className="shrink-0">{t.agentIcon}</span>
                            <span className="truncate">{t.label}</span>
                          </button>
                        ))}
                      </>
                    ) : (
                      <button
                        onClick={() => setRunSubmenuStepId(step.id)}
                        className="w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700 flex items-center justify-between gap-2"
                      >
                        <span className="flex items-center gap-2">
                          <TerminalIcon className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                          Run
                        </span>
                        <ChevronRight className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            );
          })
        )}
      </div>

      <div className="flex-shrink-0 p-2 border-t border-zinc-800">
        <button
          onClick={onExecute}
          disabled={isExecuting || steps.length === 0 || !steps.some(s => s.agent)}
          className="w-full px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-lg text-xs font-medium flex items-center justify-center gap-2"
        >
          {isExecuting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Executing...</> : <><Play className="w-3.5 h-3.5" /> Run tasks</>}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// LAYOUT RENDERER (Recursive component for flexible grid layout)
// ============================================================================

interface LayoutRendererProps {
  node: LayoutNode;
  terminals: TerminalState[];
  agents: Agent[];
  planSteps: PlanStep[];
  minimizedWidgets: MinimizedWidget[];
  // Focus/hover state
  focusedWidgetId: string | null;
  hoveredWidgetId: string | null;
  highlightedTerminalId: string | null;
  maximizedWidgetId: string | null;
  // Drag state
  activeDragId: string | null;
  overDropId: string | null;
  // Callbacks
  onFocusWidget: (id: string, type: 'terminal' | 'tasks' | 'agent-status') => void;
  onHoverWidget: (id: string | null) => void;
  onCloseTerminal: (id: string) => void;
  onMinimizeTerminal: (terminal: TerminalState) => void;
  onMaximizeTerminal: (id: string) => void;
  onClearTerminal: (id: string) => void;
  onSendMessage: (terminalId: string, message: string, files?: UploadedFile[]) => void;
  onSettingsChange: (terminalId: string, settings: TerminalSettings) => void;
  onQueueMessage: (terminalId: string, message: string, files?: UploadedFile[]) => void;
  onClearQueue: (terminalId: string) => void;
  // Tasks widget props
  onExecute: () => void;
  isExecuting: boolean;
  onStepAgentChange: (stepId: string, agentId: string | null) => void;
  onSendStepToTerminal: (step: PlanStep, terminalId?: string) => void;
  onTerminalOptionHover: (id: string | null) => void;
  onAddStep: (text: string, agentId: string | null) => void;
  // Tasks visibility (controlled from command palette)
  tasksVisible: boolean;
  // Agent status
  showAgentStatus: boolean;
  onCloseAgentStatus: () => void;
  // Split actions
  onSplitPanel: (panelId: string, direction: 'horizontal' | 'vertical') => void;
  // Layout size updates
  onUpdateSizes: (groupId: string, sizes: number[]) => void;
  // Close panel from layout
  onClosePanel: (panelId: string) => void;
}

function LayoutRenderer({
  node,
  terminals,
  agents,
  planSteps,
  minimizedWidgets,
  focusedWidgetId,
  hoveredWidgetId,
  highlightedTerminalId,
  maximizedWidgetId,
  activeDragId,
  overDropId,
  onFocusWidget,
  onHoverWidget,
  onCloseTerminal,
  onMinimizeTerminal,
  onMaximizeTerminal,
  onClearTerminal,
  onSendMessage,
  onSettingsChange,
  onQueueMessage,
  onClearQueue,
  onExecute,
  isExecuting,
  onStepAgentChange,
  onSendStepToTerminal,
  onTerminalOptionHover,
  onAddStep,
  tasksVisible,
  showAgentStatus,
  onCloseAgentStatus,
  onSplitPanel,
  onUpdateSizes,
  onClosePanel,
}: LayoutRendererProps) {
  const panelGroupRef = useRef<ImperativePanelGroupHandle>(null);

  // Render a leaf node (actual widget)
  if (node.type === 'leaf') {
    const { widgetType, widgetId } = node;

    if (widgetType === 'terminal') {
      const terminal = terminals.find(t => t.id === widgetId);
      if (!terminal) {
        // Terminal might have been closed - show placeholder
        return (
          <div className="h-full flex items-center justify-center bg-zinc-900 border border-zinc-800 rounded-lg">
            <div className="text-center text-zinc-600">
              <TerminalIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-xs">Terminal not found</p>
            </div>
          </div>
        );
      }

      const isDropTarget = overDropId === `drop-${node.id}` && activeDragId !== node.id;

      return (
        <DroppablePanel panelId={node.id} isOver={isDropTarget}>
          <div className="h-full p-1">
            <TerminalWidget
              terminal={terminal}
              onClose={() => onCloseTerminal(terminal.id)}
              onMinimize={() => onMinimizeTerminal(terminal)}
              onMaximize={() => onMaximizeTerminal(terminal.id)}
              onClear={() => onClearTerminal(terminal.id)}
              onSendMessage={onSendMessage}
              onSettingsChange={onSettingsChange}
              onQueueMessage={onQueueMessage}
              onClearQueue={onClearQueue}
              isHighlighted={highlightedTerminalId === terminal.id}
              isFocused={focusedWidgetId === terminal.id}
              isHovered={hoveredWidgetId === terminal.id}
              onFocus={() => onFocusWidget(terminal.id, 'terminal')}
              onMouseEnter={() => onHoverWidget(terminal.id)}
              onMouseLeave={() => onHoverWidget(null)}
              panelId={node.id}
              onSplitRight={() => onSplitPanel(node.id, 'horizontal')}
              onSplitBelow={() => onSplitPanel(node.id, 'vertical')}
            />
          </div>
        </DroppablePanel>
      );
    }

    if (widgetType === 'tasks') {
      // Don't render if tasks are hidden
      if (!tasksVisible) {
        return null;
      }

      const isDropTarget = overDropId === `drop-${node.id}` && activeDragId !== node.id;

      return (
        <DroppablePanel panelId={node.id} isOver={isDropTarget}>
          <div className="h-full p-1">
            <TasksWidget
              steps={planSteps}
              agents={agents}
              terminals={[
                ...terminals.map((t) => {
                  const sameAgent = terminals.filter(x => x.agent.id === t.agent.id);
                  const idx = sameAgent.findIndex(x => x.id === t.id) + 1;
                  const suffix = sameAgent.length > 1 ? ` — ${idx}` : '';
                  return {
                    id: t.id,
                    label: `${t.agent.name}${suffix}`,
                    agentIcon: t.agent.icon,
                  };
                }),
                ...minimizedWidgets
                  .filter((w): w is MinimizedWidget & { type: 'terminal'; data: TerminalState } => w.type === 'terminal' && !!w.data)
                  .map((w) => ({
                    id: w.id,
                    label: `${w.title} (minimized)`,
                    agentIcon: w.icon,
                  })),
              ]}
              highlightedTerminalId={highlightedTerminalId}
              onExecute={onExecute}
              isExecuting={isExecuting}
              onStepAgentChange={onStepAgentChange}
              onSendStepToTerminal={onSendStepToTerminal}
              onTerminalOptionHover={onTerminalOptionHover}
              onMenuClose={() => onTerminalOptionHover(null)}
              onAddStep={onAddStep}
              onClose={() => useWorkspaceStore.getState().setTasksVisible(false)}
              onMaximize={() => onMaximizeTerminal('tasks-widget')}
              isFocused={focusedWidgetId === 'tasks-widget'}
              isHovered={hoveredWidgetId === 'tasks-widget'}
              onFocus={() => onFocusWidget('tasks-widget', 'tasks')}
              onMouseEnter={() => onHoverWidget('tasks-widget')}
              onMouseLeave={() => onHoverWidget(null)}
              panelId={node.id}
            />
          </div>
        </DroppablePanel>
      );
    }

    if (widgetType === 'agent-status') {
      if (!showAgentStatus) {
        // Agent status is hidden - don't render
        return null;
      }

      const isDropTarget = overDropId === `drop-${node.id}` && activeDragId !== node.id;

      return (
        <DroppablePanel panelId={node.id} isOver={isDropTarget}>
          <div className="h-full p-1">
            <UnifiedAgentStatusWidget
              agents={agents}
              terminals={terminals}
              onClose={() => useWorkspaceStore.getState().setShowAgentStatus(false)}
              onMaximize={() => onMaximizeTerminal('agent-status-widget')}
              isFocused={focusedWidgetId === 'agent-status-widget'}
              isHovered={hoveredWidgetId === 'agent-status-widget'}
              onFocus={() => onFocusWidget('agent-status-widget', 'agent-status')}
              onMouseEnter={() => onHoverWidget('agent-status-widget')}
              onMouseLeave={() => onHoverWidget(null)}
              panelId={node.id}
            />
          </div>
        </DroppablePanel>
      );
    }

    return null;
  }

  // Render a group node (nested PanelGroup)
  const handleLayoutChange = (sizes: number[]) => {
    onUpdateSizes(node.id, sizes);
  };

  return (
    <PanelGroup
      ref={panelGroupRef}
      direction={node.direction}
      onLayout={handleLayoutChange}
    >
      {node.children.map((child, index) => (
        <Fragment key={child.id}>
          <Panel
            id={child.id}
            defaultSize={node.sizes[index]}
            minSize={10}
            order={index}
          >
            <LayoutRenderer
              node={child}
              terminals={terminals}
              agents={agents}
              planSteps={planSteps}
              minimizedWidgets={minimizedWidgets}
              focusedWidgetId={focusedWidgetId}
              hoveredWidgetId={hoveredWidgetId}
              highlightedTerminalId={highlightedTerminalId}
              maximizedWidgetId={maximizedWidgetId}
              activeDragId={activeDragId}
              overDropId={overDropId}
              onFocusWidget={onFocusWidget}
              onHoverWidget={onHoverWidget}
              onCloseTerminal={onCloseTerminal}
              onMinimizeTerminal={onMinimizeTerminal}
              onMaximizeTerminal={onMaximizeTerminal}
              onClearTerminal={onClearTerminal}
              onSendMessage={onSendMessage}
              onSettingsChange={onSettingsChange}
              onQueueMessage={onQueueMessage}
              onClearQueue={onClearQueue}
              onExecute={onExecute}
              isExecuting={isExecuting}
              onStepAgentChange={onStepAgentChange}
              onSendStepToTerminal={onSendStepToTerminal}
              onTerminalOptionHover={onTerminalOptionHover}
              onAddStep={onAddStep}
              tasksVisible={tasksVisible}
              showAgentStatus={showAgentStatus}
              onCloseAgentStatus={onCloseAgentStatus}
              onSplitPanel={onSplitPanel}
              onUpdateSizes={onUpdateSizes}
              onClosePanel={onClosePanel}
            />
          </Panel>
          {index < node.children.length - 1 && (
            <PanelResizeHandle
              className={node.direction === 'horizontal' ? 'w-1 bg-zinc-800 hover:bg-zinc-600 transition-colors' : 'h-1 bg-zinc-800 hover:bg-zinc-600 transition-colors'}
            />
          )}
        </Fragment>
      ))}
    </PanelGroup>
  );
}

// ============================================================================
// MAIN WORKSPACE
// ============================================================================

export function Workspace() {
  // Workspace state
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const pathInputRef = useRef<HTMLInputElement>(null);

  // Agents state
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);

  // Terminals state
  const [terminals, setTerminals] = useState<TerminalState[]>([]);
  const [minimizedWidgets, setMinimizedWidgets] = useState<MinimizedWidget[]>([]);
  const [highlightedTerminalId, setHighlightedTerminalId] = useState<string | null>(null);

  // Focus and hover state
  const [hoveredWidgetId, setHoveredWidgetId] = useState<string | null>(null);
  const focusedWidgetId = useWorkspaceStore(state => state.focusedWidgetId);
  const maximizedWidgetId = useWorkspaceStore(state => state.maximizedWidgetId);
  const showAgentStatus = useWorkspaceStore(state => state.showAgentStatus);
  const layoutTree = useWorkspaceStore(state => state.layoutTree);

  // Layout mode toggle (for backwards compatibility during transition)
  const [useFlexibleLayout, setUseFlexibleLayout] = useState(true);

  // Drag-and-drop state for panel reordering
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overDropId, setOverDropId] = useState<string | null>(null);

  // DnD sensors with pointer activation
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before starting drag
      },
    })
  );

  // Tasks state
  const [planSteps, setPlanSteps] = useState<PlanStep[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const tasksVisible = useWorkspaceStore(state => state.tasksVisible);

  // Add menu state
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showAgentsPanel, setShowAgentsPanel] = useState(false);
  const [showTerminalAgentMenu, setShowTerminalAgentMenu] = useState(false);
  const [showEmptyStateAgentMenu, setShowEmptyStateAgentMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // WebSocket ref
  const wsRef = useRef<WebSocket | null>(null);
  const terminalsRef = useRef<TerminalState[]>(terminals);
  terminalsRef.current = terminals;
  /** Map threadId → terminalId for immediate lookup (avoids React state race condition) */
  const threadToTerminalRef = useRef<Record<string, string>>({});
  /** Accumulate tool input JSON per block index (for input_json_delta) */
  const toolInputByBlockRef = useRef<Record<number, string>>({});

  // Fetch agents on mount
  const fetchAgents = useCallback(async () => {
    setIsLoadingAgents(true);
    try {
      // Check Claude Code
      const ccStatus = await api.checkClaudeCode();
      
      // Fetch OpenClaw agents
      const res = await fetch(`${getApiUrl()}/agents`);
      const data = await res.json();
      const openclawAgents = (data.agents || []).map((a: any) => ({
        id: a.name,
        name: a.name,
        status: a.status || 'ready',
        icon: getAgentIcon({ type: 'openclaw', name: a.name }),
        type: 'openclaw' as const,
      }));

      const allAgents: Agent[] = [];
      
      if (ccStatus.available) {
        allAgents.push({
          id: 'claude-code-local', // Must match adapter ID on server
          name: 'Claude Code',
          status: 'ready',
          icon: '🖥️',
          type: 'claude-code',
        });
      }
      
      allAgents.push(...openclawAgents);
      setAgents(allAgents);
    } catch (err) {
      console.error('Failed to fetch agents:', err);
    } finally {
      setIsLoadingAgents(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 10000);
    return () => clearInterval(interval);
  }, [fetchAgents]);

  // Refs for callback registration (to avoid dependency issues)
  const handleNewTerminalRef = useRef<(agentId: string) => void>(() => {});
  const handleAddStepRef = useRef<(text: string, agentId: string | null) => void>(() => {});
  const handleTerminalMessageRef = useRef<(terminalId: string, message: string, files?: UploadedFile[]) => void>(() => {});

  // Sync workspace store with local state for command palette integration
  // Use getState() to avoid including the store in dependencies and causing infinite loops
  useEffect(() => {
    useWorkspaceStore.getState().setAgents(agents.map(a => ({
      id: a.id,
      name: a.name,
      status: a.status,
      icon: a.icon,
      type: a.type,
    })));
  }, [agents]);

  // Sync terminals to workspace store (for display in command palette)
  useEffect(() => {
    useWorkspaceStore.getState().setTerminals(terminals.map(t => ({
      id: t.id,
      agentId: t.agent.id,
      agentName: t.agent.name,
    })));
  }, [terminals]);

  // Sync workspace path
  useEffect(() => {
    useWorkspaceStore.getState().setWorkspacePath(workspacePath);
  }, [workspacePath]);

  // Register terminal creation callback for command palette (once on mount)
  useEffect(() => {
    useWorkspaceStore.getState().registerTerminalCallback((agentId: string) => {
      handleNewTerminalRef.current(agentId);
    });
  }, []);

  // Register task creation callback for command palette (once on mount)
  useEffect(() => {
    useWorkspaceStore.getState().registerTaskCallback((text: string, agentId: string | null) => {
      handleAddStepRef.current(text, agentId);
    });
  }, []);

  // Register terminal action callbacks for command palette
  useEffect(() => {
    useWorkspaceStore.getState().registerTerminalActionCallbacks({
      onClose: (terminalId: string) => handleCloseTerminal(terminalId),
      onMinimize: (terminalId: string) => {
        const terminal = terminalsRef.current.find(t => t.id === terminalId);
        if (terminal) handleMinimizeTerminal(terminal);
      },
      onMaximize: (terminalId: string) => handleMaximizeTerminal(terminalId),
      onRestore: (terminalId: string) => {
        useWorkspaceStore.getState().setMaximizedWidget(null);
      },
      onClear: (terminalId: string) => handleClearTerminal(terminalId),
    });
  }, []);

  // Sync widgets to workspace store for arrow key navigation
  useEffect(() => {
    const widgets: Array<{ id: string; type: 'terminal' | 'tasks' | 'agent-status' }> = [];

    // Add terminals
    terminals.forEach(t => {
      widgets.push({ id: t.id, type: 'terminal' });
    });

    // Add tasks widget if visible
    if (tasksVisible) {
      widgets.push({ id: 'tasks-widget', type: 'tasks' });
    }

    // Add agent status if visible
    if (showAgentStatus) {
      widgets.push({ id: 'agent-status-widget', type: 'agent-status' });
    }

    useWorkspaceStore.getState().setWidgets(widgets);
  }, [terminals, tasksVisible, showAgentStatus]);

  // Initialize/update layout tree when terminals change
  useEffect(() => {
    if (!useFlexibleLayout) return;

    const currentLayout = useWorkspaceStore.getState().layoutTree;
    const terminalIds = terminals.map(t => t.id);

    // If no layout yet, create default layout
    if (!currentLayout) {
      if (terminalIds.length > 0) {
        const newLayout = layoutHelpers.createDefaultLayout(terminalIds, showAgentStatus);
        useWorkspaceStore.getState().setLayoutTree(newLayout);
      }
      return;
    }

    // Check if any terminals in layout no longer exist (were closed)
    // The closePanelInLayout action handles this in response to terminal close
    // But we should also handle the case where terminals were added outside of split
    const layoutTerminalIds = collectTerminalIds(currentLayout);
    const newTerminalIds = terminalIds.filter(id => !layoutTerminalIds.includes(id));

    if (newTerminalIds.length > 0) {
      // New terminals were added (e.g., via "New Terminal" button)
      // Add them to the layout in the default position (left column)
      let updatedLayout = currentLayout;
      for (const newId of newTerminalIds) {
        updatedLayout = addTerminalToLayout(updatedLayout, newId);
      }
      useWorkspaceStore.getState().setLayoutTree(updatedLayout);
    }
  }, [terminals, useFlexibleLayout, showAgentStatus]);

  // Auto-save layout when it changes
  useEffect(() => {
    if (layoutTree && useFlexibleLayout) {
      useWorkspaceStore.getState().saveLayout();
    }
  }, [layoutTree, useFlexibleLayout]);

  // Helper to collect all terminal IDs from a layout tree
  const collectTerminalIds = (node: LayoutNode): string[] => {
    if (node.type === 'leaf') {
      return node.widgetType === 'terminal' ? [node.widgetId] : [];
    }
    return node.children.flatMap(collectTerminalIds);
  };

  // Helper to add a terminal to the layout (adds to first vertical group or creates one)
  const addTerminalToLayout = (tree: LayoutNode, terminalId: string): LayoutNode => {
    const newLeaf: LayoutLeaf = {
      type: 'leaf',
      id: layoutHelpers.generateLayoutId(),
      widgetType: 'terminal',
      widgetId: terminalId,
    };

    if (tree.type === 'leaf') {
      // Convert single leaf to vertical group
      return {
        type: 'group',
        id: layoutHelpers.generateLayoutId(),
        direction: 'vertical',
        children: [tree, newLeaf],
        sizes: [50, 50],
      };
    }

    // Find the first vertical group containing terminals and add there
    if (tree.direction === 'vertical') {
      const hasTerminal = tree.children.some(c => c.type === 'leaf' && c.widgetType === 'terminal');
      if (hasTerminal) {
        const newSizes = tree.children.map(() => 100 / (tree.children.length + 1));
        newSizes.push(100 / (tree.children.length + 1));
        return {
          ...tree,
          children: [...tree.children, newLeaf],
          sizes: newSizes,
        };
      }
    }

    // For horizontal groups, try to add to the first child recursively
    if (tree.children.length > 0) {
      const firstChild = tree.children[0];
      const updatedFirst = addTerminalToLayout(firstChild, terminalId);
      return {
        ...tree,
        children: [updatedFirst, ...tree.children.slice(1)],
      };
    }

    return tree;
  };

  // Close add menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
        setShowTerminalAgentMenu(false);
      }
    };
    if (showAddMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showAddMenu]);

  const handleWsEvent = useCallback((data: any) => {
    if (data.type !== 'event') return;
    const event = data.event;
    if (!event) return;

    // Server-authoritative task list (extractor + task store)
    if (event.type === 'tasks.updated' && Array.isArray(event.payload)) {
      const tasks = event.payload as Array<{ id: string; text: string; status: string; threadId?: string; agentName?: string }>;
      const steps: PlanStep[] = tasks.map((t) => ({
        id: t.id,
        text: t.text,
        agent: t.agentName ?? null,
        status: t.status === 'doing' ? 'running' : t.status === 'completed' ? 'completed' : 'pending',
        source: 'extracted',
        threadId: t.threadId,
      }));
      setPlanSteps(prev => {
        const manual = prev.filter(s => s.source === 'manual' || s.source === 'plan');
        return [...steps, ...manual];
      });
      return;
    }

    // Support both adapterId (legacy) and threadId (Phase 2/3)
    const adapterId = event.adapterId;
    const threadId = event.threadId;
    
    // For thread events, find terminal by threadId
    const findTerminal = (terminals: TerminalState[]) => {
      if (threadId) {
        return terminals.find(t => t.threadId === threadId);
      }
      if (adapterId) {
        return terminals.find(t => t.agent.id === adapterId);
      }
      return null;
    };

    const matchesTerminal = (t: TerminalState) => {
      if (threadId) {
        // Check direct match or ref-based mapping (handles React state race condition)
        if (t.threadId === threadId) return true;
        const mappedTerminalId = threadToTerminalRef.current[threadId];
        if (mappedTerminalId && t.id === mappedTerminalId) return true;
        return false;
      }
      if (adapterId) return t.agent.id === adapterId;
      return false;
    };

    if (!adapterId && !threadId) return;

    console.log('[WS Event]', event.type, { adapterId, threadId }, event.payload);

    // Handle session.message (raw SDK events from thread)
    if (event.type === 'session.message' && event.payload) {
      const msg = event.payload;
      
      // Process SDK message types for thread sessions
      if (msg.type === 'stream_event') {
        const streamEvent = msg.event;
        const blockIndex = streamEvent?.index;

        // content_block_start: thinking or tool_use → add terminal line
        if (streamEvent?.type === 'content_block_start') {
          const block = streamEvent.content_block;
          const blockType = block?.type;
          const eventId = msg.uuid ?? crypto.randomUUID();
          const blockId = block?.id ?? eventId;

          if (blockType === 'thinking') {
            const line: TerminalLine = {
              id: `thinking-${blockId}`,
              type: 'thinking',
              content: 'Thinking...',
              timestamp: makeTimestamp(),
              isStreaming: true,
            };
            setTerminals(prev => prev.map(t =>
              matchesTerminal(t) ? { ...t, lines: [...t.lines, line], isStreaming: true } : t
            ));
          } else if (blockType === 'tool_use' || blockType === 'server_tool_use') {
            const toolName = block?.name ?? 'Tool';
            const idx = blockIndex ?? 0;
            toolInputByBlockRef.current[idx] = '';
            const line: TerminalLine = {
              id: `tool-${blockId}`,
              type: 'tool_call',
              content: toolName,
              timestamp: makeTimestamp(),
              isStreaming: true,
              blockIndex: idx,
            };
            setTerminals(prev => prev.map(t =>
              matchesTerminal(t) ? { ...t, lines: [...t.lines, line], isStreaming: true } : t
            ));
          }
        }

        // content_block_delta: text_delta, thinking_delta, or input_json_delta
        if (streamEvent?.type === 'content_block_delta') {
          const delta = streamEvent.delta;
          const deltaType = delta?.type;

          if (deltaType === 'text_delta' && delta.text) {
            // Append text delta to terminal output
            setTerminals(prev => prev.map(t => {
              if (!matchesTerminal(t)) return t;
              const lastLine = t.lines[t.lines.length - 1];
              if (lastLine?.type === 'output' && lastLine.isStreaming) {
                return {
                  ...t,
                  lines: t.lines.map((l, i) =>
                    i === t.lines.length - 1
                      ? { ...l, content: l.content + delta.text }
                      : l
                  ),
                };
              }
              return {
                ...t,
                lines: [...t.lines, {
                  id: msg.uuid ?? crypto.randomUUID(),
                  type: 'output' as const,
                  content: delta.text,
                  timestamp: makeTimestamp(),
                  isStreaming: true,
                }],
              };
            }));
          } else if (deltaType === 'thinking_delta' && delta.thinking) {
            // Append to last thinking line or create one
            setTerminals(prev => prev.map(t => {
              if (!matchesTerminal(t)) return t;
              let idx = -1;
              for (let i = t.lines.length - 1; i >= 0; i--) {
                if (t.lines[i].type === 'thinking') {
                  idx = i;
                  break;
                }
              }
              if (idx >= 0) {
                return {
                  ...t,
                  lines: t.lines.map((l, i) =>
                    i === idx
                      ? { ...l, content: l.content + delta.thinking, isStreaming: true }
                      : l
                  ),
                  isStreaming: true,
                };
              }
              return {
                ...t,
                lines: [...t.lines, {
                  id: `thinking-${msg.uuid ?? crypto.randomUUID()}`,
                  type: 'thinking' as const,
                  content: delta.thinking,
                  timestamp: makeTimestamp(),
                  isStreaming: true,
                }],
                isStreaming: true,
              };
            }));
          } else if (deltaType === 'input_json_delta' && delta.partial_json != null) {
            // Accumulate tool input JSON and update tool_call line with human-readable detail
            const blockIdx = streamEvent?.index;
            if (typeof blockIdx === 'number') {
              const acc = (toolInputByBlockRef.current[blockIdx] || '') + delta.partial_json;
              toolInputByBlockRef.current[blockIdx] = acc;
              const detail = tryExtractToolDetail(acc);
              if (detail != null) {
                setTerminals(prev => prev.map(t => {
                  if (!matchesTerminal(t)) return t;
                  const lineIdx = t.lines.findIndex(
                    (l) => l.type === 'tool_call' && l.blockIndex === blockIdx
                  );
                  if (lineIdx < 0) return t;
                  const line = t.lines[lineIdx];
                  const baseContent = line.content.includes(': ') ? line.content.split(': ')[0] : line.content;
                  return {
                    ...t,
                    lines: t.lines.map((l, i) =>
                      i === lineIdx ? { ...l, content: `${baseContent}: ${detail}` } : l
                    ),
                  };
                }));
              }
            }
          }
        }
      }
      return;
    }

    if (event.type === 'activity' && event.payload) {
      const activityType = event.payload.activityType;
      const lineType: TerminalLineType = 
        activityType === 'thinking' ? 'thinking' :
        activityType === 'file_read' ? 'tool_call' :
        activityType === 'file_write' ? 'tool_call' :
        activityType === 'command' ? 'command' : 'info';

      const line: TerminalLine = {
        id: `${Date.now()}-${Math.random()}`,
        type: lineType,
        content: event.payload.label + (event.payload.detail ? `: ${event.payload.detail}` : ''),
        timestamp: makeTimestamp(),
        isStreaming: event.payload.status === 'running',
      };

      setTerminals(prev => prev.map(t =>
        matchesTerminal(t) ? { 
          ...t, 
          lines: [...t.lines, line],
          isStreaming: event.payload.status === 'running',
        } : t
      ));
    }

    if (event.type === 'content.delta' && event.payload?.delta) {
      // Append to last output line or create new one
      setTerminals(prev => prev.map(t => {
        if (!matchesTerminal(t)) return t;
        
        const lastLine = t.lines[t.lines.length - 1];
        if (lastLine?.type === 'output' && lastLine.isStreaming) {
          // Append to existing streaming output
          return {
            ...t,
            lines: t.lines.map((l, i) => 
              i === t.lines.length - 1 
                ? { ...l, content: l.content + event.payload.delta }
                : l
            ),
          };
        } else {
          // Create new output line
          return {
            ...t,
            lines: [...t.lines, {
              id: `${Date.now()}`,
              type: 'output' as const,
              content: event.payload.delta,
              timestamp: makeTimestamp(),
              isStreaming: true,
            }],
          };
        }
      }));
    }

    // Handle turn/item completion: update terminal streaming state and sync plan step + cost
    if (event.type === 'turn.completed' || event.type === 'item.completed') {
      if (event.type === 'turn.completed') toolInputByBlockRef.current = {};
      const matchedTerminal = terminalsRef.current.find(matchesTerminal);
      const stepIdToComplete = matchedTerminal?.currentStepId;
      const usage = event.type === 'turn.completed' ? event.payload?.usage : undefined;
      const queuedMsg = matchedTerminal?.queuedMessage;
      const terminalIdForQueue = matchedTerminal?.id;

      setTerminals(prev => prev.map(t =>
        !matchesTerminal(t) ? t : {
          ...t,
          isStreaming: false,
          currentStepId: undefined,
          lines: t.lines.map(l => ({ ...l, isStreaming: false })),
          // Clear queued message since we'll send it
          queuedMessage: queuedMsg ? null : t.queuedMessage,
        }
      ));

      if (stepIdToComplete && usage) {
        setPlanSteps(prev => prev.map(s =>
          s.id === stepIdToComplete
            ? { ...s, status: 'completed' as const, costUsd: usage.costUsd ?? s.costUsd }
            : s
        ));
      }

      // Auto-send queued message after terminal finishes streaming
      if (queuedMsg && terminalIdForQueue) {
        // Use setTimeout to ensure state updates have been applied
        setTimeout(() => {
          handleTerminalMessageRef.current(terminalIdForQueue, queuedMsg.message, queuedMsg.files);
        }, 100);
      }

      // Do NOT auto-extract tasks from assistant result here — heuristic added list items and
      // intro text as "tasks". Extracted tasks come only from the server (extractor + task store).
    }
  }, []);

  // WebSocket connection for streaming events
  useEffect(() => {
    console.log('[WS] Connecting to', getWebSocketUrl());
    const ws = new WebSocket(getWebSocketUrl());
    wsRef.current = ws;

    ws.onopen = () => console.log('[WS] Connected');
    
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        handleWsEvent(data);
      } catch (err) {
        console.error('[WS] Parse error:', err);
      }
    };

    ws.onerror = (e) => console.warn('[WS] Error:', e);
    ws.onclose = () => console.warn('[WS] Closed');

    return () => ws.close();
  }, [handleWsEvent]);

  // Terminal handlers
  const handleNewTerminal = useCallback((agentId?: string) => {
    const agent = agents.find(a => a.id === agentId) || agents[0];
    if (!agent) return;

    setTerminals(prev => [...prev, {
      id: `terminal-${Date.now()}`,
      agent,
      lines: [{ id: `${Date.now()}`, type: 'system', content: `Session started — ${agent.name}`, timestamp: makeTimestamp() }],
      isStreaming: false,
    }]);
  }, [agents]);

  // Update ref for command palette
  useEffect(() => {
    handleNewTerminalRef.current = handleNewTerminal;
  }, [handleNewTerminal]);

  const handleCloseTerminal = async (terminalId: string) => {
    const terminal = terminals.find(t => t.id === terminalId);
    
    // Close thread session if exists
    if (terminal?.threadId) {
      try {
        await fetch(`${getApiUrl()}/threads/${terminal.threadId}/close`, { method: 'POST' });
      } catch (err) {
        console.warn('Failed to close thread session:', err);
      }
    }
    
    setTerminals(prev => prev.filter(t => t.id !== terminalId));
  };

  const handleMinimizeTerminal = (terminal: TerminalState) => {
    setMinimizedWidgets(prev => [...prev, { id: terminal.id, type: 'terminal', title: terminal.agent.name, icon: terminal.agent.icon, data: terminal }]);
    setTerminals(prev => prev.filter(t => t.id !== terminal.id));
    // Clear focus if this terminal was focused
    if (focusedWidgetId === terminal.id) {
      useWorkspaceStore.getState().setFocusedWidget(null, null);
    }
    // Clear maximized if this terminal was maximized
    if (maximizedWidgetId === terminal.id) {
      useWorkspaceStore.getState().setMaximizedWidget(null);
    }
  };

  const handleMaximizeTerminal = (terminalId: string) => {
    const current = useWorkspaceStore.getState().maximizedWidgetId;
    if (current === terminalId) {
      // Already maximized, restore
      useWorkspaceStore.getState().setMaximizedWidget(null);
    } else {
      useWorkspaceStore.getState().setMaximizedWidget(terminalId);
    }
  };

  const handleClearTerminal = (terminalId: string) => {
    setTerminals(prev => prev.map(t =>
      t.id === terminalId
        ? { ...t, lines: [{ id: `${Date.now()}`, type: 'system' as const, content: 'Terminal cleared', timestamp: makeTimestamp() }] }
        : t
    ));
  };

  const handleFocusWidget = (widgetId: string, widgetType: 'terminal' | 'tasks' | 'agent-status') => {
    useWorkspaceStore.getState().setFocusedWidget(widgetId, widgetType);
  };

  // Handle split panel - creates a new terminal and splits the layout
  const handleSplitPanel = useCallback((panelId: string, direction: 'horizontal' | 'vertical') => {
    // Get the focused terminal's agent (or default to first agent)
    const focusedTerminal = terminals.find(t =>
      layoutTree && findTerminalPanelId(layoutTree, t.id) === panelId
    );
    const agent = focusedTerminal?.agent || agents[0];
    if (!agent) return;

    // Create new terminal
    const newTerminalId = `terminal-${Date.now()}`;
    setTerminals(prev => [...prev, {
      id: newTerminalId,
      agent,
      lines: [{ id: `${Date.now()}`, type: 'system', content: `Session started — ${agent.name}`, timestamp: makeTimestamp() }],
      isStreaming: false,
    }]);

    // Update layout tree
    useWorkspaceStore.getState().splitPanel(panelId, direction, newTerminalId);
  }, [terminals, layoutTree, agents]);

  // Helper to find the panel ID for a terminal in the layout tree
  const findTerminalPanelId = (node: LayoutNode, terminalId: string): string | null => {
    if (node.type === 'leaf') {
      return node.widgetId === terminalId ? node.id : null;
    }
    for (const child of node.children) {
      const found = findTerminalPanelId(child, terminalId);
      if (found) return found;
    }
    return null;
  };

  // Handle updating panel sizes when user resizes
  const handleUpdatePanelSizes = useCallback((groupId: string, sizes: number[]) => {
    useWorkspaceStore.getState().updatePanelSizes(groupId, sizes);
  }, []);

  // Handle closing any panel from the layout (Tasks, agent-status, terminal)
  const handleClosePanel = useCallback((panelId: string) => {
    useWorkspaceStore.getState().closePanelInLayout(panelId);
  }, []);

  // Drag-and-drop handlers for panel reordering
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    setOverDropId(event.over?.id as string || null);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);
    setOverDropId(null);

    if (!over || active.id === over.id) return;

    // Extract panel IDs (over.id is prefixed with "drop-")
    const sourcePanelId = active.id as string;
    const targetPanelId = (over.id as string).replace('drop-', '');

    if (sourcePanelId !== targetPanelId) {
      // Swap the panels in the layout
      useWorkspaceStore.getState().swapPanels(sourcePanelId, targetPanelId);
    }
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
    setOverDropId(null);
  }, []);

  const handleTerminalSettingsChange = (terminalId: string, settings: TerminalSettings) => {
    setTerminals(prev => prev.map(t =>
      t.id === terminalId ? { ...t, settings } : t
    ));
  };

  const handleQueueMessage = (terminalId: string, message: string, files?: UploadedFile[]) => {
    setTerminals(prev => prev.map(t =>
      t.id === terminalId ? { ...t, queuedMessage: { message, files } } : t
    ));
  };

  const handleClearQueue = (terminalId: string) => {
    setTerminals(prev => prev.map(t =>
      t.id === terminalId ? { ...t, queuedMessage: null } : t
    ));
  };

  const handleTerminalMessage = async (terminalId: string, message: string, files?: UploadedFile[]) => {
    const terminal = terminals.find(t => t.id === terminalId);
    if (!terminal) return;

    const cwd = terminal.path || workspacePath || (typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : null) || '/';

    // Build prompt content with file info
    let promptContent = message;
    if (files && files.length > 0) {
      const fileNames = files.map(f => f.name).join(', ');
      promptContent = `${message}\n📎 Attached: ${fileNames}`;
    }

    // Add prompt line and extract current task into plan widget (so it shows and syncs on completion)
    const extractedStepId = `step-extracted-${Date.now()}`;
    setPlanSteps(prev => [...prev, {
      id: extractedStepId,
      text: message,
      agent: terminal.agent.id,
      status: 'running',
      source: 'extracted',
    }]);
    setTerminals(prev => prev.map(t =>
      t.id === terminalId ? {
        ...t,
        isStreaming: true,
        currentTask: message,
        currentStepId: extractedStepId,
        lines: [...t.lines, { id: `${Date.now()}`, type: 'prompt', content: promptContent, timestamp: makeTimestamp() }]
      } : t
    ));

    try {
      // Route based on agent type: OpenClaw uses agent task API, Claude Code uses thread/session API
      if (terminal.agent.type === 'openclaw') {
        // OpenClaw: Send via agent task API (WebSocket-connected agents)
        let threadId = terminal.threadId;
        if (!threadId) {
          threadId = `thread-${terminalId}`;
          threadToTerminalRef.current[threadId] = terminalId;
          setTerminals(prev => prev.map(t =>
            t.id === terminalId ? { ...t, threadId } : t
          ));
        }

        // Use /agents/:name/task for WebSocket-connected OpenClaw agents
        const res = await fetch(`${getApiUrl()}/agents/${terminal.agent.id}/task`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, cwd, threadId }),
        });
        const data = await res.json();

        if (!data.ok) {
          // Provide helpful error messages for common issues
          const errorMsg = data.error || 'Send failed';
          if (errorMsg.includes('not connected') || errorMsg.includes('Agent not connected')) {
            throw new Error(
              `Agent "${terminal.agent.name}" is not connected.\n\n` +
              `To connect this agent:\n` +
              `1. Install the ACC channel plugin on the OpenClaw instance\n` +
              `2. Configure it to point to this Dispatch server\n` +
              `3. Restart the OpenClaw gateway\n\n` +
              `See Agents panel for setup instructions.`
            );
          }
          throw new Error(errorMsg);
        }
      } else {
        // Claude Code: Use thread/session API for persistent sessions
        let threadId = terminal.threadId;

        // Create thread/session if needed (Phase 2/3)
        if (!threadId) {
          threadId = `thread-${terminalId}`;

          // Register mapping immediately (before async state update)
          threadToTerminalRef.current[threadId] = terminalId;

          const sessionRes = await fetch(`${getApiUrl()}/threads/${threadId}/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cwd,
              name: `${terminal.agent.name} - ${new Date().toLocaleString()}`,
            }),
          });
          const sessionData = await sessionRes.json();

          if (!sessionData.ok) {
            throw new Error(sessionData.error || 'Failed to create session');
          }
          setTerminals(prev => prev.map(t =>
            t.id === terminalId ? { ...t, threadId, sessionActive: true, currentStepId: extractedStepId } : t
          ));
        } else {
          // Ensure mapping exists for existing threadId
          threadToTerminalRef.current[threadId] = terminalId;
        }

        // Send via thread API (persistent session)
        let res = await fetch(`${getApiUrl()}/threads/${threadId}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        });
        let data = await res.json();

        // If server restarted, session is gone; create session and retry send once
        if (!data.ok && data.error === 'No active session for thread' && terminal.threadId) {
          setTerminals(prev => prev.map(t =>
            t.id === terminalId ? { ...t, threadId: undefined, sessionActive: false } : t
          ));
          const sessionRes = await fetch(`${getApiUrl()}/threads/${threadId}/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cwd, name: `${terminal.agent.name} - ${new Date().toLocaleString()}` }),
          });
          const sessionData = await sessionRes.json();
          if (!sessionData.ok) throw new Error(sessionData.error || 'Failed to create session');
          setTerminals(prev => prev.map(t =>
            t.id === terminalId ? { ...t, threadId, sessionActive: true } : t
          ));
          res = await fetch(`${getApiUrl()}/threads/${threadId}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message }),
          });
          data = await res.json();
        }

        if (!data.ok) {
          throw new Error(data.error || 'Send failed');
        }
      }

    } catch (err) {
      setTerminals(prev => prev.map(t =>
        t.id === terminalId ? {
          ...t,
          isStreaming: false,
          currentStepId: undefined,
          lines: [...t.lines, { id: `${Date.now()}`, type: 'error', content: `Error: ${err}`, timestamp: makeTimestamp() }]
        } : t
      ));
      setPlanSteps(prev => prev.map(s =>
        s.id === extractedStepId ? { ...s, status: 'failed' as const } : s
      ));
    }
  };

  // Keep ref updated for use in WebSocket callback
  handleTerminalMessageRef.current = handleTerminalMessage;

  const handleSendStepToTerminal = (step: PlanStep, terminalId?: string) => {
    const agent = step.agent ? agents.find(a => a.id === step.agent) : agents[0];
    if (!agent) return;

    if (terminalId) {
      const terminal = terminals.find(t => t.id === terminalId);
      if (terminal) {
        setTerminals(prev => prev.map(t =>
          t.id === terminalId ? { ...t, currentTask: step.text, currentStepId: step.id } : t
        ));
        handleTerminalMessage(terminalId, step.text);
      } else {
        const minimized = minimizedWidgets.find(w => w.type === 'terminal' && w.id === terminalId && w.data);
        if (minimized?.data) {
          const restored: TerminalState = {
            ...minimized.data,
            currentTask: step.text,
            currentStepId: step.id,
          };
          setMinimizedWidgets(prev => prev.filter(w => w.id !== terminalId));
          setTerminals(prev => [...prev, restored]);
          setTimeout(() => handleTerminalMessage(terminalId, step.text), 0);
        }
      }
    } else {
      const newTerminal: TerminalState = {
        id: `terminal-${Date.now()}`,
        agent,
        lines: [{ id: `${Date.now()}`, type: 'system', content: `Session started — ${agent.name}`, timestamp: makeTimestamp() }],
        isStreaming: false,
        currentTask: step.text,
        currentStepId: step.id,
      };
      setTerminals(prev => [...prev, newTerminal]);
      setTimeout(() => handleTerminalMessage(newTerminal.id, step.text), 100);
    }

    setPlanSteps(prev => prev.map(s => s.id === step.id ? { ...s, status: 'running' } : s));
  };

  // Tasks handlers
  const handleExecute = () => {
    const stepsWithAgent = planSteps.filter(s => s.agent);
    if (stepsWithAgent.length === 0) return;
    setIsExecuting(true);
    let idx = 0;
    const exec = () => {
      if (idx < stepsWithAgent.length) {
        const step = stepsWithAgent[idx];
        const stepIdsCompleted = new Set(stepsWithAgent.slice(0, idx).map(s => s.id));
        setPlanSteps(prev => prev.map(s =>
          s.id === step.id ? { ...s, status: 'running' as const }
            : stepIdsCompleted.has(s.id) ? { ...s, status: 'completed' as const }
            : s
        ));
        handleSendStepToTerminal(step);
        idx++;
        setTimeout(exec, 3000);
      } else {
        setPlanSteps(prev => prev.map(s => (s.agent ? { ...s, status: 'completed' as const } : s)));
        setIsExecuting(false);
      }
    };
    exec();
  };

  const handleStepAgentChange = (stepId: string, agentId: string | null) => {
    setPlanSteps(prev => prev.map(s => s.id === stepId ? { ...s, agent: agentId } : s));
  };

  const handleAddStep = useCallback((text: string, agentId: string | null) => {
    setPlanSteps(prev => [...prev, {
      id: `step-${Date.now()}-${prev.length}`,
      text,
      agent: agentId,
      status: 'pending',
      source: 'manual',
    }]);
  }, []);

  // Update ref for command palette
  useEffect(() => {
    handleAddStepRef.current = handleAddStep;
  }, [handleAddStep]);

  // Minimize/restore handlers
  const handleRestoreWidget = (widget: MinimizedWidget) => {
    setMinimizedWidgets(prev => prev.filter(w => w.id !== widget.id));
    if (widget.type === 'terminal' && widget.data) {
      setTerminals(prev => [...prev, widget.data!]);
    }
    // Tasks widget restore: right panel is always tasks; no mode to set
  };

  const getTerminalCount = (agentId: string) => terminals.filter(t => t.agent.id === agentId).length;

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* Header */}
      <div className="h-11 flex-shrink-0 bg-zinc-900 border-b border-zinc-800 px-4 flex items-center justify-between drag-region">
        {/* Left: macOS traffic lights spacing */}
        <div className="w-20" />

        {/* Center: Title & Workspace Path */}
        <div className="flex items-center gap-3 flex-1 justify-center">
          <div className="flex items-center gap-2">
            <span className="text-lg">📡</span>
            <span className="text-sm font-semibold text-zinc-100 tracking-wide">Dispatch</span>
          </div>

          <span className="text-zinc-700">|</span>

          {/* Workspace Path */}
          <div className="flex items-center no-drag group/path">
            {/* Folder icon button - opens native folder dialog */}
            <button
              onClick={async () => {
                if (window.electronAPI?.openFolder) {
                  const path = await window.electronAPI.openFolder(workspacePath || undefined);
                  if (path) {
                    setWorkspacePath(path);
                  }
                }
              }}
              className="flex items-center gap-1 px-2 py-0.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-l transition-colors"
              title="Select folder"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span className="text-xs max-w-0 overflow-hidden opacity-0 group-hover/path:max-w-[3rem] group-hover/path:opacity-100 transition-all duration-150 ease-out">
                Select
              </span>
            </button>

            {/* Path display/input - click to edit manually */}
            {isEditingPath ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setWorkspacePath(pathInput.trim() || null);
                  setIsEditingPath(false);
                }}
                className="flex items-center"
              >
                <input
                  ref={pathInputRef}
                  type="text"
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  onBlur={() => {
                    setWorkspacePath(pathInput.trim() || null);
                    setIsEditingPath(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setIsEditingPath(false);
                      setPathInput(workspacePath || '');
                    }
                  }}
                  placeholder="/path/to/project"
                  className="w-64 px-2 py-0.5 text-xs bg-zinc-800 border border-zinc-600 rounded-r text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500"
                  autoFocus
                />
              </form>
            ) : (
              <button
                onClick={() => {
                  setPathInput(workspacePath || '');
                  setIsEditingPath(true);
                }}
                className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-r transition-colors group"
                title="Click to edit path"
              >
                <span className="max-w-[200px] truncate">
                  {workspacePath || 'Set workspace path'}
                </span>
                <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2 no-drag">
          <button onClick={fetchAgents} disabled={isLoadingAgents} className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded">
            <RefreshCw className={`w-4 h-4 ${isLoadingAgents ? 'animate-spin' : ''}`} />
          </button>

          {/* Add Menu Dropdown */}
          <div className="relative" ref={addMenuRef}>
            <button
              onClick={() => {
                setShowAddMenu(!showAddMenu);
                if (showAddMenu) setShowTerminalAgentMenu(false);
              }}
              className="flex items-center justify-center w-8 h-8 bg-zinc-800 hover:bg-zinc-700 rounded"
              title="Add terminal or agent"
            >
              <Plus className="w-4 h-4" />
            </button>

            {showAddMenu && (
              <div className="absolute top-full right-0 mt-1 py-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg z-50 min-w-[160px]">
                {showTerminalAgentMenu ? (
                  <>
                    <button
                      onClick={() => setShowTerminalAgentMenu(false)}
                      className="w-full px-3 py-2 text-left text-sm text-zinc-400 hover:bg-zinc-700 flex items-center gap-2"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      Back
                    </button>
                    <div className="border-t border-zinc-700 my-0.5" />
                    {agents.map((agent) => (
                      <button
                        key={agent.id}
                        onClick={() => {
                          handleNewTerminal(agent.id);
                          setShowAddMenu(false);
                          setShowTerminalAgentMenu(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
                      >
                        <span>{agent.icon}</span>
                        <span>{agent.name}</span>
                      </button>
                    ))}
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        if (agents.length === 1) {
                          handleNewTerminal(agents[0].id);
                          setShowAddMenu(false);
                        } else if (agents.length > 1) {
                          setShowTerminalAgentMenu(true);
                        }
                      }}
                      disabled={agents.length === 0}
                      className="w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      <TerminalIcon className="w-4 h-4 text-cyan-400" />
                      <span>Terminal</span>
                      {agents.length > 1 && <ChevronRight className="w-4 h-4 ml-auto text-zinc-500" />}
                    </button>
                    <button
                      onClick={() => {
                        setShowAgentsPanel(true);
                        setShowAddMenu(false);
                      }}
                      className="w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
                    >
                      <Globe className="w-4 h-4 text-indigo-400" />
                      <span>Agent</span>
                    </button>
                    {!showAgentStatus && (
                      <button
                        onClick={() => {
                          useWorkspaceStore.getState().setShowAgentStatus(true);
                          setShowAddMenu(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
                      >
                        <Wifi className="w-4 h-4 text-emerald-400" />
                        <span>Agent Status</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Workspace Grid */}
      <div
        className="flex-1 p-2 overflow-hidden"
        onClick={(e) => {
          // Clear focus when clicking on empty grid space
          if (e.target === e.currentTarget) {
            useWorkspaceStore.getState().setFocusedWidget(null, null);
          }
        }}
      >
        {!workspacePath ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <FolderOpen className="w-12 h-12 text-zinc-600 mb-3" />
            <p className="text-sm font-medium text-zinc-300 mb-1">Set a workspace path to get started</p>
            <p className="text-xs text-zinc-500 max-w-sm">Click the path in the header above to choose your project folder. Agents run in this workspace.</p>
          </div>
        ) : terminals.length === 0 ? (
          /* Empty state - no terminals yet */
          <div className="h-full flex flex-col items-center justify-center text-center p-4">
            <TerminalIcon className="w-10 h-10 text-zinc-700 mb-3" />
            <p className="text-sm text-zinc-500 mb-2">No terminals open</p>
            {agents.length === 0 ? (
              <button disabled className="px-3 py-1.5 bg-zinc-800 rounded text-xs flex items-center gap-1.5 opacity-50 cursor-not-allowed">
                <Plus className="w-3.5 h-3.5" /> New Terminal
              </button>
            ) : agents.length === 1 ? (
              <button onClick={() => handleNewTerminal(agents[0].id)} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" /> New Terminal
              </button>
            ) : (
              <div className="relative">
                <button
                  onClick={() => setShowEmptyStateAgentMenu(prev => !prev)}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" /> New Terminal
                  <ChevronDown className="w-3 h-3 text-zinc-500" />
                </button>
                {showEmptyStateAgentMenu && (
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 py-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg z-50 min-w-[160px]">
                    {agents.map(agent => (
                      <button
                        key={agent.id}
                        onClick={() => {
                          handleNewTerminal(agent.id);
                          setShowEmptyStateAgentMenu(false);
                        }}
                        className="w-full px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
                      >
                        <span>{agent.icon}</span>
                        <span>{agent.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {agents.length === 0 && <p className="text-xs text-zinc-600 mt-2">No agents connected</p>}
          </div>
        ) : useFlexibleLayout && layoutTree ? (
          /* Flexible grid layout with LayoutRenderer wrapped in DndContext */
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <LayoutRenderer
              node={layoutTree}
              terminals={terminals}
              agents={agents}
              planSteps={planSteps}
              minimizedWidgets={minimizedWidgets}
              focusedWidgetId={focusedWidgetId}
              hoveredWidgetId={hoveredWidgetId}
              highlightedTerminalId={highlightedTerminalId}
              maximizedWidgetId={maximizedWidgetId}
              activeDragId={activeDragId}
              overDropId={overDropId}
              onFocusWidget={handleFocusWidget}
              onHoverWidget={setHoveredWidgetId}
              onCloseTerminal={handleCloseTerminal}
              onMinimizeTerminal={handleMinimizeTerminal}
              onMaximizeTerminal={handleMaximizeTerminal}
              onClearTerminal={handleClearTerminal}
              onSendMessage={handleTerminalMessage}
              onSettingsChange={handleTerminalSettingsChange}
              onQueueMessage={handleQueueMessage}
              onClearQueue={handleClearQueue}
              onExecute={handleExecute}
              isExecuting={isExecuting}
              onStepAgentChange={handleStepAgentChange}
              onSendStepToTerminal={handleSendStepToTerminal}
              onTerminalOptionHover={setHighlightedTerminalId}
              onAddStep={handleAddStep}
              tasksVisible={tasksVisible}
              showAgentStatus={showAgentStatus}
              onCloseAgentStatus={() => useWorkspaceStore.getState().setShowAgentStatus(false)}
              onSplitPanel={handleSplitPanel}
              onUpdateSizes={handleUpdatePanelSizes}
              onClosePanel={handleClosePanel}
            />
          </DndContext>
        ) : (
          /* Fallback: Simple vertical stack layout */
          <PanelGroup direction="horizontal">
            <Panel defaultSize={60} minSize={30}>
              <PanelGroup direction="vertical">
                {terminals.map((terminal, index) => (
                  <Fragment key={terminal.id}>
                    <Panel defaultSize={Math.floor(100 / terminals.length)} minSize={20}>
                      <div className="h-full p-1">
                        <TerminalWidget
                          terminal={terminal}
                          onClose={() => handleCloseTerminal(terminal.id)}
                          onMinimize={() => handleMinimizeTerminal(terminal)}
                          onMaximize={() => handleMaximizeTerminal(terminal.id)}
                          onClear={() => handleClearTerminal(terminal.id)}
                          onSendMessage={handleTerminalMessage}
                          onSettingsChange={handleTerminalSettingsChange}
                          onQueueMessage={handleQueueMessage}
                          onClearQueue={handleClearQueue}
                          isHighlighted={highlightedTerminalId === terminal.id}
                          isFocused={focusedWidgetId === terminal.id}
                          isHovered={hoveredWidgetId === terminal.id}
                          onFocus={() => handleFocusWidget(terminal.id, 'terminal')}
                          onMouseEnter={() => setHoveredWidgetId(terminal.id)}
                          onMouseLeave={() => setHoveredWidgetId(null)}
                        />
                      </div>
                    </Panel>
                    {index < terminals.length - 1 && <PanelResizeHandle className="h-1 bg-zinc-800 hover:bg-zinc-700" />}
                  </Fragment>
                ))}
              </PanelGroup>
            </Panel>
            <PanelResizeHandle className="w-1 bg-zinc-800 hover:bg-zinc-700" />
            <Panel defaultSize={40} minSize={20}>
              <div className="h-full p-1">
                <TasksWidget
                  steps={planSteps}
                  agents={agents}
                  terminals={terminals.map((t) => ({
                    id: t.id,
                    label: t.agent.name,
                    agentIcon: t.agent.icon,
                  }))}
                  highlightedTerminalId={highlightedTerminalId}
                  onExecute={handleExecute}
                  isExecuting={isExecuting}
                  onStepAgentChange={handleStepAgentChange}
                  onSendStepToTerminal={handleSendStepToTerminal}
                  onTerminalOptionHover={setHighlightedTerminalId}
                  onMenuClose={() => setHighlightedTerminalId(null)}
                  onAddStep={handleAddStep}
                  onMaximize={() => handleMaximizeTerminal('tasks-widget')}
                  isFocused={focusedWidgetId === 'tasks-widget'}
                  isHovered={hoveredWidgetId === 'tasks-widget'}
                  onFocus={() => handleFocusWidget('tasks-widget', 'tasks')}
                  onMouseEnter={() => setHoveredWidgetId('tasks-widget')}
                  onMouseLeave={() => setHoveredWidgetId(null)}
                />
              </div>
            </Panel>
          </PanelGroup>
        )}
      </div>

      {/* Minimized Widgets Tab Bar */}
      {minimizedWidgets.length > 0 && (
        <div className="flex-shrink-0 h-9 bg-zinc-900 border-t border-zinc-800 px-2 flex items-center gap-1">
          {minimizedWidgets.map(widget => (
            <div
              key={widget.id}
              onClick={() => handleRestoreWidget(widget)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer group transition-all duration-150 ${
                widget.type === 'terminal' && highlightedTerminalId === widget.id
                  ? 'ring-1 ring-violet-400/50 terminal-tab-highlight-pulse'
                  : 'bg-zinc-800 hover:bg-zinc-700'
              }`}
            >
              <span>{widget.icon}</span>
              <span className="text-zinc-300 max-w-[100px] truncate">{widget.title}</span>
              <button onClick={(e) => { e.stopPropagation(); setMinimizedWidgets(prev => prev.filter(w => w.id !== widget.id)); }} className="text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Maximized Widget Overlay */}
      {maximizedWidgetId && (() => {
        const maximizedTerminal = terminals.find(t => t.id === maximizedWidgetId);
        const isTasksMaximized = maximizedWidgetId === 'tasks-widget';

        if (maximizedTerminal) {
          return (
            <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
              <div
                className="w-full h-full max-w-[95vw] max-h-[90vh] animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
              >
                <TerminalWidget
                  terminal={maximizedTerminal}
                  onClose={() => handleCloseTerminal(maximizedTerminal.id)}
                  onMinimize={() => handleMinimizeTerminal(maximizedTerminal)}
                  onMaximize={() => handleMaximizeTerminal(maximizedTerminal.id)}
                  onClear={() => handleClearTerminal(maximizedTerminal.id)}
                  onSendMessage={handleTerminalMessage}
                  onSettingsChange={handleTerminalSettingsChange}
                  onQueueMessage={handleQueueMessage}
                  onClearQueue={handleClearQueue}
                  isFocused={true}
                />
              </div>
              <button
                className="absolute top-4 right-4 p-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-zinc-200"
                onClick={() => useWorkspaceStore.getState().setMaximizedWidget(null)}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          );
        }

        if (isTasksMaximized) {
          return (
            <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
              <div
                className="w-full h-full max-w-[95vw] max-h-[90vh] animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
              >
                <TasksWidget
                  steps={planSteps}
                  agents={agents}
                  terminals={[
                    ...terminals.map((t) => {
                      const sameAgent = terminals.filter(x => x.agent.id === t.agent.id);
                      const idx = sameAgent.findIndex(x => x.id === t.id) + 1;
                      const suffix = sameAgent.length > 1 ? ` — ${idx}` : '';
                      return {
                        id: t.id,
                        label: `${t.agent.name}${suffix}`,
                        agentIcon: t.agent.icon,
                      };
                    }),
                  ]}
                  highlightedTerminalId={highlightedTerminalId}
                  onExecute={handleExecute}
                  isExecuting={isExecuting}
                  onStepAgentChange={handleStepAgentChange}
                  onSendStepToTerminal={handleSendStepToTerminal}
                  onTerminalOptionHover={setHighlightedTerminalId}
                  onMenuClose={() => setHighlightedTerminalId(null)}
                  onAddStep={handleAddStep}
                  onMaximize={() => handleMaximizeTerminal('tasks-widget')}
                  isFocused={true}
                />
              </div>
              <button
                className="absolute top-4 right-4 p-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-zinc-200"
                onClick={() => useWorkspaceStore.getState().setMaximizedWidget(null)}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          );
        }

        return null;
      })()}

      {/* Agents Panel Modal */}
      <AgentsPanel
        isOpen={showAgentsPanel}
        onClose={() => setShowAgentsPanel(false)}
        serverUrl={getApiUrl().replace('http://', '').replace('https://', '')}
      />
    </div>
  );
}
