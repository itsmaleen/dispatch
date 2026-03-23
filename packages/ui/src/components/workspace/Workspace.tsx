import { useState, useEffect, useRef, useCallback, Fragment, useLayoutEffect } from 'react';
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
  MonitorDot,
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
  GitBranch,
  Terminal as TerminalIcon, // Keep for command line icon usage
} from 'lucide-react';
import { AgentsPanel } from '../agents/AgentsPanel';
import { api, getServerUrl, getWsUrl } from '../../stores/app';
import { useWorkspaceStore, type LayoutNode, type LayoutLeaf, type LayoutGroup, type WidgetType, type ConsoleResumeOptions, layoutHelpers } from '../../stores/workspace';
import { ChatInput, type UploadedFile } from './ChatInput';
import { TasksWidgetContainer } from './TasksWidgetContainer';
import { TerminalWidget as RealTerminalWidget } from '../terminal/TerminalWidget';
import { WorktreePanel, WorktreeButton, EnableWorktreeDialog } from './WorktreePanel';
import { ProjectStartingPoint } from './ProjectStartingPoint';
import type { TerminalInstance } from '@acc/contracts';

// ============================================================================
// TYPES
// ============================================================================

// Dynamic URLs - resolved at runtime for Electron compatibility
const getApiUrl = () => getServerUrl();
const getWebSocketUrl = () => `${getWsUrl()}/events`;

type AgentStatus = 'ready' | 'busy' | 'offline';
type ConsoleLineType = 'prompt' | 'thinking' | 'tool_call' | 'tool_result' | 'output' | 'error' | 'info' | 'command' | 'system';

// Backwards compatibility aliases (internal use only - external APIs use new names)
type TerminalLineType = ConsoleLineType;

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

interface ConsoleLine {
  id: string;
  type: ConsoleLineType;
  content: string;
  timestamp?: string;
  isStreaming?: boolean;
  /** Block index for tool_call lines (used to match input_json_delta updates) */
  blockIndex?: number;
}

/** Agent console display settings */
interface ConsoleSettings {
  label?: string; // Custom name for the console
  accentColor?: string; // Accent color for visual distinction
  showThinking?: boolean; // Show thinking lines
  showToolCalls?: boolean; // Show tool call lines
  showToolResults?: boolean; // Show tool result lines
  showTimestamps?: boolean; // Show timestamps on lines
}

const DEFAULT_CONSOLE_SETTINGS: ConsoleSettings = {
  showThinking: true,
  showToolCalls: true,
  showToolResults: true,
  showTimestamps: true,
};

// Backwards compatibility aliases (internal use only)
type TerminalLine = ConsoleLine;
type TerminalSettings = ConsoleSettings;
type TerminalState = ConsoleState;
const DEFAULT_TERMINAL_SETTINGS = DEFAULT_CONSOLE_SETTINGS;

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

interface ConsoleState {
  id: string;
  agent: Agent;
  lines: ConsoleLine[];
  isStreaming: boolean;
  currentTask?: string;
  /** Plan step id when this console is executing a step (for status/cost sync) */
  currentStepId?: string;
  path?: string; // Override workspace path
  // Thread integration (Phase 2/3)
  threadId?: string;
  sessionActive?: boolean;
  // Session resume - Claude Code SDK session ID for resume
  resumeSessionId?: string;
  // Settings
  settings?: ConsoleSettings;
  // Message queue - allows typing while console is busy
  queuedMessage?: QueuedMessage | null;
  // Worktree isolation
  worktreePath?: string;
  worktreeBranch?: string;
}

interface MinimizedWidget {
  id: string;
  type: 'agent-console' | 'tasks' | 'terminal';
  title: string;
  icon: string;
  data?: ConsoleState;
  terminalData?: TerminalInstance;
}

/** Drop position for drag-and-drop operations */
type DropPosition = 'center' | 'left' | 'right' | 'top' | 'bottom';

/** Information about the current drop zone during drag operations */
interface DropZoneInfo {
  panelId: string;
  position: DropPosition;
}

// ============================================================================
// UTILITIES
// ============================================================================

function makeTimestamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Calculate which drop zone the cursor is in based on position within the panel.
 * Returns 'left', 'right', 'top', 'bottom' for edge zones (25% threshold),
 * or 'center' for the middle area (swap behavior).
 */
