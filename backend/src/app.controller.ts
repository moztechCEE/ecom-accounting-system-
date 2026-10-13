import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from './common/prisma/prisma.service';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('debug')
  async debug() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        db: 'connected',
      };
    } catch {
      return {
        status: 'error',
        db: 'disconnected',
      };
    }
  }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Public()
  @Get('health')
  health() {
    return {
      status: 'ok',
      sourceVersion: /^[a-f0-9]{40}$/.test(process.env.SOURCE_VERSION || '') ? process.env.SOURCE_VERSION : 'unknown',
    };
  }

  @Public()
  @Get('health/ready')
  async readiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ready',
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready',
      });
    }
  }
}
