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

    if (payload.post_type === 'classified') {
      return `${baseUrl}/classified-ads?ad=${payload.uuid}`;
    }
    
    return `${baseUrl}/jobs/${payload.uuid}`;
  }

  format(payload: JobPublishedPayloadDto): FormattedPost {
    const jobUrl = this.resolveJobUrl(payload);
    const hashtags = ['#Hiring', '#JobOpening', '#JobBaskets', '#Careers'];
    if (payload.skills) {
      for (const skill of payload.skills.slice(0, 3)) {
        const clean = skill.replace(/[^a-zA-Z0-9]/g, '');
        if (clean) hashtags.push(`#${clean}`);
      }
    }

    // Classified flyer ads: simple caption (details are on the flyer image itself)
    if (payload.post_type === 'classified') {
      const lines = [
        payload.title ? `${payload.title.toUpperCase()}` : 'JOB OPPORTUNITY',
        '',
        payload.company_name && payload.company_name !== 'JobBaskets Hiring Partner'
          ? `Organization: ${payload.company_name}` : null,
        payload.locations && payload.locations.length > 0
          ? `Location: ${payload.locations.join(', ')}` : null,
        '',
        'To apply, visit:',
        jobUrl,
        '',
        hashtags.join(' '),
      ].filter(Boolean) as string[];

      return { text: lines.join('\n'), hashtags, jobUrl };
    }

    // Standard job posts: full structured caption
    const locations = payload.locations && payload.locations.length > 0 ? payload.locations.join(', ') : 'Multiple Locations';
    const workType = payload.work_type ? ` (${payload.work_type.toUpperCase()})` : '';
    const curr = resolveCurrencySymbol(payload.salary_currency);
    const salaryText = payload.show_salary && payload.salary_min && payload.salary_max
      ? `💰 Salary: ${curr}${payload.salary_min.toLocaleString()} - ${curr}${payload.salary_max.toLocaleString()}`
      : null;

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

    let photoBuffer: Buffer | undefined;

    if (payload.post_type === 'classified' && payload.image_url) {
      // Classified flyer ad: use the pre-uploaded flyer image directly
      try {
        const response = await fetch(payload.image_url);
        if (response.ok) {
          photoBuffer = Buffer.from(await response.arrayBuffer());
          this.logger.log(`Facebook: Using flyer image for classified ad ${payload.job_id}`);
        }
      } catch (err) {
        this.logger.warn(`Facebook: Failed to download flyer image: ${err}`);
      }
    } else {
      // Standard job: generate dynamic branded banner
      try {
        photoBuffer = await this.bannerService.generateBanner(payload);
      } catch (err) {
        this.logger.warn(`Facebook banner rendering failed: ${err}`);
      }
    }

    // Publish to Facebook Page
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
