import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  JobPublishedPayloadDto,
  SocialPlatform,
  resolveCurrencySymbol,
} from '@app/common';
import { BaseSocialPlugin } from '../base/base-social.plugin';
import { FormattedPost, PluginHealth, PublishResult } from '../plugin.interface';
import { FacebookGraphClient } from './facebook-graph.client';
import { JobBannerService } from '../../banner/job-banner.service';

@Injectable()
export class FacebookPlugin extends BaseSocialPlugin {
  readonly id = SocialPlatform.FACEBOOK;
  readonly name = 'Facebook Page';

  constructor(
    private readonly configService: ConfigService,
    private readonly fbClient: FacebookGraphClient,
    private readonly bannerService: JobBannerService,
  ) {
    super();
  }

  isEnabled(): boolean {
    const pageId = this.configService.get<string>('FB_PAGE_ID');
    const token = this.configService.get<string>('FB_PAGE_ACCESS_TOKEN');
    return Boolean(pageId && token);
  }

  async validateHealth(): Promise<PluginHealth> {
    if (!this.isEnabled()) {
      return { healthy: false, message: 'Facebook credentials not configured (running in sandbox mode)' };
    }

    const isHealthy = await this.fbClient.checkPageHealth();
    return {
      healthy: isHealthy,
      message: isHealthy ? 'Facebook Page API is active' : 'Facebook Page access token is invalid or expired',
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
    return `${baseUrl}/jobs/${payload.uuid}`;
  }

  format(payload: JobPublishedPayloadDto): FormattedPost {
    const locations = payload.locations && payload.locations.length > 0 ? payload.locations.join(', ') : 'Multiple Locations';
    const workType = payload.work_type ? ` (${payload.work_type.toUpperCase()})` : '';
    const curr = resolveCurrencySymbol(payload.salary_currency);
    const salaryText = payload.show_salary && payload.salary_min && payload.salary_max
      ? `💰 Salary: ${curr}${payload.salary_min.toLocaleString()} - ${curr}${payload.salary_max.toLocaleString()}`
      : null;

    const hashtags = ['#Hiring', '#JobOpening', '#JobBaskets', '#Careers'];
    if (payload.skills) {
      for (const skill of payload.skills.slice(0, 3)) {
        const clean = skill.replace(/[^a-zA-Z0-9]/g, '');
        if (clean) hashtags.push(`#${clean}`);
      }
    }

    const jobUrl = this.resolveJobUrl(payload);

    const lines = [
      `JOB OPPORTUNITY | ${payload.title.toUpperCase()}`,
      '',
      `Organization: ${payload.company_name}`,
      `Location: ${locations}${workType}`,
      payload.employment_type ? `Employment Type: ${payload.employment_type}` : null,
      payload.experience_required ? `Experience Required: ${payload.experience_required}` : null,
      salaryText ? `Remuneration: ${salaryText.replace('💰 Salary: ', '')}` : null,
      payload.skills && payload.skills.length > 0 ? `Key Competencies: ${payload.skills.slice(0, 5).join(', ')}` : null,
      '',
      'To view the complete job specifications and apply directly, visit:',
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

  protected async executePublish(payload: JobPublishedPayloadDto, formatted: FormattedPost): Promise<PublishResult> {
    const pageId = this.configService.get<string>('FB_PAGE_ID')!;
    const pageToken = this.configService.get<string>('FB_PAGE_ACCESS_TOKEN')!;

    // 1. Generate dynamic branded banner buffer
    let photoBuffer: Buffer | undefined;
    try {
      photoBuffer = await this.bannerService.generateBanner(payload);
    } catch (err) {
      this.logger.warn(`Facebook banner rendering failed: ${err}`);
    }

    // 2. Publish to Facebook Page
    const res = await this.fbClient.publishToPage({
      pageId,
      pageToken,
      message: formatted.text,
      link: formatted.jobUrl,
      photoBuffer,
    });

    return {
      platform: this.id,
      success: true,
      externalPostId: res.postId || res.id,
      postUrl: res.postUrl,
      rawResponse: res,
      timestamp: new Date().toISOString(),
    };
  }
}
