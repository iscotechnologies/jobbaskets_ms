import { Injectable, Logger } from '@nestjs/common';
import { PostStatus, RedisService, SocialPlatform } from '@app/common';
import { PublishResult } from '../plugins/plugin.interface';

@Injectable()
export class SocialPostStateService {
  private readonly logger = new Logger(SocialPostStateService.name);

  constructor(private readonly redisService: RedisService) {}

  /**
   * Acquire atomic lock to prevent duplicate concurrent processing of the same job post
   */
  async acquireJobLock(jobId: number | string, ttlSeconds = 3600): Promise<boolean> {
    const lockKey = `lock:social_post:${jobId}`;
    return this.redisService.acquireLock(lockKey, ttlSeconds);
  }

  /**
   * Release lock after job finishes
   */
  async releaseJobLock(jobId: number | string): Promise<void> {
    const lockKey = `lock:social_post:${jobId}`;
    await this.redisService.releaseLock(lockKey);
  }

  /**
   * Check if a job has already been successfully posted to a specific platform
   */
  async isPlatformPosted(jobId: number | string, platform: SocialPlatform | string): Promise<boolean> {
    const state = await this.redisService.getPostState(jobId);
    return state[`${platform}_status`] === PostStatus.POSTED;
  }

  /**
   * Record processing status for all platforms
   */
  async recordProcessing(jobId: number | string, platforms: (SocialPlatform | string)[]): Promise<void> {
    const data: Record<string, string> = {
      overall_status: PostStatus.PROCESSING,
      updated_at: new Date().toISOString(),
    };

    for (const p of platforms) {
      data[`${p}_status`] = PostStatus.PROCESSING;
    }

    await this.redisService.setPostState(jobId, data);
  }

  /**
   * Record individual platform results
   */
  async recordPlatformResult(jobId: number | string, result: PublishResult): Promise<void> {
    const data: Record<string, string> = {
      [`${result.platform}_status`]: result.success ? PostStatus.POSTED : PostStatus.FAILED,
      [`${result.platform}_timestamp`]: result.timestamp,
    };

    if (result.externalPostId) {
      data[`${result.platform}_post_id`] = result.externalPostId;
    }
    if (result.postUrl) {
      data[`${result.platform}_post_url`] = result.postUrl;
    }
    if (result.error) {
      data[`${result.platform}_error`] = result.error;
    }

    await this.redisService.setPostState(jobId, data);
  }

  /**
   * Mark overall job state as completed
   */
  async markOverallComplete(jobId: number | string, hasErrors: boolean): Promise<void> {
    await this.redisService.setPostState(jobId, {
      overall_status: hasErrors ? PostStatus.FAILED : PostStatus.POSTED,
      completed_at: new Date().toISOString(),
    });
  }

  /**
   * Retrieve current state for a job
   */
  async getJobSocialState(jobId: number | string): Promise<Record<string, string>> {
    return this.redisService.getPostState(jobId);
  }
}
