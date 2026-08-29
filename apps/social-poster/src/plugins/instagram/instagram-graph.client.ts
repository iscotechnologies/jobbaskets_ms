import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface InstagramPublishRequest {
  accountId?: string;
  accessToken?: string;
  imageUrl: string;
  caption: string;
}

export interface InstagramPublishResponse {
  mediaId: string;
  postUrl?: string;
}

@Injectable()
export class InstagramGraphClient {
  private readonly logger = new Logger(InstagramGraphClient.name);
  private readonly graphApiVersion = 'v20.0';

  constructor(private readonly configService: ConfigService) {}

  /**
   * Publishes an image post to Instagram Business Account via Container API
   */
  async publishPhoto(req: InstagramPublishRequest): Promise<InstagramPublishResponse> {
    const accountId = req.accountId || this.configService.get<string>('INSTAGRAM_ACCOUNT_ID');
    const token = req.accessToken || this.configService.get<string>('FB_PAGE_ACCESS_TOKEN');

    if (!accountId || !token) {
      throw new Error('INSTAGRAM_ACCOUNT_ID or FB_PAGE_ACCESS_TOKEN is not configured');
    }

    if (!req.imageUrl) {
      throw new Error('Instagram publishing requires a public imageUrl');
    }

    // Step 1: Create Media Container
    this.logger.log(`Creating Instagram media container for account ${accountId}...`);
    const containerParams = new URLSearchParams({
      image_url: req.imageUrl,
      caption: req.caption,
      access_token: token,
    });

    const containerRes = await fetch(`https://graph.facebook.com/${this.graphApiVersion}/${accountId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: containerParams.toString(),
    });

    const containerData = await containerRes.json();
    if (containerData.error) {
      this.logger.error(`Instagram container creation failed: ${JSON.stringify(containerData.error)}`);
      throw new Error(`Instagram error [${containerData.error.code}]: ${containerData.error.message}`);
    }

    const creationId = containerData.id;
    this.logger.log(`Created Instagram container ID: ${creationId}`);

    // Step 2: Poll container status until FINISHED
    let ready = false;
    for (let attempt = 1; attempt <= 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const statusRes = await fetch(
        `https://graph.facebook.com/${this.graphApiVersion}/${creationId}?fields=status_code,status&access_token=${token}`,
      );
      const statusData = await statusRes.json();

      if (statusData.status_code === 'FINISHED') {
        ready = true;
        break;
      } else if (statusData.status_code === 'ERROR') {
        throw new Error(`Instagram container processing failed: ${JSON.stringify(statusData)}`);
      }
    }

    if (!ready) {
      throw new Error(`Instagram container ${creationId} timed out before finishing processing`);
    }

    // Step 3: Publish Media Container
    const publishParams = new URLSearchParams({
      creation_id: creationId,
      access_token: token,
    });

    const publishRes = await fetch(`https://graph.facebook.com/${this.graphApiVersion}/${accountId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: publishParams.toString(),
    });

    const publishData = await publishRes.json();
    if (publishData.error) {
      this.logger.error(`Instagram media_publish failed: ${JSON.stringify(publishData.error)}`);
      throw new Error(`Instagram publish error [${publishData.error.code}]: ${publishData.error.message}`);
    }

    const mediaId = publishData.id;
    return {
      mediaId,
      postUrl: `https://www.instagram.com/p/${mediaId}/`,
    };
  }

  /**
   * Validates health by querying the Instagram profile
   */
  async checkAccountHealth(): Promise<boolean> {
    const accountId = this.configService.get<string>('INSTAGRAM_ACCOUNT_ID');
    const token = this.configService.get<string>('FB_PAGE_ACCESS_TOKEN');

    if (!accountId || !token) return false;

    try {
      const res = await fetch(`https://graph.facebook.com/${this.graphApiVersion}/${accountId}?fields=id,username&access_token=${token}`);
      const data = await res.json();
      return Boolean(data.id && !data.error);
    } catch {
      return false;
    }
  }
}
