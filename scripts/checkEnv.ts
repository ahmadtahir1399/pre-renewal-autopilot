// npm run env:check
// Validates configuration and prints a summary without any secret values.
// Exits with code 1 and one readable list of problems if anything is wrong.

import { loadEnvOrExit, SECRET_ENV_KEYS } from '../src/config/env.js';
import { createLogger } from '../src/config/logger.js';

const env = loadEnvOrExit();
const logger = createLogger();

// A plain string, because the logger would (correctly) redact fields named like *_KEY / *_TOKEN.
const secretsSet = SECRET_ENV_KEYS.map((key) => `${key}=${env[key] === undefined ? 'not set' : 'set'}`).join(', ');

logger.info('Configuration OK', {
  TIMEZONE: env.TIMEZONE,
  RUN_TIME: env.RUN_TIME,
  FIXTURES_DIR: env.FIXTURES_DIR,
  DATA_DIR: env.DATA_DIR,
  RUN_LIVE_LLM: env.RUN_LIVE_LLM,
  LLM_MODEL: env.LLM_MODEL ?? 'not set',
  OUTPUT_DIR: env.OUTPUT_DIR,
  DB_PATH: env.DB_PATH,
  WINDOW_MIN_DAYS: env.WINDOW_MIN_DAYS,
  WINDOW_MAX_DAYS: env.WINDOW_MAX_DAYS,
  PREMIUM_MEDIUM_PCT: env.PREMIUM_MEDIUM_PCT,
  PREMIUM_HIGH_PCT: env.PREMIUM_HIGH_PCT,
  DRY_RUN: env.DRY_RUN,
  AUTOPILOT_ENABLED: env.AUTOPILOT_ENABLED,
  REFERENCE_DATE: env.REFERENCE_DATE ?? 'not set',
  LLM_PROVIDER: env.LLM_PROVIDER ?? 'not set',
  presence: secretsSet,
});
