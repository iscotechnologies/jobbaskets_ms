import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobPublishedPayloadDto, SocialPlatform } from '@app/common';

export interface FormattedSocialContent {
  caption: string;
  hashtags: string[];
  jobUrl: string;
  fullMessage: string;
}

@Injectable()
export class SocialContentFormatterService {
  constructor(private readonly configService: ConfigService) {}

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

  formatContent(payload: JobPublishedPayloadDto, platform: SocialPlatform): FormattedSocialContent {
    const locations = payload.locations && payload.locations.length > 0 ? payload.locations.join(', ') : 'Multiple Locations';
    const workType = payload.work_type ? ` (${payload.work_type.toUpperCase()})` : '';
    const curr = this.resolveCurrency(payload.salary_currency);
    const salaryText = payload.show_salary && payload.salary_min && payload.salary_max
      ? `💰 Salary: ${curr}${payload.salary_min.toLocaleString()} - ${payload.salary_max.toLocaleString()}`
      : null;

    const hashtags = this.generateHashtags(payload, platform);
    const jobUrl = this.resolveJobUrl(payload);

    switch (platform) {
      case SocialPlatform.LINKEDIN:
        return this.formatForLinkedIn(payload, locations, workType, salaryText, hashtags, jobUrl);
      case SocialPlatform.FACEBOOK:
        return this.formatForFacebook(payload, locations, workType, salaryText, hashtags, jobUrl);
      case SocialPlatform.INSTAGRAM:
        return this.formatForInstagram(payload, locations, workType, salaryText, hashtags, jobUrl);
      case SocialPlatform.TWITTER:
      default:
        return this.formatForTwitter(payload, locations, workType, salaryText, hashtags, jobUrl);
    }
  }

  private formatForLinkedIn(
    payload: JobPublishedPayloadDto,
    locations: string,
    workType: string,
    salaryText: string | null,
    hashtags: string[],
    jobUrl: string,
  ): FormattedSocialContent {
    const lines = [
      `JOB OPPORTUNITY | ${payload.title.toUpperCase()}`,
      '',
      `Organization: ${payload.company_name}`,
      `Location: ${locations}${workType}`,
      payload.employment_type ? `Employment Type: ${payload.employment_type}` : null,
      payload.experience_required ? `Experience Level: ${payload.experience_required}` : null,
      salaryText ? `Remuneration: ${salaryText.replace('💰 Salary: ', '')}` : null,
      payload.skills && payload.skills.length > 0 ? `Key Competencies: ${payload.skills.slice(0, 5).join(', ')}` : null,
      '',
      'To review full specifications and submit your application, visit:',
      jobUrl,
      '',
      hashtags.join(' '),
    ].filter(Boolean) as string[];

    const fullMessage = lines.join('\n');
    return {
      caption: lines.slice(0, -3).join('\n'),
      hashtags,
      jobUrl,
      fullMessage,
    };
  }

  private formatForFacebook(
    payload: JobPublishedPayloadDto,
    locations: string,
    workType: string,
    salaryText: string | null,
    hashtags: string[],
    jobUrl: string,
  ): FormattedSocialContent {
    const lines = [
      `JOB OPPORTUNITY | ${payload.title.toUpperCase()}`,
      '',
      `Organization: ${payload.company_name}`,
      `Location: ${locations}${workType}`,
      salaryText ? `Remuneration: ${salaryText.replace('💰 Salary: ', '')}` : null,
      '',
      'To view the complete job description and apply directly, visit: ' + jobUrl,
      '',
      hashtags.slice(0, 5).join(' '),
    ].filter(Boolean) as string[];

    return {
      caption: lines.slice(0, -2).join('\n'),
      hashtags,
      jobUrl,
      fullMessage: lines.join('\n'),
    };
  }

  private formatForInstagram(
    payload: JobPublishedPayloadDto,
    locations: string,
    workType: string,
    salaryText: string | null,
    hashtags: string[],
    jobUrl: string,
  ): FormattedSocialContent {
    const lines = [
      `JOB OPPORTUNITY | ${payload.title.toUpperCase()}`,
      '',
      `Organization: ${payload.company_name}`,
      `Location: ${locations}${workType}`,
      payload.employment_type ? `Employment Type: ${payload.employment_type}` : null,
      salaryText ? `Remuneration: ${salaryText.replace('💰 Salary: ', '')}` : null,
      '',
      'To review full specifications and apply, visit the link in bio or:',
      jobUrl,
      '',
      hashtags.join(' '),
    ].filter(Boolean) as string[];

    return {
      caption: lines.slice(0, -3).join('\n'),
      hashtags,
      jobUrl,
      fullMessage: lines.join('\n'),
    };
  }

  private formatForTwitter(
    payload: JobPublishedPayloadDto,
    locations: string,
    workType: string,
    salaryText: string | null,
    hashtags: string[],
    jobUrl: string,
  ): FormattedSocialContent {
    const header = `🚀 Hiring: ${payload.title} @ ${payload.company_name}\n📍 ${locations}${workType}\n`;
    const footer = `\n👉 Apply: ${jobUrl}\n${hashtags.slice(0, 3).join(' ')}`;
    return {
      caption: header,
      hashtags,
      jobUrl,
      fullMessage: `${header}${footer}`.slice(0, 280),
    };
  }

  private generateHashtags(payload: JobPublishedPayloadDto, _platform: SocialPlatform): string[] {
    const tags = ['#Hiring', '#JobOpening', '#JobBaskets', '#Careers'];
    if (payload.skills) {
      for (const skill of payload.skills.slice(0, 3)) {
        const cleanSkill = skill.replace(/[^a-zA-Z0-9]/g, '');
        if (cleanSkill) tags.push(`#${cleanSkill}`);
      }
    }
    if (payload.work_type === 'remote') {
      tags.push('#RemoteJobs', '#WorkFromHome');
    }
    return tags;
  }

  private resolveCurrency(currency?: string): string {
    if (!currency) return '₹';
    const c = currency.trim().toUpperCase();
    if (c === 'INR' || c === 'RS' || c === 'RS.' || c === '₹') return '₹';
    if (c === 'USD' || c === '$') return '$';
    if (c === 'EUR' || c === '€') return '€';
    if (c === 'GBP' || c === '£') return '£';
    if (c === 'AED') return 'AED ';
    return currency;
  }
}
