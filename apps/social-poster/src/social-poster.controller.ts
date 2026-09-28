import { Body, Controller, Get, Param, Post, ValidationPipe, UsePipes, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { JobPublishedPayloadDto } from '@app/common';
import { SocialPostQueueService } from './queue/social-post.queue.service';
import { SocialPostStateService } from './state/social-post-state.service';
import { SocialPosterService } from './social-poster.service';
import { PluginRegistry } from './plugins/plugin.registry';
import { WhatsAppBaileysClient } from './plugins/whatsapp/whatsapp-baileys.client';
import { ServiceAuthGuard } from './guards/service-auth.guard';

@Controller()
export class SocialPosterController {
  constructor(
    private readonly socialPosterService: SocialPosterService,
    private readonly queueService: SocialPostQueueService,
    private readonly stateService: SocialPostStateService,
    private readonly pluginRegistry: PluginRegistry,
    private readonly whatsAppClient: WhatsAppBaileysClient,
  ) {}

  @Get('health')
  async healthCheck() {
    return this.socialPosterService.getHealth();
  }

  @Get('api/v1/plugins')
  async listPlugins() {
    const plugins = this.pluginRegistry.getAllPlugins().map((p) => ({
      id: p.id,
      name: p.name,
      enabled: p.isEnabled(),
    }));
    const health = await this.pluginRegistry.checkAllHealth();

    return {
      plugins,
      health,
    };
  }

  @Post('api/v1/jobs/publish')
  @UseGuards(ServiceAuthGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async enqueueJobPublish(@Body() payload: JobPublishedPayloadDto) {
    const queueJobId = await this.queueService.enqueueJobPosting(payload);
    return {
      status: 'accepted',
      message: 'Job social posting enqueued successfully',
      job_id: payload.job_id,
      bullmq_job_id: queueJobId,
    };
  }

  @Get('api/v1/jobs/:jobId/social-status')
  async getJobSocialStatus(@Param('jobId') jobId: string) {
    const state = await this.stateService.getJobSocialState(jobId);
    return {
      job_id: jobId,
      state: Object.keys(state).length > 0 ? state : { status: 'NOT_FOUND' },
    };
  }

  @Get('api/v1/queue/metrics')
  async getQueueMetrics() {
    return this.queueService.getQueueMetrics();
  }

  @Get('api/v1/whatsapp/status')
  async getWhatsAppStatus() {
    return this.whatsAppClient.getStatus();
  }

  @Get('api/v1/whatsapp/channel')
  async getWhatsAppChannel() {
    return this.whatsAppClient.getChannelMetadata();
  }

  @Post('api/v1/whatsapp/pair')
  async requestWhatsAppPairing(@Body() body: { phoneNumber?: string }) {
    const code = await this.whatsAppClient.requestPairingCode(body?.phoneNumber);
    return {
      success: true,
      phoneNumber: body?.phoneNumber || this.whatsAppClient.getPhoneNumber(),
      pairingCode: code,
      instructions: [
        '1. Open WhatsApp on your mobile phone',
        '2. Go to Settings > Linked Devices > Link a Device',
        '3. Tap "Link with phone number instead"',
        `4. Enter this 8-digit code: ${code}`,
      ],
    };
  }

  @Post('api/v1/whatsapp/reset')
  async resetWhatsAppAuth() {
    this.whatsAppClient.clearAuth();
    return {
      success: true,
      message: 'WhatsApp session credentials cleared. You can pair again.',
    };
  }
}

