import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface FacebookPostRequest {
  pageId: string;
  pageToken: string;
  message: string;
  link?: string;
  photoBuffer?: Buffer;
}

export interface FacebookPostResponse {
  id: string;
  postId?: string;
  postUrl?: string;
}

@Injectable()
export class FacebookGraphClient {
  private readonly logger = new Logger(FacebookGraphClient.name);
  private readonly graphApiVersion = 'v20.0';

  constructor(private readonly configService: ConfigService) {}

  /**
   * Publishes a post (with photo or link) to a Facebook Page
   */
  async publishToPage(req: FacebookPostRequest): Promise<FacebookPostResponse> {
    const pageId = req.pageId || this.configService.get<string>('FB_PAGE_ID');
    const pageToken = req.pageToken || this.configService.get<string>('FB_PAGE_ACCESS_TOKEN');

    if (!pageId || !pageToken) {
      throw new Error('FB_PAGE_ID or FB_PAGE_ACCESS_TOKEN is not configured');
    }

    // 1. If photoBuffer is present, publish as photo post
    if (req.photoBuffer) {
      try {
        const formData = new FormData();
        formData.append('access_token', pageToken);
        formData.append('message', req.message);
        formData.append('source', new Blob([new Uint8Array(req.photoBuffer)], { type: 'image/png' }), 'job_banner.png');

        const response = await fetch(`https://graph.facebook.com/${this.graphApiVersion}/${pageId}/photos`, {
          method: 'POST',
          body: formData,
        });

        const data = await response.json();
        if (data.error) {
          throw new Error(`Facebook photo publish error [${data.error.code}]: ${data.error.message}`);
        }

        const postId = data.post_id || data.id;
        const postUrl = `https://www.facebook.com/${postId.replace('_', '/posts/')}`;

        return {
          id: data.id,
          postId,
          postUrl,
        };
      } catch (err) {
        this.logger.warn(`Facebook photo post failed: ${err}. Falling back to standard feed post...`);
      }
    }

    // 2. Fallback: Standard feed post with link
    const payload: Record<string, string> = {
      access_token: pageToken,
      message: req.message,
    };
    if (req.link) {
      payload.link = req.link;
    }

    const feedResponse = await fetch(`https://graph.facebook.com/${this.graphApiVersion}/${pageId}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const feedData = await feedResponse.json();
    if (feedData.error) {
      this.logger.error(`Facebook feed publish error: ${JSON.stringify(feedData.error)}`);
      throw new Error(`Facebook error ${feedData.error.code}: ${feedData.error.message}`);
    }

    const postId = feedData.id;
    return {
      id: feedData.id,
      postId,
      postUrl: `https://www.facebook.com/${postId.replace('_', '/posts/')}`,
    };
  }

  /**
   * Health check for Facebook Page token
   */
  async checkPageHealth(): Promise<boolean> {
    const pageId = this.configService.get<string>('FB_PAGE_ID');
    const pageToken = this.configService.get<string>('FB_PAGE_ACCESS_TOKEN');

    if (!pageId || !pageToken) return false;

    try {
      const res = await fetch(`https://graph.facebook.com/${this.graphApiVersion}/${pageId}?fields=id,name&access_token=${pageToken}`);
      const data = await res.json();
      return Boolean(data.id && !data.error);
    } catch {
      return false;
    }
  }
}
