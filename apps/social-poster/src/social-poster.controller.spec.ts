import { Test, TestingModule } from '@nestjs/testing';
import { SocialPosterController } from './social-poster.controller';
import { SocialPosterService } from './social-poster.service';
import { SocialPostQueueService } from './queue/social-post.queue.service';
import { SocialPostStateService } from './state/social-post-state.service';
import { PluginRegistry } from './plugins/plugin.registry';
import { JobPublishedPayloadDto } from '@app/common';

describe('SocialPosterController', () => {
  let controller: SocialPosterController;
  let queueService: SocialPostQueueService;
  let stateService: SocialPostStateService;
  let posterService: SocialPosterService;
  let pluginRegistry: PluginRegistry;

  const mockPosterService = {
    getHealth: jest.fn().mockResolvedValue({
      status: 'ok',
      service: 'social-poster',
      redis: 'healthy',
    }),
  };

  const mockQueueService = {
    enqueueJobPosting: jest.fn().mockResolvedValue('job_post_100'),
    getQueueMetrics: jest.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 5, failed: 0, delayed: 0 }),
  };

  const mockStateService = {
    getJobSocialState: jest.fn().mockResolvedValue({ overall_status: 'POSTED' }),
  };

  const mockPluginRegistry = {
    getAllPlugins: jest.fn().mockReturnValue([
      { id: 'linkedin', name: 'LinkedIn Organization', isEnabled: () => true },
      { id: 'telegram', name: 'Telegram Channel', isEnabled: () => false },
    ]),
    checkAllHealth: jest.fn().mockResolvedValue({
      linkedin: { healthy: true, message: 'Active' },
      telegram: { healthy: false, message: 'Unconfigured' },
    }),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [SocialPosterController],
      providers: [
        { provide: SocialPosterService, useValue: mockPosterService },
        { provide: SocialPostQueueService, useValue: mockQueueService },
        { provide: SocialPostStateService, useValue: mockStateService },
        { provide: PluginRegistry, useValue: mockPluginRegistry },
        {
          provide: require('@nestjs/config').ConfigService,
          useValue: { get: jest.fn().mockReturnValue(null) },
        },
      ],
    }).compile();

    controller = app.get<SocialPosterController>(SocialPosterController);
    queueService = app.get<SocialPostQueueService>(SocialPostQueueService);
    stateService = app.get<SocialPostStateService>(SocialPostStateService);
    posterService = app.get<SocialPosterService>(SocialPosterService);
    pluginRegistry = app.get<PluginRegistry>(PluginRegistry);
  });

  describe('health check', () => {
    it('should return health status', async () => {
      const result = await controller.healthCheck();
      expect(result.status).toBe('ok');
      expect(mockPosterService.getHealth).toHaveBeenCalled();
    });
  });

  describe('plugins list', () => {
    it('should list all plugins and health', async () => {
      const result = await controller.listPlugins();
      expect(result.plugins.length).toBe(2);
      expect(result.health.linkedin.healthy).toBe(true);
    });
  });

  describe('publish endpoint', () => {
    it('should enqueue job post and return accepted response', async () => {
      const payload: JobPublishedPayloadDto = {
        job_id: 100,
        uuid: 'test-uuid-1234',
        title: 'Senior Software Engineer',
        company_name: 'Tech Corp',
        job_url: 'https://jobbaskets.io/jobs/test-uuid-1234',
      };

      const result = await controller.enqueueJobPublish(payload);
      expect(result.status).toBe('accepted');
      expect(result.bullmq_job_id).toBe('job_post_100');
      expect(mockQueueService.enqueueJobPosting).toHaveBeenCalledWith(payload);
    });
  });

  describe('status endpoint', () => {
    it('should return job social state', async () => {
      const result = await controller.getJobSocialStatus('100');
      expect(result.job_id).toBe('100');
      expect(result.state).toEqual({ overall_status: 'POSTED' });
    });
  });
});
