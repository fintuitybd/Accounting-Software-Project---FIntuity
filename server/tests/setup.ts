import { loadDotEnv } from '../src/env.ts';

// Local developer convenience only. CI and deployment inject environment variables directly.
loadDotEnv();
