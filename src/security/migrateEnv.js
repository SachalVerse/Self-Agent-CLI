// src/security/migrateEnv.js
// One-time migration: moves secret values out of a plaintext .env file
// into the OS secret store, then comments them out in .env.
//   selfagent migrate [--path=./.env]

const fs = require('fs');
const path = require('path');
const secretStore = require('./secretStore');
const logger = require('../utils/logger');

const SECRET_VARS = [
  'GROQ_API_KEY',
  'NVIDIA_API_KEY',
  'GITHUB_TOKEN',
  'SERVER_SECRET',
  'WHATSAPP_PHONE_NUMBER'
];

async function migrateEnvToStore(envPath = path.join(__dirname, '../../.env')) {
  if (!fs.existsSync(envPath)) {
    return { migrated: [], skipped: [], backend: secretStore.backend, message: 'No .env file found.' };
  }

  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const migrated = [];
  const skipped = [];
  const output = lines.slice();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;

    const key = match[1];
    if (!SECRET_VARS.includes(key)) continue;

    let value = match[2].trim();
    value = value.replace(/^["']|["']$/g, '').trim();
    if (!value || value.startsWith('#') || value === '') {
      skipped.push(key);
      continue;
    }

    const already = await secretStore.get(key);
    if (already && already === value) {
      skipped.push(key);
    } else {
      await secretStore.set(key, value);
      migrated.push(key);
    }

    output[i] = `# ${line}  # migrated to OS secret store`;
  }

  fs.writeFileSync(envPath, output.join('\n'), 'utf8');
  logger.info(`Migrated ${migrated.length} secret(s) to ${secretStore.backend}.`);

  return { migrated, skipped, backend: secretStore.backend };
}

module.exports = { migrateEnvToStore, SECRET_VARS };