function calculateDropPosition(
  clientX: number,
  clientY: number,
  rect: DOMRect
): DropPosition {
  const EDGE_THRESHOLD = 0.25; // 25% of panel is edge zone

  const relX = (clientX - rect.left) / rect.width;
  const relY = (clientY - rect.top) / rect.height;

  if (relX < EDGE_THRESHOLD) return 'left';
  if (relX > 1 - EDGE_THRESHOLD) return 'right';
  if (relY < EDGE_THRESHOLD) return 'top';
  if (relY > 1 - EDGE_THRESHOLD) return 'bottom';
  return 'center';
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
// CONSOLE LINE COMPONENT
// ============================================================================

function ConsoleLineItem({ line, showTimestamp = true }: { line: ConsoleLine; showTimestamp?: boolean }) {
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
// CONSOLE SETTINGS POPOVER
// ============================================================================

function ConsoleSettingsPopover({
  settings,
  onSettingsChange,
  consoleLabel,
  onLabelChange,
  onClose,
}: {
  settings: ConsoleSettings;
  onSettingsChange: (settings: ConsoleSettings) => void;
  consoleLabel: string;
  onLabelChange: (label: string) => void;
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [localLabel, setLocalLabel] = useState(consoleLabel);

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
    if (localLabel !== consoleLabel) {
      onLabelChange(localLabel);
    }
  };

  const toggleSetting = (key: keyof ConsoleSettings) => {
    onSettingsChange({ ...settings, [key]: !settings[key] });
  };

  return (
    <div
      ref={popoverRef}
      className="absolute top-full right-0 mt-1 w-64 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-2 border-b border-zinc-700">
        <span className="text-xs font-medium text-zinc-300">Console Settings</span>
      </div>

      <div className="p-3 space-y-3">
        {/* Console Label */}
        <div className="space-y-1">
          <label className="text-[10px] text-zinc-500 uppercase tracking-wide">Label</label>
          <input
            type="text"
            value={localLabel}
            onChange={(e) => setLocalLabel(e.target.value)}
            onBlur={handleLabelBlur}
            onKeyDown={(e) => { if (e.key === 'Enter') handleLabelBlur(); }}
            placeholder="Console name..."
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
// CONSOLE CONTEXT MENU
// ============================================================================

interface ContextMenuPosition {
  x: number;
  y: number;
}

function ConsoleContextMenu({
  position,
  onClose,
  onMaximize,
  onMinimize,
  onCloseConsole,
  onClear,
  onSettings,
  onSplitRight,
  onSplitBelow,
}: {
  position: ContextMenuPosition;
  onClose: () => void;
  onMaximize?: () => void;
  onMinimize?: () => void;
  onCloseConsole?: () => void;
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
        e.preventDefault();
        e.stopPropagation();
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

  // Calculate adjusted position to avoid screen edge overflow
  const [adjustedPosition, setAdjustedPosition] = useState({ top: position.y, left: position.x });

  useLayoutEffect(() => {
    if (!menuRef.current) return;

    const menu = menuRef.current;
    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const padding = 8;

    let left = position.x;
    let top = position.y;

    // Check if menu would overflow on the right - open to the left of cursor
    if (left + menuRect.width + padding > viewportWidth) {
      left = position.x - menuRect.width;
    }

    // Check if menu would overflow on the bottom - open above cursor
    if (top + menuRect.height + padding > viewportHeight) {
      top = position.y - menuRect.height;
    }

    // Ensure menu doesn't go off-screen on the left
    if (left < padding) {
      left = padding;
    }

    // Ensure menu doesn't go off-screen on the top
    if (top < padding) {
      top = padding;
    }

    setAdjustedPosition({ top, left });
  }, [position]);

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        top: adjustedPosition.top,
        left: adjustedPosition.left,
        zIndex: 100,
      }}
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
      {onCloseConsole && (
        <button
          onClick={() => { onCloseConsole(); onClose(); }}
          className="w-full px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
        >
          <X className="w-4 h-4 text-red-400" />
          Close
        </button>
      )}
      {(onMaximize || onMinimize || onCloseConsole) && (onSplitRight || onSplitBelow) && (
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

/**
 * Edge-aware droppable component that detects which zone (left, right, top, bottom, center)
 * the cursor is in and shows a preview of the new cell that would be created.
 */
function EdgeAwareDroppable({
  panelId,
  children,
  onDropZoneChange,
  activeDropZone,
  isDragging,
  isSourcePanel,
}: {
  panelId: string;
  children: React.ReactNode;
  onDropZoneChange: (zone: DropZoneInfo | null) => void;
  activeDropZone: DropZoneInfo | null;
  isDragging: boolean;
  isSourcePanel: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { setNodeRef, isOver } = useDroppable({ id: `drop-${panelId}` });

  // Combine refs
  const combinedRef = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    },
    [setNodeRef]
  );

  // Track mouse position to determine drop zone
  useEffect(() => {
    if (!isOver || !isDragging || isSourcePanel) {
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const position = calculateDropPosition(e.clientX, e.clientY, rect);
      onDropZoneChange({ panelId, position });
    };

    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, [isOver, isDragging, isSourcePanel, panelId, onDropZoneChange]);

  // Clear drop zone when not hovering
  useEffect(() => {
    if (!isOver && activeDropZone?.panelId === panelId) {
      onDropZoneChange(null);
    }
  }, [isOver, activeDropZone, panelId, onDropZoneChange]);

  const isActive = activeDropZone?.panelId === panelId && isDragging && !isSourcePanel;
  const position = activeDropZone?.position;

  return (
    <div ref={combinedRef} className="h-full relative">
      {children}

      {/* Preview of new cell that would be created */}
      {isActive && (
        <>
          {/* Center: swap indicator - highlight entire panel */}
          {position === 'center' && (
            <div className="absolute inset-0 border-2 border-dashed border-blue-400 bg-blue-500/10 rounded-lg pointer-events-none" />
          )}

          {/* Left: show preview cell on the left side */}
          {position === 'left' && (
            <div className="absolute inset-0 flex pointer-events-none">
              <div className="w-1/2 border-2 border-blue-500 bg-blue-500/20 rounded-l-lg flex items-center justify-center">
                <div className="text-blue-400 text-sm font-medium opacity-75">New Panel</div>
              </div>
              <div className="w-1/2 border-2 border-blue-500/30 rounded-r-lg" />
            </div>
          )}

          {/* Right: show preview cell on the right side */}
          {position === 'right' && (
            <div className="absolute inset-0 flex pointer-events-none">
              <div className="w-1/2 border-2 border-blue-500/30 rounded-l-lg" />
              <div className="w-1/2 border-2 border-blue-500 bg-blue-500/20 rounded-r-lg flex items-center justify-center">
                <div className="text-blue-400 text-sm font-medium opacity-75">New Panel</div>
              </div>
            </div>
          )}

          {/* Top: show preview cell on the top */}
          {position === 'top' && (
            <div className="absolute inset-0 flex flex-col pointer-events-none">
              <div className="h-1/2 border-2 border-blue-500 bg-blue-500/20 rounded-t-lg flex items-center justify-center">
                <div className="text-blue-400 text-sm font-medium opacity-75">New Panel</div>
              </div>
              <div className="h-1/2 border-2 border-blue-500/30 rounded-b-lg" />
            </div>
          )}

          {/* Bottom: show preview cell on the bottom */}
          {position === 'bottom' && (
            <div className="absolute inset-0 flex flex-col pointer-events-none">
              <div className="h-1/2 border-2 border-blue-500/30 rounded-t-lg" />
              <div className="h-1/2 border-2 border-blue-500 bg-blue-500/20 rounded-b-lg flex items-center justify-center">
                <div className="text-blue-400 text-sm font-medium opacity-75">New Panel</div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================================
// AGENT CONSOLE WIDGET
// ============================================================================

function AgentConsoleWidget({
  console: consoleState,
  onClose,
  onMinimize,
  onMaximize,
  onClear,
  onSendMessage,
  onSettingsChange,
  onQueueMessage,
  onClearQueue,
  onWorktreeEnabled,
  onWorktreeMerged,
  onOpenTerminal,
  workspacePath,
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
  console: ConsoleState;
  onClose?: () => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
  onClear?: () => void;
  onSendMessage: (consoleId: string, message: string, files?: UploadedFile[]) => void;
  onSettingsChange?: (consoleId: string, settings: ConsoleSettings) => void;
  onQueueMessage?: (consoleId: string, message: string, files?: UploadedFile[]) => void;
  onClearQueue?: (consoleId: string) => void;
  onWorktreeEnabled?: (consoleId: string, worktreePath: string, branch: string) => void;
  onWorktreeMerged?: (consoleId: string) => void;
  onOpenTerminal?: (cwd: string) => void;
  workspacePath?: string;
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
  const [showWorktreePanel, setShowWorktreePanel] = useState(false);
  const [showEnableWorktreeDialog, setShowEnableWorktreeDialog] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  const settings = { ...DEFAULT_CONSOLE_SETTINGS, ...consoleState.settings };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [consoleState.lines, autoScroll]);

  // Focus name input when editing starts
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  const handleSend = (message: string, files?: UploadedFile[]) => {
    onSendMessage(consoleState.id, message, files);
  };

  const handleNameSave = () => {
    const newLabel = nameInput.trim() || undefined;
    if (onSettingsChange) {
      onSettingsChange(consoleState.id, { ...settings, label: newLabel });
    }
    setIsEditingName(false);
  };

  const handleNameCancel = () => {
    setIsEditingName(false);
    setNameInput(settings.label || '');
  };

  // Filter lines based on settings
  const filteredLines = consoleState.lines.filter((line) => {
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

  const displayName = settings.label || consoleState.agent.name;

  return (
    <div
      className={`h-full bg-[#0d1117] border rounded-lg flex flex-col overflow-hidden transition-all duration-150 ${getBorderClass()}`}
      data-console-id={consoleState.id}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onContextMenu={handleContextMenu}
    >
      {/* Context Menu */}
      {contextMenu && (
        <ConsoleContextMenu
          position={contextMenu}
          onClose={() => setContextMenu(null)}
          onMaximize={onMaximize}
          onMinimize={onMinimize}
          onCloseConsole={onClose}
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
          <span className="text-sm">{consoleState.agent.icon}</span>
          {/* Inline editable name */}
          {isEditingName ? (
            <form
              onSubmit={(e) => { e.preventDefault(); handleNameSave(); }}
              className="flex items-center"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                ref={nameInputRef}
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onBlur={handleNameSave}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    handleNameCancel();
                  }
                }}
                placeholder={consoleState.agent.name}
                className="w-32 px-1 py-0.5 text-xs bg-zinc-800 border border-zinc-600 rounded text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-violet-500"
              />
            </form>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setNameInput(settings.label || '');
                setIsEditingName(true);
              }}
              className="text-xs font-medium text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 px-1 py-0.5 rounded transition-colors group flex items-center gap-1"
              title="Click to rename"
            >
              <span>{displayName}</span>
              <Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-500" />
            </button>
          )}
          {settings.label && (
            <span className="text-[10px] text-zinc-600">({consoleState.agent.name})</span>
          )}
          {consoleState.isStreaming && <Loader2 className="w-3 h-3 text-violet-400 animate-spin" />}
        </div>
        <div className="flex items-center gap-2">
          {consoleState.currentTask && (
            <span className="text-[10px] text-zinc-500 truncate max-w-[200px]">{consoleState.currentTask}</span>
          )}
          {/* Worktree button - show for Claude Code consoles (even before thread exists) */}
          {consoleState.agent.type === 'claude-code' && (
            <WorktreeButton
              threadId={consoleState.threadId || consoleState.id}
              hasWorktree={!!consoleState.worktreePath}
              branch={consoleState.worktreeBranch}
              onEnableWorktree={() => setShowEnableWorktreeDialog(true)}
              onShowChanges={() => setShowWorktreePanel(true)}
            />
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
              title="Console Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
            {showSettings && onSettingsChange && (
              <ConsoleSettingsPopover
                settings={settings}
                onSettingsChange={(newSettings) => onSettingsChange(consoleState.id, newSettings)}
                consoleLabel={settings.label || ''}
                onLabelChange={(label) => onSettingsChange(consoleState.id, { ...settings, label: label || undefined })}
                onClose={() => setShowSettings(false)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Output */}
      <div ref={outputRef} className="flex-1 overflow-y-auto p-3 font-mono text-sm space-y-0.5">
        {filteredLines.map((line) => (
          <ConsoleLineItem key={line.id} line={line} showTimestamp={settings.showTimestamps !== false} />
        ))}
      </div>

      {/* Input */}
      <div className="flex-shrink-0 p-2 border-t border-zinc-800">
        <ChatInput
          onSend={handleSend}
          placeholder="Send message..."
          disabled={consoleState.isStreaming}
          showPrompt={true}
          promptIcon="❯"
          allowQueue={true}
          queuedMessage={consoleState.queuedMessage}
          onQueue={onQueueMessage ? (message, files) => onQueueMessage(consoleState.id, message, files) : undefined}
          onClearQueue={onClearQueue ? () => onClearQueue(consoleState.id) : undefined}
        />
      </div>

      {/* Worktree Panel - show if worktree is enabled */}
      {consoleState.worktreePath && consoleState.threadId && (
        <WorktreePanel
          threadId={consoleState.threadId}
          isOpen={showWorktreePanel}
          onClose={() => setShowWorktreePanel(false)}
          onMerged={() => onWorktreeMerged?.(consoleState.id)}
          onOpenTerminal={onOpenTerminal}
        />
      )}

      {/* Enable Worktree Dialog - works even before thread exists */}
      <EnableWorktreeDialog
        threadId={consoleState.threadId || `thread-${consoleState.id}`}
        threadName={settings.label || consoleState.agent.name}
        cwd={consoleState.path || workspacePath}
        hasExistingSession={consoleState.lines.some(l => l.type === 'output' || l.type === 'prompt')}
        isOpen={showEnableWorktreeDialog}
        onClose={() => setShowEnableWorktreeDialog(false)}
        onEnabled={(worktreePath, branch) => {
          console.log('[AgentConsoleWidget] onEnabled called:', { consoleId: consoleState.id, worktreePath, branch, hasCallback: !!onWorktreeEnabled });
          onWorktreeEnabled?.(consoleState.id, worktreePath, branch);
          setShowEnableWorktreeDialog(false);
        }}
      />
    </div>
  );
}

// Backwards compatibility alias
const TerminalWidget = AgentConsoleWidget;

// ============================================================================
// UNIFIED AGENT STATUS WIDGET
// ============================================================================

function UnifiedAgentStatusWidget({
  agents,
  consoles,
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
  consoles: ConsoleState[];
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
  const getConsoleCount = (agentId: string) => consoles.filter(c => c.agent.id === agentId).length;

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
            const consoleCount = getConsoleCount(agent.id);
            const isBusy = consoles.some(c => c.agent.id === agent.id && c.isStreaming);
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
                  {consoleCount > 0 && (
                    <span className="text-[10px] text-zinc-500">
                      {consoleCount} console{consoleCount > 1 ? 's' : ''}
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

/** Console summary for Run submenu */
interface ConsoleOption {
  id: string;
  label: string;
  agentIcon: string;
}

// Backwards compatibility alias
type TerminalOption = ConsoleOption;

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
                          New console
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
  consoles: ConsoleState[];
  agents: Agent[];
  planSteps: PlanStep[];
  minimizedWidgets: MinimizedWidget[];
  // Real PTY terminals
  realTerminals: TerminalInstance[];
  onCloseRealTerminal: (id: string) => void;
  onMinimizeRealTerminal: (terminal: TerminalInstance) => void;
  onRenameRealTerminal: (id: string, name: string) => void;
  // Focus/hover state
  focusedWidgetId: string | null;
  hoveredWidgetId: string | null;
  highlightedTerminalId: string | null;
  maximizedWidgetId: string | null;
  // Drag state
  activeDragId: string | null;
  overDropId: string | null;
  // Edge-aware drop zone state
  dropZone: DropZoneInfo | null;
  onDropZoneChange: (zone: DropZoneInfo | null) => void;
  // Callbacks
  onFocusWidget: (id: string, type: 'agent-console' | 'tasks' | 'agent-status' | 'terminal') => void;
  onHoverWidget: (id: string | null) => void;
  onCloseTerminal: (id: string) => void;
  onMinimizeTerminal: (terminal: TerminalState) => void;
  onMaximizeTerminal: (id: string) => void;
  onClearTerminal: (id: string) => void;
  onSendMessage: (terminalId: string, message: string, files?: UploadedFile[]) => void;
  onSettingsChange: (terminalId: string, settings: TerminalSettings) => void;
  onQueueMessage: (terminalId: string, message: string, files?: UploadedFile[]) => void;
  onClearQueue: (terminalId: string) => void;
  onWorktreeEnabled?: (terminalId: string, worktreePath: string, branch: string) => void;
  onWorktreeMerged?: (terminalId: string) => void;
  onOpenTerminal?: (cwd: string) => void;
  // Tasks widget props (legacy - kept for old TasksWidget)
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
  // WebSocket for new TasksWidget real-time updates
  ws?: WebSocket | null;
  // For sending task text to console
  onSendTaskToConsole?: (taskText: string, consoleId?: string) => void;
  // For highlighting/focusing a console by thread ID
  onHighlightConsole?: (threadId: string) => void;
  // Workspace path for filtering tasks/goals/sessions
  workspacePath?: string | null;
}

function LayoutRenderer({
  node,
  consoles: terminals, // Alias for backward compatibility with internal variable naming
  agents,
  planSteps,
  minimizedWidgets,
  realTerminals,
  onCloseRealTerminal,
  onMinimizeRealTerminal,
  onRenameRealTerminal,
  focusedWidgetId,
  hoveredWidgetId,
  highlightedTerminalId,
  maximizedWidgetId,
  activeDragId,
  overDropId,
  dropZone,
  onDropZoneChange,
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
  onWorktreeEnabled,
  onWorktreeMerged,
  onOpenTerminal,
  onExecute,
  isExecuting,
  onStepAgentChange,
  onSendStepToTerminal,
  onTerminalOptionHover,
  onAddStep,
  tasksVisible,
  showAgentStatus,
  ws,
  onSendTaskToConsole,
  onHighlightConsole,
  onCloseAgentStatus,
  onSplitPanel,
  onUpdateSizes,
  onClosePanel,
  workspacePath,
}: LayoutRendererProps) {
  const panelGroupRef = useRef<ImperativePanelGroupHandle>(null);

  // Render a leaf node (actual widget)
  if (node.type === 'leaf') {
    const { widgetType, widgetId } = node;

    if (widgetType === 'agent-console') {
      const terminal = terminals.find(t => t.id === widgetId);
      if (!terminal) {
        // Terminal was closed - remove panel from layout (deferred to avoid render-time state update)
        setTimeout(() => onClosePanel(node.id), 0);
        return null;
      }

      return (
        <EdgeAwareDroppable
          panelId={node.id}
          onDropZoneChange={onDropZoneChange}
          activeDropZone={dropZone}
          isDragging={!!activeDragId}
          isSourcePanel={activeDragId === node.id}
        >
          <div className="h-full p-1">
            <TerminalWidget
              console={terminal}
              onClose={() => onCloseTerminal(terminal.id)}
              onMinimize={() => onMinimizeTerminal(terminal)}
              onMaximize={() => onMaximizeTerminal(terminal.id)}
              onClear={() => onClearTerminal(terminal.id)}
              onSendMessage={onSendMessage}
              onSettingsChange={onSettingsChange}
              onQueueMessage={onQueueMessage}
              onClearQueue={onClearQueue}
              onWorktreeEnabled={onWorktreeEnabled}
              onWorktreeMerged={onWorktreeMerged}
              onOpenTerminal={onOpenTerminal}
              workspacePath={workspacePath ?? undefined}
              isHighlighted={highlightedTerminalId === terminal.id}
              isFocused={focusedWidgetId === terminal.id}
              isHovered={hoveredWidgetId === terminal.id}
              onFocus={() => onFocusWidget(terminal.id, 'agent-console')}
              onMouseEnter={() => onHoverWidget(terminal.id)}
              onMouseLeave={() => onHoverWidget(null)}
              panelId={node.id}
              onSplitRight={() => onSplitPanel(node.id, 'horizontal')}
              onSplitBelow={() => onSplitPanel(node.id, 'vertical')}
            />
          </div>
        </EdgeAwareDroppable>
      );
    }

    if (widgetType === 'tasks') {
      // Don't render if tasks are hidden
      if (!tasksVisible) {
        return null;
      }

      return (
        <EdgeAwareDroppable
          panelId={node.id}
          onDropZoneChange={onDropZoneChange}
          activeDropZone={dropZone}
          isDragging={!!activeDragId}
          isSourcePanel={activeDragId === node.id}
        >
          <div className="h-full p-1">
            <TasksWidgetContainer
              ws={ws}
              workspacePath={workspacePath ?? undefined}
              onSendToConsole={onSendTaskToConsole}
              onHighlightConsole={onHighlightConsole}
              onClose={() => {
                useWorkspaceStore.getState().setTasksVisible(false);
                onClosePanel(node.id);
              }}
              onMaximize={() => onMaximizeTerminal('tasks-widget')}
              isFocused={focusedWidgetId === 'tasks-widget'}
              isHovered={hoveredWidgetId === 'tasks-widget'}
              onFocus={() => onFocusWidget('tasks-widget', 'tasks')}
              onMouseEnter={() => onHoverWidget('tasks-widget')}
              onMouseLeave={() => onHoverWidget(null)}
              panelId={node.id}
            />
          </div>
        </EdgeAwareDroppable>
      );
    }

    if (widgetType === 'agent-status') {
      if (!showAgentStatus) {
        // Agent status is hidden - don't render
        return null;
      }

      return (
        <EdgeAwareDroppable
          panelId={node.id}
          onDropZoneChange={onDropZoneChange}
          activeDropZone={dropZone}
          isDragging={!!activeDragId}
          isSourcePanel={activeDragId === node.id}
        >
          <div className="h-full p-1">
            <UnifiedAgentStatusWidget
              agents={agents}
              consoles={terminals}
              onClose={() => {
                useWorkspaceStore.getState().setShowAgentStatus(false);
                onClosePanel(node.id);
              }}
              onMaximize={() => onMaximizeTerminal('agent-status-widget')}
              isFocused={focusedWidgetId === 'agent-status-widget'}
              isHovered={hoveredWidgetId === 'agent-status-widget'}
              onFocus={() => onFocusWidget('agent-status-widget', 'agent-status')}
              onMouseEnter={() => onHoverWidget('agent-status-widget')}
              onMouseLeave={() => onHoverWidget(null)}
              panelId={node.id}
            />
          </div>
        </EdgeAwareDroppable>
      );
    }

    if (widgetType === 'terminal') {
      // Real PTY-based terminal widget
      const terminalInstance = realTerminals.find(t => t.id === widgetId);
      if (!terminalInstance) {
        // Terminal was closed - remove panel from layout (deferred to avoid render-time state update)
        setTimeout(() => onClosePanel(node.id), 0);
        return null;
      }

      return (
        <EdgeAwareDroppable
          panelId={node.id}
          onDropZoneChange={onDropZoneChange}
          activeDropZone={dropZone}
          isDragging={!!activeDragId}
          isSourcePanel={activeDragId === node.id}
        >
          <div className="h-full p-1">
            <RealTerminalWidget
              terminal={terminalInstance}
              onClose={() => onCloseRealTerminal(terminalInstance.id)}
              onMinimize={() => onMinimizeRealTerminal(terminalInstance)}
              onMaximize={() => onMaximizeTerminal(terminalInstance.id)}
              onRename={onRenameRealTerminal}
              isFocused={focusedWidgetId === terminalInstance.id}
              isHovered={hoveredWidgetId === terminalInstance.id}
              onFocus={() => onFocusWidget(terminalInstance.id, 'terminal' as any)}
              onMouseEnter={() => onHoverWidget(terminalInstance.id)}
              onMouseLeave={() => onHoverWidget(null)}
              panelId={node.id}
            />
          </div>
        </EdgeAwareDroppable>
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
              consoles={terminals}
              agents={agents}
              planSteps={planSteps}
              minimizedWidgets={minimizedWidgets}
              realTerminals={realTerminals}
              onCloseRealTerminal={onCloseRealTerminal}
              onMinimizeRealTerminal={onMinimizeRealTerminal}
              onRenameRealTerminal={onRenameRealTerminal}
              focusedWidgetId={focusedWidgetId}
              hoveredWidgetId={hoveredWidgetId}
              highlightedTerminalId={highlightedTerminalId}
              maximizedWidgetId={maximizedWidgetId}
              activeDragId={activeDragId}
              overDropId={overDropId}
              dropZone={dropZone}
              onDropZoneChange={onDropZoneChange}
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
              onWorktreeEnabled={onWorktreeEnabled}
              onWorktreeMerged={onWorktreeMerged}
              onOpenTerminal={onOpenTerminal}
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
              ws={ws}
              onSendTaskToConsole={onSendTaskToConsole}
              onHighlightConsole={onHighlightConsole}
              workspacePath={workspacePath}
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

  // Terminals state (agent consoles)
  const [terminals, setTerminals] = useState<TerminalState[]>([]);
  const [minimizedWidgets, setMinimizedWidgets] = useState<MinimizedWidget[]>([]);
  const [highlightedTerminalId, setHighlightedTerminalId] = useState<string | null>(null);

  // Real PTY terminals
  const [realTerminals, setRealTerminals] = useState<TerminalInstance[]>([]);

  // WebSocket connection state
  const [wsConnected, setWsConnected] = useState(false);
  const wsReconnectAttempts = useRef(0);
  const wsReconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const [dropZone, setDropZone] = useState<DropZoneInfo | null>(null);

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

  // Fetch existing real terminals on mount
  useEffect(() => {
    const fetchTerminals = async () => {
      try {
        const res = await fetch(`${getApiUrl()}/api/terminals`);
        const data = await res.json();
        if (data.terminals) {
          setRealTerminals(data.terminals);
        }
      } catch (err) {
        console.error('Failed to fetch terminals:', err);
      }
    };
    fetchTerminals();
  }, []);

  // Refs for callback registration (to avoid dependency issues)
  const handleNewTerminalRef = useRef<(agentId: string, options?: ConsoleResumeOptions) => void>(() => {});
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
    useWorkspaceStore.getState().setConsoles(terminals.map(t => ({
      id: t.id,
      agentId: t.agent.id,
      agentName: t.agent.name,
    })));
  }, [terminals]);

  // Sync real PTY terminals to workspace store (for layout commands)
  useEffect(() => {
    useWorkspaceStore.getState().setRealTerminals(realTerminals.map(t => ({
      id: t.id,
      name: t.name || 'Terminal',
    })));
  }, [realTerminals]);

  // Sync workspace path
  useEffect(() => {
    useWorkspaceStore.getState().setWorkspacePath(workspacePath);
  }, [workspacePath]);

  // Register console creation callback for command palette (once on mount)
  useEffect(() => {
    useWorkspaceStore.getState().registerConsoleCallback((agentId: string, options?: ConsoleResumeOptions) => {
      handleNewTerminalRef.current(agentId, options);
    });
  }, []);

  // Register real terminal creation callback for command palette (once on mount)
  useEffect(() => {
    useWorkspaceStore.getState().registerTerminalCallback(async (cwd?: string) => {
      // Create terminal via HTTP - the server no longer broadcasts terminal:created events,
      // so the terminal only appears in this window (fixing multi-window isolation)
      try {
        const res = await fetch(`${getApiUrl()}/api/terminals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cwd: cwd || workspacePath || undefined }),
        });
        const data = await res.json();
        if (data.ok && data.terminal) {
          setRealTerminals(prev => [...prev, data.terminal]);
        } else {
          console.error('Failed to create terminal:', data.error);
        }
      } catch (err) {
        console.error('Failed to create terminal:', err);
      }
    });
  }, [workspacePath]);

  // Register task creation callback for command palette (once on mount)
  useEffect(() => {
    useWorkspaceStore.getState().registerTaskCallback((text: string, agentId: string | null) => {
      handleAddStepRef.current(text, agentId);
    });
  }, []);

  // Register terminal action callbacks for command palette
  useEffect(() => {
    useWorkspaceStore.getState().registerConsoleActionCallbacks({
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
    const widgets: Array<{ id: string; type: 'agent-console' | 'tasks' | 'agent-status' | 'terminal' }> = [];

    // Add agent consoles
    terminals.forEach(t => {
      widgets.push({ id: t.id, type: 'agent-console' });
    });

    // Add real terminals
    realTerminals.forEach(t => {
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
  }, [terminals, realTerminals, tasksVisible, showAgentStatus]);

  // ============================================================================
  // CTRL+C DOUBLE-PRESS TO STOP AGENT (Claude Code style)
  // ============================================================================
  const lastCtrlCTimeRef = useRef<number>(0);
  const ctrlCCountRef = useRef<number>(0);
  const DOUBLE_PRESS_THRESHOLD = 1500; // 1.5 seconds

  // Stop all running sessions for the focused console or all consoles
  const stopActiveSessions = useCallback(async (forceStop = false) => {
    // Find running sessions - check which terminals are streaming
    const runningSessions = terminals.filter(t => t.isStreaming);

    if (runningSessions.length === 0) {
      console.log('[Workspace] No running sessions to stop');
      return;
    }

    // Stop each running session
    for (const terminal of runningSessions) {
      const sessionId = terminal.threadId || terminal.id;
      try {
        const endpoint = forceStop
          ? `/sessions/${sessionId}/force-stop`
          : `/sessions/${sessionId}/stop`;

        await api.post(endpoint);
        console.log(`[Workspace] ${forceStop ? 'Force stopped' : 'Stopped'} session ${sessionId}`);

        // Update local terminal state - session stays active, just stop streaming
        setTerminals(prev => prev.map(t =>
          t.id === terminal.id
            ? {
                ...t,
                isStreaming: false,
                lines: [
                  ...t.lines,
                  {
                    id: crypto.randomUUID(),
                    type: 'system' as ConsoleLineType,
                    content: forceStop
                      ? '⚠️ Agent interrupted. You can continue the conversation.'
                      : '⚠️ Agent stopped. You can continue the conversation.',
                    timestamp: makeTimestamp(),
                  }
                ]
              }
            : t
        ));
      } catch (err) {
        console.error(`[Workspace] Failed to stop session ${sessionId}:`, err);
      }
    }
  }, [terminals]);

  // Global CTRL+C handler for stopping agents
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for CTRL+C (or CMD+C on Mac when not in an input)
      if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
        // Don't intercept if user is in an input field (they might be copying)
        const activeElement = document.activeElement;
        const isInInput = activeElement instanceof HTMLInputElement ||
                         activeElement instanceof HTMLTextAreaElement ||
                         activeElement?.getAttribute('contenteditable') === 'true';

        // Check if there's a text selection (user is copying text)
        const selection = window.getSelection();
        const hasTextSelection = selection && selection.toString().length > 0;

        // Only intercept if not in input and no text selected
        if (!isInInput && !hasTextSelection) {
          // Check if any sessions are running
          const hasRunningSessions = terminals.some(t => t.isStreaming);

          if (hasRunningSessions) {
            const now = Date.now();

            if (now - lastCtrlCTimeRef.current < DOUBLE_PRESS_THRESHOLD) {
              // Second press within threshold - force stop!
              e.preventDefault();
              ctrlCCountRef.current = 0;
              stopActiveSessions(true);
              console.log('[Workspace] Double CTRL+C detected - force stopping agent');
            } else {
              // First press - show warning and prepare for double-press
              e.preventDefault();
              ctrlCCountRef.current = 1;
              lastCtrlCTimeRef.current = now;

              // Add a visual hint to the running terminals
              setTerminals(prev => prev.map(t =>
                t.isStreaming
                  ? {
                      ...t,
                      lines: [
                        ...t.lines,
                        {
                          id: crypto.randomUUID(),
                          type: 'info' as ConsoleLineType,
                          content: '⏸️ Press CTRL+C again to stop the agent',
                          timestamp: makeTimestamp(),
                        }
                      ]
                    }
                  : t
              ));

              console.log('[Workspace] First CTRL+C - press again to stop agent');
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [terminals, stopActiveSessions]);

  // Initialize/update layout tree when terminals change
  useEffect(() => {
    if (!useFlexibleLayout) return;

    const currentLayout = useWorkspaceStore.getState().layoutTree;
    const consoleIds = terminals.map(t => t.id);

    // Build complete widgets array including all widget types
    const widgets = [
      // Content widgets
      ...terminals.map(t => ({ type: 'agent-console' as const, id: t.id })),
      ...realTerminals.map(t => ({ type: 'terminal' as const, id: t.id })),
      // Utility widgets
      ...(showAgentStatus ? [{ type: 'agent-status' as const, id: 'agent-status-widget' }] : []),
      ...(tasksVisible ? [{ type: 'tasks' as const, id: 'tasks-widget' }] : []),
    ];

    // If no layout yet, create default layout
    if (!currentLayout) {
      if (widgets.length > 0) {
        const newLayout = layoutHelpers.createDefaultLayout(widgets);
        useWorkspaceStore.getState().setLayoutTree(newLayout);
      }
      return;
    }

    // Check for widgets that need to be added to the layout
    // This handles terminals/consoles that were added outside of split actions
    // (e.g., fetched on page load or created via button click)
    const layoutConsoleIds = collectWidgetIds(currentLayout, 'agent-console');
    const layoutTerminalIds = collectWidgetIds(currentLayout, 'terminal');

    const newConsoleIds = consoleIds.filter(id => !layoutConsoleIds.includes(id));
    const newTerminalIds = realTerminals.map(t => t.id).filter(id => !layoutTerminalIds.includes(id));

    // Check for utility widgets (tasks, agent status)
    const layoutTasksIds = collectWidgetIds(currentLayout, 'tasks');
    const layoutAgentStatusIds = collectWidgetIds(currentLayout, 'agent-status');
    const hasTasksInLayout = layoutTasksIds.length > 0;
    const hasAgentStatusInLayout = layoutAgentStatusIds.length > 0;

    console.log('[LayoutSync] Check:', {
      realTerminalIds: realTerminals.map(t => t.id),
      layoutTerminalIds,
      newTerminalIds,
      layoutConsoleIds,
      newConsoleIds,
      tasksVisible,
      hasTasksInLayout,
      showAgentStatus,
      hasAgentStatusInLayout,
    });

    let updatedLayout = currentLayout;
    let needsUpdate = false;

    // Add new agent consoles
    if (newConsoleIds.length > 0) {
      console.log('[LayoutSync] Adding new consoles:', newConsoleIds);
      for (const newId of newConsoleIds) {
        updatedLayout = addTerminalToLayout(updatedLayout, newId);
      }
      needsUpdate = true;
    }

    // Add new real terminals
    if (newTerminalIds.length > 0) {
      console.log('[LayoutSync] Adding new terminals:', newTerminalIds);
      for (const newId of newTerminalIds) {
        updatedLayout = addRealTerminalToLayout(updatedLayout, newId);
      }
      needsUpdate = true;
    }

    // Handle tasks widget visibility
    if (tasksVisible && !hasTasksInLayout) {
      console.log('[LayoutSync] Adding tasks widget');
      updatedLayout = addUtilityWidgetToLayout(updatedLayout, 'tasks', 'tasks-widget');
      needsUpdate = true;
    } else if (!tasksVisible && hasTasksInLayout) {
      console.log('[LayoutSync] Removing tasks widget');
      updatedLayout = removeWidgetFromLayout(updatedLayout, 'tasks-widget');
      needsUpdate = true;
    }

    // Handle agent status widget visibility
    if (showAgentStatus && !hasAgentStatusInLayout) {
      console.log('[LayoutSync] Adding agent status widget');
      updatedLayout = addUtilityWidgetToLayout(updatedLayout, 'agent-status', 'agent-status-widget');
      needsUpdate = true;
    } else if (!showAgentStatus && hasAgentStatusInLayout) {
      console.log('[LayoutSync] Removing agent status widget');
      updatedLayout = removeWidgetFromLayout(updatedLayout, 'agent-status-widget');
      needsUpdate = true;
    }

    if (needsUpdate) {
      useWorkspaceStore.getState().setLayoutTree(updatedLayout);
    }
  }, [terminals, realTerminals, useFlexibleLayout, showAgentStatus, tasksVisible]);

  // Auto-save layout when it changes
  useEffect(() => {
    if (layoutTree && useFlexibleLayout) {
      useWorkspaceStore.getState().saveLayout();
    }
  }, [layoutTree, useFlexibleLayout]);

  // Helper to collect all widget IDs of a specific type from a layout tree
  const collectWidgetIds = (node: LayoutNode, widgetType: WidgetType): string[] => {
    if (node.type === 'leaf') {
      return node.widgetType === widgetType ? [node.widgetId] : [];
    }
    return node.children.flatMap(c => collectWidgetIds(c, widgetType));
  };

  // Helper to add a terminal to the layout (adds to first vertical group or creates one)
  const addTerminalToLayout = (tree: LayoutNode, terminalId: string): LayoutNode => {
    const newLeaf: LayoutLeaf = {
      type: 'leaf',
      id: layoutHelpers.generateLayoutId(),
      widgetType: 'agent-console',
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
      const hasTerminal = tree.children.some(c => c.type === 'leaf' && c.widgetType === 'agent-console');
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

  // Helper to add a real PTY terminal to the layout
  const addRealTerminalToLayout = (tree: LayoutNode, terminalId: string): LayoutNode => {
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

    // Find the first vertical group containing content widgets and add there
    if (tree.direction === 'vertical') {
      const hasContent = tree.children.some(c =>
        c.type === 'leaf' && (c.widgetType === 'agent-console' || c.widgetType === 'terminal')
      );
      if (hasContent) {
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
      const updatedFirst = addRealTerminalToLayout(firstChild, terminalId);
      return {
        ...tree,
        children: [updatedFirst, ...tree.children.slice(1)],
      };
    }

    return tree;
  };

  // Helper to add a utility widget (tasks, agent-status) to the layout
  const addUtilityWidgetToLayout = (tree: LayoutNode, widgetType: WidgetType, widgetId: string): LayoutNode => {
    const newLeaf: LayoutLeaf = {
      type: 'leaf',
      id: layoutHelpers.generateLayoutId(),
      widgetType,
      widgetId,
    };

    if (tree.type === 'leaf') {
      // Convert single leaf to horizontal group (utility widgets on the right)
      return {
        type: 'group',
        id: layoutHelpers.generateLayoutId(),
        direction: 'horizontal',
        children: [tree, newLeaf],
        sizes: [70, 30],
      };
    }

    // For groups, add as a new panel on the right side
    if (tree.direction === 'horizontal') {
      const newSizes = tree.sizes ? [...tree.sizes.map(s => s * 0.7), 30] : tree.children.map(() => 100 / (tree.children.length + 1));
      return {
        ...tree,
        children: [...tree.children, newLeaf],
        sizes: newSizes,
      };
    }

    // For vertical groups, wrap in a horizontal group
    return {
      type: 'group',
      id: layoutHelpers.generateLayoutId(),
      direction: 'horizontal',
      children: [tree, newLeaf],
      sizes: [70, 30],
    };
  };

  // Helper to remove a widget from the layout by widgetId
  const removeWidgetFromLayout = (tree: LayoutNode, widgetId: string): LayoutNode => {
    if (tree.type === 'leaf') {
      // If this is the widget to remove, return a placeholder (handled by caller)
      return tree;
    }

    // Filter out the widget from children
    const filteredChildren = tree.children.filter(child => {
      if (child.type === 'leaf' && child.widgetId === widgetId) {
        return false;
      }
      return true;
    });

    // Recursively process remaining children
    const processedChildren = filteredChildren.map(child =>
      child.type === 'group' ? removeWidgetFromLayout(child, widgetId) : child
    );

    // If only one child remains, return it directly (unwrap the group)
    if (processedChildren.length === 1) {
      return processedChildren[0];
    }

    // If no children remain, this shouldn't happen but handle gracefully
    if (processedChildren.length === 0) {
      return tree;
    }

    // Redistribute sizes evenly
    const newSizes = processedChildren.map(() => 100 / processedChildren.length);

    return {
      ...tree,
      children: processedChildren,
      sizes: newSizes,
    };
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
    // Handle terminal events (not wrapped in 'event')
    if (data.type === 'terminal:created' && data.terminal) {
      console.log('[WS] Terminal created:', data.terminal.id);
      setRealTerminals(prev => {
        // Avoid duplicates
        if (prev.some(t => t.id === data.terminal.id)) return prev;
        return [...prev, data.terminal];
      });
      return;
    }
    if (data.type === 'terminal:closed' && data.terminalId) {
      console.log('[WS] Terminal closed:', data.terminalId);
      setRealTerminals(prev => prev.filter(t => t.id !== data.terminalId));
      return;
    }
    if (data.type === 'terminal:exit' && data.terminalId) {
      console.log('[WS] Terminal exited:', data.terminalId, 'code:', data.code);
      setRealTerminals(prev => prev.map(t =>
        t.id === data.terminalId
          ? { ...t, status: 'exited' as const, exitCode: data.code, exitSignal: data.signal }
          : t
      ));
      return;
    }

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

    // Also check minimized widgets for matching terminal
    const matchesMinimizedWidget = (w: MinimizedWidget) => {
      if (w.type !== 'agent-console' || !w.data) return false;
      const t = w.data;
      if (threadId) {
        if (t.threadId === threadId) return true;
        const mappedTerminalId = threadToTerminalRef.current[threadId];
        if (mappedTerminalId && t.id === mappedTerminalId) return true;
        return false;
      }
      if (adapterId) return t.agent.id === adapterId;
      return false;
    };

    // Helper to update both visible terminals AND minimized widgets
    // Takes a function that receives the full previous array and returns the new array
    const updateAllTerminalsRaw = (
      terminalUpdater: (prev: TerminalState[]) => TerminalState[],
      minimizedUpdater?: (prev: MinimizedWidget[]) => MinimizedWidget[]
    ) => {
      setTerminals(terminalUpdater);
      if (minimizedUpdater) {
        setMinimizedWidgets(minimizedUpdater);
      } else {
        // Default: apply same logic to minimized widgets
        setMinimizedWidgets(prev => prev.map(w => {
          if (!matchesMinimizedWidget(w) || !w.data) return w;
          // Create a single-element array, run the updater, extract the result
          const updated = terminalUpdater([w.data]);
          return updated.length > 0 && updated[0] !== w.data
            ? { ...w, data: updated[0] }
            : w;
        }));
      }
    };

    // Simple helper for common case: update matching terminal with a transform function
    const updateAllTerminals = (updater: (t: TerminalState) => TerminalState) => {
      updateAllTerminalsRaw(
        prev => prev.map(t => matchesTerminal(t) ? updater(t) : t)
      );
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
            updateAllTerminals(t => ({ ...t, lines: [...t.lines, line], isStreaming: true }));
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
            updateAllTerminals(t => ({ ...t, lines: [...t.lines, line], isStreaming: true }));
          }
        }

        // content_block_delta: text_delta, thinking_delta, or input_json_delta
        if (streamEvent?.type === 'content_block_delta') {
          const delta = streamEvent.delta;
          const deltaType = delta?.type;

          if (deltaType === 'text_delta' && delta.text) {
            // Append text delta to terminal output
            updateAllTerminalsRaw(prev => prev.map(t => {
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
            updateAllTerminalsRaw(prev => prev.map(t => {
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
                updateAllTerminalsRaw(prev => prev.map(t => {
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

      // Handle SDK result message with error (e.g., rate limit, auth errors)
      if (msg.type === 'result' && msg.is_error) {
        const errorMessage = msg.result || 'An error occurred';
        console.error('[WS] Session result error:', errorMessage);

        updateAllTerminals(t => ({
          ...t,
          isStreaming: false,
          currentStepId: undefined,
          lines: [
            ...t.lines.map(l => ({ ...l, isStreaming: false })),
            {
              id: `error-${Date.now()}`,
              type: 'error' as const,
              content: errorMessage,
              timestamp: makeTimestamp(),
            },
          ],
        }));
        return;
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

      updateAllTerminals(t => ({
        ...t,
        lines: [...t.lines, line],
        isStreaming: event.payload.status === 'running',
      }));
    }

    if (event.type === 'content.delta' && event.payload?.delta) {
      // Append to last output line or create new one
      updateAllTerminalsRaw(prev => prev.map(t => {
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

    // Handle turn error: stop streaming and show error
    if (event.type === 'turn.error') {
      const errorMessage = event.payload?.message || event.payload?.error || 'Session error occurred';
      console.error('[WS] Turn error:', errorMessage);

      updateAllTerminals(t => ({
        ...t,
        isStreaming: false,
        currentStepId: undefined,
        lines: [
          ...t.lines.map(l => ({ ...l, isStreaming: false })),
          {
            id: `error-${Date.now()}`,
            type: 'error' as const,
            content: `Error: ${errorMessage}`,
            timestamp: makeTimestamp(),
          },
        ],
      }));
      return;
    }

    // Handle turn/item completion: update terminal streaming state and sync plan step + cost
    if (event.type === 'turn.completed' || event.type === 'item.completed') {
      if (event.type === 'turn.completed') toolInputByBlockRef.current = {};
      const matchedTerminal = terminalsRef.current.find(matchesTerminal);
      const stepIdToComplete = matchedTerminal?.currentStepId;
      const usage = event.type === 'turn.completed' ? event.payload?.usage : undefined;
      const queuedMsg = matchedTerminal?.queuedMessage;
      const terminalIdForQueue = matchedTerminal?.id;

      // Check if turn completed with an error (status: 'failed' from server)
      const isError = event.payload?.status === 'failed';
      const errorMessage = event.payload?.reason || event.payload?.result;

      updateAllTerminals(t => ({
        ...t,
        isStreaming: false,
        currentStepId: undefined,
        lines: [
          ...t.lines.map(l => ({ ...l, isStreaming: false })),
          // Add error line if turn completed with failed status
          ...(isError && errorMessage ? [{
            id: `error-${Date.now()}`,
            type: 'error' as const,
            content: errorMessage,
            timestamp: makeTimestamp(),
          }] : []),
        ],
        // Clear queued message since we'll send it (only if not an error)
        queuedMessage: (queuedMsg && !isError) ? null : t.queuedMessage,
      }));

      if (stepIdToComplete && usage) {
        setPlanSteps(prev => prev.map(s =>
          s.id === stepIdToComplete
            ? { ...s, status: 'completed' as const, costUsd: usage.costUsd ?? s.costUsd }
            : s
        ));
      }

      // Auto-send queued message after terminal finishes streaming (but not on error)
      if (queuedMsg && terminalIdForQueue && !isError) {
        // Use setTimeout to ensure state updates have been applied
        setTimeout(() => {
          handleTerminalMessageRef.current(terminalIdForQueue, queuedMsg.message, queuedMsg.files);
        }, 100);
      }

      // Do NOT auto-extract tasks from assistant result here — heuristic added list items and
      // intro text as "tasks". Extracted tasks come only from the server (extractor + task store).
    }
  }, []);

  // WebSocket connection for streaming events with reconnection
  useEffect(() => {
    let isCleaningUp = false;

    const connect = () => {
      if (isCleaningUp) return;

      console.log('[WS] Connecting to', getWebSocketUrl());
      const ws = new WebSocket(getWebSocketUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected');
        setWsConnected(true);
        wsReconnectAttempts.current = 0;
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          handleWsEvent(data);
        } catch (err) {
          console.error('[WS] Parse error:', err);
        }
      };

      ws.onerror = (e) => {
        console.warn('[WS] Error:', e);
      };

      ws.onclose = () => {
        console.warn('[WS] Closed');
        setWsConnected(false);
        wsRef.current = null;

        // Mark all streaming terminals as disconnected
        setTerminals(prev => prev.map(t =>
          !t.isStreaming ? t : {
            ...t,
            isStreaming: false,
            lines: [
              ...t.lines.map(l => ({ ...l, isStreaming: false })),
              {
                id: `disconnect-${Date.now()}`,
                type: 'system' as const,
                content: 'Connection lost. Reconnecting...',
                timestamp: makeTimestamp(),
              },
            ],
          }
        ));

        // Reconnect with exponential backoff (max 30 seconds)
        if (!isCleaningUp) {
          const delay = Math.min(1000 * Math.pow(2, wsReconnectAttempts.current), 30000);
          console.log(`[WS] Reconnecting in ${delay}ms (attempt ${wsReconnectAttempts.current + 1})`);
          wsReconnectAttempts.current++;

          wsReconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      };
    };

    connect();

    return () => {
      isCleaningUp = true;
      if (wsReconnectTimeoutRef.current) {
        clearTimeout(wsReconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [handleWsEvent]);

  // Terminal handlers
  const handleNewTerminal = useCallback((agentId?: string, initialMessageOrOptions?: string | ConsoleResumeOptions) => {
    const agent = agents.find(a => a.id === agentId) || agents[0];
    if (!agent) return;

    // Determine if we're resuming a session or creating a new one
    const isResumeOptions = typeof initialMessageOrOptions === 'object' && initialMessageOrOptions !== null;
    const resumeOptions = isResumeOptions ? initialMessageOrOptions : undefined;
    const initialMessage = typeof initialMessageOrOptions === 'string' ? initialMessageOrOptions : undefined;

    // For resumed sessions, use the existing threadId as the terminal ID for consistency
    const newTerminalId = resumeOptions?.threadId || `terminal-${Date.now()}`;

    const systemMessage = resumeOptions?.resume
      ? `Session resumed — ${agent.name}`
      : `Session started — ${agent.name}`;

    setTerminals(prev => [...prev, {
      id: newTerminalId,
      agent,
      lines: [{ id: `${Date.now()}`, type: 'system', content: systemMessage, timestamp: makeTimestamp() }],
      isStreaming: false,
      // If resuming, pre-populate the threadId so the session API uses it
      threadId: resumeOptions?.threadId,
      // Store the Claude Code SDK session ID for resume
      resumeSessionId: resumeOptions?.sessionId,
      // Use the original project path for resumed sessions (critical for SDK to find session files)
      path: resumeOptions?.projectPath,
    }]);

    // If an initial message was provided (non-resume case), send it after the terminal is created
    if (initialMessage) {
      // Use requestAnimationFrame + setTimeout to ensure state has updated
      requestAnimationFrame(() => {
        setTimeout(() => {
          handleTerminalMessageRef.current(newTerminalId, initialMessage);
        }, 50);
      });
    }

    // If resuming a session, automatically send a summary prompt to show the user context
    if (resumeOptions?.resume) {
      requestAnimationFrame(() => {
        setTimeout(() => {
          handleTerminalMessageRef.current(
            newTerminalId,
            'Please provide a brief summary of what we were working on in the previous session, including any pending tasks or next steps.'
          );
        }, 100);
      });
    }

    return newTerminalId;
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

    // Also remove the panel from the layout tree so the grid collapses
    const currentLayoutTree = useWorkspaceStore.getState().layoutTree;
    if (currentLayoutTree) {
      // Inline helper to find the panel ID for this terminal
      const findPanelId = (node: LayoutNode): string | null => {
        if (node.type === 'leaf') {
          return node.widgetId === terminalId ? node.id : null;
        }
        for (const child of node.children) {
          const found = findPanelId(child);
          if (found) return found;
        }
        return null;
      };
      const panelId = findPanelId(currentLayoutTree);
      if (panelId) {
        useWorkspaceStore.getState().closePanelInLayout(panelId);
      }
    }
  };

  // Rename a real PTY terminal
  const handleRenameRealTerminal = useCallback(async (terminalId: string, name: string) => {
    // Update local state optimistically
    setRealTerminals(prev => prev.map(t =>
      t.id === terminalId ? { ...t, name } : t
    ));

    // Update on server
    try {
      const res = await fetch(`${getApiUrl()}/api/terminals/${terminalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        console.warn('Failed to rename real terminal:', res.status);
      }
    } catch (err) {
      console.warn('Failed to rename real terminal:', err);
    }
  }, [getApiUrl]);

  // Close a real PTY terminal
  const handleCloseRealTerminal = useCallback(async (terminalId: string) => {
    // Remove from local state first
    setRealTerminals(prev => prev.filter(t => t.id !== terminalId));

    // Try to delete on server (may already be deleted if closed via WebSocket, which is fine)
    try {
      const res = await fetch(`${getApiUrl()}/api/terminals/${terminalId}`, { method: 'DELETE' });
      // 404 is expected if terminal was already closed via WebSocket message
      if (!res.ok && res.status !== 404) {
        console.warn('Failed to close real terminal:', res.status);
      }
    } catch (err) {
      // Network errors are still worth logging
      console.warn('Failed to close real terminal:', err);
    }

    // Also remove the panel from the layout tree
    const currentLayoutTree = useWorkspaceStore.getState().layoutTree;
    if (currentLayoutTree) {
      const findPanelId = (node: LayoutNode): string | null => {
        if (node.type === 'leaf') {
          return node.widgetId === terminalId ? node.id : null;
        }
        for (const child of node.children) {
          const found = findPanelId(child);
          if (found) return found;
        }
        return null;
      };
      const panelId = findPanelId(currentLayoutTree);
      if (panelId) {
        useWorkspaceStore.getState().closePanelInLayout(panelId);
      }
    }
  }, []);

  const handleMinimizeTerminal = (terminal: TerminalState) => {
    setMinimizedWidgets(prev => [...prev, { id: terminal.id, type: 'agent-console', title: terminal.agent.name, icon: terminal.agent.icon, data: terminal }]);
    setTerminals(prev => prev.filter(t => t.id !== terminal.id));
    // Clear focus if this terminal was focused
    if (focusedWidgetId === terminal.id) {
      useWorkspaceStore.getState().setFocusedWidget(null, null);
    }
    // Clear maximized if this terminal was maximized
    if (maximizedWidgetId === terminal.id) {
      useWorkspaceStore.getState().setMaximizedWidget(null);
    }
    // Also remove the panel from the layout tree so the grid collapses
    const currentLayoutTree = useWorkspaceStore.getState().layoutTree;
    if (currentLayoutTree) {
      const findPanelId = (node: LayoutNode): string | null => {
        if (node.type === 'leaf') {
          return node.widgetId === terminal.id ? node.id : null;
        }
        for (const child of node.children) {
          const found = findPanelId(child);
          if (found) return found;
        }
        return null;
      };
      const panelId = findPanelId(currentLayoutTree);
      if (panelId) {
        useWorkspaceStore.getState().closePanelInLayout(panelId);
      }
    }
  };

  const handleMinimizeRealTerminal = (terminal: TerminalInstance) => {
    setMinimizedWidgets(prev => [...prev, {
      id: terminal.id,
      type: 'terminal',
      title: terminal.name || 'Terminal',
      icon: '💻',
      terminalData: terminal
    }]);
    setRealTerminals(prev => prev.filter(t => t.id !== terminal.id));
    // Clear focus if this terminal was focused
    if (focusedWidgetId === terminal.id) {
      useWorkspaceStore.getState().setFocusedWidget(null, null);
    }
    // Clear maximized if this terminal was maximized
    if (maximizedWidgetId === terminal.id) {
      useWorkspaceStore.getState().setMaximizedWidget(null);
    }
    // Also remove the panel from the layout tree so the grid collapses
    const currentLayoutTree = useWorkspaceStore.getState().layoutTree;
    if (currentLayoutTree) {
      const findPanelId = (node: LayoutNode): string | null => {
        if (node.type === 'leaf') {
          return node.widgetId === terminal.id ? node.id : null;
        }
        for (const child of node.children) {
          const found = findPanelId(child);
          if (found) return found;
        }
        return null;
      };
      const panelId = findPanelId(currentLayoutTree);
      if (panelId) {
        useWorkspaceStore.getState().closePanelInLayout(panelId);
      }
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

  const handleFocusWidget = (widgetId: string, widgetType: 'agent-console' | 'tasks' | 'agent-status' | 'terminal') => {
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

    // Capture drop zone before clearing state
    const currentDropZone = dropZone;

    setActiveDragId(null);
    setOverDropId(null);
    setDropZone(null);

    if (!over || active.id === over.id) return;

    // Extract panel IDs (over.id is prefixed with "drop-")
    const sourcePanelId = active.id as string;
    const targetPanelId = (over.id as string).replace('drop-', '');

    if (sourcePanelId !== targetPanelId) {
      // Use the detected drop position, default to 'center' for swap behavior
      const position = currentDropZone?.panelId === targetPanelId
        ? currentDropZone.position
        : 'center';

      // movePanel handles all cases: center = swap, edges = split
      useWorkspaceStore.getState().movePanel(sourcePanelId, targetPanelId, position);
    }
  }, [dropZone]);

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
    setOverDropId(null);
    setDropZone(null);
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

  // Handle worktree enabled - update console state with worktree info
  const handleWorktreeEnabled = (terminalId: string, worktreePath: string, branch: string) => {
    console.log('[Worktree] Enabling worktree:', { terminalId, worktreePath, branch });
    setTerminals(prev => {
      const updated = prev.map(t => {
        if (t.id !== terminalId) return t;

        // If thread didn't exist before, set it now (worktree was enabled before first message)
        const threadId = t.threadId || `thread-${terminalId}`;
        if (!t.threadId) {
          // Register mapping for WebSocket events
          threadToTerminalRef.current[threadId] = terminalId;
        }

        console.log('[Worktree] Updating terminal:', { id: t.id, threadId, worktreePath, branch });
        return {
          ...t,
          threadId,
          worktreePath,
          worktreeBranch: branch,
          path: worktreePath,
        };
      });
      console.log('[Worktree] Updated terminals:', updated.map(t => ({ id: t.id, worktreePath: t.worktreePath, worktreeBranch: t.worktreeBranch })));
      return updated;
    });
  };

  // Handle worktree merged - clear worktree info from console state
  const handleWorktreeMerged = (terminalId: string) => {
    console.log('[Worktree] Merged worktree:', { terminalId });
    setTerminals(prev => {
      const updated = prev.map(t => {
        if (t.id !== terminalId) return t;

        // Revert path to workspace path (worktree path is no longer valid)
        const originalPath = workspacePath || t.path;

        console.log('[Worktree] Clearing worktree state, reverting to:', { id: t.id, originalPath });
        return {
          ...t,
          worktreePath: undefined,
          worktreeBranch: undefined,
          path: originalPath,
        };
      });
      return updated;
    });
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
        const resumeSessionId = terminal.resumeSessionId;

        // Create thread/session if needed (Phase 2/3) or resume existing
        if (!threadId || !terminal.sessionActive) {
          // If threadId already exists (resume case), use it; otherwise generate new
          if (!threadId) {
            threadId = `thread-${terminalId}`;
          }

          // Register mapping immediately (before async state update)
          threadToTerminalRef.current[threadId] = terminalId;

          const sessionRes = await fetch(`${getApiUrl()}/threads/${threadId}/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cwd,
              name: `${terminal.agent.name} - ${new Date().toLocaleString()}`,
              // Pass resume flag and session ID if resuming a previous session
              resume: !!resumeSessionId,
              sessionId: resumeSessionId,
            }),
          });
          const sessionData = await sessionRes.json();

          if (!sessionData.ok) {
            throw new Error(sessionData.error || 'Failed to create session');
          }
          setTerminals(prev => prev.map(t =>
            t.id === terminalId ? { ...t, threadId, sessionActive: true, currentStepId: extractedStepId, resumeSessionId: undefined } : t
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
        const minimized = minimizedWidgets.find(w => w.type === 'agent-console' && w.id === terminalId && w.data);
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

  // Handler for sending task text to terminal (used by new TasksWidget)
  const handleSendTaskToTerminal = useCallback((taskText: string, terminalId?: string) => {
    // Use the first available terminal if none specified
    const targetTerminal = terminalId
      ? terminals.find(t => t.id === terminalId)
      : terminals[0];

    if (targetTerminal) {
      handleTerminalMessage(targetTerminal.id, taskText);
    } else if (agents.length > 0) {
      // Create a new terminal with the first agent
      const agent = agents[0];
      const newConsoleId = `terminal-${Date.now()}`;
      const newConsole: ConsoleState = {
        id: newConsoleId,
        agent,
        lines: [],
        isStreaming: false,
        threadId: undefined,
        settings: {},
      };
      setTerminals(prev => [...prev, newConsole]);
      // Send message after console is created
      setTimeout(() => handleTerminalMessage(newConsoleId, taskText), 100);
    }
  }, [terminals, agents, handleTerminalMessage]);

  // Handler for highlighting a console by its threadId (session ID)
  const handleHighlightTerminal = useCallback((threadId: string) => {
    // First check the ref for fast lookup
    let consoleId: string | undefined = threadToTerminalRef.current[threadId];

    // If not in ref, search by threadId in terminals (consoles)
    if (!consoleId) {
      const console = terminals.find(t => t.threadId === threadId);
      consoleId = console?.id;
    }

    if (consoleId) {
      // Highlight the console briefly
      setHighlightedTerminalId(consoleId);
      // Focus the console
      handleFocusWidget(consoleId, 'agent-console');
      // Clear highlight after 2 seconds
      setTimeout(() => setHighlightedTerminalId(null), 2000);
    } else {
      console.log('[Workspace] No terminal found for threadId:', threadId);
    }
  }, [terminals, handleFocusWidget]);

  // Update ref for command palette
  useEffect(() => {
    handleAddStepRef.current = handleAddStep;
  }, [handleAddStep]);

  // Minimize/restore handlers
  const handleRestoreWidget = (widget: MinimizedWidget) => {
    setMinimizedWidgets(prev => prev.filter(w => w.id !== widget.id));
    if (widget.type === 'agent-console' && widget.data) {
      setTerminals(prev => [...prev, widget.data!]);
    } else if (widget.type === 'terminal' && widget.terminalData) {
      setRealTerminals(prev => [...prev, widget.terminalData!]);
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
              title="Add console or agent"
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
                      <MonitorDot className="w-4 h-4 text-cyan-400" />
                      <span>Agent Console</span>
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
                    <button
                      onClick={async () => {
                        try {
                          const res = await fetch(`${getApiUrl()}/api/terminals`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ cwd: workspacePath || undefined }),
                          });
                          const data = await res.json();
                          if (data.ok && data.terminal) {
                            // Add to state - the layout sync effect will add it to the layout
                            setRealTerminals(prev => [...prev, data.terminal]);
                          }
                        } catch (err) {
                          console.error('Failed to create terminal:', err);
                        }
                        setShowAddMenu(false);
                      }}
                      className="w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
                    >
                      <TerminalIcon className="w-4 h-4 text-amber-400" />
                      <span>Terminal</span>
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
        ) : terminals.length === 0 && realTerminals.length === 0 && !tasksVisible && !showAgentStatus ? (
          /* Project Starting Point - empty state with task input and quick actions */
          <ProjectStartingPoint
            workspacePath={workspacePath}
            agents={agents}
            onSubmit={(task) => {
              // Use the default agent (Claude Code)
              const agent = agents.find(a => a.type === 'claude-code') || agents[0];
              if (!agent) return;

              // Create a new console and send the initial message
              handleNewTerminal(agent.id, task);
            }}
          />
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
              consoles={terminals}
              agents={agents}
              planSteps={planSteps}
              minimizedWidgets={minimizedWidgets}
              realTerminals={realTerminals}
              onCloseRealTerminal={handleCloseRealTerminal}
              onMinimizeRealTerminal={handleMinimizeRealTerminal}
              onRenameRealTerminal={handleRenameRealTerminal}
              focusedWidgetId={focusedWidgetId}
              hoveredWidgetId={hoveredWidgetId}
              highlightedTerminalId={highlightedTerminalId}
              maximizedWidgetId={maximizedWidgetId}
              activeDragId={activeDragId}
              overDropId={overDropId}
              dropZone={dropZone}
              onDropZoneChange={setDropZone}
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
              onWorktreeEnabled={handleWorktreeEnabled}
              onWorktreeMerged={handleWorktreeMerged}
              onOpenTerminal={(cwd) => useWorkspaceStore.getState().createTerminal(cwd)}
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
              ws={wsRef.current}
              onSendTaskToConsole={handleSendTaskToTerminal}
              onHighlightConsole={handleHighlightTerminal}
              workspacePath={workspacePath}
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
                          console={terminal}
                          onClose={() => handleCloseTerminal(terminal.id)}
                          onMinimize={() => handleMinimizeTerminal(terminal)}
                          onMaximize={() => handleMaximizeTerminal(terminal.id)}
                          onClear={() => handleClearTerminal(terminal.id)}
                          onSendMessage={handleTerminalMessage}
                          onSettingsChange={handleTerminalSettingsChange}
                          onQueueMessage={handleQueueMessage}
                          onClearQueue={handleClearQueue}
                          onWorktreeEnabled={handleWorktreeEnabled}
                          onWorktreeMerged={handleWorktreeMerged}
                          onOpenTerminal={(cwd) => useWorkspaceStore.getState().createTerminal(cwd)}
                          workspacePath={workspacePath ?? undefined}
                          isHighlighted={highlightedTerminalId === terminal.id}
                          isFocused={focusedWidgetId === terminal.id}
                          isHovered={hoveredWidgetId === terminal.id}
                          onFocus={() => handleFocusWidget(terminal.id, 'agent-console')}
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
                <TasksWidgetContainer
                  ws={wsRef.current}
                  workspacePath={workspacePath ?? undefined}
                  onSendToConsole={handleSendTaskToTerminal}
                  onHighlightConsole={handleHighlightTerminal}
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
          {minimizedWidgets.map(widget => {
            // Get the current console state to check if it's streaming
            const consoleState = widget.type === 'agent-console' ? terminals.find(t => t.id === widget.id) : null;
            const isStreaming = consoleState?.isStreaming || widget.data?.isStreaming;

            return (
              <div
                key={widget.id}
                onClick={() => handleRestoreWidget(widget)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer group transition-all duration-150 ${
                  widget.type === 'agent-console' && highlightedTerminalId === widget.id
                    ? 'ring-1 ring-violet-400/50 terminal-tab-highlight-pulse'
                    : 'bg-zinc-800 hover:bg-zinc-700'
                }`}
              >
                <span>{widget.icon}</span>
                <span className="text-zinc-300 max-w-[100px] truncate">{widget.title}</span>
                {isStreaming && (
                  <Loader2 className="w-3 h-3 text-violet-400 animate-spin" />
                )}
                <button onClick={(e) => { e.stopPropagation(); setMinimizedWidgets(prev => prev.filter(w => w.id !== widget.id)); }} className="text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100">
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Maximized Widget Overlay */}
      {maximizedWidgetId && (() => {
        const maximizedTerminal = terminals.find(t => t.id === maximizedWidgetId);
        const maximizedRealTerminal = realTerminals.find(t => t.id === maximizedWidgetId);
        const isTasksMaximized = maximizedWidgetId === 'tasks-widget';

        if (maximizedRealTerminal) {
          return (
            <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
              <div
                className="w-full h-full max-w-[95vw] max-h-[90vh] animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
              >
                <RealTerminalWidget
                  terminal={maximizedRealTerminal}
                  onClose={() => handleCloseRealTerminal(maximizedRealTerminal.id)}
                  onMinimize={() => handleMinimizeRealTerminal(maximizedRealTerminal)}
                  onMaximize={() => handleMaximizeTerminal(maximizedRealTerminal.id)}
                  onRename={handleRenameRealTerminal}
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

        if (maximizedTerminal) {
          return (
            <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
              <div
                className="w-full h-full max-w-[95vw] max-h-[90vh] animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
              >
                <AgentConsoleWidget
                  console={maximizedTerminal}
                  onClose={() => handleCloseTerminal(maximizedTerminal.id)}
                  onMinimize={() => handleMinimizeTerminal(maximizedTerminal)}
                  onMaximize={() => handleMaximizeTerminal(maximizedTerminal.id)}
                  onClear={() => handleClearTerminal(maximizedTerminal.id)}
                  onSendMessage={handleTerminalMessage}
                  onSettingsChange={handleTerminalSettingsChange}
                  onQueueMessage={handleQueueMessage}
                  onClearQueue={handleClearQueue}
                  onWorktreeEnabled={handleWorktreeEnabled}
                  onWorktreeMerged={handleWorktreeMerged}
                  onOpenTerminal={(cwd) => useWorkspaceStore.getState().createTerminal(cwd)}
                  workspacePath={workspacePath ?? undefined}
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
                <TasksWidgetContainer
                  ws={wsRef.current}
                  workspacePath={workspacePath ?? undefined}
                  onSendToConsole={handleSendTaskToTerminal}
                  onHighlightConsole={handleHighlightTerminal}
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
