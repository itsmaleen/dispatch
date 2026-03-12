/**
 * Adapter Types - Internal server types for adapter implementations
 */

import type { 
  Adapter, 
  AdapterConfig, 
  AdapterState, 
  AdapterCapabilities,
  AdapterEvent,
  SendOptions 
} from '@acc/contracts';

export interface AdapterContext {
  config: AdapterConfig;
  emitEvent: (event: Omit<AdapterEvent, 'adapterId' | 'timestamp'>) => void;
  log: {
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
  };
}

export interface AdapterImplementation {
  /** Initialize the adapter */
  init(ctx: AdapterContext): Promise<void>;
  
  /** Connect to the agent runtime */
  connect(): Promise<void>;
  
  /** Disconnect from the agent runtime */
  disconnect(): Promise<void>;
  
  /** Send a message/task */
  send(options: SendOptions): Promise<{ turnId: string }>;
  
  /** Interrupt current task */
  interrupt(): Promise<void>;
  
  /** Get current state */
  getState(): AdapterState;
  
  /** Get capabilities */
  getCapabilities(): AdapterCapabilities;
  
  /** Cleanup resources */
  destroy(): Promise<void>;
}

export type AdapterFactory = (config: AdapterConfig) => AdapterImplementation;

/**
 * Event emitter for adapters
 */
export class AdapterEventEmitter {
  private listeners = new Map<string, Set<(event: AdapterEvent) => void>>();

  on(eventType: string, handler: (event: AdapterEvent) => void): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(handler);
    
    return () => {
      this.listeners.get(eventType)?.delete(handler);
    };
  }

  emit(event: AdapterEvent): void {
    // Emit to specific type listeners
    this.listeners.get(event.type)?.forEach(handler => handler(event));
    // Emit to wildcard listeners
    this.listeners.get('*')?.forEach(handler => handler(event));
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
