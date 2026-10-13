import { Controller, Get } from '@nestjs/common';
import { sql } from 'kysely';
import { Public } from '../common/auth/auth-context';
import { DbService } from '../common/db.service';
import { RedisService } from '../common/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly dbs: DbService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  async health() {
    await sql`select 1`.execute(this.dbs.db);
    await this.redis.client.ping();
    return { status: 'ok' };
  }
}
