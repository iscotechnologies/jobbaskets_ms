import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobPublishedPayloadDto, resolveCurrencySymbol } from '@app/common';
import { BaseSocialPlugin } from '../base/base-social.plugin';
import { FormattedPost, PluginHealth, PublishResult } from '../plugin.interface';
import { TelegramBotClient } from './telegram-bot.client';
import { JobBannerService } from '../../banner/job-banner.service';

@Injectable()
export class TelegramPlugin extends BaseSocialPlugin {
  readonly id = 'telegram';
  readonly name = 'Telegram Channel';

  constructor(
    private readonly configService: ConfigService,
    private readonly botClient: TelegramBotClient,
    private readonly bannerService: JobBannerService,
  ) {
    super();
  }

  isEnabled(): boolean {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    const chatId = this.configService.get<string>('TELEGRAM_CHAT_ID');
    return Boolean(token && chatId);
  }

  async validateHealth(): Promise<PluginHealth> {
    if (!this.isEnabled()) {
      return { healthy: false, message: 'Telegram bot credentials not configured (running in sandbox mode)' };
    }

    const isHealthy = await this.botClient.checkBotHealth();
    return {
      healthy: isHealthy,
      message: isHealthy ? 'Telegram Bot is active and responsive' : 'Telegram Bot token invalid',
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
    const jobUrl = this.resolveJobUrl(payload);
    const hashtags = ['#Hiring', '#JobOpening', '#JobBaskets'];
    if (payload.skills) {
      for (const skill of payload.skills.slice(0, 3)) {
        const clean = skill.replace(/[^a-zA-Z0-9]/g, '');
        if (clean) hashtags.push(`#${clean}`);
      }
    }

    // Classified flyer ads: simple HTML caption (details are on the flyer image itself)
    if (payload.post_type === 'classified') {
      const lines = [
        `<b>${payload.title ? this.escapeHtml(payload.title.toUpperCase()) : 'JOB OPPORTUNITY'}</b>`,
        '',
        payload.company_name && payload.company_name !== 'JobBaskets Hiring Partner'
          ? `<b>Organization:</b> ${this.escapeHtml(payload.company_name)}` : null,
        payload.locations && payload.locations.length > 0
          ? `<b>Location:</b> ${this.escapeHtml(payload.locations.join(', '))}` : null,
        '',
        hashtags.join(' '),
      ].filter(Boolean) as string[];

      return { text: lines.join('\n'), hashtags, jobUrl };
    }

    // Standard job posts: full structured HTML caption
    const locations = payload.locations && payload.locations.length > 0 ? payload.locations.join(', ') : 'Multiple Locations';
    const workType = payload.work_type ? ` (${payload.work_type.toUpperCase()})` : '';
    const curr = resolveCurrencySymbol(payload.salary_currency);
    const salaryText = payload.show_salary && payload.salary_min && payload.salary_max
      ? `💰 <b>Salary:</b> ${curr}${payload.salary_min.toLocaleString()} - ${curr}${payload.salary_max.toLocaleString()}`
      : null;

    const lines = [
      `<b>JOB OPPORTUNITY | ${this.escapeHtml(payload.title.toUpperCase())}</b>`,
      '',
      `<b>Organization:</b> ${this.escapeHtml(payload.company_name)}`,
      `<b>Location:</b> ${this.escapeHtml(locations)}${workType}`,
      payload.employment_type ? `<b>Employment Type:</b> ${this.escapeHtml(payload.employment_type)}` : null,
      payload.experience_required ? `<b>Experience Level:</b> ${this.escapeHtml(payload.experience_required)}` : null,
      salaryText ? `<b>Remuneration:</b> ${this.escapeHtml(salaryText.replace(/💰\s*<b>Salary:<\/b>\s*/i, ''))}` : null,
      payload.skills && payload.skills.length > 0 ? `<b>Key Competencies:</b> ${this.escapeHtml(payload.skills.slice(0, 5).join(', '))}` : null,
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
    const chatId = this.configService.get<string>('TELEGRAM_CHAT_ID')!;

    let photoBuffer: Buffer | undefined;
    let photoUrl: string | undefined;

    if (payload.post_type === 'classified' && payload.image_url) {
      // Classified flyer ad: download and use the pre-uploaded flyer image directly
      try {
        const response = await fetch(payload.image_url);
        if (response.ok) {
          photoBuffer = Buffer.from(await response.arrayBuffer());
          this.logger.log(`Telegram: Using flyer image for classified ad ${payload.job_id}`);
        }
      } catch (err) {
        this.logger.warn(`Telegram: Failed to download flyer image: ${err}. Falling back to URL...`);
        photoUrl = payload.image_url;
      }
    } else {
      // Standard job: generate dynamic branded banner
      try {
        photoBuffer = await this.bannerService.generateBanner(payload);
      } catch (err) {
        this.logger.warn(`Banner generation failed: ${err}. Sending without dynamic banner...`);
      }
      photoUrl = payload.banner_url || payload.image_url || payload.company_logo;
    }

    // Publish to Telegram
    const res = await this.botClient.sendMessage({
      chatId,
      text: formatted.text,
      applyUrl: formatted.jobUrl,
      photoBuffer,
      photoUrl,
    });

    const postUrl = res.chatUsername
      ? `https://t.me/${res.chatUsername}/${res.messageId}`
      : `https://t.me/c/${chatId.replace('-100', '')}/${res.messageId}`;

    return {
      platform: this.id,
      success: true,
      externalPostId: String(res.messageId),
      postUrl,
      rawResponse: res,
      timestamp: new Date().toISOString(),
    };
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
