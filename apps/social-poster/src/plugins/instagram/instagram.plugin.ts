import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobPublishedPayloadDto, SocialPlatform } from '@app/common';
import { BaseSocialPlugin } from '../base/base-social.plugin';
import { FormattedPost, PluginHealth, PublishResult } from '../plugin.interface';
import { InstagramGraphClient } from './instagram-graph.client';
import { JobBannerService } from '../../banner/job-banner.service';

@Injectable()
export class InstagramPlugin extends BaseSocialPlugin {
  readonly id = SocialPlatform.INSTAGRAM;
  readonly name = 'Instagram Business';

  constructor(
    private readonly configService: ConfigService,
    private readonly igClient: InstagramGraphClient,
    private readonly bannerService: JobBannerService,
  ) {
    super();
  }

  isEnabled(): boolean {
    const accountId = this.configService.get<string>('INSTAGRAM_ACCOUNT_ID');
    const token = this.configService.get<string>('FB_PAGE_ACCESS_TOKEN');
    return Boolean(accountId && token);
  }

  async validateHealth(): Promise<PluginHealth> {
    if (!this.isEnabled()) {
      return { healthy: false, message: 'Instagram credentials not configured (running in sandbox mode)' };
    }

    const isHealthy = await this.igClient.checkAccountHealth();
    return {
      healthy: isHealthy,
      message: isHealthy ? 'Instagram Business API is active' : 'Instagram account ID or token is invalid',
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
    const salaryText = payload.show_salary && payload.salary_min && payload.salary_max
      ? `💰 Salary: ${payload.salary_currency || '$'}${payload.salary_min.toLocaleString()} - ${payload.salary_currency || '$'}${payload.salary_max.toLocaleString()}`
      : null;

    const hashtags = ['#Hiring', '#JobOpening', '#JobBaskets', '#Careers', '#TechJobs'];
    if (payload.skills) {
      for (const skill of payload.skills.slice(0, 5)) {
        const clean = skill.replace(/[^a-zA-Z0-9]/g, '');
        if (clean) hashtags.push(`#${clean}`);
      }
    }

    const jobUrl = this.resolveJobUrl(payload);

    const lines = [
      `🚀 WE ARE HIRING! | ${payload.title.toUpperCase()}`,
      '',
      `🏢 Company: ${payload.company_name}`,
      `📍 Location: ${locations}${workType}`,
      payload.employment_type ? `⏱ Type: ${payload.employment_type}` : null,
      salaryText,
      payload.skills && payload.skills.length > 0 ? `🛠 Skills: ${payload.skills.slice(0, 5).join(', ')}` : null,
      '',
      '👉 Tap the link in our bio or visit:',
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
    const accountId = this.configService.get<string>('INSTAGRAM_ACCOUNT_ID')!;
    const token = this.configService.get<string>('FB_PAGE_ACCESS_TOKEN')!;

    // Resolve public image URL: payload.image_url, payload.banner_url, or auto-generate dynamic Canva banner
    let imageUrl = payload.image_url || payload.banner_url;

    if (!imageUrl) {
      try {
        const bannerResult = await this.bannerService.getOrSaveBanner(payload);
        imageUrl = bannerResult.publicUrl;
      } catch (err) {
        this.logger.warn(`Could not generate dynamic Canva banner for Instagram: ${err}`);
      }
    }

    if (!imageUrl) {
      this.logger.warn(`Skipping Instagram publish for job ${payload.uuid}: Instagram requires a public image_url`);
      return {
        platform: this.id,
        success: false,
        error: 'Instagram publishing requires a public image URL (e.g. S3 / CDN image_url)',
        timestamp: new Date().toISOString(),
      };
    }

    const res = await this.igClient.publishPhoto({
      accountId,
      accessToken: token,
      imageUrl,
      caption: formatted.text,
    });

    return {
      platform: this.id,
      success: true,
      externalPostId: res.mediaId,
      postUrl: res.postUrl,
      rawResponse: res,
      timestamp: new Date().toISOString(),
    };
  }
}
