/**
 * ACC Channel Plugin for OpenClaw
 * 
 * Native channel integration for Dispatch.
 * Makes ACC a first-class messaging surface like Telegram/Discord.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { accChannelPlugin } from "./src/channel.js";
import { setAccRuntime } from "./src/runtime.js";

const plugin = {
  id: "acc-channel",
  name: "Dispatch",
  description: "Native channel plugin for Dispatch integration",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setAccRuntime(api.runtime);
    api.registerChannel({ plugin: accChannelPlugin });
    
    api.logger.info("[acc-channel] Plugin registered");
  },
};

export default plugin;
