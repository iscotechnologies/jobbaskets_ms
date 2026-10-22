import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface LinkedInPostRequest {
  author?: string; // e.g. "urn:li:organization:123456" or "urn:li:person:abcdef"
  commentary: string;
  visibility: 'PUBLIC' | 'CONNECTIONS';
  landingPageUrl: string;
  title?: string;
  description?: string;
  photoBuffer?: Buffer;
}

export interface LinkedInPostResponse {
  id: string;
  postUrl?: string;
}

export interface LinkedInUserInfo {
  sub: string;
  name?: string;
  email?: string;
  picture?: string;
}

@Injectable()
export class LinkedInRestClient {
  private readonly logger = new Logger(LinkedInRestClient.name);
  private readonly baseUrl = 'https://api.linkedin.com/rest';
  private readonly woopBaseUrl = 'https://api.woopsocial.com/v1';
  private cachedPersonUrn?: string;
  private cachedWoopProjectId?: string;
  private cachedWoopSocialAccount?: { id: string; platform: string };

  constructor(private readonly configService: ConfigService) {}

  /**
   * Check if WoopSocial integration is active
   */
  isWoopConfigured(): boolean {
    return Boolean(this.configService.get<string>('WOOPSOCIAL_API_KEY'));
  }

  /**
   * Retrieve WoopSocial Project ID (cached after first lookup)
   */
  async getWoopProjectId(): Promise<string> {
    const configured = this.configService.get<string>('WOOPSOCIAL_PROJECT_ID');
    if (configured) return configured;
    if (this.cachedWoopProjectId) return this.cachedWoopProjectId;

    const apiKey = this.configService.get<string>('WOOPSOCIAL_API_KEY');
    const res = await fetch(`${this.woopBaseUrl}/projects`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch WoopSocial projects: ${res.status} ${await res.text()}`);
    }
    const projects = await res.json();
    if (!Array.isArray(projects) || projects.length === 0) {
      throw new Error('No WoopSocial project found for this API key');
    }
    this.cachedWoopProjectId = String(projects[0].id);
    return this.cachedWoopProjectId;
  }

  /**
   * Retrieve WoopSocial Social Account for LinkedIn (preferring LINKEDIN_PAGES)
   */
  async getWoopSocialAccount(): Promise<{ id: string; platform: string }> {
    const configuredId = this.configService.get<string>('WOOPSOCIAL_LINKEDIN_ACCOUNT_ID');
    if (configuredId) {
      return { id: configuredId, platform: 'LINKEDIN_PAGES' };
    }
    if (this.cachedWoopSocialAccount) {
      return this.cachedWoopSocialAccount;
    }

    const apiKey = this.configService.get<string>('WOOPSOCIAL_API_KEY');
    const res = await fetch(`${this.woopBaseUrl}/social-accounts`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch WoopSocial social accounts: ${res.status} ${await res.text()}`);
    }
    const accounts = await res.json();
    if (!Array.isArray(accounts) || accounts.length === 0) {
      throw new Error('No social account connected in WoopSocial');
    }

    // Look for LINKEDIN_PAGES first (Company Page), fallback to LINKEDIN (personal)
    const pageAccount = accounts.find((a: any) => a.platform === 'LINKEDIN_PAGES' && a.status === 'CONNECTED');
    if (pageAccount) {
      this.cachedWoopSocialAccount = { id: pageAccount.id, platform: pageAccount.platform };
      return this.cachedWoopSocialAccount;
    }

    const memberAccount = accounts.find((a: any) => a.platform === 'LINKEDIN' && a.status === 'CONNECTED');
    if (memberAccount) {
      this.cachedWoopSocialAccount = { id: memberAccount.id, platform: memberAccount.platform };
      return this.cachedWoopSocialAccount;
    }

