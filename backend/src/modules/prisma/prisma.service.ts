import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from 'prisma/generated/client';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly configService: ConfigService) {
    const adapter = new PrismaPg({
      connectionString: configService.getOrThrow<string>('DATABASE_URL'),
    });

    super({ adapter });
  }

  public async onModuleInit() {
    const start = Date.now();

    this.logger.log('Connecting to database...');

    try {
      await this.$connect();

      const ms = Date.now() - start;

      this.logger.log(`Database has been connected (time=${ms}ms)`);
    } catch (error) {
      this.logger.error('Connection to databse has been failed: ', error);

      throw error;
    }
  }

  public async onModuleDestroy() {
    this.logger.log(`Disconnecting from databse`);

    try {
      this.$disconnect();
      this.logger.log('Connection to database has been closed succefully');
    } catch (error) {
      this.logger.error('Failed to disconnect from databse: ', error);
    }
  }
}
