import { Injectable } from '@nestjs/common';
import { RedisService } from '@app/common';

@Injectable()
export class SocialPosterService {
  constructor(private readonly redisService: RedisService) {}

  async getHealth() {
    let redisStatus = 'healthy';
    try {
      const client = this.redisService.getClient();
      await client.ping();
    } catch (err) {
      redisStatus = `unhealthy: ${err instanceof Error ? err.message : String(err)}`;
    }

    return {
      status: 'ok',
      service: 'social-poster',
      timestamp: new Date().toISOString(),
      redis: redisStatus,
      uptime_seconds: process.uptime(),
    };
  }
}
