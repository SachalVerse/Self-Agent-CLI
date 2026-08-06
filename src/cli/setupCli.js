// src/cli/setupCli.js
// Non-interactive CLI commands for the selfagent binary:
//   selfagent setup [--KEY=value ...]
//   selfagent keys
//   selfagent unset <KEY>
//   selfagent backend
//   selfagent --version | -v
//   selfagent --help | -h | help

const secretStore = require('../security/secretStore');
const { runSetup } = require('../security/setupWizard');
const { migrateEnvToStore } = require('../security/migrateEnv');
const { version } = require('../../package.json');

const CLI_KEYS = new Set([
  'GITHUB_TOKEN',
  'GROQ_API_KEY',
  'NVIDIA_API_KEY',
  'SERVER_SECRET',
  'WHATSAPP_PHONE_NUMBER'
]);

function printUsage() {
  console.log(`
SelfAgent — Autonomous AI & WhatsApp Gateway Agent

USAGE:
  selfagent                     Start the server (terminal + WhatsApp agent)
  selfagent setup               Interactive secure setup for GitHub token & API keys
  selfagent setup --KEY=value   Non-interactive setup (repeatable, e.g. --GITHUB_TOKEN=ghp_...)
  selfagent migrate             Move existing keys out of .env into the OS secret store
  selfagent keys                List which secrets are configured (values are masked)
  selfagent unset <KEY>         Remove a stored secret
  selfagent backend             Show which OS secret store backend is in use
  selfagent --version           Print version
  selfagent --help              Show this help

EXAMPLES:
  selfagent setup
  selfagent setup --GITHUB_TOKEN=ghp_xxx --GROQ_API_KEY=gsk_xxx
  selfagent keys
  selfagent unset NVIDIA_API_KEY
`);
}

function mask(value) {
  if (!value) return '(not configured)';
  if (value.length <= 8) return '********';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function runKeysCommand() {
  const names = await secretStore.list();
  console.log(`\n🔐 Configured secrets [backend: ${secretStore.backend}]:`);
  if (names.length === 0) {
    console.log('   None. Run `selfagent setup` to securely store your keys.');
  } else {
    for (const name of names) {
      const value = await secretStore.get(name);
      console.log(`   • ${name}: ${mask(value)}`);
    }
  }
  console.log('');
}

async function runUnsetCommand(key) {
  const normalized = key.trim().toUpperCase();
  if (!CLI_KEYS.has(normalized)) {
    console.log(`Unknown key "${key}". Known keys: ${[...CLI_KEYS].join(', ')}`);
    return;
  }
  await secretStore.delete(normalized);
  const configManager = require('../utils/configManager');
  configManager.set(normalized, '');
  console.log(`🗑️  Removed ${normalized} from the secret store and cleared it from config/user_config.json.`);
}

async function runBackendCommand() {
  const backend = await secretStore._resolveBackend();
  console.log(`Secret store backend: ${backend.name}`);
}

function parseSetupFlags(argv) {
  const values = {};
  for (const arg of argv) {
    if (arg.startsWith('--') && arg.includes('=')) {
      const [rawKey, ...rest] = arg.slice(2).split('=');
      const key = rawKey.toUpperCase();
      if (CLI_KEYS.has(key)) {
        values[key] = rest.join('=');
      }
    }
  }
  return values;
}

async function handleCliArgs(argv) {
  if (!argv || argv.length === 0) return false;

  const first = argv[0];

  if (first === '--version' || first === '-v') {
    console.log(version);
    return true;
  }

  if (first === '--help' || first === '-h' || first === 'help') {
    printUsage();
    return true;
  }

  if (first === 'setup') {
    const values = parseSetupFlags(argv.slice(1));
    await runSetup({ interactive: argv.length === 1, values });
    return true;
  }

  if (first === 'migrate') {
    const argPath = argv[1] && argv[1].startsWith('--path=') ? argv[1].slice(7) : null;
    const envPath = argPath ? require('path').resolve(argPath) : require('path').join(__dirname, '../../.env');
    console.log(`\n🔁 Migrating secrets from ${envPath} into the OS secret store...\n`);
    const result = await migrateEnvToStore(envPath);
    if (result.migrated.length > 0) {
      console.log(`✅ Stored securely: ${result.migrated.join(', ')}`);
    }
    if (result.skipped.length > 0) {
      console.log(`⏭️  Already secure / skipped: ${result.skipped.join(', ') || 'none'}`);
    }
    if (!result.message) {
      console.log(`📄 The secrets were removed from .env and the file was updated.`);
    } else {
      console.log(result.message);
    }
    console.log('');
    return true;
  }

  if (first === 'keys') {
    await runKeysCommand();
    return true;
  }

  if (first === 'unset') {
    const key = argv[1];
    if (!key) {
      console.log('Usage: selfagent unset <KEY>');
      return true;
    }
    await runUnsetCommand(key);
    return true;
  }

  if (first === 'backend') {
    await runBackendCommand();
    return true;
  }

  return false;
}

module.exports = { handleCliArgs, printUsage, runKeysCommand, CLI_KEYS };
