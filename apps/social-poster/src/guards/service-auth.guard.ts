import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class ServiceAuthGuard implements CanActivate {
  private readonly logger = new Logger(ServiceAuthGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expectedSecret = this.configService.get<string>('INTERNAL_SERVICE_SECRET');

    // In local development or if secret is not set, allow with warning
    if (!expectedSecret) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const providedKey =
      (request.headers['x-internal-service-key'] as string) ||
      (request.headers['x-api-key'] as string) ||
      this.extractBearerToken(request.headers['authorization']);

    if (!providedKey || providedKey !== expectedSecret) {
      this.logger.warn(`Rejected unauthorized request to ${request.path} from IP ${request.ip}`);
      throw new UnauthorizedException('Invalid or missing internal service key');
    }

    return true;
  }

  private extractBearerToken(authHeader?: string): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    return authHeader.substring(7).trim();
  }
}
