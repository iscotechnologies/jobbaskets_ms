export const SOCIAL_POST_QUEUE = 'social_post_queue';
export const JOB_PUBLISH_TASK = 'publish_to_socials';

export const REDIS_CLIENT = 'REDIS_CLIENT';
export const REDIS_PUBSUB_CHANNEL = 'jb:events:job_published';

export enum SocialPlatform {
  LINKEDIN = 'linkedin',
  FACEBOOK = 'facebook',
  INSTAGRAM = 'instagram',
  TWITTER = 'twitter',
}

export enum PostStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  POSTED = 'POSTED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

export function resolveCurrencySymbol(currency?: string): string {
  if (!currency) return '₹';
  const c = currency.trim().toUpperCase();
  if (c === 'INR' || c === 'RS' || c === 'RS.' || c === '₹') return '₹';
  if (c === 'USD' || c === '$') return '$';
  if (c === 'EUR' || c === '€') return '€';
  if (c === 'GBP' || c === '£') return '£';
  if (c === 'AED') return 'AED ';
  return currency;
}
