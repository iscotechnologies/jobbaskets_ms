import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobPublishedPayloadDto } from '@app/common';
import { ISocialPlugin, PluginHealth, PublishResult, SOCIAL_PLUGINS_TOKEN } from './plugin.interface';

@Injectable()
export class PluginRegistry implements OnModuleInit {
  private readonly logger = new Logger(PluginRegistry.name);
  private readonly plugins = new Map<string, ISocialPlugin>();

  constructor(
    @Inject(SOCIAL_PLUGINS_TOKEN) private readonly injectedPlugins: ISocialPlugin[],
  ) {}

  onModuleInit() {
    for (const plugin of this.injectedPlugins) {
      this.plugins.set(plugin.id.toLowerCase(), plugin);
      const status = plugin.isEnabled() ? 'ENABLED' : 'SANDBOX / UNCONFIGURED';
      this.logger.log(`Registered social plugin: [${plugin.name}] (ID: ${plugin.id}) -> Status: ${status}`);
    }
  }

  getPlugin(id: string): ISocialPlugin | undefined {
    return this.plugins.get(id.toLowerCase());
  }

  getAllPlugins(): ISocialPlugin[] {
    return Array.from(this.plugins.values());
  }

  getEnabledPlugins(): ISocialPlugin[] {
    return this.getAllPlugins().filter((p) => p.isEnabled());
  }

  async checkAllHealth(): Promise<Record<string, PluginHealth>> {
    const report: Record<string, PluginHealth> = {};
    for (const [id, plugin] of this.plugins.entries()) {
      report[id] = await plugin.validateHealth();
    }
    return report;
  }

  async publishToPlatform(platformId: string, payload: JobPublishedPayloadDto): Promise<PublishResult> {
    const plugin = this.getPlugin(platformId);
    if (!plugin) {
      return {
        platform: platformId,
        success: false,
        error: `Plugin [${platformId}] not found in registry`,
        timestamp: new Date().toISOString(),
      };
    }
    return plugin.publish(payload);
  }
}
