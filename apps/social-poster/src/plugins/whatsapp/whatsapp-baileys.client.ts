import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import * as fs from 'fs';
import * as path from 'path';

export interface WhatsAppPublishRequest {
  channelJid?: string;
  caption: string;
  imageBuffer?: Buffer;
}

export interface WhatsAppPublishResult {
  messageId: string;
  jid: string;
  postUrl?: string;
}

export interface WhatsAppClientStatus {
  connected: boolean;
  registered: boolean;
  phoneNumber?: string;
  pairingCode?: string;
  qrCode?: string;
  resolvedChannelJid?: string;
  authDir: string;
}

@Injectable()
export class WhatsAppBaileysClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppBaileysClient.name);
  private sock: WASocket | null = null;
  private isConnected = false;
  private isRegistered = false;
  private pairingCode: string | null = null;
  private qrCode: string | null = null;
  private resolvedChannelJid: string | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isInitializing = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    // Only auto-connect if WhatsApp is enabled or phone number is provided
    if (this.isConfigured()) {
      this.logger.log('WhatsApp client is configured. Initializing Baileys connection...');
      await this.initSocket();
    } else {
      this.logger.log('WhatsApp credentials not configured yet. Client standing by.');
    }
  }

  async onModuleDestroy() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch (err) {
        this.logger.warn(`Error closing WhatsApp socket: ${err}`);
      }
    }
  }

  public isConfigured(): boolean {
    const phone = this.getPhoneNumber();
    const channel = this.getChannelConfig();
    const enabled = this.configService.get<string>('WHATSAPP_ENABLED');
    return Boolean(phone || channel || enabled === 'true');
  }

  public getStatus(): WhatsAppClientStatus {
    return {
      connected: this.isConnected,
      registered: this.isRegistered,
      phoneNumber: this.getPhoneNumber() || undefined,
      pairingCode: this.pairingCode || undefined,
      qrCode: this.qrCode || undefined,
      resolvedChannelJid: this.resolvedChannelJid || this.getChannelConfig() || undefined,
      authDir: this.getAuthDir(),
    };
  }

  public isReady(): boolean {
    return this.isConnected && this.sock !== null;
  }

  private getAuthDir(): string {
    const customPath = this.configService.get<string>('WHATSAPP_AUTH_DIR');
    if (customPath) {
      return path.resolve(customPath);
    }
    const storagePath = this.configService.get<string>('STORAGE_PATH') || path.join(process.cwd(), 'storage');
    return path.join(storagePath, 'whatsapp_auth');
  }

  public getPhoneNumber(): string | null {
    const raw = this.configService.get<string>('WHATSAPP_PHONE_NUMBER') || '9943161027';
    if (!raw) return null;
    return this.sanitizePhoneNumber(raw);
  }

  public sanitizePhoneNumber(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    // If it's a 10-digit Indian number without country code, prepend 91
    if (digits.length === 10) {
      return `91${digits}`;
    }
    return digits;
  }

  private getChannelConfig(): string | null {
    return (
      this.configService.get<string>('WHATSAPP_CHANNEL_JID') ||
      this.configService.get<string>('WHATSAPP_CHANNEL_URL') ||
      this.configService.get<string>('WHATSAPP_CHANNEL_INVITE_CODE') ||
      null
    );
  }

  public async initSocket(): Promise<void> {
    if (this.isInitializing) return;
    this.isInitializing = true;

    try {
      let authDir = this.getAuthDir();
      try {
        fs.mkdirSync(authDir, { recursive: true });
      } catch (err) {
        this.logger.warn(`Could not create ${authDir} (${err}), falling back to /tmp/whatsapp_auth`);
        authDir = '/tmp/whatsapp_auth';
        fs.mkdirSync(authDir, { recursive: true });
      }

      const pinoLogger = pino({ level: 'silent' });
      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      const { version } = await fetchLatestBaileysVersion();

      this.isRegistered = Boolean(state.creds?.registered);

      this.sock = makeWASocket({
        version,
        logger: pinoLogger,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pinoLogger),
        },
        printQRInTerminal: false,
        generateHighQualityLinkPreview: true,
        markOnlineOnConnect: false,
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrCode = qr;
          this.logger.log('[WhatsApp] QR code generated.');
        }

        if (connection === 'open') {
          this.isConnected = true;
          this.isRegistered = true;
          this.pairingCode = null;
          this.qrCode = null;
          const userJid = this.sock?.user?.id || 'unknown';
          this.logger.log(`[WhatsApp] Connected successfully! Account: ${userJid}`);

          // Attempt channel pre-resolution if configured
          this.resolveChannelJid().catch((e) =>
            this.logger.warn(`[WhatsApp] Channel resolution warning: ${e?.message || e}`),
          );
        }

        if (connection === 'close') {
          this.isConnected = false;
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          this.logger.warn(
            `[WhatsApp] Connection closed. Status code: ${statusCode}. Reconnecting: ${shouldReconnect}`,
          );

          if (shouldReconnect) {
            this.scheduleReconnect();
          } else {
            this.logger.error('[WhatsApp] Device logged out. Removing auth credentials to allow re-pairing.');
            this.clearAuth();
          }
        }
      });

      // If not registered yet, automatically request pairing code using configured phone number
      if (!this.isRegistered) {
        const phoneNumber = this.getPhoneNumber();
        if (phoneNumber) {
          setTimeout(async () => {
            try {
              await this.requestPairingCode(phoneNumber);
            } catch (err) {
              this.logger.warn(`[WhatsApp] Auto pairing code request: ${err}`);
            }
          }, 3000);
        }
      }
    } catch (err) {
      this.logger.error(`[WhatsApp] Socket initialization error: ${err}`);
    } finally {
      this.isInitializing = false;
    }
  }

  private scheduleReconnect(delayMs = 5000): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    this.reconnectTimeout = setTimeout(() => {
      this.initSocket();
    }, delayMs);
  }

  public async requestPairingCode(phone?: string): Promise<string> {
    if (!this.sock) {
      await this.initSocket();
    }
    if (!this.sock) {
      throw new Error('WhatsApp socket is not initialized');
    }

    const targetPhone = this.sanitizePhoneNumber(phone || this.getPhoneNumber() || '');
    if (!targetPhone) {
      throw new Error('No phone number provided for WhatsApp pairing');
    }

    this.logger.log(`[WhatsApp] Requesting 8-digit pairing code for number: ${targetPhone}...`);
    const code = await this.sock.requestPairingCode(targetPhone);
    this.pairingCode = code;

    this.logger.log(`
===============================================================
[WhatsApp Channel Integration]
PAIRING CODE FOR +${targetPhone}:  [ ${code} ]

Instructions to link your WhatsApp:
1. Open WhatsApp on phone (${targetPhone})
2. Go to Settings > Linked Devices > Link a Device
3. Tap "Link with phone number instead"
4. Enter code: ${code}
===============================================================
`);

    return code;
  }

  public async resolveChannelJid(): Promise<string> {
    if (this.resolvedChannelJid) {
      return this.resolvedChannelJid;
    }

    const configVal = this.getChannelConfig();
    if (!configVal) {
      throw new Error(
        'WhatsApp Channel is not configured. Please set WHATSAPP_CHANNEL_JID or WHATSAPP_CHANNEL_URL in environment.',
      );
    }

    // Case 1: Direct JID (e.g. 120363xxxxxxxx@newsletter)
    if (configVal.endsWith('@newsletter') || /^\d+@newsletter$/.test(configVal)) {
      this.resolvedChannelJid = configVal;
      return this.resolvedChannelJid;
    }

    // Case 2: Numeric channel ID without @newsletter
    if (/^\d{15,20}$/.test(configVal.trim())) {
      this.resolvedChannelJid = `${configVal.trim()}@newsletter`;
      return this.resolvedChannelJid;
    }

    // Case 3: Channel Invite link (e.g. https://whatsapp.com/channel/0029VaXXXXX or code 0029VaXXXXX)
    let inviteCode = configVal.trim();
    if (inviteCode.includes('whatsapp.com/channel/')) {
      const parts = inviteCode.split('whatsapp.com/channel/');
      inviteCode = (parts[1] || '').split(/[/?#]/)[0];
    }

    if (inviteCode && this.sock) {
      try {
        this.logger.log(`[WhatsApp] Resolving newsletter invite code "${inviteCode}"...`);
        const metadata = await this.sock.newsletterMetadata('invite', inviteCode);
        if (metadata && metadata.id) {
          const jid = metadata.id.endsWith('@newsletter') ? metadata.id : `${metadata.id}@newsletter`;
          this.resolvedChannelJid = jid;
          this.logger.log(`[WhatsApp] Resolved channel "${metadata.name || 'Job Baskets Careers'}" -> ${jid}`);
          return jid;
        }
      } catch (err) {
        this.logger.warn(`[WhatsApp] Failed to resolve channel invite code: ${err}`);
      }
    }

    // Fallback: use configVal as is
    this.resolvedChannelJid = configVal.includes('@newsletter') ? configVal : `${configVal}@newsletter`;
    return this.resolvedChannelJid;
  }

  public async publishToChannel(req: WhatsAppPublishRequest): Promise<WhatsAppPublishResult> {
    if (!this.sock || !this.isConnected) {
      throw new Error('WhatsApp client is not connected. Please pair or wait for connection.');
    }

    let targetJid = req.channelJid || this.resolvedChannelJid;
    if (!targetJid) {
      targetJid = await this.resolveChannelJid();
    }

    if (!targetJid.endsWith('@newsletter')) {
      targetJid = `${targetJid}@newsletter`;
    }

    this.logger.log(`[WhatsApp] Publishing message to channel: ${targetJid}`);

    let sentMsg: any;
    if (req.imageBuffer) {
      sentMsg = await this.sock.sendMessage(targetJid, {
        image: req.imageBuffer,
        caption: req.caption,
      });
    } else {
      sentMsg = await this.sock.sendMessage(targetJid, {
        text: req.caption,
      });
    }

    const messageId = sentMsg?.key?.id || String(Date.now());
    this.logger.log(`[WhatsApp] Message successfully posted to channel. Message ID: ${messageId}`);

    return {
      messageId,
      jid: targetJid,
      postUrl: `https://whatsapp.com/channel/${targetJid.replace('@newsletter', '')}`,
    };
  }

  public clearAuth(): void {
    const authDir = this.getAuthDir();
    try {
      if (fs.existsSync(authDir)) {
        fs.rmSync(authDir, { recursive: true, force: true });
        this.logger.log(`[WhatsApp] Cleared auth storage at ${authDir}`);
      }
    } catch (err) {
      this.logger.warn(`[WhatsApp] Failed to clear auth directory: ${err}`);
    }
    this.isConnected = false;
    this.isRegistered = false;
    this.pairingCode = null;
    this.qrCode = null;
    this.resolvedChannelJid = null;
  }
}
