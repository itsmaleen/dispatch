import { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/app';
import {
  X,
  Terminal,
  Globe,
  CheckCircle,
  XCircle,
  Copy,
  Check,
  RefreshCw,
  Plus,
  ExternalLink,
  ChevronRight
} from 'lucide-react';

interface AgentsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  serverUrl: string;
}

interface ClaudeCodeStatus {
  available: boolean;
  version?: string;
  adapterRegistered?: boolean;
  checking: boolean;
  initializing?: boolean;
}

type TunnelProvider = 'local' | 'ngrok' | 'cloudflare' | 'tailscale' | 'custom';

export function AgentsPanel({ isOpen, onClose, serverUrl }: AgentsPanelProps) {
  const { agents } = useAppStore();
  const [claudeStatus, setClaudeStatus] = useState<ClaudeCodeStatus>({
    available: false,
    checking: true,
  });
  const [copied, setCopied] = useState<string | null>(null);
  const [showAddOpenClaw, setShowAddOpenClaw] = useState(false);

  // Tunnel/proxy configuration
  const [tunnelProvider, setTunnelProvider] = useState<TunnelProvider>('local');
  const [customUrl, setCustomUrl] = useState('');

  const { setAgents } = useAppStore();

  // ESC key to close modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Fetch agents and check Claude Code when panel opens
  useEffect(() => {
    if (!isOpen) return;

    const agentsUrl = `http://${serverUrl}/agents`;
    const claudeCheckUrl = `http://${serverUrl}/check/claude-code`;

    const fetchData = async () => {
      // Fetch agents
      try {
        const agentsRes = await fetch(agentsUrl);
        if (!agentsRes.ok) throw new Error(`agents ${agentsRes.status}`);
        const agentsData = await agentsRes.json();
        const list = agentsData?.agents;
        if (Array.isArray(list)) {
          setAgents(
            list.map((a: any) => ({
              name: a.name ?? 'Unknown',
              capabilities: a.capabilities ?? [],
              connectedAt: a.connectedAt,
              status: 'idle' as const,
            }))
          );
        }
      } catch {
        // ignore
      }

      // Check Claude Code CLI availability
      setClaudeStatus(s => ({ ...s, checking: true }));
      try {
        const res = await fetch(claudeCheckUrl);
        const data = await res.json();
        setClaudeStatus({
          available: data.available ?? false,
          version: data.version,
          adapterRegistered: data.adapterRegistered,
          checking: false,
        });
      } catch {
        setClaudeStatus({ available: false, checking: false });
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [isOpen, serverUrl, setAgents]);

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  // Get the server port from the current serverUrl
  const getServerPort = () => {
    const match = serverUrl.match(/:(\d+)/);
    return match ? match[1] : '3333';
  };

  // Generate WebSocket URL based on tunnel provider
  const getAccWsUrl = () => {
    switch (tunnelProvider) {
      case 'ngrok':
        return customUrl ? `wss://${customUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}/channel` : 'wss://YOUR_NGROK_URL.ngrok.io/channel';
      case 'cloudflare':
        return customUrl ? `wss://${customUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}/channel` : 'wss://YOUR_TUNNEL.trycloudflare.com/channel';
      case 'tailscale':
        return customUrl ? `ws://${customUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}/channel` : `ws://YOUR_MACHINE_NAME:${getServerPort()}/channel`;
      case 'custom':
        if (!customUrl) return 'wss://YOUR_CUSTOM_URL/channel';
        const url = customUrl.replace(/\/$/, '');
        if (url.startsWith('wss://') || url.startsWith('ws://')) {
          return url.endsWith('/channel') ? url : `${url}/channel`;
        }
        const isSecure = url.startsWith('https://') || url.includes('.') && !url.includes('localhost');
        const cleanUrl = url.replace(/^https?:\/\//, '');
        return `${isSecure ? 'wss' : 'ws'}://${cleanUrl}/channel`;
      case 'local':
      default:
        return `ws://${serverUrl}/channel`;
    }
  };

  // Check if URL is properly configured
  const isUrlConfigured = () => {
    if (tunnelProvider === 'local') return true;
    if (!customUrl) return false;
    return !customUrl.includes('YOUR_');
  };

  // Simple prompt that can be sent to OpenClaw via any channel (Telegram, etc.)
  const agentPrompt = `Install the ACC Channel plugin and connect to Dispatch.

Run: curl -sL https://raw.githubusercontent.com/moltyfromclaw/acc-channel/main/install.sh | bash

Then run:
export ACC_SERVER_URL="${getAccWsUrl()}"
openclaw gateway restart`;

  // Manual commands for advanced users
  const manualCommands = `# 1. Install the plugin
curl -sL https://raw.githubusercontent.com/moltyfromclaw/acc-channel/main/install.sh | bash

# 2. Configure connection
export ACC_SERVER_URL="${getAccWsUrl()}"
export ACC_AGENT_NAME="my-agent"

# 3. Restart gateway
openclaw gateway restart`;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold">Agents & Adapters</h2>
          <button onClick={onClose} className="p-1 hover:bg-zinc-800 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Claude Code Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-400 uppercase tracking-wider">
              <Terminal className="w-4 h-4" />
              <span>Claude Code (Local)</span>
            </div>
            
            <div className="bg-zinc-800/50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {claudeStatus.checking || claudeStatus.initializing ? (
                    <RefreshCw className="w-5 h-5 text-zinc-400 animate-spin" />
                  ) : claudeStatus.adapterRegistered ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : claudeStatus.available ? (
                    <CheckCircle className="w-5 h-5 text-yellow-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-zinc-500" />
                  )}
                  <div>
                    <div className="font-medium">
                      {claudeStatus.checking ? 'Checking...' 
                        : claudeStatus.initializing ? 'Connecting...'
                        : claudeStatus.adapterRegistered ? 'Connected' 
                        : claudeStatus.available ? 'Available (not connected)' 
                        : 'Not detected'}
                    </div>
                    <div className="text-sm text-zinc-500">
                      {claudeStatus.adapterRegistered 
                        ? `Claude Code ${claudeStatus.version || ''} - Primary adapter`
                        : claudeStatus.available 
                        ? 'Click Connect to use Claude Code as primary'
                        : 'Install Claude Code CLI to use this adapter'}
                    </div>
                  </div>
                </div>
                {claudeStatus.available && !claudeStatus.adapterRegistered && !claudeStatus.checking && (
                  <button
                    onClick={async () => {
                      setClaudeStatus(s => ({ ...s, initializing: true }));
                      try {
                        const res = await fetch(`http://${serverUrl}/adapters/claude-code/init`, { method: 'POST' });
                        const data = await res.json();
                        if (data.ok) {
                          setClaudeStatus(s => ({ ...s, adapterRegistered: true, initializing: false }));
                        } else {
                          alert(data.error || 'Failed to connect');
                          setClaudeStatus(s => ({ ...s, initializing: false }));
                        }
                      } catch {
                        alert('Failed to connect');
                        setClaudeStatus(s => ({ ...s, initializing: false }));
                      }
                    }}
                    className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 rounded-md"
                  >
                    Connect
                  </button>
                )}
                {!claudeStatus.available && !claudeStatus.checking && (
                  <a
                    href="https://claude.ai/code"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-sm text-indigo-400 hover:text-indigo-300"
                  >
                    Install <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* OpenClaw Instances Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-400 uppercase tracking-wider">
                <Globe className="w-4 h-4" />
                <span>OpenClaw Instances</span>
              </div>
              <button
                onClick={() => setShowAddOpenClaw(!showAddOpenClaw)}
                className="flex items-center gap-1 text-sm text-indigo-400 hover:text-indigo-300"
              >
                <Plus className="w-4 h-4" />
                <span>Add Instance</span>
              </button>
            </div>

            {/* Connected agents */}
            {agents.length > 0 ? (
              <div className="space-y-2">
                {agents.map((agent) => (
                  <div key={agent.name} className="bg-zinc-800/50 rounded-lg p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <div>
                        <div className="font-medium">{agent.name}</div>
                        <div className="text-sm text-zinc-500">
                          Connected • {agent.capabilities?.join(', ') || 'streaming, tools'}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs text-zinc-500 bg-zinc-700 px-2 py-1 rounded">
                      {agent.status || 'idle'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-zinc-800/50 rounded-lg p-4 text-center text-zinc-500">
                No OpenClaw instances connected
              </div>
            )}

            {/* Add OpenClaw Instructions */}
            {showAddOpenClaw && (
              <div className="bg-zinc-800 rounded-lg p-4 space-y-4 border border-zinc-700">
                <h3 className="font-medium">Connect an OpenClaw Instance</h3>

                {/* Connection Method Tabs */}
                <div className="space-y-3">
                  <label className="text-xs text-zinc-400">How will OpenClaw connect to Dispatch?</label>
                  <div className="flex flex-wrap gap-1">
                    {[
                      { id: 'local' as const, label: 'Same Machine' },
                      { id: 'ngrok' as const, label: 'ngrok' },
                      { id: 'cloudflare' as const, label: 'Cloudflare' },
                      { id: 'tailscale' as const, label: 'Tailscale' },
                      { id: 'custom' as const, label: 'Custom URL' },
                    ].map((provider) => (
                      <button
                        key={provider.id}
                        onClick={() => {
                          setTunnelProvider(provider.id);
                          setCustomUrl('');
                        }}
                        className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                          tunnelProvider === provider.id
                            ? 'bg-indigo-600 text-white'
                            : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                        }`}
                      >
                        {provider.label}
                      </button>
                    ))}
                  </div>

                  {/* Provider-specific instructions and input */}
                  {tunnelProvider === 'local' && (
                    <p className="text-xs text-zinc-500">
                      OpenClaw is running on the same machine as Dispatch. Connection URL: <code className="text-green-400">{getAccWsUrl()}</code>
                    </p>
                  )}

                  {tunnelProvider === 'ngrok' && (
                    <div className="space-y-2">
                      <p className="text-xs text-zinc-500">
                        Run <code className="text-zinc-300">ngrok http {getServerPort()}</code> on your Dispatch machine, then paste the URL:
                      </p>
                      <input
                        type="text"
                        value={customUrl}
                        onChange={(e) => setCustomUrl(e.target.value)}
                        placeholder="abc123.ngrok.io"
                        className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-600 rounded-md text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  )}

                  {tunnelProvider === 'cloudflare' && (
                    <div className="space-y-2">
                      <p className="text-xs text-zinc-500">
                        Run <code className="text-zinc-300">cloudflared tunnel --url http://localhost:{getServerPort()}</code> then paste the URL:
                      </p>
                      <input
                        type="text"
                        value={customUrl}
                        onChange={(e) => setCustomUrl(e.target.value)}
                        placeholder="random-words.trycloudflare.com"
                        className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-600 rounded-md text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  )}

                  {tunnelProvider === 'tailscale' && (
                    <div className="space-y-2">
                      <p className="text-xs text-zinc-500">
                        Enter your Tailscale machine name or IP (both machines must be on the same Tailnet):
                      </p>
                      <input
                        type="text"
                        value={customUrl}
                        onChange={(e) => setCustomUrl(e.target.value)}
                        placeholder={`my-macbook:${getServerPort()} or 100.x.x.x:${getServerPort()}`}
                        className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-600 rounded-md text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  )}

                  {tunnelProvider === 'custom' && (
                    <div className="space-y-2">
                      <p className="text-xs text-zinc-500">
                        Enter the full URL where Dispatch is accessible:
                      </p>
                      <input
                        type="text"
                        value={customUrl}
                        onChange={(e) => setCustomUrl(e.target.value)}
                        placeholder="wss://your-server.com/channel or https://your-server.com"
                        className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-600 rounded-md text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  )}

                  {/* Show configured URL */}
                  {tunnelProvider !== 'local' && customUrl && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-zinc-500">Connection URL:</span>
                      <code className="text-green-400">{getAccWsUrl()}</code>
                    </div>
                  )}
                </div>

                {/* Warning if URL not configured */}
                {!isUrlConfigured() && tunnelProvider !== 'local' && (
                  <p className="text-xs text-amber-400/80 bg-amber-950/30 px-3 py-2 rounded">
                    ⚠️ Enter your tunnel URL above before copying the instructions.
                  </p>
                )}

                {/* Main: Copy-paste prompt for OpenClaw */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs bg-indigo-600 px-1.5 py-0.5 rounded font-medium">Send to OpenClaw</span>
                    <label className="text-sm text-zinc-300">Copy and send this message</label>
                  </div>
                  <div className="relative">
                    <pre className={`bg-zinc-900 p-3 rounded text-sm font-mono overflow-x-auto whitespace-pre-wrap ${
                      isUrlConfigured() ? 'text-zinc-300' : 'text-zinc-500'
                    }`}>
{agentPrompt}</pre>
                    <button
                      onClick={() => copyToClipboard(agentPrompt, 'prompt')}
                      disabled={!isUrlConfigured()}
                      className="absolute top-2 right-2 p-1.5 hover:bg-zinc-700 rounded bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {copied === 'prompt' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Manual commands (collapsed by default) */}
                <details className="group">
                  <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-300 flex items-center gap-1">
                    <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
                    Manual setup commands
                  </summary>
                  <div className="mt-2 relative">
                    <pre className="bg-zinc-900 p-3 rounded text-xs font-mono text-zinc-400 overflow-x-auto whitespace-pre">
{manualCommands}</pre>
                    <button
                      onClick={() => copyToClipboard(manualCommands, 'manual')}
                      className="absolute top-2 right-2 p-1.5 hover:bg-zinc-700 rounded"
                    >
                      {copied === 'manual' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </details>

                <p className="text-xs text-zinc-500 pt-2 border-t border-zinc-700">
                  Once connected, the agent will appear in the list above automatically.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center justify-between text-sm text-zinc-500">
            <span>{agents.length} agent{agents.length !== 1 ? 's' : ''} connected</span>
            <span>Server: {serverUrl}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
