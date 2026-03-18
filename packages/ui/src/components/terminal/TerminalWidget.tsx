/**
 * Terminal Widget Component
 *
 * Real PTY-based terminal using xterm.js for rendering and node-pty on the server.
 * Provides a full shell experience (bash, zsh, etc.) within the application.
 *
 * Styled to match AgentConsoleWidget with traffic light buttons, drag handle, etc.
 */

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { useDraggable } from '@dnd-kit/core';
import '@xterm/xterm/css/xterm.css';
import {
  X,
  Minus,
  Maximize2,
  Search,
  ChevronUp,
  ChevronDown,
  GripVertical,
  Terminal as TerminalIcon,
} from 'lucide-react';
import { getWsUrl } from '../../stores/app';
import type { TerminalInstance, TerminalServerMessage } from '@acc/contracts';

// ============================================================================
// TYPES
// ============================================================================

export interface TerminalWidgetProps {
  /** Terminal instance data from server */
  terminal?: TerminalInstance;
  /** Callback when terminal should be closed */
  onClose?: () => void;
  /** Callback when terminal should be minimized */
  onMinimize?: () => void;
  /** Callback when terminal should be maximized */
  onMaximize?: () => void;
  /** Whether this widget is focused */
  isFocused?: boolean;
  /** Whether this widget is hovered */
  isHovered?: boolean;
  /** Callback when widget receives focus */
  onFocus?: () => void;
  /** Callback when mouse enters */
  onMouseEnter?: () => void;
  /** Callback when mouse leaves */
  onMouseLeave?: () => void;
  /** Panel ID for drag-and-drop */
  panelId?: string;
}

export interface TerminalWidgetHandle {
  /** Focus the terminal */
  focus: () => void;
  /** Write data to the terminal */
  write: (data: string) => void;
  /** Clear the terminal */
  clear: () => void;
  /** Resize the terminal */
  resize: () => void;
}

// ============================================================================
// DRAGGABLE HANDLE (same as AgentConsoleWidget)
// ============================================================================

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

// ============================================================================
// TERMINAL WIDGET COMPONENT
// ============================================================================

