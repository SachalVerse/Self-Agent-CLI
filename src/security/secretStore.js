// src/security/secretStore.js
// Cross-platform secure secret storage.
//
// Backends (auto-detected in priority order):
//   win32  -> Windows DPAPI via PowerShell (built-in, user + machine bound)
//   darwin -> macOS Keychain via `security` CLI (built-in)
//   linux  -> libsecret via `secret-tool` (if installed), else encrypted file
//   any    -> AES-256-GCM encrypted file fallback in ~/.selfagent/
//
// No native npm dependencies are required. Every key (GITHUB_TOKEN,
// GROQ_API_KEY, NVIDIA_API_KEY, SERVER_SECRET, WHATSAPP_PHONE_NUMBER, ...)
// is stored encrypted by the operating system instead of plaintext .env.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawnSync } = require('child_process');
const logger = require('../utils/logger');

const STORE_DIR = path.join(os.homedir(), '.selfagent');
const ENC_FILE = path.join(STORE_DIR, 'secrets.enc');
const MASTER_KEY_FILE = path.join(STORE_DIR, '.master.key');

const serviceName = 'selfagent';
const accountName = 'selfagent';

// ─────────────────────────────────────────────
// Small promise wrapper around execFile
// ─────────────────────────────────────────────
function run(cmd, args, options = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000, ...options }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, error, stdout: (stdout || '').toString(), stderr: (stderr || '').toString() });
      } else {
        resolve({ ok: true, stdout: (stdout || '').toString(), stderr: (stderr || '').toString() });
      }
    });
  });
}

const powershell = process.env.SystemRoot
  ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : 'powershell.exe';

function psEscape(value) {
  return value.replace(/'/g, "''");
}

function runSync(cmd, args, options = {}) {
  const res = spawnSync(cmd, args, { timeout: 15000, encoding: 'utf8', ...options });
  if (res.error) {
    return { ok: false, stdout: '', stderr: String(res.stderr || res.error.message) };
  }
  return { ok: res.status === 0, stdout: res.stdout || '', stderr: res.stderr || '' };
}

// ─────────────────────────────────────────────
// Backend: Windows DPAPI (PowerShell)
// ─────────────────────────────────────────────
const windowsDpapi = {
  name: 'windows-dpapi',
  async isAvailable() {
    const res = await run(powershell, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']);
    return res.ok;
  },

  isAvailableSync() {
    const res = runSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']);
    return res.ok;
  },

  async set(key, value) {
    const b64 = Buffer.from(value, 'utf8').toString('base64');
    const file = path.join(STORE_DIR, `dpapi_${key}.enc`);
    ensureStoreDir();
    const script = [
      `$v = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64}'))`,
      `$s = ConvertTo-SecureString -String $v -AsPlainText -Force`,
      `$blob = $s | ConvertFrom-SecureString`,
      `Set-Content -LiteralPath '${psEscape(file)}' -Value $blob -Encoding UTF8 -NoNewline`
    ].join('; ');
    const res = await run(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]);
    return res.ok;
  },

  async get(key) {
    const file = path.join(STORE_DIR, `dpapi_${key}.enc`);
    if (!fs.existsSync(file)) return null;
    const script = [
      `$blob = Get-Content -LiteralPath '${psEscape(file)}' -Raw`,
      `$s = $blob | ConvertTo-SecureString`,
      `$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)`,
      `$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr)`,
      `[System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($plain))`
    ].join('; ');
    const res = await run(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]);
    if (!res.ok) return null;
    const b64 = res.stdout.trim().split(/\r?\n/).pop().trim();
    if (!b64) return null;
    try {
      return Buffer.from(b64, 'base64').toString('utf8');
    } catch {
      return null;
    }
  },

  getSync(key) {
    const file = path.join(STORE_DIR, `dpapi_${key}.enc`);
    if (!fs.existsSync(file)) return null;
    const script = [
      `$blob = Get-Content -LiteralPath '${psEscape(file)}' -Raw`,
      `$s = $blob | ConvertTo-SecureString`,
      `$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)`,
      `$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr)`,
      `[System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($plain))`
    ].join('; ');
    const res = runSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]);
    if (!res.ok) return null;
    const b64 = res.stdout.trim().split(/\r?\n/).pop().trim();
    if (!b64) return null;
    try {
      return Buffer.from(b64, 'base64').toString('utf8');
    } catch {
      return null;
    }
  },

  async delete(key) {
    const file = path.join(STORE_DIR, `dpapi_${key}.enc`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return true;
  },

  async list() {
    const files = fs.existsSync(STORE_DIR) ? fs.readdirSync(STORE_DIR) : [];
    return files
      .filter((f) => f.startsWith('dpapi_') && f.endsWith('.enc'))
      .map((f) => f.replace(/^dpapi_/, '').replace(/\.enc$/, ''));
  }
};

