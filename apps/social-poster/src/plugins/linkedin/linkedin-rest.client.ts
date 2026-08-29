import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface LinkedInPostRequest {
  author?: string; // e.g. "urn:li:organization:123456" or "urn:li:person:abcdef"
  commentary: string;
  visibility: 'PUBLIC' | 'CONNECTIONS';
  landingPageUrl: string;
  title?: string;
  description?: string;
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
  private cachedPersonUrn?: string;

  constructor(private readonly configService: ConfigService) {}

  /**
   * Retrieve authenticated member's user info / person URN
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
   * Create a post using LinkedIn Versioned REST API (202401 protocol)
   */
  async createPost(req: LinkedInPostRequest): Promise<LinkedInPostResponse> {
    const accessToken = this.configService.get<string>('LINKEDIN_ACCESS_TOKEN');
    if (!accessToken) {
      throw new Error('LINKEDIN_ACCESS_TOKEN is not configured');
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
