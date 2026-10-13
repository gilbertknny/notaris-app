import { createApp } from './bootstrap';
import { config } from './config';

async function main() {
  const app = await createApp();
  await app.listen(config().PORT);
  console.log(`API berjalan di http://localhost:${config().PORT}/api/v1`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