// ─────────────────────────────────────────────
// Backend: macOS Keychain (`security`)
// ─────────────────────────────────────────────
const macKeychain = {
  name: 'macos-keychain',
  async isAvailable() {
    if (process.platform !== 'darwin') return false;
    const res = await run('security', ['help']);
    return res.ok;
  },

  isAvailableSync() {
    if (process.platform !== 'darwin') return false;
    const res = runSync('security', ['help']);
    return res.ok;
  },

  async set(key, value) {
    const res = await run('security', ['add-generic-password', '-a', accountName, '-s', key, '-w', value, '-U']);
    return res.ok;
  },

  async get(key) {
    const res = await run('security', ['find-generic-password', '-a', accountName, '-s', key, '-w']);
    if (!res.ok) return null;
    const value = res.stdout.trim();
    return value.length > 0 ? value : null;
  },

  getSync(key) {
    const res = runSync('security', ['find-generic-password', '-a', accountName, '-s', key, '-w']);
    if (!res.ok) return null;
    const value = res.stdout.trim();
    return value.length > 0 ? value : null;
  },

  async delete(key) {
    await run('security', ['delete-generic-password', '-a', accountName, '-s', key]);
    return true;
  },

  async list() {
    const res = await run('security', ['dump-keychain']);
    if (!res.ok) return [];
    const names = [];
    const regex = /"svce"\s*=\s*"([^"]+)"/g;
    let m;
    while ((m = regex.exec(res.stdout)) !== null) {
      if (m[1].startsWith('SELFAGENT_') || m[1].startsWith('GROQ_') || m[1].startsWith('GITHUB_') ||
          m[1].startsWith('NVIDIA_') || m[1].startsWith('WHATSAPP_') || m[1].startsWith('SERVER_')) {
        names.push(m[1]);
      }
    }
    return names;
  }
};

// ─────────────────────────────────────────────
// Backend: Linux libsecret (`secret-tool`)
// ─────────────────────────────────────────────
const libSecret = {
  name: 'libsecret',
  async isAvailable() {
    if (process.platform !== 'linux') return false;
    const res = await run('secret-tool', ['--version']);
    return res.ok;
  },

  isAvailableSync() {
    if (process.platform !== 'linux') return false;
    const res = runSync('secret-tool', ['--version']);
    return res.ok;
  },

  async set(key, value) {
    const res = await run('secret-tool', ['store', '--label=selfagent', 'service', serviceName, 'key', key], {
      input: value
    });
    return res.ok;
  },

  async get(key) {
    const res = await run('secret-tool', ['lookup', 'service', serviceName, 'key', key], { input: '' });
    if (!res.ok) return null;
    const value = res.stdout.trim();
    return value.length > 0 ? value : null;
  },

  getSync(key) {
    const res = runSync('secret-tool', ['lookup', 'service', serviceName, 'key', key], { input: '' });
    if (!res.ok) return null;
    const value = res.stdout.trim();
    return value.length > 0 ? value : null;
  },

  async delete(key) {
    await run('secret-tool', ['clear', 'service', serviceName, 'key', key]);
    return true;
  },

  async list() {
    return []; // secret-tool has no simple list API; env keys remain authoritative
  }
};

// ─────────────────────────────────────────────
// Fallback backend: AES-256-GCM encrypted file
// ─────────────────────────────────────────────
function ensureStoreDir() {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
}

function getMasterKey() {
  ensureStoreDir();
  if (fs.existsSync(MASTER_KEY_FILE)) {
    return fs.readFileSync(MASTER_KEY_FILE);
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(MASTER_KEY_FILE, key, { mode: 0o600 });
  if (process.platform !== 'win32') {
    try { fs.chmodSync(MASTER_KEY_FILE, 0o600); } catch (e) {}
  }
  return key;
}

function encryptValue(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString('base64'), tag: tag.toString('base64'), data: enc.toString('base64') };
}

function decryptValue(payload, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8');
}