    throw new Error('No connected LinkedIn account found in WoopSocial');
  }

  /**
   * Publish post via WoopSocial REST API to LinkedIn Pages with automatic media cleanup
   */
  private async publishViaWoopSocial(req: LinkedInPostRequest): Promise<LinkedInPostResponse> {
    const apiKey = this.configService.get<string>('WOOPSOCIAL_API_KEY')!;
    const projectId = await this.getWoopProjectId();
    const account = await this.getWoopSocialAccount();

    let mediaId: string | undefined;

    // 1. Upload photo if present
    if (req.photoBuffer) {
      try {
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(req.photoBuffer)], { type: 'image/png' }), 'job_banner.png');

        const uploadRes = await fetch(`${this.woopBaseUrl}/media?projectId=${projectId}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
        });

        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          mediaId = uploadData.mediaId;
          this.logger.log(`Uploaded job image to WoopSocial. Media ID: ${mediaId}`);
        } else {
          this.logger.warn(`WoopSocial media upload failed [${uploadRes.status}]: ${await uploadRes.text()}`);
        }
      } catch (err) {
        this.logger.warn(`WoopSocial media upload error: ${err}`);
      }
    }

    // 2. Publish post immediately with autoDeleteMediaAfterPublish to keep storage at 0 MB
    const payload = {
      content: [
        {
          text: req.commentary,
          media: mediaId ? [{ type: 'MEDIA_LIBRARY', mediaId }] : undefined,
        },
      ],
      schedule: {
        type: 'PUBLISH_NOW',
      },
      autoDeleteMediaAfterPublish: true,
      socialAccounts: [
        {
          platform: account.platform,
          socialAccountId: account.id,
        },
      ],
    };

    const postRes = await fetch(`${this.woopBaseUrl}/posts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!postRes.ok) {
      const errText = await postRes.text();
      this.logger.error(`WoopSocial post creation failed [${postRes.status}]: ${errText}`);
      throw new Error(`WoopSocial API error [${postRes.status}]: ${errText}`);
    }

    const postData = await postRes.json();
    const childPost = postData.socialAccountPosts?.[0];
    const externalId = childPost?.externalPostId || postData.id;
    const postUrl = childPost?.externalPostUrl || `https://www.linkedin.com/company/112977680/admin/feed/posts/`;

    this.logger.log(`Successfully published post via WoopSocial to ${account.platform} [${externalId}]`);

    return {
      id: externalId,
      postUrl,
    };
  }

  /**
   * Retrieve authenticated member's user info / person URN (Native LinkedIn OAuth)
   */
  async getUserInfo(): Promise<LinkedInUserInfo | null> {
    const accessToken = this.configService.get<string>('LINKEDIN_ACCESS_TOKEN');
    if (!accessToken) return null;

    try {
      const res = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        this.logger.warn(`Failed to fetch LinkedIn user info: ${res.status}`);
        return null;
      }
      const data = await res.json();
      if (data.sub) {
        this.cachedPersonUrn = `urn:li:person:${data.sub}`;
      }
      return data;
    } catch (err) {
      this.logger.error(`Error fetching LinkedIn user info: ${err}`);
      return null;
    }
  }

  /**
   * Determine the best author URN (Organization or Person)
   */
  async getAuthorUrn(): Promise<string> {
    const orgId = this.configService.get<string>('LINKEDIN_ORG_ID');
    if (orgId) {
      return orgId.startsWith('urn:li:') ? orgId : `urn:li:organization:${orgId}`;
    }

    if (this.cachedPersonUrn) {
      return this.cachedPersonUrn;
    }

    const userInfo = await this.getUserInfo();
    if (userInfo?.sub) {
      return `urn:li:person:${userInfo.sub}`;
    }

    throw new Error('Unable to determine LinkedIn author URN. Please configure LINKEDIN_ORG_ID or check access token permissions.');
  }

  /**
   * Create a post (routes to WoopSocial if configured, otherwise native LinkedIn REST API)
   */
  async createPost(req: LinkedInPostRequest): Promise<LinkedInPostResponse> {
    if (this.isWoopConfigured()) {
      return this.publishViaWoopSocial(req);
    }

    const accessToken = this.configService.get<string>('LINKEDIN_ACCESS_TOKEN');
    if (!accessToken) {
      throw new Error('Neither WOOPSOCIAL_API_KEY nor LINKEDIN_ACCESS_TOKEN is configured');
    }

    let author = req.author || (await this.getAuthorUrn());

    const buildPayload = (authorUrn: string) => ({
      author: authorUrn,
      commentary: req.commentary,
      visibility: req.visibility,
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      content: {
        article: {
          source: req.landingPageUrl,
          title: req.title,
          description: req.description,
        },
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    });

    let response = await fetch(`${this.baseUrl}/posts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': '202401',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildPayload(author)),
    });

    // If posting as organization failed with 403 (e.g. w_member_social scope only), retry as member
    if (response.status === 403 && author.includes('organization')) {
      this.logger.warn(`Posting as organization returned 403. Retrying with authenticated member URN...`);
      const userInfo = await this.getUserInfo();
      if (userInfo?.sub) {
        author = `urn:li:person:${userInfo.sub}`;
        response = await fetch(`${this.baseUrl}/posts`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-Restli-Protocol-Version': '2.0.0',
            'LinkedIn-Version': '202401',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(buildPayload(author)),
        });
      }
    }

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(`LinkedIn API error [${response.status}]: ${errorBody}`);
      throw new Error(`LinkedIn API responded with status ${response.status}: ${errorBody}`);
    }

    const postId = response.headers.get('x-restli-id') || response.headers.get('x-linkedin-id') || 'urn:li:share:created';
    const postUrl = `https://www.linkedin.com/feed/update/${postId}`;

    return {
      id: postId,
      postUrl,
    };
  }

  async checkTokenHealth(): Promise<boolean> {
    if (this.isWoopConfigured()) {
      try {
        const apiKey = this.configService.get<string>('WOOPSOCIAL_API_KEY');
        const res = await fetch(`${this.woopBaseUrl}/social-accounts`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) return false;
        const accounts = await res.json();
        return Array.isArray(accounts) && accounts.some((a: any) => a.status === 'CONNECTED');
      } catch {
        return false;
      }
    }

    const accessToken = this.configService.get<string>('LINKEDIN_ACCESS_TOKEN');
    if (!accessToken) return false;

    try {
      const res = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
