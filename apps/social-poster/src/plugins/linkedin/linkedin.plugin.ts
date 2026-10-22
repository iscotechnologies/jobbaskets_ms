import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  JobPublishedPayloadDto,
  SocialPlatform,
  resolveCurrencySymbol,
} from '@app/common';
import { BaseSocialPlugin } from '../base/base-social.plugin';
import { FormattedPost, PluginHealth, PublishResult } from '../plugin.interface';
import { LinkedInRestClient } from './linkedin-rest.client';
import { JobBannerService } from '../../banner/job-banner.service';

@Injectable()
export class LinkedInPlugin extends BaseSocialPlugin {
  readonly id = SocialPlatform.LINKEDIN;
  readonly name = 'LinkedIn Organization';

  constructor(
    private readonly configService: ConfigService,
    private readonly restClient: LinkedInRestClient,
    private readonly bannerService: JobBannerService,
  ) {
    super();
  }

  isEnabled(): boolean {
    const woopApiKey = this.configService.get<string>('WOOPSOCIAL_API_KEY');
    const token = this.configService.get<string>('LINKEDIN_ACCESS_TOKEN');
    return Boolean(woopApiKey || token);
  }

  async validateHealth(): Promise<PluginHealth> {
    if (!this.isEnabled()) {
      return { healthy: false, message: 'LinkedIn credentials not configured (running in sandbox mode)' };
    }

    const isHealthy = await this.restClient.checkTokenHealth();
    return {
      healthy: isHealthy,
      message: isHealthy ? 'LinkedIn connection is active' : 'LinkedIn token is invalid or expired',
    };
  }

  private resolveJobUrl(payload: JobPublishedPayloadDto): string {
    if (payload.job_url && payload.job_url.startsWith('http')) {
      return payload.job_url;
    }
    const frontendBase = this.configService.get<string>('PLATFORM_FRONTEND_URL')
      || this.configService.get<string>('APP_URL')
      || 'https://jobbaskets.com';
    const baseUrl = frontendBase.replace(/\/+$/, '');

    if (payload.post_type === 'classified') {
      return `${baseUrl}/classified-ads?ad=${payload.uuid}`;
    }

    return `${baseUrl}/jobs/${payload.uuid}`;
  }

  format(payload: JobPublishedPayloadDto): FormattedPost {
    const locations = payload.locations && payload.locations.length > 0 ? payload.locations.join(', ') : 'Multiple Locations';
    const workType = payload.work_type ? ` (${payload.work_type.toUpperCase()})` : '';
    const curr = resolveCurrencySymbol(payload.salary_currency);
    const salaryText = payload.show_salary && payload.salary_min && payload.salary_max
      ? `💰 Salary: ${curr}${payload.salary_min.toLocaleString()} - ${curr}${payload.salary_max.toLocaleString()}`
      : null;

    const hashtags = ['#Hiring', '#JobOpening', '#JobBaskets', '#CareerOpportunity'];
    if (payload.skills) {
      for (const skill of payload.skills.slice(0, 3)) {
        const cleanSkill = skill.replace(/[^a-zA-Z0-9]/g, '');
        if (cleanSkill) hashtags.push(`#${cleanSkill}`);
      }
    }
    if (payload.work_type === 'remote') {
      hashtags.push('#RemoteWork', '#HiringNow');
    }

    const jobUrl = this.resolveJobUrl(payload);

    const lines = [
      `🚀 WE ARE HIRING! | ${payload.title.toUpperCase()}`,
      '',
      `🏢 Company: ${payload.company_name}`,
      `📍 Location: ${locations}${workType}`,
      payload.employment_type ? `⏱ Employment: ${payload.employment_type}` : null,
      payload.experience_required ? `🎯 Experience: ${payload.experience_required}` : null,
      salaryText,
      payload.skills && payload.skills.length > 0 ? `🛠 Skills: ${payload.skills.slice(0, 5).join(', ')}` : null,
      '',
      '👉 Apply directly on JobBaskets:',
      jobUrl,
      '',
      hashtags.join(' '),
    ].filter(Boolean) as string[];

    return {
      text: lines.join('\n'),
      hashtags,
      jobUrl,
      extraMetadata: {
        title: `${payload.title} at ${payload.company_name}`,
        description: `Apply for ${payload.title} position at ${payload.company_name} on JobBaskets.`,
      },
    };
  }

  protected async executePublish(payload: JobPublishedPayloadDto, formatted: FormattedPost): Promise<PublishResult> {
    const orgId = this.configService.get<string>('LINKEDIN_ORG_ID');
    const author = orgId ? (orgId.startsWith('urn:li:') ? orgId : `urn:li:organization:${orgId}`) : undefined;

    let photoBuffer: Buffer | undefined;

    if (payload.post_type === 'classified' && payload.image_url) {
      try {
        const response = await fetch(payload.image_url);
        if (response.ok) {
          photoBuffer = Buffer.from(await response.arrayBuffer());
          this.logger.log(`LinkedIn: Using flyer image for classified ad ${payload.job_id}`);
        }
      } catch (err) {
        this.logger.warn(`LinkedIn: Failed to download flyer image: ${err}`);
      }
    } else {
      try {
        photoBuffer = await this.bannerService.generateBanner(payload);
      } catch (err) {
        this.logger.warn(`LinkedIn banner rendering failed: ${err}`);
      }
    }

    const res = await this.restClient.createPost({
      author,
      commentary: formatted.text,
      visibility: 'PUBLIC',
      landingPageUrl: formatted.jobUrl,
      title: formatted.extraMetadata?.title as string,
      description: formatted.extraMetadata?.description as string,
      photoBuffer,
    });

    return {
      platform: this.id,
      success: true,
      externalPostId: res.id,
      postUrl: res.postUrl,
      rawResponse: res,
      timestamp: new Date().toISOString(),
    };
  }
}
