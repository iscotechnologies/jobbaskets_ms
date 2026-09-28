import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobPublishedPayloadDto, resolveCurrencySymbol, SocialPlatform } from '@app/common';
import { BaseSocialPlugin } from '../base/base-social.plugin';
import { FormattedPost, PluginHealth, PublishResult } from '../plugin.interface';
import { WhatsAppBaileysClient } from './whatsapp-baileys.client';
import { JobBannerService } from '../../banner/job-banner.service';

@Injectable()
export class WhatsAppPlugin extends BaseSocialPlugin {
  readonly id = SocialPlatform.WHATSAPP;
  readonly name = 'WhatsApp Channel';

  constructor(
    private readonly configService: ConfigService,
    private readonly whatsAppClient: WhatsAppBaileysClient,
    private readonly bannerService: JobBannerService,
  ) {
    super();
  }

  isEnabled(): boolean {
    return this.whatsAppClient.isConfigured();
  }

  async validateHealth(): Promise<PluginHealth> {
    if (!this.isEnabled()) {
      return {
        healthy: false,
        message: 'WhatsApp credentials/phone number not configured',
        details: this.whatsAppClient.getStatus() as any,
      };
    }

    const status = this.whatsAppClient.getStatus();
    const isReady = this.whatsAppClient.isReady();

    return {
      healthy: isReady,
      message: isReady
        ? 'WhatsApp Baileys socket connected and active'
        : status.pairingCode
          ? `WhatsApp pairing pending (Code: ${status.pairingCode})`
          : 'WhatsApp socket initializing/disconnected',
      details: status as any,
    };
  }

  private resolveJobUrl(payload: JobPublishedPayloadDto): string {
    if (payload.job_url && payload.job_url.startsWith('http')) {
      return payload.job_url;
    }
    const frontendBase =
      this.configService.get<string>('PLATFORM_FRONTEND_URL') ||
      this.configService.get<string>('APP_URL') ||
      'https://jobbaskets.io';
    const baseUrl = frontendBase.replace(/\/+$/, '');

    if (payload.post_type === 'classified') {
      return `${baseUrl}/classified-ads?ad=${payload.uuid}`;
    }

    return `${baseUrl}/jobs/${payload.uuid}`;
  }

  format(payload: JobPublishedPayloadDto): FormattedPost {
    const jobUrl = this.resolveJobUrl(payload);
    const hashtags = ['#Hiring', '#JobOpening', '#JobBaskets'];
    if (payload.skills) {
      for (const skill of payload.skills.slice(0, 3)) {
        const clean = skill.replace(/[^a-zA-Z0-9]/g, '');
        if (clean) hashtags.push(`#${clean}`);
      }
    }

    // Classified flyer ads: concise caption (details are on the flyer image itself)
    if (payload.post_type === 'classified') {
      const lines = [
        `💼 *${payload.title ? payload.title.toUpperCase() : 'JOB OPPORTUNITY'}*`,
        '',
        payload.company_name && payload.company_name !== 'JobBaskets Hiring Partner'
          ? `🏢 *Organization:* ${payload.company_name}`
          : null,
        payload.locations && payload.locations.length > 0
          ? `📍 *Location:* ${payload.locations.join(', ')}`
          : null,
        '',
        '🔗 *View Details & Apply:*',
        jobUrl,
        '',
        hashtags.join(' '),
      ].filter(Boolean) as string[];

      return { text: lines.join('\n'), hashtags, jobUrl };
    }

    // Standard job posts: structured WhatsApp markdown caption
    const locations =
      payload.locations && payload.locations.length > 0
        ? payload.locations.join(', ')
        : 'Multiple Locations';
    const workType = payload.work_type ? ` (${payload.work_type.toUpperCase()})` : '';
    const curr = resolveCurrencySymbol(payload.salary_currency);
    const salaryText =
      payload.show_salary && payload.salary_min && payload.salary_max
        ? `${curr}${payload.salary_min.toLocaleString()} - ${curr}${payload.salary_max.toLocaleString()}`
        : null;

    const lines = [
      `💼 *JOB OPPORTUNITY | ${payload.title.toUpperCase()}*`,
      '',
      `🏢 *Organization:* ${payload.company_name}`,
      `📍 *Location:* ${locations}${workType}`,
      payload.employment_type ? `💼 *Employment Type:* ${payload.employment_type}` : null,
      payload.experience_required ? `🎓 *Experience Level:* ${payload.experience_required}` : null,
      salaryText ? `💰 *Remuneration:* ${salaryText}` : null,
      payload.skills && payload.skills.length > 0
        ? `⚡ *Key Competencies:* ${payload.skills.slice(0, 5).join(', ')}`
        : null,
      '',
      '🔗 *Apply Now:*',
      jobUrl,
      '',
      hashtags.join(' '),
    ].filter(Boolean) as string[];

    return {
      text: lines.join('\n'),
      hashtags,
      jobUrl,
    };
  }

  protected async executePublish(
    payload: JobPublishedPayloadDto,
    formatted: FormattedPost,
  ): Promise<PublishResult> {
    let photoBuffer: Buffer | undefined;

    if (payload.post_type === 'classified' && payload.image_url) {
      // Classified flyer ad: fetch the uploaded flyer image
      try {
        const response = await fetch(payload.image_url);
        if (response.ok) {
          photoBuffer = Buffer.from(await response.arrayBuffer());
          this.logger.log(`[WhatsApp] Using flyer image for classified ad ${payload.job_id}`);
        }
      } catch (err) {
        this.logger.warn(`[WhatsApp] Failed to download flyer image: ${err}. Posting without flyer image...`);
      }
    } else {
      // Standard job: generate dynamic branded portrait banner
      try {
        photoBuffer = await this.bannerService.generateBanner(payload);
      } catch (err) {
        this.logger.warn(`[WhatsApp] Banner generation failed: ${err}. Sending without banner...`);
      }
    }

    // NOTE: Baileys sendMessage with images to newsletter JIDs may silently fail.
    // Sending text-only for now to verify channel delivery works.
    const res = await this.whatsAppClient.publishToChannel({
      caption: formatted.text,
      imageBuffer: undefined, // TODO: Re-enable once newsletter image delivery is confirmed
    });

    return {
      platform: this.id,
      success: true,
      externalPostId: res.messageId,
      postUrl: res.postUrl,
      rawResponse: res,
      timestamp: new Date().toISOString(),
    };
  }
}
