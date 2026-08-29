import { JobPublishedPayloadDto, SocialPlatform } from '@app/common';

export interface PluginHealth {
  healthy: boolean;
  message?: string;
  details?: Record<string, unknown>;
}

export interface FormattedPost {
  text: string;
  hashtags: string[];
  jobUrl: string;
  mediaUrls?: string[];
  extraMetadata?: Record<string, unknown>;
}

export interface PublishResult {
  platform: SocialPlatform | string;
  success: boolean;
  externalPostId?: string;
  postUrl?: string;
  error?: string;
  rawResponse?: unknown;
  latencyMs?: number;
  timestamp: string;
}

export interface ISocialPlugin {
  readonly id: SocialPlatform | string;
  readonly name: string;

  /**
   * Check whether this plugin is configured and enabled in the current environment
   */
  isEnabled(): boolean;

  /**
   * Validate API token validity or connection health
   */
  validateHealth(): Promise<PluginHealth>;

  /**
   * Format the standardized JobPublishedPayload into platform-specific format
   */
  format(payload: JobPublishedPayloadDto): FormattedPost;

  /**
   * Publish the job post to the external platform
   */
  publish(payload: JobPublishedPayloadDto): Promise<PublishResult>;

  /**
   * Optional: delete a published post by external ID
   */
  deletePost?(externalPostId: string): Promise<boolean>;
}

export const SOCIAL_PLUGINS_TOKEN = Symbol('SOCIAL_PLUGINS_TOKEN');
