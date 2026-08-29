import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCanvas, loadImage, Image, SKRSContext2D } from '@napi-rs/canvas';
import { JobPublishedPayloadDto } from '@app/common';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class JobBannerService implements OnModuleInit {
  private readonly logger = new Logger(JobBannerService.name);
  private logoImage?: Image;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    await this.loadBrandLogo();
  }

  private async loadBrandLogo() {
    const candidates = [
      path.resolve(__dirname, '../../assets/logo.png'),
      path.resolve(__dirname, '../assets/logo.png'),
      path.resolve(process.cwd(), 'apps/social-poster/assets/logo.png'),
      path.resolve(process.cwd(), 'apps/social-poster/src/assets/logo.png'),
      '/home/jk/work/jb/jobbaskets-api/public/images/logo.png',
    ];

    for (const logoPath of candidates) {
      if (fs.existsSync(logoPath)) {
        try {
          this.logoImage = await loadImage(logoPath);
          this.logger.log(`Loaded official JobBaskets logo from: ${logoPath}`);
          return;
        } catch (err) {
          this.logger.warn(`Failed to load logo from ${logoPath}: ${err}`);
        }
      }
    }

    this.logger.warn('Official logo file not found, will use fallback vector badge');
  }

  /**
   * Helper to get public frontend URL from .env
   */
  private getFrontendUrl(): string {
    const url = this.configService.get<string>('PLATFORM_FRONTEND_URL')
      || this.configService.get<string>('APP_URL')
      || 'https://jobbaskets.com';
    return url.replace(/\/+$/, '');
  }

  /**
   * Generates banner buffer and saves it to public web directory so Instagram can fetch it
   */
  async getOrSaveBanner(job: JobPublishedPayloadDto): Promise<{ buffer: Buffer; publicUrl: string }> {
    const buffer = await this.generateBanner(job);
    const filename = `${job.uuid}.png`;

    const storageCandidates = [
      this.configService.get<string>('BANNER_STORAGE_PATH'),
      '/app/public_storage/app/public/banners',
      '/home/jk/work/jb/jobbaskets-api/public/banners',
      path.resolve(process.cwd(), 'apps/social-poster/public/banners'),
      path.resolve(process.cwd(), 'public/banners'),
    ].filter(Boolean) as string[];

    let saved = false;
    for (const dir of storageCandidates) {
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const filePath = path.join(dir, filename);
        fs.writeFileSync(filePath, buffer);
        this.logger.log(`Saved dynamic Canva banner to: ${filePath}`);
        saved = true;
        break;
      } catch (err) {
        this.logger.warn(`Could not save banner to ${dir}: ${err}`);
      }
    }

    const publicPrefix = this.configService.get<string>('BANNER_PUBLIC_URL_PREFIX')
      || `${this.getFrontendUrl()}/storage/banners`;
    const publicUrl = `${publicPrefix.replace(/\/+$/, '')}/${filename}`;
    return { buffer, publicUrl };
  }

  /**
   * Generates a 1200x630 professional Canva-style Job Banner Buffer with official logo & dynamic URL
   */
  async generateBanner(job: JobPublishedPayloadDto): Promise<Buffer> {
    const width = 1200;
    const height = 630;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const frontendUrl = this.getFrontendUrl();

    // 1. Sleek Modern Dark Tech Gradient Background
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, '#0a0f1d');
    bgGrad.addColorStop(0.5, '#0f172a');
    bgGrad.addColorStop(1, '#020617');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // 2. Decorative Background Glows
    const glow1 = ctx.createRadialGradient(200, 150, 10, 200, 150, 450);
    glow1.addColorStop(0, 'rgba(59, 130, 246, 0.18)');
    glow1.addColorStop(1, 'rgba(59, 130, 246, 0)');
    ctx.fillStyle = glow1;
    ctx.fillRect(0, 0, width, height);

    const glow2 = ctx.createRadialGradient(1000, 450, 10, 1000, 450, 400);
    glow2.addColorStop(0, 'rgba(16, 185, 129, 0.15)');
    glow2.addColorStop(1, 'rgba(16, 185, 129, 0)');
    ctx.fillStyle = glow2;
    ctx.fillRect(0, 0, width, height);

    // 3. Card Container Frame
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 2;
    this.roundRect(ctx, 40, 40, width - 80, height - 80, 24);
    ctx.stroke();

    // 4. Header: Official Logo or Brand Badge
    if (this.logoImage) {
      const logoHeight = 55;
      const logoWidth = (this.logoImage.width / this.logoImage.height) * logoHeight;
      ctx.drawImage(this.logoImage, 80, 68, logoWidth, logoHeight);
    } else {
      ctx.fillStyle = '#2563eb';
      this.roundRect(ctx, 80, 75, 48, 48, 12);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText('JB', 90, 108);

      ctx.font = 'bold 28px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('JobBaskets', 140, 109);
    }

    // Top Right: "WE ARE HIRING" Badge
    ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
    this.roundRect(ctx, width - 290, 72, 210, 48, 24);
    ctx.fill();
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, width - 290, 72, 210, 48, 24);
    ctx.stroke();

    // Green Dot
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(width - 265, 96, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('WE ARE HIRING', width - 245, 102);

    // 5. Job Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 44px sans-serif';
    const cleanTitle = job.title.length > 38 ? job.title.substring(0, 36) + '...' : job.title;
    ctx.fillText(cleanTitle, 80, 220);

    // 6. Company Name
    ctx.fillStyle = '#94a3b8';
    ctx.font = '24px sans-serif';
    ctx.fillText('at  ', 80, 265);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(job.company_name, 115, 265);

    // 7. Pills (Location, Salary, Work Type)
    let pillX = 80;
    const pillY = 320;

    const locationText = job.locations && job.locations.length > 0 ? job.locations[0] : 'Multiple Locations';
    const workTypeText = job.work_type ? ` (${job.work_type.toUpperCase()})` : '';
    this.drawPill(ctx, pillX, pillY, `📍 ${locationText}${workTypeText}`, '#3b82f6');
    pillX += this.getTextWidth(ctx, `📍 ${locationText}${workTypeText}`, 'bold 18px sans-serif') + 40;

    if (job.show_salary && job.salary_min && job.salary_max) {
      const curr = this.resolveCurrency(job.salary_currency);
      const salaryStr = `💰 ${curr}${job.salary_min.toLocaleString()} - ${job.salary_max.toLocaleString()}`;
      this.drawPill(ctx, pillX, pillY, salaryStr, '#10b981');
      pillX += this.getTextWidth(ctx, salaryStr, 'bold 18px sans-serif') + 40;
    }

    if (job.employment_type) {
      this.drawPill(ctx, pillX, pillY, `⏱ ${job.employment_type}`, '#a855f7');
    }

    // 8. Skills Badges
    if (job.skills && job.skills.length > 0) {
      let skillX = 80;
      const skillY = 410;
      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('REQUIRED SKILLS:', 80, 395);

      for (const skill of job.skills.slice(0, 5)) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        const skillText = `• ${skill}`;
        const sw = this.getTextWidth(ctx, skillText, '16px sans-serif') + 24;
        this.roundRect(ctx, skillX, skillY, sw, 36, 8);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        this.roundRect(ctx, skillX, skillY, sw, 36, 8);
        ctx.stroke();

        ctx.fillStyle = '#e2e8f0';
        ctx.font = '16px sans-serif';
        ctx.fillText(skillText, skillX + 12, skillY + 24);
        skillX += sw + 12;
      }
    }

    // 9. Footer: CTA Button & Dynamic URL from ENV
    const footerY = 515;
    const ctaGrad = ctx.createLinearGradient(80, footerY, 360, footerY);
    ctaGrad.addColorStop(0, '#2563eb');
    ctaGrad.addColorStop(1, '#1d4ed8');
    ctx.fillStyle = ctaGrad;
    this.roundRect(ctx, 80, footerY, 280, 52, 12);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('Apply on JobBaskets ➔', 105, footerY + 33);

    // Dynamic right footer URL text obeying PLATFORM_FRONTEND_URL
    const footerText = `Official Portal: ${frontendUrl}`;
    const footerTextWidth = this.getTextWidth(ctx, footerText, '18px sans-serif');
    ctx.fillStyle = '#64748b';
    ctx.font = '18px sans-serif';
    ctx.fillText(footerText, width - footerTextWidth - 80, footerY + 33);

    return canvas.toBuffer('image/png');
  }

  private roundRect(ctx: SKRSContext2D, x: number, y: number, width: number, height: number, radius: number) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x + radius, y);
    ctx.closePath();
  }

  private drawPill(ctx: SKRSContext2D, x: number, y: number, text: string, color: string) {
    ctx.font = 'bold 18px sans-serif';
    const width = ctx.measureText(text).width + 32;
    const height = 42;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    this.roundRect(ctx, x, y, width, height, 10);
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    this.roundRect(ctx, x, y, width, height, 10);
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.fillText(text, x + 16, y + 27);
  }

  private getTextWidth(ctx: SKRSContext2D, text: string, font: string) {
    ctx.font = font;
    return ctx.measureText(text).width;
  }

  private resolveCurrency(currency?: string): string {
    if (!currency) return '₹';
    const c = currency.trim().toUpperCase();
    if (c === 'INR' || c === 'RS' || c === 'RS.' || c === '₹') return '₹';
    if (c === 'USD' || c === '$') return '$';
    if (c === 'EUR' || c === '€') return '€';
    if (c === 'GBP' || c === '£') return '£';
    if (c === 'AED') return 'AED ';
    return currency;
  }
}
