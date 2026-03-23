/**
 * Electron API type declarations
 * 
 * Single source of truth for window.electronAPI types.
 * The actual implementation is in electron/preload.ts
 */

export {};

declare global {
  interface Window {
    electronAPI?: {
      window: {
        getId: () => number;
        getInitialFolderPath: () => string | undefined;
        create: (folderPath?: string) => Promise<{ ok: boolean }>;
        /** Register callback for window close - allows saving state before window closes */
        onClosing: (callback: () => Promise<void>) => () => void;
      };
      server: {
        getInfo: () => Promise<{ port: number; pid?: number }>;
        getPort: () => number;
        getApiUrl: () => string;
        getWsUrl: () => string;
        onInfo: (callback: (info: { port: number; windowId?: number; folderPath?: string }) => void) => () => void;
      };
      adapter: {
        connect: (adapterId: string, config: unknown) => Promise<{ ok: boolean }>;
        disconnect: (adapterId: string) => Promise<{ ok: boolean }>;
        send: (adapterId: string, message: string) => Promise<{ ok: boolean; turnId: string }>;
        onEvent: (callback: (event: unknown) => void) => () => void;
      };
      launcher: {
        cursor: (path: string) => Promise<{ ok: boolean }>;
        browser: (url: string) => Promise<{ ok: boolean }>;
      };
      coderabbit: {
        review: (cwd: string) => Promise<{ ok: boolean; output: string }>;
      };
      github: {
        createPr: (options: { title: string; body: string; cwd: string }) => Promise<{ ok: boolean; output: string }>;
      };
      platform: NodeJS.Platform;
      openFolder: (defaultPath?: string) => Promise<string | null>;
    };
  }
}
