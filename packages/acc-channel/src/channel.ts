/**
 * ACC Channel Implementation
 * 
 * WebSocket-based channel for Dispatch integration.
 */

import type {
  ChannelPlugin,
  OpenClawConfig,
} from "openclaw/plugin-sdk";
import { getAccRuntime } from "./runtime.js";

// ============================================================================
// Types
// ============================================================================

export interface AccAccountConfig {
  enabled?: boolean;
  serverUrl: string;
  agentName: string;
  token?: string;
  model?: string;
  taskTimeout?: number;
  reconnectInterval?: number;
}

export interface AccChannelConfig {
  enabled?: boolean;
  defaultAccount?: string;
  accounts?: Record<string, AccAccountConfig>;
}

export interface ResolvedAccAccount {
  accountId: string;
  enabled: boolean;
  serverUrl: string;
  agentName: string;
  token: string;
  model?: string;
  taskTimeout: number;
  reconnectInterval: number;
  config: AccAccountConfig;
}

export interface AccProbe {
  ok: boolean;
  connected: boolean;
  registered: boolean;
  serverVersion?: string;
  error?: string;
}

// ============================================================================
// Config Helpers
// ============================================================================

const DEFAULT_ACCOUNT_ID = "default";
const DEFAULT_TASK_TIMEOUT = 300000; // 5 minutes
const DEFAULT_RECONNECT_INTERVAL = 5000; // 5 seconds

function getAccConfig(cfg: OpenClawConfig): AccChannelConfig | undefined {
  return (cfg.channels as any)?.acc;
}

function listAccAccountIds(cfg: OpenClawConfig): string[] {
  const accCfg = getAccConfig(cfg);
  if (!accCfg?.accounts) {
    return accCfg?.enabled ? [DEFAULT_ACCOUNT_ID] : [];
  }
  return Object.keys(accCfg.accounts);
}

function resolveAccAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string;
}): ResolvedAccAccount {
  const { cfg, accountId = DEFAULT_ACCOUNT_ID } = params;
  const accCfg = getAccConfig(cfg);
  const accountCfg = accCfg?.accounts?.[accountId] ?? {} as AccAccountConfig;
  
  const serverUrl = accountCfg.serverUrl 
    ?? process.env.ACC_SERVER_URL 
    ?? "ws://localhost:3333/channel";
  
  const agentName = accountCfg.agentName 
    ?? process.env.ACC_AGENT_NAME 
    ?? "openclaw-agent";
  
  const token = accountCfg.token 
    ?? process.env.ACC_TOKEN 
    ?? "";

  return {
    accountId,
    enabled: accountCfg.enabled ?? true,
    serverUrl,
    agentName,
    token,
    model: accountCfg.model,
    taskTimeout: accountCfg.taskTimeout ?? DEFAULT_TASK_TIMEOUT,
    reconnectInterval: accountCfg.reconnectInterval ?? DEFAULT_RECONNECT_INTERVAL,
    config: accountCfg,
  };
}

// ============================================================================
// Channel Plugin
// ============================================================================

