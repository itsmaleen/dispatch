/**
 * ACC Channel Plugin for OpenClaw
 * 
 * Native channel integration for Agent Command Center.
 * Makes ACC a first-class messaging surface like Telegram/Discord.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { accChannelPlugin } from "./src/channel.js";
import { setAccRuntime } from "./src/runtime.js";

const plugin = {
  id: "acc-channel",
  name: "Agent Command Center",
  description: "Native channel plugin for Agent Command Center integration",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setAccRuntime(api.runtime);
    api.registerChannel({ plugin: accChannelPlugin });
    
    api.logger.info("[acc-channel] Plugin registered");
  },
};

export default plugin;
