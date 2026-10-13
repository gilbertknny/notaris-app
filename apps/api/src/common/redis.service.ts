import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { config } from '../config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client = new Redis(config().REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });

  /** Hitung percobaan gagal dalam jendela waktu; kembalikan jumlah terkini. */
  async hit(key: string, windowSeconds: number): Promise<number> {
    const n = await this.client.incr(key);
    if (n === 1) await this.client.expire(key, windowSeconds);
    return n;
  }

  async count(key: string): Promise<number> {
    return Number((await this.client.get(key)) ?? 0);
  }

  async reset(key: string) {
    await this.client.del(key);
  }

  async onModuleDestroy() {
    this.client.disconnect();
  }
}
