import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobPublishedPayloadDto } from '@app/common';
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
    const locations = payload.locations && payload.locations.length > 0 ? payload.locations.join(', ') : 'Multiple Locations';
    const workType = payload.work_type ? ` (${payload.work_type.toUpperCase()})` : '';
    const salaryText = payload.show_salary && payload.salary_min && payload.salary_max
      ? `💰 <b>Salary:</b> ${payload.salary_currency || '$'}${payload.salary_min.toLocaleString()} - ${payload.salary_currency || '$'}${payload.salary_max.toLocaleString()}`
      : null;

    const hashtags = ['#Hiring', '#JobOpening', '#JobBaskets'];
    if (payload.skills) {
      for (const skill of payload.skills.slice(0, 3)) {
        const clean = skill.replace(/[^a-zA-Z0-9]/g, '');
        if (clean) hashtags.push(`#${clean}`);
      }
    }

    const jobUrl = this.resolveJobUrl(payload);

    const lines = [
      `📢 <b>NEW JOB ALERT!</b>`,
      `💼 <b>${this.escapeHtml(payload.title)}</b>`,
      `🏢 <b>Company:</b> ${this.escapeHtml(payload.company_name)}`,
      `📍 <b>Location:</b> ${this.escapeHtml(locations)}${workType}`,
      payload.employment_type ? `⏱ <b>Type:</b> ${this.escapeHtml(payload.employment_type)}` : null,
      payload.experience_required ? `🎯 <b>Experience:</b> ${this.escapeHtml(payload.experience_required)}` : null,
      salaryText,
      payload.skills && payload.skills.length > 0 ? `🛠 <b>Skills:</b> ${this.escapeHtml(payload.skills.slice(0, 5).join(', '))}` : null,
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

    // 1. Generate dynamic Canva-style branded banner buffer
    let photoBuffer: Buffer | undefined;
    try {
      photoBuffer = await this.bannerService.generateBanner(payload);
    } catch (err) {
      this.logger.warn(`Banner generation failed: ${err}. Sending without dynamic banner...`);
    }

    // 2. Publish with banner to Telegram
    const res = await this.botClient.sendMessage({
      chatId,
      text: formatted.text,
      applyUrl: formatted.jobUrl,
      photoBuffer,
      photoUrl: payload.banner_url || payload.image_url || payload.company_logo,
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
