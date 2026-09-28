import { ConfigService } from '@nestjs/config';

jest.mock('@whiskeysockets/baileys', () => ({
  __esModule: true,
  default: jest.fn(),
  makeWASocket: jest.fn(),
  useMultiFileAuthState: jest.fn().mockResolvedValue({
    state: { creds: { registered: true }, keys: {} },
    saveCreds: jest.fn(),
  }),
  fetchLatestBaileysVersion: jest.fn().mockResolvedValue({ version: [2, 3000, 1] }),
  makeCacheableSignalKeyStore: jest.fn(),
  DisconnectReason: { loggedOut: 401 },
}));

import { WhatsAppPlugin } from './whatsapp.plugin';
import { WhatsAppBaileysClient } from './whatsapp-baileys.client';
import { JobBannerService } from '../../banner/job-banner.service';
import { JobPublishedPayloadDto, SocialPlatform } from '@app/common';

describe('WhatsAppPlugin', () => {
  let plugin: WhatsAppPlugin;
  let mockConfigService: Partial<ConfigService>;
  let mockWhatsAppClient: Partial<WhatsAppBaileysClient>;
  let mockBannerService: Partial<JobBannerService>;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'PLATFORM_FRONTEND_URL') return 'https://jobbaskets.io';
        if (key === 'WHATSAPP_PHONE_NUMBER') return '9943161027';
        return null;
      }),
    };

    mockWhatsAppClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      isReady: jest.fn().mockReturnValue(true),
      getStatus: jest.fn().mockReturnValue({
        connected: true,
        registered: true,
        phoneNumber: '919943161027',
        authDir: '/tmp/whatsapp_auth',
      }),
      publishToChannel: jest.fn().mockResolvedValue({
        messageId: 'wa_msg_12345',
        jid: '120363123456789@newsletter',
        postUrl: 'https://whatsapp.com/channel/120363123456789',
      }),
    };

    mockBannerService = {
      generateBanner: jest.fn().mockResolvedValue(Buffer.from('fake-banner-bytes')),
    };

    plugin = new WhatsAppPlugin(
      mockConfigService as ConfigService,
      mockWhatsAppClient as WhatsAppBaileysClient,
      mockBannerService as JobBannerService,
    );
  });

  it('should have id "whatsapp" and correct name', () => {
    expect(plugin.id).toBe(SocialPlatform.WHATSAPP);
    expect(plugin.name).toBe('WhatsApp Channel');
  });

  it('should validate health as true when client is ready', async () => {
    const health = await plugin.validateHealth();
    expect(health.healthy).toBe(true);
    expect(health.message).toContain('active');
  });

  it('should format standard job post with WhatsApp markdown and apply url', () => {
    const payload: JobPublishedPayloadDto = {
      job_id: 101,
      uuid: 'abc-123',
      title: 'Home Nurse',
      company_name: 'Care Well Services',
      locations: ['Chennai', 'Coimbatore'],
      employment_type: 'Full-time',
      experience_required: '1-3 Years',
      salary_min: 20000,
      salary_max: 30000,
      salary_currency: 'INR',
      show_salary: true,
      skills: ['Patient Care', 'First Aid'],
    };

    const formatted = plugin.format(payload);
    expect(formatted.text).toContain('💼 *JOB OPPORTUNITY | HOME NURSE*');
    expect(formatted.text).toContain('🏢 *Organization:* Care Well Services');
    expect(formatted.text).toContain('📍 *Location:* Chennai, Coimbatore');
    expect(formatted.text).toContain('💼 *Employment Type:* Full-time');
    expect(formatted.text).toContain('🎓 *Experience Level:* 1-3 Years');
    expect(formatted.text).toContain('💰 *Remuneration:* ₹20,000 - ₹30,000');
    expect(formatted.text).toContain('⚡ *Key Competencies:* Patient Care, First Aid');
    expect(formatted.text).toContain('https://jobbaskets.io/jobs/abc-123');
    expect(formatted.hashtags).toContain('#Hiring');
  });

  it('should format classified ad flyer post with clean structure', () => {
    const payload: JobPublishedPayloadDto = {
      job_id: 102,
      uuid: 'ad-456',
      post_type: 'classified',
      title: 'Urgent Delivery Driver',
      company_name: 'Express Logistics',
      locations: ['Bangalore'],
      image_url: 'https://storage.jobbaskets.io/flyers/driver.png',
    };

    const formatted = plugin.format(payload);
    expect(formatted.text).toContain('💼 *URGENT DELIVERY DRIVER*');
    expect(formatted.text).toContain('🏢 *Organization:* Express Logistics');
    expect(formatted.text).toContain('📍 *Location:* Bangalore');
    expect(formatted.text).toContain('https://jobbaskets.io/classified-ads?ad=ad-456');
    expect(formatted.hashtags).toContain('#Hiring');
  });

  it('should execute publish for standard job generating dynamic banner', async () => {
    const payload: JobPublishedPayloadDto = {
      job_id: 101,
      uuid: 'abc-123',
      title: 'Home Nurse',
      company_name: 'Care Well Services',
    };

    const result = await plugin.publish(payload);
    expect(result.success).toBe(true);
    expect(result.platform).toBe(SocialPlatform.WHATSAPP);
    expect(result.externalPostId).toBe('wa_msg_12345');
    expect(mockBannerService.generateBanner).toHaveBeenCalledWith(payload);
    expect(mockWhatsAppClient.publishToChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        imageBuffer: Buffer.from('fake-banner-bytes'),
      }),
    );
  });
});
