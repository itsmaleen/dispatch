import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Cpu, Globe, Zap, FolderOpen } from 'lucide-react';
import type { Agent } from '../../stores/app';

interface AgentSelectorProps {
  agents: Agent[];
  selected: string | null;
  onSelect: (agentId: string) => void;
  claudeCodeAvailable?: boolean;
  suggestedAgent?: string;
  suggestReason?: string;
  disabled?: boolean;
  className?: string;
}

interface AgentOption {
  id: string;
  name: string;
  type: 'claude-code' | 'openclaw';
  status: 'idle' | 'busy' | 'offline';
  capabilities: string[];
}

export function AgentSelector({
  agents,
  selected,
  onSelect,
  claudeCodeAvailable = false,
  suggestedAgent,
  suggestReason,
  disabled = false,
  className = '',
}: AgentSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Build options list: Claude Code first (if available), then OpenClaw agents
  const options: AgentOption[] = [];
  
  if (claudeCodeAvailable) {
    options.push({
      id: 'claude-code',
      name: 'Claude Code',
      type: 'claude-code',
      status: 'idle',
      capabilities: ['filesystem', 'shell', 'local'],
    });
  }
  
  agents.forEach((agent) => {
    options.push({
      id: agent.name,
      name: agent.name,
      type: 'openclaw',
      status: agent.status,
      capabilities: agent.capabilities.length > 0 ? agent.capabilities : ['autonomous', 'web'],
    });
  });

  const selectedOption = options.find((o) => o.id === selected) || options[0];

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'idle': return 'bg-green-500';
      case 'busy': return 'bg-yellow-500';
      default: return 'bg-zinc-500';
    }
  };

  const getCapabilityIcon = (cap: string) => {
    switch (cap) {
      case 'filesystem':
      case 'local':
        return <FolderOpen className="w-3 h-3" />;
      case 'web':
        return <Globe className="w-3 h-3" />;
      case 'shell':
        return <Cpu className="w-3 h-3" />;
      case 'autonomous':
        return <Zap className="w-3 h-3" />;
      default:
        return null;
    }
  };

  if (options.length === 0) {
    return (
      <div className={`px-3 py-2 bg-zinc-800 rounded-lg text-zinc-500 text-sm ${className}`}>
        No agents available
      </div>
    );
  }

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 
          rounded-lg transition-colors min-w-[180px] justify-between
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${getStatusColor(selectedOption?.status || 'offline')}`} />
          <span className="text-sm font-medium">{selectedOption?.name || 'Select agent'}</span>
          {selectedOption?.type === 'claude-code' && (
            <span className="text-xs text-zinc-500">(local)</span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden">
          {options.map((option) => {
            const isSelected = option.id === selected;
            const isSuggested = option.id === suggestedAgent;
            
            return (
              <button
                key={option.id}
                onClick={() => {
                  onSelect(option.id);
                  setIsOpen(false);
                }}
                className={`
                  w-full px-3 py-2.5 flex items-start gap-3 hover:bg-zinc-700 transition-colors text-left
                  ${isSelected ? 'bg-zinc-700/50' : ''}
                `}
              >
                {/* Status indicator */}
                <div className={`w-2 h-2 rounded-full mt-1.5 ${getStatusColor(option.status)}`} />
                
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{option.name}</span>
                    {option.type === 'claude-code' && (
                      <span className="text-xs text-indigo-400 bg-indigo-500/20 px-1.5 py-0.5 rounded">local</span>
                    )}
                    {isSuggested && (
                      <span className="text-xs text-amber-400 bg-amber-500/20 px-1.5 py-0.5 rounded">★ suggested</span>
                    )}
                  </div>
                  
                  {/* Capabilities */}
                  <div className="flex items-center gap-2 mt-1">
                    {option.capabilities.slice(0, 4).map((cap) => (
                      <div
                        key={cap}
                        className="flex items-center gap-1 text-xs text-zinc-400"
                        title={cap}
                      >
                        {getCapabilityIcon(cap)}
                      </div>
                    ))}
                    {isSuggested && suggestReason && (
                      <span className="text-xs text-zinc-500 truncate">{suggestReason}</span>
                    )}
                  </div>
                </div>

                {/* Selected check */}
                {isSelected && (
                  <Check className="w-4 h-4 text-green-500 mt-1" />
                )}
              </button>
            );
          })}
          
          {/* Helper text */}
          <div className="px-3 py-2 border-t border-zinc-700 text-xs text-zinc-500">
            {claudeCodeAvailable ? (
              <span>Claude Code for local edits, OpenClaw for autonomous work</span>
            ) : (
              <span>Install Claude Code CLI for local filesystem access</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
