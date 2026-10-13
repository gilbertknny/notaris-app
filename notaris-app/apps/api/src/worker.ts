import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { DbService } from './common/db.service';
import { StorageService } from './modules/documents/storage.service';
import { OutboxProcessor } from './worker/outbox.processor';

const POLL_MS = 2000;

async function main() {
  const logger = new Logger('Worker');
  const dbs = new DbService();
  const processor = new OutboxProcessor(dbs, new StorageService());
  let running = true;
  const stop = async () => {
    running = false;
    logger.log('Menghentikan worker…');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  logger.log('Worker outbox berjalan.');
  while (running) {
    try {
      const n = await processor.drain(100);
      if (n === 0) await new Promise((r) => setTimeout(r, POLL_MS));
    } catch (err) {
      logger.error((err as Error).message);
      await new Promise((r) => setTimeout(r, POLL_MS * 5));
    }
  }
  await dbs.onModuleDestroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