function readEncFile() {
  if (!fs.existsSync(ENC_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(ENC_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeEncFile(data) {
  ensureStoreDir();
  fs.writeFileSync(ENC_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  if (process.platform !== 'win32') {
    try { fs.chmodSync(ENC_FILE, 0o600); } catch (e) {}
  }
}

const encFileFallback = {
  name: 'encrypted-file',
  async isAvailable() {
    return true;
  },

  async set(key, value) {
    const masterKey = getMasterKey();
    const data = readEncFile();
    data[key] = encryptValue(value, masterKey);
    writeEncFile(data);
    return true;
  },

  async get(key) {
    const data = readEncFile();
    if (!data[key]) return null;
    try {
      return decryptValue(data[key], getMasterKey());
    } catch {
      return null;
    }
  },

  getSync(key) {
    const data = readEncFile();
    if (!data[key]) return null;
    try {
      return decryptValue(data[key], getMasterKey());
    } catch {
      return null;
    }
  },

  async delete(key) {
    const data = readEncFile();
    if (data[key]) {
      delete data[key];
      writeEncFile(data);
    }
    return true;
  },

  async list() {
    return Object.keys(readEncFile());
  }
};

// ─────────────────────────────────────────────
// Secret Store facade
// ─────────────────────────────────────────────
class SecretStore {
  constructor() {
    this._backend = null;
    this._resolved = false;
  }

  async _resolveBackend() {
    if (this._resolved) return this._backend;
    this._resolved = true;

    const forced = process.env.SELFAGENT_SECRET_BACKEND;
    const candidates = [];
    if (process.platform === 'win32') candidates.push(windowsDpapi, encFileFallback);
    else if (process.platform === 'darwin') candidates.push(macKeychain, encFileFallback);
    else candidates.push(libSecret, encFileFallback);

    if (forced) {
      const found = candidates.find((b) => b.name === forced);
      if (found) {
        this._backend = found;
        return this._backend;
      }
      logger.warn(`Unknown SELFAGENT_SECRET_BACKEND "${forced}", using auto-detection.`);
    }

    for (const backend of candidates) {
      try {
        if (await backend.isAvailable()) {
          this._backend = backend;
          break;
        }
      } catch (e) {
        // try next backend
      }
    }

    if (!this._backend) {
      this._backend = encFileFallback;
    }

    logger.info(`Secret store backend: ${this._backend.name}`);
    return this._backend;
  }

  get backend() {
    return this._backend ? this._backend.name : 'resolving';
  }

  async set(key, value) {
    const backend = await this._resolveBackend();
    const normalized = key.trim().toUpperCase();
    return backend.set(normalized, String(value));
  }

  async get(key) {
    const backend = await this._resolveBackend();
    const normalized = key.trim().toUpperCase();
    try {
      return await backend.get(normalized);
    } catch (e) {
      return null;
    }
  }

  // Synchronous read for startup (no shell round-trip needed for encrypted-file,
  // spawnSync for OS backends). Resolves the backend synchronously.
  getSync(key) {
    const normalized = key.trim().toUpperCase();
    const backend = this._resolveBackendSync();
    try {
      return backend.getSync ? backend.getSync(normalized) : null;
    } catch (e) {
      return null;
    }
  }

  _resolveBackendSync() {
    const forced = process.env.SELFAGENT_SECRET_BACKEND;
    const candidates = [];
    if (process.platform === 'win32') candidates.push(windowsDpapi, encFileFallback);
    else if (process.platform === 'darwin') candidates.push(macKeychain, encFileFallback);
    else candidates.push(libSecret, encFileFallback);

    if (forced) {
      const found = candidates.find((b) => b.name === forced);
      if (found) return found;
    }
    for (const backend of candidates) {
      try {
        const available = backend.isAvailableSync ? backend.isAvailableSync() : false;
        if (available) {
          this._backend = backend;
          this._resolved = true;
          return backend;
        }
      } catch (e) {
        // try next
      }
    }
    this._backend = encFileFallback;
    this._resolved = true;
    return encFileFallback;
  }

  async delete(key) {
    const backend = await this._resolveBackend();
    return backend.delete(key.trim().toUpperCase());
  }

  async has(key) {
    const value = await this.get(key);
    return value !== null && value !== '';
  }

  async list() {
    const backend = await this._resolveBackend();
    return backend.list();
  }

  // Load all known secrets into process.env (only fills empty slots)
  async hydrateEnv() {
    const known = ['GROQ_API_KEY', 'NVIDIA_API_KEY', 'GITHUB_TOKEN', 'SERVER_SECRET', 'WHATSAPP_PHONE_NUMBER'];
    for (const key of known) {
      if (process.env[key]) continue;
      const value = await this.get(key);
      if (value) process.env[key] = value;
    }
  }

  // Synchronous hydration, safe to call before config is built
  hydrateEnvSync() {
    const known = ['GROQ_API_KEY', 'NVIDIA_API_KEY', 'GITHUB_TOKEN', 'SERVER_SECRET', 'WHATSAPP_PHONE_NUMBER'];
    for (const key of known) {
      if (process.env[key]) continue;
      const value = this.getSync(key);
      if (value) process.env[key] = value;
    }
  }
}

module.exports = new SecretStore();
