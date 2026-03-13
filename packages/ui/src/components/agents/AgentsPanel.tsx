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
  ExternalLink
} from 'lucide-react';

interface AgentsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  serverUrl: string;
}

interface ClaudeCodeStatus {
  available: boolean;
  version?: string;
  checking: boolean;
}

export function AgentsPanel({ isOpen, onClose, serverUrl }: AgentsPanelProps) {
  const { agents } = useAppStore();
  const [claudeStatus, setClaudeStatus] = useState<ClaudeCodeStatus>({
    available: false,
    checking: true,
  });
  const [copied, setCopied] = useState<string | null>(null);
  const [showAddOpenClaw, setShowAddOpenClaw] = useState(false);

  const { setAgents } = useAppStore();

  // Fetch agents and check Claude Code when panel opens
  useEffect(() => {
    const fetchData = async () => {
      // Fetch agents
      try {
        const agentsRes = await fetch(`http://${serverUrl}/agents`);
        const agentsData = await agentsRes.json();
        if (agentsData.agents) {
          setAgents(
            agentsData.agents.map((a: any) => ({
              name: a.name,
              capabilities: a.capabilities || [],
              connectedAt: a.connectedAt,
              status: 'idle' as const,
            }))
          );
        }
      } catch (err) {
        console.error('Failed to fetch agents:', err);
      }

      // Check Claude Code CLI availability
      setClaudeStatus(s => ({ ...s, checking: true }));
      try {
        // Check via server endpoint that tests if 'claude' CLI exists
        const res = await fetch(`http://${serverUrl}/check/claude-code`);
        const data = await res.json();
        setClaudeStatus({
          available: data.available ?? false,
          version: data.version,
          checking: false,
        });
      } catch {
        // Fallback: assume not available if check fails
        setClaudeStatus({ available: false, checking: false });
      }
    };
    
    if (isOpen) {
      fetchData();
      // Refresh every 3 seconds while open
      const interval = setInterval(fetchData, 3000);
      return () => clearInterval(interval);
    }
  }, [isOpen, serverUrl, setAgents]);

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  // Generate connection instructions for OpenClaw
  const getAccWsUrl = () => {
    // If serverUrl contains ngrok or cloudflare, use wss
    if (serverUrl.includes('ngrok') || serverUrl.includes('cloudflare') || serverUrl.includes('https')) {
      return serverUrl.replace('https://', 'wss://').replace('http://', 'ws://') + '/channel';
    }
    return `ws://${serverUrl}/channel`;
  };

  const hookInstallCmd = `cd ~/.openclaw/hooks && cat > acc-channel.mjs << 'EOF'
#!/usr/bin/env node
import WebSocket from 'ws';
import { spawn } from 'child_process';

const CONFIG = {
  serverUrl: process.env.ACC_SERVER_URL || '${getAccWsUrl()}',
  agentName: process.env.ACC_AGENT_NAME || process.env.HOSTNAME || 'openclaw-agent',
  token: process.env.ACC_TOKEN || 'dev-token',
};

let ws = null;
const activeTasks = new Map();

function connect() {
  console.log(\`[acc] Connecting to \${CONFIG.serverUrl}\`);
  ws = new WebSocket(CONFIG.serverUrl, {
    headers: { 'Authorization': \`Bearer \${CONFIG.token}\`, 'X-Agent-Name': CONFIG.agentName }
  });
  ws.on('open', () => {
    console.log('[acc] Connected');
    ws.send(JSON.stringify({ type: 'register', metadata: { agentName: CONFIG.agentName, capabilities: ['streaming', 'tools'] }}));
  });
  ws.on('message', async (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'task.send') {
      const { taskId, message } = msg;
      ws.send(JSON.stringify({ type: 'task.started', taskId }));
      const proc = spawn('openclaw', ['agent', '--local', '--session-id', \`acc-\${taskId}\`, '--json', '--message', message]);
      let stdout = '';
      proc.stdout.on('data', (chunk) => { stdout += chunk; ws.send(JSON.stringify({ type: 'content.delta', taskId, content: chunk.toString() })); });
      proc.on('close', (code) => {
        try { const r = JSON.parse(stdout); ws.send(JSON.stringify({ type: 'task.completed', taskId, content: r.payloads?.[0]?.text || stdout })); }
        catch { ws.send(JSON.stringify({ type: 'task.completed', taskId, content: stdout || 'Done' })); }
      });
    }
  });
  ws.on('close', () => setTimeout(connect, 5000));
}
connect();
EOF
npm init -y && npm install ws && node acc-channel.mjs`;

  const envVarsCmd = `export ACC_SERVER_URL="${getAccWsUrl()}"
export ACC_AGENT_NAME="my-agent"
export ACC_TOKEN="dev-token"`;

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
                  {claudeStatus.checking ? (
                    <RefreshCw className="w-5 h-5 text-zinc-400 animate-spin" />
                  ) : claudeStatus.available ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-zinc-500" />
                  )}
                  <div>
                    <div className="font-medium">
                      {claudeStatus.checking ? 'Checking...' : claudeStatus.available ? 'Available' : 'Not detected'}
                    </div>
                    <div className="text-sm text-zinc-500">
                      {claudeStatus.available 
                        ? 'Claude Code CLI is ready to use'
                        : 'Install Claude Code CLI to use this adapter'}
                    </div>
                  </div>
                </div>
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
                
                <p className="text-sm text-zinc-400">
                  Run these commands on your OpenClaw instance to connect it to ACC:
                </p>

                {/* Server URL Info */}
                <div className="space-y-2">
                  <label className="text-sm text-zinc-400">ACC Server URL (WebSocket)</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-zinc-900 px-3 py-2 rounded text-sm font-mono text-green-400 overflow-x-auto">
                      {getAccWsUrl()}
                    </code>
                    <button
                      onClick={() => copyToClipboard(getAccWsUrl(), 'ws-url')}
                      className="p-2 hover:bg-zinc-700 rounded"
                    >
                      {copied === 'ws-url' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-zinc-500">
                    💡 For remote access, expose your ACC server with ngrok or cloudflared:
                    <br />
                    <code className="text-zinc-400">ngrok http 3333</code> or <code className="text-zinc-400">cloudflared tunnel --url http://localhost:3333</code>
                  </p>
                </div>

                {/* Environment Variables */}
                <div className="space-y-2">
                  <label className="text-sm text-zinc-400">1. Set environment variables</label>
                  <div className="relative">
                    <pre className="bg-zinc-900 p-3 rounded text-sm font-mono text-zinc-300 overflow-x-auto">
                      {envVarsCmd}
                    </pre>
                    <button
                      onClick={() => copyToClipboard(envVarsCmd, 'env')}
                      className="absolute top-2 right-2 p-1.5 hover:bg-zinc-700 rounded"
                    >
                      {copied === 'env' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Quick Install Command */}
                <div className="space-y-2">
                  <label className="text-sm text-zinc-400">2. Install & run the ACC hook</label>
                  <div className="relative">
                    <pre className="bg-zinc-900 p-3 rounded text-sm font-mono text-zinc-300 overflow-x-auto max-h-40">
                      {hookInstallCmd}
                    </pre>
                    <button
                      onClick={() => copyToClipboard(hookInstallCmd, 'hook')}
                      className="absolute top-2 right-2 p-1.5 hover:bg-zinc-700 rounded"
                    >
                      {copied === 'hook' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <p className="text-sm text-zinc-400">
                  Once connected, the agent will appear in the list above.
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
