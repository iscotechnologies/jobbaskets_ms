import { Logger } from '@nestjs/common';
import { JobPublishedPayloadDto, SocialPlatform } from '@app/common';
import { FormattedPost, ISocialPlugin, PluginHealth, PublishResult } from '../plugin.interface';

export abstract class BaseSocialPlugin implements ISocialPlugin {
  abstract readonly id: SocialPlatform | string;
  abstract readonly name: string;
  protected readonly logger = new Logger(this.constructor.name);

  abstract isEnabled(): boolean;
  abstract validateHealth(): Promise<PluginHealth>;
  abstract format(payload: JobPublishedPayloadDto): FormattedPost;
  protected abstract executePublish(payload: JobPublishedPayloadDto, formatted: FormattedPost): Promise<PublishResult>;

  async publish(payload: JobPublishedPayloadDto): Promise<PublishResult> {
    const startTime = Date.now();
    const formatted = this.format(payload);

    if (!this.isEnabled()) {
      this.logger.warn(`[${this.name}] Plugin credentials missing or disabled. Running in SANDBOX mode.`);
      return {
        platform: this.id,
        success: true,
        externalPostId: `sandbox_${this.id}_${Date.now()}_${payload.job_id}`,
        postUrl: `https://${this.id}.com/sandbox/post/${payload.uuid}`,
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const result = await this.executePublish(payload, formatted);
      result.latencyMs = Date.now() - startTime;
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[${this.name}] Publish failed for job ${payload.job_id}: ${errorMsg}`);
      return {
        platform: this.id,
        success: false,
        error: errorMsg,
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