export const TerminalWidget = forwardRef<TerminalWidgetHandle, TerminalWidgetProps>(
  function TerminalWidget(
    { terminal, onClose, onMinimize, onMaximize, isFocused, isHovered, onFocus, onMouseEnter, onMouseLeave, panelId },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const searchAddonRef = useRef<SearchAddon | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [isTerminalReady, setIsTerminalReady] = useState(false);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Expose imperative handle
    useImperativeHandle(ref, () => ({
      focus: () => {
        terminalRef.current?.focus();
      },
      write: (data: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN && terminal) {
          wsRef.current.send(JSON.stringify({
            type: 'terminal:input',
            terminalId: terminal.id,
            data,
          }));
        }
      },
      clear: () => {
        terminalRef.current?.clear();
      },
      resize: () => {
        fitAddonRef.current?.fit();
      },
    }));

    // Initialize xterm.js terminal
    useEffect(() => {
      if (!containerRef.current) return;

      const container = containerRef.current;
      let term: Terminal | null = null;
      let fitAddon: FitAddon | null = null;
      let searchAddon: SearchAddon | null = null;
      let resizeObserver: ResizeObserver | null = null;
      let isInitialized = false;
      let isCancelled = false; // Track if effect was cleaned up

      const initTerminal = () => {
        // Don't initialize if effect was cleaned up (React Strict Mode double-mount)
        if (isCancelled || isInitialized || !container) return;

        // Check if container has valid dimensions
        const rect = container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          // Container not ready yet, retry
          requestAnimationFrame(initTerminal);
          return;
        }

        isInitialized = true;

        // Clear any existing xterm elements from the container (handles React Strict Mode remount)
        container.innerHTML = '';

        term = new Terminal({
          cursorBlink: true,
          cursorStyle: 'block',
          fontSize: 13,
          fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
          theme: {
            background: '#0d1117', // Match AgentConsoleWidget background
            foreground: '#e4e4e7',
            cursor: '#a1a1aa',
            cursorAccent: '#0d1117',
            selectionBackground: '#3f3f46',
            black: '#27272a',
            red: '#f87171',
            green: '#4ade80',
            yellow: '#facc15',
            blue: '#60a5fa',
            magenta: '#c084fc',
            cyan: '#22d3ee',
            white: '#e4e4e7',
            brightBlack: '#52525b',
            brightRed: '#fca5a5',
            brightGreen: '#86efac',
            brightYellow: '#fde047',
            brightBlue: '#93c5fd',
            brightMagenta: '#d8b4fe',
            brightCyan: '#67e8f9',
            brightWhite: '#fafafa',
          },
          allowProposedApi: true,
          scrollback: 10000,
        });

        fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon();
        searchAddon = new SearchAddon();

        term.loadAddon(fitAddon);
        term.loadAddon(webLinksAddon);
        term.loadAddon(searchAddon);

        term.open(container);

        // Delay fit() to ensure the terminal is fully rendered
        requestAnimationFrame(() => {
          fitAddon?.fit();
        });

        terminalRef.current = term;
        fitAddonRef.current = fitAddon;
        searchAddonRef.current = searchAddon;

        // Signal that terminal is ready for WebSocket connection
        setIsTerminalReady(true);

        // ResizeObserver for container resize
        resizeObserver = new ResizeObserver(() => {
          // Only fit if terminal is initialized and container has valid dimensions
          const rect = container.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && fitAddon) {
            try {
              fitAddon.fit();
            } catch (e) {
              // Ignore fit errors during rapid resize
            }
          }
        });
        resizeObserver.observe(container);
      };

      // Handle window resize
      const handleResize = () => {
        if (fitAddonRef.current) {
          try {
            fitAddonRef.current.fit();
          } catch (e) {
            // Ignore fit errors during rapid resize
          }
        }
      };
      window.addEventListener('resize', handleResize);

      // Start initialization
      requestAnimationFrame(initTerminal);

      return () => {
        isCancelled = true;
        window.removeEventListener('resize', handleResize);
        resizeObserver?.disconnect();
        term?.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
        searchAddonRef.current = null;
        setIsTerminalReady(false);
        // Clear container to prevent leftover xterm elements
        if (container) {
          container.innerHTML = '';
        }
      };
    }, []);

    // Connect to WebSocket when terminal instance and xterm are ready
    useEffect(() => {
      if (!terminal || !isTerminalReady || !terminalRef.current) return;

      const wsUrl = getWsUrl();
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        // Attach to terminal to receive output
        ws.send(JSON.stringify({
          type: 'terminal:attach',
          terminalId: terminal.id,
        }));
      };

      ws.onmessage = (event) => {
        try {
          const msg: TerminalServerMessage = JSON.parse(event.data);

          switch (msg.type) {
            case 'terminal:output':
              if (msg.terminalId === terminal.id) {
                terminalRef.current?.write(msg.data);
              }
              break;
            case 'terminal:exit':
              if (msg.terminalId === terminal.id) {
                terminalRef.current?.write(`\r\n\x1b[90m[Process exited with code ${msg.code}]\x1b[0m\r\n`);
              }
              break;
            case 'terminal:error':
              if (msg.terminalId === terminal.id) {
                terminalRef.current?.write(`\r\n\x1b[31m[Error: ${msg.error}]\x1b[0m\r\n`);
              }
              break;
          }
        } catch (err) {
          console.error('[TerminalWidget] Failed to parse message:', err);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
      };

      ws.onerror = () => {
        setIsConnected(false);
      };

      // Send terminal input to server
      const handleData = terminalRef.current.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'terminal:input',
            terminalId: terminal.id,
            data,
          }));
        }
      });

      // Send resize events to server
      const handleTermResize = terminalRef.current.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'terminal:resize',
            terminalId: terminal.id,
            cols,
            rows,
          }));
        }
      });

      return () => {
        handleData.dispose();
        handleTermResize.dispose();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'terminal:detach',
            terminalId: terminal.id,
          }));
        }
        ws.close();
        wsRef.current = null;
      };
    }, [terminal, isTerminalReady]);

    // Focus terminal when widget becomes focused
    useEffect(() => {
      if (isFocused && terminalRef.current) {
        terminalRef.current.focus();
      }
    }, [isFocused]);

    // Handle search
    const handleSearch = useCallback((direction: 'next' | 'previous') => {
      if (!searchAddonRef.current || !searchQuery) return;
      if (direction === 'next') {
        searchAddonRef.current.findNext(searchQuery);
      } else {
        searchAddonRef.current.findPrevious(searchQuery);
      }
    }, [searchQuery]);

    // Toggle search bar
    const toggleSearch = useCallback(() => {
      setIsSearchOpen((prev) => {
        if (!prev) {
          setTimeout(() => searchInputRef.current?.focus(), 50);
        }
        return !prev;
      });
    }, []);

    // Handle close
    const handleClose = useCallback(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN && terminal) {
        wsRef.current.send(JSON.stringify({
          type: 'terminal:close',
          terminalId: terminal.id,
        }));
      }
      onClose?.();
    }, [terminal, onClose]);

    // Handle click to focus
    const handleContainerClick = useCallback(() => {
      onFocus?.();
      terminalRef.current?.focus();
    }, [onFocus]);

    // Border class based on state (matching AgentConsoleWidget)
    const getBorderClass = () => {
      if (isFocused) return 'border-blue-400/60 ring-1 ring-blue-400/30';
      if (isHovered) return 'border-zinc-600';
      return 'border-zinc-800';
    };

    // Title bar class based on state
    const getTitleBarClass = () => {
      if (isFocused) return 'bg-blue-900/30 border-blue-400/40';
      if (isHovered) return 'bg-zinc-800 border-zinc-700';
      return 'bg-zinc-900 border-zinc-800';
    };

    return (
      <div
        className={`h-full bg-[#0d1117] border rounded-lg flex flex-col overflow-hidden transition-all duration-150 ${getBorderClass()}`}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={handleContainerClick}
      >
        {/* Title Bar - matching AgentConsoleWidget style */}
        <div
          className={`flex-shrink-0 px-3 py-2 border-b flex items-center justify-between transition-all duration-150 cursor-pointer ${getTitleBarClass()}`}
          onClick={(e) => { e.stopPropagation(); onFocus?.(); }}
        >
          <div className="flex items-center gap-2">
            {/* Drag handle */}
            {panelId && <DraggableHandle panelId={panelId} />}

            {/* Traffic light buttons */}
            <div className="flex items-center gap-1.5 mr-2">
              <button
                onClick={(e) => { e.stopPropagation(); handleClose(); }}
                className="group w-3 h-3 rounded-full bg-red-500/80 hover:bg-red-500 flex items-center justify-center"
              >
                <X className="w-2 h-2 text-red-900 opacity-0 group-hover:opacity-100" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onMinimize?.(); }}
                className="group w-3 h-3 rounded-full bg-yellow-500/80 hover:bg-yellow-500 flex items-center justify-center"
              >
                <Minus className="w-2 h-2 text-yellow-900 opacity-0 group-hover:opacity-100" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onMaximize?.(); }}
                className="group w-3 h-3 rounded-full bg-green-500/80 hover:bg-green-500 flex items-center justify-center"
              >
                <Maximize2 className="w-2 h-2 text-green-900 opacity-0 group-hover:opacity-100" />
              </button>
            </div>

            {/* Terminal icon and name */}
            <TerminalIcon className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs font-medium text-zinc-300">
              {terminal?.name || 'Terminal'}
            </span>

            {/* Connection status */}
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isConnected ? 'bg-emerald-500' : 'bg-zinc-500'
              }`}
              title={isConnected ? 'Connected' : 'Disconnected'}
            />
          </div>

          <div className="flex items-center gap-2">
            {/* CWD display */}
            {terminal?.cwd && (
              <span className="text-[10px] text-zinc-500 font-mono truncate max-w-[200px]">
                {terminal.cwd}
              </span>
            )}

            {/* Search button */}
            <button
              onClick={(e) => { e.stopPropagation(); toggleSearch(); }}
              className={`p-1 rounded transition-colors ${
                isSearchOpen ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'
              }`}
              title="Search (Ctrl+F)"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Search bar */}
        {isSearchOpen && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900/50 border-b border-zinc-800">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSearch(e.shiftKey ? 'previous' : 'next');
                } else if (e.key === 'Escape') {
                  setIsSearchOpen(false);
                }
              }}
              placeholder="Search..."
              className="flex-1 px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => handleSearch('previous')}
              className="p-1 rounded hover:bg-zinc-700 text-zinc-400 transition-colors"
              title="Previous match"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleSearch('next')}
              className="p-1 rounded hover:bg-zinc-700 text-zinc-400 transition-colors"
              title="Next match"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIsSearchOpen(false)}
              className="p-1 rounded hover:bg-zinc-700 text-zinc-400 transition-colors"
              title="Close search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Terminal container - xterm.js renders here */}
        <div
          ref={containerRef}
          className="flex-1 min-h-0 overflow-hidden xterm-container"
          style={{
            minHeight: '100px',
            // Debug: red border to see container bounds
            // border: '2px solid red',
          }}
        />
      </div>
    );
  }
);

export default TerminalWidget;
