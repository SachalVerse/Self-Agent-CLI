const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const logger = require('./logger');

const CONFIG_DIR = path.join(os.homedir(), '.selfagent/config');
const CONFIG_PATH = path.join(CONFIG_DIR, 'user_config.json');

const DEFAULT_SEARCH_PREFERENCES = {
  searchDepth: 2,
  timeoutMs: 10000,
  subreddits: ['webdev', 'programming', 'learnprogramming', 'devops', 'MachineLearning'],
  repositories: ['free-for-dev', 'ripienaar/free-for-dev'],
  resourcePages: ['https://free-for.dev/', 'https://github.com/ripienaar/free-for-dev', 'https://github.com/255kb/stack-on-a-budget']
};

const DEFAULT_CONFIG = {
  GROQ_API_KEY: '',
  NVIDIA_API_KEY: '',
  GITHUB_TOKEN: '',
  SERVER_SECRET: '',
  WHATSAPP_PHONE_NUMBER: '',
  WHATSAPP_TOKEN: '',
  SEARCH_PREFERENCES: DEFAULT_SEARCH_PREFERENCES
};

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function promptInput(question, hidden = false) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!hidden) {
      const rl = readline.createInterface({ input: stdin, output: stdout });
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }

    stdout.write(question);
    
    let value = '';
    const onData = (chunk) => {
      const str = String(chunk);
      for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (char === '\r' || char === '\n') {
          stdout.write('\n');
          try { stdin.setRawMode(false); } catch (e) {}
          stdin.pause();
          stdin.removeListener('data', onData);
          resolve(value.trim());
          return;
        } else if (char === '\u0003') {
          process.exit(1);
        } else if (char === '\u0008' || char === '\u007f') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            stdout.write('\b \b');
          }
        } else {
          value += char;
          stdout.write('*');
        }
      }
    };

    try {
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');
      stdin.on('data', onData);
    } catch (e) {
      // Fallback if raw mode is not supported
      const rl = readline.createInterface({ input: stdin, output: stdout });
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

function safeParseJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

class ConfigManager {
  constructor() {
    this.config = null;
    this.loadConfig();
  }

  loadConfig() {
    if (this.config) {
      return this.config;
    }

    if (!fs.existsSync(CONFIG_PATH)) {
      this.config = { ...DEFAULT_CONFIG };
      return this.config;
    }

    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = safeParseJson(raw);
    if (!parsed) {
      this.config = { ...DEFAULT_CONFIG };
      return this.config;
    }

    this.config = {
      ...DEFAULT_CONFIG,
      ...parsed,
      SEARCH_PREFERENCES: {
        ...DEFAULT_SEARCH_PREFERENCES,
        ...(parsed.SEARCH_PREFERENCES || {})
      }
    };

    return this.config;
  }

  getAll() {
    return this.loadConfig();
  }

  get(key) {
    const cfg = this.loadConfig();
    return cfg[key];
  }

  set(key, value) {
    const cfg = this.loadConfig();
    cfg[key] = value;
    this.config = cfg;
    this.saveConfig(cfg);
    return cfg;
  }

  updateSearchPreferences(preferences) {
    const cfg = this.loadConfig();
    cfg.SEARCH_PREFERENCES = {
      ...DEFAULT_SEARCH_PREFERENCES,
      ...(cfg.SEARCH_PREFERENCES || {}),
      ...preferences
    };
    this.config = cfg;
    this.saveConfig(cfg);
    return cfg.SEARCH_PREFERENCES;
  }

  async syncWithSecretStore(secretStore) {
    const cfg = this.loadConfig();
    const known = ['GROQ_API_KEY', 'NVIDIA_API_KEY', 'GITHUB_TOKEN', 'SERVER_SECRET', 'WHATSAPP_PHONE_NUMBER', 'WHATSAPP_TOKEN'];
    let dirty = false;

    for (const key of known) {
      const isPlaceholder = !cfg[key] || cfg[key] === '' || cfg[key] === 'gsk_test' || cfg[key] === 'nvapi_test';
      if (isPlaceholder) {
        const value = await secretStore.get(key);
        if (value && value !== 'gsk_test' && value !== 'nvapi_test') {
          cfg[key] = value;
          dirty = true;
        }
      }
    }

    if (dirty) {
      this.saveConfig(cfg);
      this.config = cfg;
    }

    return dirty;
  }

  saveConfig(config) {
    ensureConfigDir();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { encoding: 'utf8' });
  }

  isValidConfig(config = this.loadConfig()) {
    if (!config || typeof config !== 'object') return false;
    const groqKey = process.env.GROQ_API_KEY || config.GROQ_API_KEY || '';
    return groqKey.length > 5;
  }

  async promptWizard() {
    logger.info('Launching SelfAgent first-time setup wizard...');
    console.log('\n=== Welcome to SelfAgent First-Time Setup ===\n');

    const groqKey = await promptInput('Enter your GROQ_API_KEY (required): ', false);
    const nvidiaKey = await promptInput('Enter your NVIDIA_API_KEY (optional): ', false);
    const githubToken = await promptInput('Enter your GITHUB_TOKEN (required): ', false);
    const serverSecret = await promptInput('Enter your SERVER_SECRET (optional, press enter to skip): ', false);
    const whatsappPhoneNumber = await promptInput('Enter your WHATSAPP_PHONE_NUMBER (required): ', false);
    const whatsappToken = await promptInput('Enter your WHATSAPP_TOKEN (optional, press enter to skip): ', false);

    console.log('\nSearch preferences:');
    const searchDepth = parseInt(await promptInput('  Search depth [default: 2]: '), 10) || DEFAULT_SEARCH_PREFERENCES.searchDepth;
    const timeoutMs = parseInt(await promptInput('  Scraping timeout in ms [default: 10000]: '), 10) || DEFAULT_SEARCH_PREFERENCES.timeoutMs;
    const subredditsInput = await promptInput(`  Target subreddits comma-separated [default: ${DEFAULT_SEARCH_PREFERENCES.subreddits.join(', ')}]: `);
    const repositoriesInput = await promptInput(`  Target repositories/combo names comma-separated [default: ${DEFAULT_SEARCH_PREFERENCES.repositories.join(', ')}]: `);

    const subreddits = subredditsInput ? subredditsInput.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_SEARCH_PREFERENCES.subreddits;
    const repositories = repositoriesInput ? repositoriesInput.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_SEARCH_PREFERENCES.repositories;

    const config = {
      GROQ_API_KEY: groqKey,
      NVIDIA_API_KEY: nvidiaKey,
      GITHUB_TOKEN: githubToken,
      SERVER_SECRET: serverSecret || '',
      WHATSAPP_PHONE_NUMBER: whatsappPhoneNumber,
      WHATSAPP_TOKEN: whatsappToken || '',
      SEARCH_PREFERENCES: {
        searchDepth,
        timeoutMs,
        subreddits,
        repositories,
        resourcePages: DEFAULT_SEARCH_PREFERENCES.resourcePages
      }
    };

    this.saveConfig(config);
    this.config = config;
    console.log('\n✅ Saved your configuration to config/user_config.json\n');
    return config;
  }

  async ensureConfig() {
    const config = this.loadConfig();
    if (this.isValidConfig(config)) {
      return config;
    }
    return this.promptWizard();
  }
}

module.exports = new ConfigManager();
