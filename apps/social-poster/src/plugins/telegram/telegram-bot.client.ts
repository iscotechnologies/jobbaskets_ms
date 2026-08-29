import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface TelegramMessageRequest {
  chatId: string; // e.g. "@jobbaskets" or "-100123456789"
  text: string;
  applyUrl: string;
  photoBuffer?: Buffer;
  photoUrl?: string;
}

export interface TelegramMessageResponse {
  messageId: number;
  chatUsername?: string;
}

@Injectable()
export class TelegramBotClient {
  private readonly logger = new Logger(TelegramBotClient.name);

  constructor(private readonly configService: ConfigService) {}

  async sendMessage(req: TelegramMessageRequest): Promise<TelegramMessageResponse> {
    const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    }

    const replyMarkup = {
      inline_keyboard: [
        [
          {
            text: '🚀 Apply for this Job on JobBaskets',
            url: req.applyUrl,
          },
        ],
      ],
    };

    // 1. If photoBuffer is provided (Dynamically rendered Canva banner)
    if (req.photoBuffer) {
      try {
        const formData = new FormData();
        formData.append('chat_id', req.chatId);
        formData.append('photo', new Blob([new Uint8Array(req.photoBuffer)], { type: 'image/png' }), 'job_banner.png');
        formData.append('caption', req.text);
        formData.append('parse_mode', 'HTML');
        formData.append('reply_markup', JSON.stringify(replyMarkup));

        const photoResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
          method: 'POST',
          body: formData,
        });

        const photoData = await photoResponse.json();
        if (photoData.ok) {
          return {
            messageId: photoData.result.message_id,
            chatUsername: photoData.result.chat?.username,
          };
        }

        this.logger.warn(`Telegram sendPhoto buffer failed (${photoData.description}). Falling back...`);
      } catch (err) {
        this.logger.warn(`Telegram sendPhoto buffer error: ${err}. Falling back...`);
      }
    }

    // 2. If photoUrl is provided
    if (req.photoUrl) {
      try {
        const photoPayload = {
          chat_id: req.chatId,
          photo: req.photoUrl,
          caption: req.text,
          parse_mode: 'HTML',
          reply_markup: replyMarkup,
        };

        const photoResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(photoPayload),
        });

        const photoData = await photoResponse.json();
        if (photoData.ok) {
          return {
            messageId: photoData.result.message_id,
            chatUsername: photoData.result.chat?.username,
          };
        }

        this.logger.warn(`Telegram sendPhoto URL failed (${photoData.description}). Falling back to text message...`);
      } catch (err) {
        this.logger.warn(`Telegram sendPhoto URL error: ${err}. Falling back to text message...`);
      }
    }

    // 3. Fallback or default: sendMessage
    const payload = {
      chat_id: req.chatId,
      text: req.text,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
      reply_markup: replyMarkup,
    };

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!data.ok) {
      this.logger.error(`Telegram API error [${data.error_code}]: ${data.description}`);
      throw new Error(`Telegram error ${data.error_code}: ${data.description}`);
    }

    return {
      messageId: data.result.message_id,
      chatUsername: data.result.chat?.username,
    };
  }

  async checkBotHealth(): Promise<boolean> {
    const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!botToken) return false;

    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const data = await res.json();
      return Boolean(data.ok);
    } catch {
      return false;
    }
  }
}