export const accChannelPlugin: ChannelPlugin = {
  id: "acc",
  
  meta: {
    id: "acc",
    label: "Dispatch",
    selectionLabel: "ACC (WebSocket)",
    docsPath: "/channels/acc",
    blurb: "Connect OpenClaw to Dispatch via WebSocket.",
    aliases: ["acc", "command-center"],
  },

  capabilities: {
    chatTypes: ["direct"],
    reactions: false,
    threads: false,
    media: false,
    nativeCommands: false,
    blockStreaming: false, // We support streaming!
  },

  reload: { configPrefixes: ["channels.acc"] },

  config: {
    listAccountIds: (cfg) => listAccAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveAccAccount({ cfg, accountId: accountId ?? undefined }),
    defaultAccountId: (cfg) => getAccConfig(cfg)?.defaultAccount ?? DEFAULT_ACCOUNT_ID,
    
    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      const next = { ...cfg };
      const channels = { ...next.channels } as any;
      const acc = { ...channels.acc } as AccChannelConfig;
      const accounts = { ...acc.accounts };
      
      if (accounts[accountId]) {
        accounts[accountId] = { ...accounts[accountId], enabled };
      }
      
      acc.accounts = accounts;
      channels.acc = acc;
      next.channels = channels;
      return next;
    },
    
    deleteAccount: ({ cfg, accountId }) => {
      const next = { ...cfg };
      const channels = { ...next.channels } as any;
      const acc = { ...channels.acc } as AccChannelConfig;
      const accounts = { ...acc.accounts };
      
      delete accounts[accountId];
      
      acc.accounts = accounts;
      channels.acc = acc;
      next.channels = channels;
      return next;
    },
    
    isConfigured: (account) => Boolean(account.serverUrl?.trim()),
    
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.agentName,
      enabled: account.enabled,
      configured: Boolean(account.serverUrl?.trim()),
    }),
  },

  outbound: {
    deliveryMode: "direct",
    
    sendText: async ({ to, text, accountId }) => {
      // ACC is primarily inbound (tasks come from ACC)
      // Outbound is handled via WebSocket task.completed messages
      // This is a fallback for any direct send attempts
      console.log(`[acc] sendText called: to=${to}, accountId=${accountId}`);
      return { ok: true, channel: "acc", messageId: `acc-${Date.now()}` };
    },
  },

  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      connected: false,
      lastStartAt: undefined,
      lastStopAt: undefined,
      lastError: undefined,
    },
    
    collectStatusIssues: (accounts: any[]) => {
      const issues: any[] = [];
      
      for (const snap of accounts) {
        const account = snap.account ?? snap;
        const runtime = snap.runtime;
        if (!account?.serverUrl) {
          issues.push({ channel: "acc", accountId: account?.accountId ?? "default", kind: "error", level: "error", message: "ACC server URL not configured" });
        }
        if (runtime && !runtime.connected) {
          issues.push({ channel: "acc", accountId: account?.accountId ?? "default", kind: "warning", level: "warning", message: "Not connected to ACC server" });
        }
      }
      
      return issues;
    },
    
    buildChannelSummary: (params: any) => {
      const snapshot = params?.snapshot ?? params;
      return {
        configured: snapshot?.configured ?? false,
        running: snapshot?.running ?? false,
        connected: snapshot?.connected ?? false,
      };
    },
    
    probeAccount: async ({ account, timeoutMs }: any) => {
      // TODO: Implement actual probe (test WebSocket connection)
      return {
        ok: Boolean((account as any)?.serverUrl),
        connected: false,
      };
    },
    
    buildAccountSnapshot: ({ account, runtime }: any) => ({
      accountId: account.accountId,
      name: account.agentName,
      enabled: account.enabled,
      configured: Boolean(account.serverUrl?.trim()),
      running: runtime?.running ?? false,
      connected: runtime?.connected ?? false,
      lastStartAt: runtime?.lastStartAt ?? undefined,
      lastStopAt: runtime?.lastStopAt ?? undefined,
      lastError: runtime?.lastError ?? undefined,
    }),
  },

  gateway: {
    startAccount: async (ctx: any) => {
      const { account, cfg, runtime, abortSignal, log: _log } = ctx;
      const log = _log ?? { info: console.log, warn: console.warn, error: console.error, debug: console.log };
      
      log.info(`[acc:${account.accountId}] Starting ACC channel...`);
      log.info(`[acc:${account.accountId}] Server: ${account.serverUrl}`);
      log.info(`[acc:${account.accountId}] Agent: ${account.agentName}`);
      
      // Import WebSocket dynamically
      const { default: WebSocket } = await import("ws");
      
      // Connection state
      let ws: InstanceType<typeof WebSocket> | null = null;
      let reconnectTimer: NodeJS.Timeout | null = null;
      const activeTasks = new Map<string, { startedAt: number }>();
      
      // Update runtime state
      const updateRuntime = (updates: Record<string, any>) => {
        if (runtime) {
          Object.assign(runtime, updates);
        }
      };
      
      // Connect to ACC server
      const connect = () => {
        if (abortSignal?.aborted) return;
        
        log.debug(`[acc:${account.accountId}] Connecting to ${account.serverUrl}`);
        
        ws = new WebSocket(account.serverUrl, {
          headers: {
            "Authorization": `Bearer ${account.token}`,
            "X-Agent-Name": account.agentName,
          },
        });
        
        ws.on("open", () => {
          log.info(`[acc:${account.accountId}] Connected to ACC server`);
          updateRuntime({ connected: true, lastError: null });
          
          // Register with ACC
          ws?.send(JSON.stringify({
            type: "register",
            metadata: {
              agentName: account.agentName,
              capabilities: ["streaming", "tools", "spawn"],
              model: account.model ?? (cfg.agents as any)?.defaults?.model ?? "anthropic/claude-sonnet-4-20250514",
              version: "1.0.0",
            },
          }));
          
          updateRuntime({ registered: true });
          log.info(`[acc:${account.accountId}] Registered as ${account.agentName}`);
        });
        
        ws.on("message", async (data) => {
          try {
            const msg = JSON.parse(data.toString());
            log.debug(`[acc:${account.accountId}] Received: ${msg.type}`);
            
            switch (msg.type) {
              case "task.send":
                await handleTaskSend(msg);
                break;
              case "task.cancel":
                handleTaskCancel(msg);
                break;
              case "ping":
                ws?.send(JSON.stringify({ type: "pong" }));
                break;
            }
          } catch (err) {
            log.error(`[acc:${account.accountId}] Message handling error: ${err}`);
          }
        });
        
        ws.on("close", (code) => {
          log.info(`[acc:${account.accountId}] Disconnected (code: ${code})`);
          updateRuntime({ connected: false, registered: false });
          scheduleReconnect();
        });
        
        ws.on("error", (err) => {
          log.error(`[acc:${account.accountId}] WebSocket error: ${err.message}`);
          updateRuntime({ lastError: err.message });
        });
      };
      
      // Schedule reconnection
      const scheduleReconnect = () => {
        if (abortSignal?.aborted || reconnectTimer) return;
        
        log.debug(`[acc:${account.accountId}] Reconnecting in ${account.reconnectInterval}ms`);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, account.reconnectInterval);
      };
      
      // Handle incoming task
      const handleTaskSend = async (msg: { taskId: string; message: string; context?: any }) => {
        const { taskId, message, context } = msg;
        
        if (!taskId || !message) {
          ws?.send(JSON.stringify({
            type: "task.error",
            taskId: taskId ?? "unknown",
            error: "Missing taskId or message",
          }));
          return;
        }
        
        log.info(`[acc:${account.accountId}] Task received: ${taskId}`);
        
        const startedAt = Date.now();
        activeTasks.set(taskId, { startedAt });
        
        // Send started acknowledgment
        ws?.send(JSON.stringify({
          type: "task.started",
          taskId,
          metadata: { startedAt: new Date(startedAt).toISOString() },
        }));
        
        try {
          // Use sessions_spawn for isolated execution
          // This is the key integration point - we're using OpenClaw's native session spawning
          const result = await getAccRuntime().sessions.spawn({
            task: message,
            cleanup: "delete",
            runTimeoutSeconds: Math.floor(account.taskTimeout / 1000),
            // Stream output via callback if available
            onChunk: (chunk: string) => {
              ws?.send(JSON.stringify({
                type: "content.delta",
                taskId,
                content: chunk,
              }));
            },
          });
          
          const durationMs = Date.now() - startedAt;
          log.info(`[acc:${account.accountId}] Task completed: ${taskId} (${durationMs}ms)`);
          
          ws?.send(JSON.stringify({
            type: "task.completed",
            taskId,
            content: result?.content ?? result ?? "Task completed",
            status: "completed",
            metadata: { durationMs },
          }));
          
        } catch (err: any) {
          const durationMs = Date.now() - startedAt;
          log.error(`[acc:${account.accountId}] Task failed: ${taskId} - ${err.message}`);
          
          ws?.send(JSON.stringify({
            type: "task.error",
            taskId,
            error: err.message,
            status: "failed",
            metadata: { durationMs },
          }));
        } finally {
          activeTasks.delete(taskId);
        }
      };
      
      // Handle task cancellation
      const handleTaskCancel = (msg: { taskId: string }) => {
        const { taskId } = msg;
        if (activeTasks.has(taskId)) {
          log.info(`[acc:${account.accountId}] Cancelling task: ${taskId}`);
          activeTasks.delete(taskId);
          ws?.send(JSON.stringify({ type: "task.cancelled", taskId }));
        }
      };
      
      // Cleanup on abort
      abortSignal?.addEventListener("abort", () => {
        log.info(`[acc:${account.accountId}] Shutting down ACC channel`);
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (ws) ws.close();
        updateRuntime({ running: false, connected: false, registered: false });
      });
      
      // Start connection
      updateRuntime({ 
        running: true, 
        lastStartAt: Date.now(),
        accountId: account.accountId,
      });
      connect();
      
      // Return cleanup function
      return () => {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (ws) ws.close();
      };
    },
    
    logoutAccount: async ({ accountId, cfg }) => {
      // Remove token from config
      const next = { ...cfg };
      const channels = { ...next.channels } as any;
      const acc = { ...channels.acc } as AccChannelConfig;
      const accounts = { ...acc.accounts };
      
      if (accounts[accountId]) {
        const { token, ...rest } = accounts[accountId];
        accounts[accountId] = rest;
      }
      
      acc.accounts = accounts;
      channels.acc = acc;
      next.channels = channels;
      
      return { cleared: true, loggedOut: true };
    },
  },
};
