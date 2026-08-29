import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('REDIS_HOST', '127.0.0.1');
    const port = Number(this.configService.get<number>('REDIS_PORT', 6379));
    const password = this.configService.get<string>('REDIS_PASSWORD');
    const db = Number(this.configService.get<number>('REDIS_DB', 0));
    const tlsEnabled = this.configService.get<string>('REDIS_TLS') === 'true';
    const keyPrefix = this.configService.get<string>('REDIS_KEY_PREFIX', 'jb:social:');

    const redisOptions: RedisOptions = {
      host,
      port,
      password: password || undefined,
      db,
      keyPrefix,
      tls: tlsEnabled ? {} : undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times) => {
        const delay = Math.min(times * 100, 3000);
        this.logger.warn(`Redis disconnected. Retrying in ${delay}ms (attempt ${times})...`);
        return delay;
      },
    };

    this.client = new Redis(redisOptions);

    this.client.on('connect', () => {
      this.logger.log(`Redis connected successfully to ${host}:${port}`);
    });

    this.client.on('error', (err) => {
      this.logger.error(`Redis connection error: ${err.message}`, err.stack);
    });
  }

  getClient(): Redis {
    return this.client;
  }

  /**
   * Acquire an atomic lock for a job to prevent duplicate concurrent processing
   * @param key Unique lock key (e.g. `lock:job:123`)
   * @param ttlSeconds Lock expiration time in seconds (default 3600 = 1 hr)
   */
  async acquireLock(key: string, ttlSeconds = 3600): Promise<boolean> {
    const result = await this.client.set(key, 'LOCKED', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  /**
   * Release an atomic lock
   */
  async releaseLock(key: string): Promise<void> {
    await this.client.del(key);
  }

  /**
   * Set hash field for tracking social post states
   */
  async setPostState(jobId: string | number, data: Record<string, string>): Promise<void> {
    const key = `post_state:${jobId}`;
    await this.client.hset(key, data);
  }

  /**
   * Get post state for a job
   */
  async getPostState(jobId: string | number): Promise<Record<string, string>> {
    const key = `post_state:${jobId}`;
    return this.client.hgetall(key);
  }

  /**
   * Publish an event to a Redis Pub/Sub channel
   */
  async publish(channel: string, message: unknown): Promise<number> {
    const payload = typeof message === 'string' ? message : JSON.stringify(message);
    return this.client.publish(channel, payload);
  }

  async onModuleDestroy() {
    this.logger.log('Closing Redis connection...');
    await this.client.quit();
  }
}
