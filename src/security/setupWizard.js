// src/security/setupWizard.js
// Interactive first-run setup.
// Asks the user for their secret keys (GitHub token, Groq key, NVIDIA key,
// server secret, WhatsApp phone) and stores them in the OS secret store —
// never in plaintext files.

const readline = require('readline');
const secretStore = require('./secretStore');
const configManager = require('../utils/configManager');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────
// Hidden password-style input (cross-platform)
// ─────────────────────────────────────────────
function promptHidden(query) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const output = process.stdout;

    output.write(query);

    let input = '';
    let raw = false;

    const onData = (chunk) => {
      const str = String(chunk);
      for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (char === '\u0003') {
          cleanup();
          process.exit(130);
        }
        if (char === '\r' || char === '\n' || char === '\u0004') {
          cleanup();
          output.write('\n');
          resolve(input);
          return;
        }
        if (char === '\u007f' || char === '\b') {
          if (input.length > 0) {
            input = input.slice(0, -1);
            output.write('\b \b');
          }
        } else {
          input += char;
          output.write('*');
        }
      }
    };

    const cleanup = () => {
      stdin.removeListener('data', onData);
      try { stdin.setRawMode(false); } catch (e) {}
      stdin.pause();
    };

    try {
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');
      stdin.on('data', onData);
    } catch (e) {
      // Raw mode unavailable (some non-TTY environments) — fall back to visible input
      const rl = readline.createInterface({ input: stdin, output });
      rl.question(query, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

function promptVisible(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function confirm(query, defaultValue = false) {
  const suffix = defaultValue ? ' [Y/n]' : ' [y/N]';
  const answer = await promptVisible(`${query}${suffix} `);
  if (!answer) return defaultValue;
  return /^y(es)?$/i.test(answer);
}

// ─────────────────────────────────────────────
// Wizard definition
// ─────────────────────────────────────────────
const SECRET_FIELDS = [
  {
    key: 'GITHUB_TOKEN',
    label: 'GitHub Personal Access Token (ghp_...)',
    required: false,
    hidden: false,
    hint: 'Used for GitHub API repo/issue scraping. Create at https://github.com/settings/tokens'
  },
  {
    key: 'GROQ_API_KEY',
    label: 'Groq API Key (gsk_...)',
    required: false,
    hidden: false,
    hint: 'Powers AI chat + voice transcription. Get at https://console.groq.com/keys'
  },
  {
    key: 'NVIDIA_API_KEY',
    label: 'NVIDIA API Key (nvapi-...)',
    required: false,
    hidden: false,
    hint: 'Optional fallback AI provider. Get at https://build.nvidia.com'
  },
  {
    key: 'SERVER_SECRET',
    label: 'Server Secret Key',
    required: false,
    hidden: false,
    hint: 'Used to sign/secure local requests. You may generate your own.'
  },
  {
    key: 'WHATSAPP_PHONE_NUMBER',
    label: 'Your WhatsApp Phone Number (e.g. +923188201502)',
    required: false,
    hidden: false,
    hint: 'Only this number (or your self-chat) is authorized to talk to the agent.'
  }
];

async function runSetup(options = {}) {
  const {
    interactive = true,
    values = {}
  } = options;

  logger.info('🔐 SelfAgent Secure Setup');
  logger.info('--------------------------');
  logger.info('Your keys are stored encrypted in the operating system secret store and also persisted to config/user_config.json as a fallback.\n');

  const stored = {};

  for (const field of SECRET_FIELDS) {
    const existing = await secretStore.get(field.key) || configManager.get(field.key);
    const provided = values[field.key];

    if (provided) {
      stored[field.key] = String(provided).trim();
      continue;
    }

    if (!interactive) {
      if (existing) stored[field.key] = existing;
      continue;
    }

    let displayLabel = field.label;
    if (existing) {
      const masked = existing.length > 8 ? `${existing.slice(0, 4)}...${existing.slice(-4)}` : '********';
      displayLabel += ` (current: ${masked})`;
    }

    console.log(`\n— ${displayLabel}`);
    console.log(`  (${field.hint})`);

    let value = '';
    if (field.hidden) {
      value = await promptHidden(`  Enter ${field.key} (press Enter to keep current): `);
    } else {
      value = await promptVisible(`  Enter ${field.key} (press Enter to keep current): `);
    }
    value = value.trim();

    if (value) {
      stored[field.key] = value;
    } else if (existing) {
      stored[field.key] = existing;
    }
  }

  for (const [key, value] of Object.entries(stored)) {
    await secretStore.set(key, value);
    configManager.set(key, value);
    logger.info(`✅ Stored ${key} in ${secretStore.backend} and config/user_config.json`);
  }

  if (interactive && Object.keys(stored).length === 0) {
    const hasExisting = await secretStore.list();
    if (hasExisting.length === 0) {
      console.log('\nNo keys were configured yet. Running first-time JSON config wizard...\n');
      const wizardConfig = await configManager.promptWizard();
      for (const [key, value] of Object.entries(wizardConfig)) {
        if (value) {
          await secretStore.set(key, value);
        }
      }
    }
  }

  const configured = await secretStore.list();
  console.log('\n📋 Secret store summary:');
  if (configured.length === 0) {
    console.log('   No secrets stored yet. Run `selfagent setup` to add them.');
  } else {
    for (const name of configured) {
      const exists = await secretStore.has(name);
      console.log(`   • ${name}: ${exists ? 'configured' : 'empty'}`);
    }
  }
  console.log(`\n🔒 Backend: ${secretStore.backend}\n`);

  return { stored, backend: secretStore.backend };
}

async function promptForMissingLlmKeys() {
  const hasGroq = await secretStore.has('GROQ_API_KEY') || Boolean(configManager.get('GROQ_API_KEY'));
  const hasNvidia = await secretStore.has('NVIDIA_API_KEY') || Boolean(configManager.get('NVIDIA_API_KEY'));

  if (hasGroq || hasNvidia) {
    return;
  }

  const shouldConfigure = await confirm('No Groq or NVIDIA API key is configured. Would you like to configure them now?', true);
  if (!shouldConfigure) {
    return;
  }

  await runSetup({ interactive: true });
}

module.exports = { runSetup, promptForMissingLlmKeys, SECRET_FIELDS, promptHidden, promptVisible, confirm };
