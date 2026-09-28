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

import { WhatsAppBaileysClient } from './whatsapp-baileys.client';

describe('WhatsAppBaileysClient', () => {
  let client: WhatsAppBaileysClient;
  let mockConfigService: Partial<ConfigService>;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'WHATSAPP_PHONE_NUMBER') return '9943161027';
        if (key === 'WHATSAPP_CHANNEL_JID') return '120363000000000000@newsletter';
        return null;
      }),
    };

    client = new WhatsAppBaileysClient(mockConfigService as ConfigService);
  });

  describe('sanitizePhoneNumber', () => {
    it('should format 10-digit Indian numbers with 91 prefix', () => {
      expect(client.sanitizePhoneNumber('9943161027')).toBe('919943161027');
      expect(client.sanitizePhoneNumber('+91 99431 61027')).toBe('919943161027');
      expect(client.sanitizePhoneNumber('919943161027')).toBe('919943161027');
    });

    it('should handle already formatted numbers', () => {
      expect(client.sanitizePhoneNumber('919943161027')).toBe('919943161027');
    });
  });

  describe('resolveChannelJid', () => {
    it('should return direct JID when configured with @newsletter', async () => {
      const jid = await client.resolveChannelJid();
      expect(jid).toBe('120363000000000000@newsletter');
    });

    it('should append @newsletter to numeric ID if missing', async () => {
      mockConfigService.get = jest.fn((key: string) => {
        if (key === 'WHATSAPP_CHANNEL_JID') return '120363123456789012';
        return null;
      });

      const newClient = new WhatsAppBaileysClient(mockConfigService as ConfigService);
      const jid = await newClient.resolveChannelJid();
      expect(jid).toBe('120363123456789012@newsletter');
    });
  });

  describe('getStatus', () => {
    it('should return client status structure', () => {
      const status = client.getStatus();
      expect(status).toHaveProperty('connected');
      expect(status).toHaveProperty('registered');
      expect(status).toHaveProperty('phoneNumber', '919943161027');
      expect(status).toHaveProperty('authDir');
    });
  });
});
