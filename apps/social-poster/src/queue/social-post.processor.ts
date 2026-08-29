import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  JOB_PUBLISH_TASK,
  JobPublishedPayloadDto,
  SOCIAL_POST_QUEUE,
} from '@app/common';
import { SocialPostStateService } from '../state/social-post-state.service';
import { PluginRegistry } from '../plugins/plugin.registry';

@Processor(SOCIAL_POST_QUEUE, {
  concurrency: 5,
  limiter: {
    max: 10,
    duration: 1000,
  },
})
export class SocialPostProcessor extends WorkerHost {
  private readonly logger = new Logger(SocialPostProcessor.name);

  constructor(
    private readonly stateService: SocialPostStateService,
    private readonly pluginRegistry: PluginRegistry,
  ) {
    super();
  }

  async process(job: Job<JobPublishedPayloadDto, void, string>): Promise<void> {
    const payload = job.data;
    const jobId = payload.job_id;

    this.logger.log(`[Worker] Received job "${payload.title}" (Job ID: ${jobId}, BullMQ ID: ${job.id})`);

    // 1. Atomic Deduplication Lock
    const lockAcquired = await this.stateService.acquireJobLock(jobId);
    if (!lockAcquired) {
      this.logger.warn(`[Worker] Job ${jobId} is already locked or in-progress. Skipping duplicate execution.`);
      return;
    }

    try {
      // 2. Identify target platforms from payload or registered plugins
      const targetPlatforms: string[] = payload.target_platforms && payload.target_platforms.length > 0
        ? payload.target_platforms.map((p) => p.toLowerCase())
        : this.pluginRegistry.getAllPlugins().map((p) => p.id.toLowerCase());

      this.logger.log(`[Worker] Target platforms for Job ${jobId}: [${targetPlatforms.join(', ')}]`);
      await this.stateService.recordProcessing(jobId, targetPlatforms as any);

      let hasErrors = false;

      // 3. Dispatch to each plugin independently
      for (const platformId of targetPlatforms) {
        const isPosted = await this.stateService.isPlatformPosted(jobId, platformId as any);
        if (isPosted) {
          this.logger.log(`[Worker] Platform [${platformId}] already posted for job ${jobId}. Skipping.`);
          continue;
        }

        try {
          const result = await this.pluginRegistry.publishToPlatform(platformId, payload);
          await this.stateService.recordPlatformResult(jobId, result as any);

          if (!result.success) {
            hasErrors = true;
          }
        } catch (err) {
          hasErrors = true;
          const errMsg = err instanceof Error ? err.message : String(err);
          this.logger.error(`[Worker] Unexpected failure for plugin [${platformId}] on job ${jobId}: ${errMsg}`);
          await this.stateService.recordPlatformResult(jobId, {
            platform: platformId as any,
            success: false,
            error: errMsg,
            timestamp: new Date().toISOString(),
          });
        }
      }

      await this.stateService.markOverallComplete(jobId, hasErrors);
      this.logger.log(`[Worker] Completed social distribution for job ${jobId} (hasErrors: ${hasErrors})`);
    } finally {
      await this.stateService.releaseJobLock(jobId);
    }
  }
}
