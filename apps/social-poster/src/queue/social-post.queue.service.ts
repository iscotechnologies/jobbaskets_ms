import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JOB_PUBLISH_TASK, JobPublishedPayloadDto, SOCIAL_POST_QUEUE } from '@app/common';

@Injectable()
export class SocialPostQueueService {
  private readonly logger = new Logger(SocialPostQueueService.name);

  constructor(
    @InjectQueue(SOCIAL_POST_QUEUE) private readonly socialQueue: Queue<JobPublishedPayloadDto>,
  ) {}

  /**
   * Enqueue job for background posting across social media platforms
   */
  async enqueueJobPosting(payload: JobPublishedPayloadDto): Promise<string> {
    const customJobId = `job_post_${payload.job_id}`;

    this.logger.log(`Enqueuing social post job: ${payload.title} (ID: ${payload.job_id})`);

    const job = await this.socialQueue.add(JOB_PUBLISH_TASK, payload, {
      jobId: customJobId,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: {
        age: 86400, // Keep in history for 24 hours
        count: 1000,
      },
      removeOnFail: {
        age: 604800, // Keep failed jobs for 7 days
      },
    });

    return job.id || customJobId;
  }

  /**
   * Get current queue statistics
   */
  async getQueueMetrics() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.socialQueue.getWaitingCount(),
      this.socialQueue.getActiveCount(),
      this.socialQueue.getCompletedCount(),
      this.socialQueue.getFailedCount(),
      this.socialQueue.getDelayedCount(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
    };
  }
}
