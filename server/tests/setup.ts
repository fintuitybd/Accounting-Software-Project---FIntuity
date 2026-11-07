import { loadDotEnv } from '../src/env.ts';

loadDotEnv();
process.env.MFS_WEBHOOK_SECRET = process.env.MFS_WEBHOOK_SECRET || 'test_mfs_webhook_secret_key_12345';
