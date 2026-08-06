const logger = require('../utils/logger');
const secretStore = require('../security/secretStore');
const configManager = require('../utils/configManager');

function hydrateEnvironment() {
  secretStore.hydrateEnvSync();

  const userConfig = configManager.loadConfig();
  const fallbackValues = {
    GROQ_API_KEY: userConfig.GROQ_API_KEY,
    NVIDIA_API_KEY: userConfig.NVIDIA_API_KEY,
    GITHUB_TOKEN: userConfig.GITHUB_TOKEN,
    SERVER_SECRET: userConfig.SERVER_SECRET,
    WHATSAPP_PHONE_NUMBER: userConfig.WHATSAPP_PHONE_NUMBER
  };

  for (const [key, value] of Object.entries(fallbackValues)) {
    if (value) {
      process.env[key] = value;
    }
  }
}

// Hydrate environment from OS secret store and JSON config before config is built.
hydrateEnvironment();

// ─────────────────────────────────────────────
// Validates environment variables on startup
// ─────────────────────────────────────────────
const REQUIRED_VARS = [
  'GROQ_API_KEY'
];

const OPTIONAL_VARS_DEFAULTS = {
  PORT: '3000',
  NODE_ENV: 'development',
  USE_PLAYWRIGHT: 'false',
  SCRAPE_CONCURRENCY: '3',
  SCRAPE_DELAY_MS: '1500',
  MAX_RETRIES: '3',
  CACHE_TTL_SECONDS: '3600',
  DISCOVERY_INTERVAL_CRON: '0 */6 * * *',
  HEALTH_CHECK_INTERVAL_CRON: '*/15 * * * *',
  REMINDER_CHECK_INTERVAL_CRON: '*/5 * * * *',
  WHATSAPP_SESSION_PATH: './.wwebjs_auth'
};

function refreshConfig() {
  hydrateEnvironment();
  for (const [varName, defaultValue] of Object.entries(OPTIONAL_VARS_DEFAULTS)) {
    if (!process.env[varName]) {
      process.env[varName] = defaultValue;
      logger.debug(`Using default for ${varName}: ${defaultValue}`);
    }
  }
}

function validateEnvironment() {
  refreshConfig();

  const missing = [];
  for (const varName of REQUIRED_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    logger.warn(`Missing recommended environment variables: ${missing.join(', ')}`);
    logger.warn('Run `selfagent setup` to securely store API keys and tokens, or set them in .env.');
    logger.warn('Running with placeholder API keys may restrict AI voice/chat capabilities.');
  } else {
    logger.info('✅ Environment validation passed');
  }
}

const config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development',
    secret: process.env.SERVER_SECRET || 'fallback-secret'
  },
  ai: {
    groqApiKey: process.env.GROQ_API_KEY || '',
    nvidiaApiKey: process.env.NVIDIA_API_KEY || '',
    nvidiaBaseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1'
  },
  whatsapp: {
    phoneNumber: process.env.WHATSAPP_PHONE_NUMBER || '',
    sessionPath: process.env.WHATSAPP_SESSION_PATH || './.wwebjs_auth'
  },
  github: {
    token: process.env.GITHUB_TOKEN || ''
  },
  scraping: {
    usePlaywright: process.env.USE_PLAYWRIGHT === 'true',
    concurrency: parseInt(process.env.SCRAPE_CONCURRENCY || '3', 10),
    delayMs: parseInt(process.env.SCRAPE_DELAY_MS || '1500', 10),
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10)
  },
  scheduler: {
    discoveryInterval: process.env.DISCOVERY_INTERVAL_CRON || '0 */6 * * *',
    healthCheckInterval: process.env.HEALTH_CHECK_INTERVAL_CRON || '*/15 * * * *',
    reminderCheckInterval: process.env.REMINDER_CHECK_INTERVAL_CRON || '*/5 * * * *'
  },
  cache: {
    ttlSeconds: parseInt(process.env.CACHE_TTL_SECONDS || '3600', 10)
  }
};

function refreshConfigObject() {
  config.server.port = parseInt(process.env.PORT || '3000', 10);
  config.server.env = process.env.NODE_ENV || 'development';
  config.server.secret = process.env.SERVER_SECRET || 'fallback-secret';

  config.ai.groqApiKey = process.env.GROQ_API_KEY || '';
  config.ai.nvidiaApiKey = process.env.NVIDIA_API_KEY || '';
  config.ai.nvidiaBaseUrl = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';

  config.whatsapp.phoneNumber = process.env.WHATSAPP_PHONE_NUMBER || '';
  config.whatsapp.sessionPath = process.env.WHATSAPP_SESSION_PATH || './.wwebjs_auth';

  config.github.token = process.env.GITHUB_TOKEN || '';

  config.scraping.usePlaywright = process.env.USE_PLAYWRIGHT === 'true';
  config.scraping.concurrency = parseInt(process.env.SCRAPE_CONCURRENCY || '3', 10);
  config.scraping.delayMs = parseInt(process.env.SCRAPE_DELAY_MS || '1500', 10);
  config.scraping.maxRetries = parseInt(process.env.MAX_RETRIES || '3', 10);

  config.scheduler.discoveryInterval = process.env.DISCOVERY_INTERVAL_CRON || '0 */6 * * *';
  config.scheduler.healthCheckInterval = process.env.HEALTH_CHECK_INTERVAL_CRON || '*/15 * * * *';
  config.scheduler.reminderCheckInterval = process.env.REMINDER_CHECK_INTERVAL_CRON || '*/5 * * * *';

  config.cache.ttlSeconds = parseInt(process.env.CACHE_TTL_SECONDS || '3600', 10);
}

refreshConfigObject();

module.exports = { config, validateEnvironment, refreshConfigObject };
