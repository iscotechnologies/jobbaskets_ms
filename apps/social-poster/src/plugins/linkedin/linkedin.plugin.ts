import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobPublishedPayloadDto, SocialPlatform } from '@app/common';
import { BaseSocialPlugin } from '../base/base-social.plugin';
import { FormattedPost, PluginHealth, PublishResult } from '../plugin.interface';
import { LinkedInRestClient } from './linkedin-rest.client';

@Injectable()
export class LinkedInPlugin extends BaseSocialPlugin {
  readonly id = SocialPlatform.LINKEDIN;
  readonly name = 'LinkedIn Organization';

  constructor(
    private readonly configService: ConfigService,
    private readonly restClient: LinkedInRestClient,
  ) {
    super();
  }

  isEnabled(): boolean {
    const token = this.configService.get<string>('LINKEDIN_ACCESS_TOKEN');
    return Boolean(token);
  }

  async validateHealth(): Promise<PluginHealth> {
    if (!this.isEnabled()) {
      return { healthy: false, message: 'LinkedIn access token not configured (running in sandbox mode)' };
    }

    const isHealthy = await this.restClient.checkTokenHealth();
    return {
      healthy: isHealthy,
      message: isHealthy ? 'LinkedIn API token is active' : 'LinkedIn API token is invalid or expired',
    };
  }

  private resolveJobUrl(payload: JobPublishedPayloadDto): string {
    if (payload.job_url && payload.job_url.startsWith('http')) {
      return payload.job_url;
    }
    const frontendBase = this.configService.get<string>('PLATFORM_FRONTEND_URL')
      || this.configService.get<string>('APP_URL')
      || 'https://jobbaskets.io';
    const baseUrl = frontendBase.replace(/\/+$/, '');
    return `${baseUrl}/jobs/${payload.uuid}`;
  }

  format(payload: JobPublishedPayloadDto): FormattedPost {
    const locations = payload.locations && payload.locations.length > 0 ? payload.locations.join(', ') : 'Multiple Locations';
    const workType = payload.work_type ? ` (${payload.work_type.toUpperCase()})` : '';
    const salaryText = payload.show_salary && payload.salary_min && payload.salary_max
      ? `💰 Salary: ${payload.salary_currency || '$'}${payload.salary_min.toLocaleString()} - ${payload.salary_currency || '$'}${payload.salary_max.toLocaleString()}`
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

    const res = await this.restClient.createPost({
      author,
      commentary: formatted.text,
      visibility: 'PUBLIC',
      landingPageUrl: formatted.jobUrl,
      title: formatted.extraMetadata?.title as string,
      description: formatted.extraMetadata?.description as string,
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
