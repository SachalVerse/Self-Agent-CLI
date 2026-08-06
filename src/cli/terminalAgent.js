const readline = require('readline');
const fs = require('fs');
const path = require('path');
const chatAgent = require('../agents/chatAgent');
const gateway = require('../whatsapp/gateway');
const healthMonitor = require('../health/healthMonitor');
const secretStore = require('../security/secretStore');
const configManager = require('../utils/configManager');
const { runSetup } = require('../security/setupWizard');

// Claude Code CLI Color Palette
const COLORS = {
  gold: '\x1b[38;5;214m',
  goldBold: '\x1b[1m\x1b[38;5;214m',
  yellowHighlight: '\x1b[1m\x1b[38;5;220m',
  lavender: '\x1b[38;5;141m',
  lavenderBold: '\x1b[1m\x1b[38;5;141m',
  green: '\x1b[32m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  reset: '\x1b[0m'
};

async function setSecretKey(name, key) {
  try {
    await secretStore.set(name, key);
    configManager.set(name, key);
    process.env[name] = key;

    if (name === 'GROQ_API_KEY' || name === 'NVIDIA_API_KEY') {
      chatAgent.refreshClients();
    } else if (name === 'WHATSAPP_PHONE_NUMBER') {
      gateway.myPhone = key;
    }

    return true;
  } catch (err) {
    console.log(`\n${COLORS.red}[Error]${COLORS.reset} Failed to store ${name}: ${err.message}\n`);
    return false;
  }
}

async function printConfiguredKeys() {
  const names = await secretStore.list();
  console.log(`\n${COLORS.lavenderBold}🔐 Configured secrets [backend: ${secretStore.backend}]:${COLORS.reset}`);
  if (names.length === 0) {
    console.log(`   ${COLORS.gray}None. Use 'setup' to securely store your keys.${COLORS.reset}`);
  } else {
    for (const name of names) {
      const value = await secretStore.get(name);
      const shown = value ? `${value.slice(0, 4)}...${value.slice(-4)}` : '(empty)';
      console.log(`   ${COLORS.gold}•${COLORS.reset} ${name}: ${shown}`);
    }
  }
  console.log('');
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning.';
  if (hour < 18) return 'Good afternoon.';
  return 'Good evening.';
}

function centerLine(text, width = 80) {
  const plainText = text.replace(/\x1b\[[0-9;]*m/g, '');
  const padLength = Math.max(0, Math.floor((width - plainText.length) / 2));
  return ' '.repeat(padLength) + text;
}

function printBanner() {
  const width = process.stdout.columns || 80;

  const logoLines = [
    `  ___ ___ _    ___   _   ___ ___ _  _ _____ `,
    ` / __| __| |  | __| /_\\ / __| __| \\| |_   _|`,
    ` \\__ \\ _|| |__| _| / _ \\ (_ | _|| .\` | | |  `,
    ` |___/___|____|_| /_/ \\_\\___|___|_|\\_| |_|  `
  ];

  console.log('');
  for (const line of logoLines) {
    console.log(centerLine(`${COLORS.gold}${line}${COLORS.reset}`, width));
  }
  console.log('');

  console.log(centerLine(`${COLORS.lavenderBold} Autonomous AI Systems & WhatsApp Gateway Agent${COLORS.reset}`, width));
  console.log(centerLine(`${COLORS.gray} ${getGreeting()}${COLORS.reset}`, width));
  console.log('');

  if (gateway.isReady) {
    console.log(centerLine(`${COLORS.green} ✅ WhatsApp Connected (${gateway.myPhone || 'Active'})${COLORS.reset}`, width));
    console.log(centerLine(`${COLORS.yellowHighlight} Type 'resources', 'status', or '/help' to get started.${COLORS.reset}`, width));
  } else {
    console.log(centerLine(`${COLORS.yellowHighlight} Type 'connect' or 'whatsapp' for pairing QR code & settings.${COLORS.reset}`, width));
  }
  console.log(centerLine(`${COLORS.gray} Shortcuts: 'resources' · 'status' · '/help' · 'exit'${COLORS.reset}`, width));
  console.log('');
}

function printHelp() {
  console.log(`
${COLORS.lavenderBold}⚡ SelfAgent CLI & WhatsApp Commands:${COLORS.reset}
  ${COLORS.gold}setup${COLORS.reset}                   → Securely store GitHub token & API keys (OS keychain)
  ${COLORS.gold}key <NAME> <value>${COLORS.reset}      → Store a single secret securely (e.g. key GROQ_API_KEY gsk_...)
  ${COLORS.gold}keys${COLORS.reset}                    → Show which secrets are configured (masked)
  ${COLORS.gold}unset <NAME>${COLORS.reset}            → Remove a stored secret
  ${COLORS.gold}groq <key>${COLORS.reset}              → Shortcut: update Groq API Key (stored securely)
  ${COLORS.gold}feed <minutes>${COLORS.reset}        → Set live WhatsApp resource feed timer (e.g. feed 15)
  ${COLORS.gold}feed-now${COLORS.reset}              → Run web discovery & send live resource feed to WhatsApp now
  ${COLORS.gold}connect${COLORS.reset}               → Generate & display WhatsApp pairing QR code in CLI
  ${COLORS.gold}connect <phone>${COLORS.reset}       → Set phone number & display pairing QR code (e.g. connect +923188201502)
  ${COLORS.gold}send <num> <msg>${COLORS.reset}       → Send WhatsApp message directly from CLI
  ${COLORS.gold}resources${COLORS.reset}             → Discover free developer tools, APIs & cloud credits
  ${COLORS.gold}reset${COLORS.reset}                 → Reset chat memory context & clear auth sessions
  ${COLORS.gold}status${COLORS.reset}                → Check system health and uptime
  ${COLORS.gold}clear${COLORS.reset}                 → Clear terminal screen
  ${COLORS.gold}exit${COLORS.reset}                  → Exit SelfAgent CLI & Server
`);
}

function startTerminalConsole() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let activePrompt = false;
  const promptStr = `${COLORS.gold}selfagent >${COLORS.reset} `;

  // Hook console functions to prevent logs from corrupting active user typing line
  const hookConsole = (orig) => {
    return function (...args) {
      if (activePrompt && !rl.closed) {
        process.stdout.write('\x1b[2K\r');
        orig.apply(console, args);
        process.stdout.write(promptStr + rl.line);
      } else {
        orig.apply(console, args);
      }
    };
  };

  console.log = hookConsole(console.log);
  console.info = hookConsole(console.info);
  console.warn = hookConsole(console.warn);
  console.error = hookConsole(console.error);

  printBanner();

  let shuttingDown = false;

  // Graceful exit when stdin closes (EOF / pipe ends) instead of crashing.
  rl.on('close', () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${COLORS.gray}[SelfAgent CLI & Server stopped]${COLORS.reset}`);
    process.exit(0);
  });

  function promptUser() {
    if (rl.closed) return;
    activePrompt = true;
    rl.question(promptStr, async (input) => {
      activePrompt = false;
      const trimmed = input.trim();

      if (rl.closed) return;

      if (!trimmed) {
        promptUser();
        return;
      }

      const lower = trimmed.toLowerCase();

      if (lower === 'exit' || lower === 'quit' || lower === '/exit') {
        shuttingDown = true;
        console.log(`\n${COLORS.gray}[SelfAgent CLI & Server stopped]${COLORS.reset}\n`);
        rl.close();
        process.exit(0);
      }

      if (lower === 'clear' || lower === '/clear') {
        console.clear();
        printBanner();
        promptUser();
        return;
      }

      if (lower === 'help' || lower === '/help' || lower === '?') {
        printHelp();
        promptUser();
        return;
      }

      if (lower.startsWith('groq ') || lower.startsWith('set-key ') || lower.startsWith('/groq ')) {
        const parts = trimmed.split(' ');
        if (parts.length > 1 && parts[1].length > 5) {
          const key = parts[1].trim();
          await setSecretKey('GROQ_API_KEY', key);
          console.log(`\n${COLORS.green}✅ Groq API Key stored securely in ${secretStore.backend}!${COLORS.reset}\n`);
        } else {
          console.log(`\n${COLORS.gold}Usage:${COLORS.reset} groq <gsk_your_api_key>\n`);
        }
        promptUser();
        return;
      }

      if (lower === 'setup' || lower === '/setup') {
        console.log(`\n${COLORS.gold}🔐 Running secure setup wizard...${COLORS.reset}\n`);
        await runSetup({ interactive: true });
        chatAgent.refreshClients();
        promptUser();
        return;
      }

      if (lower.startsWith('key ') || lower.startsWith('/key ')) {
        const parts = trimmed.split(' ');
        if (parts.length < 3) {
          console.log(`\n${COLORS.gold}Usage:${COLORS.reset} key <NAME> <value>\nExample: key GITHUB_TOKEN ghp_xxxx\n`);
        } else {
          const name = parts[1].toUpperCase();
          const value = parts.slice(2).join(' ');
          const ok = await setSecretKey(name, value);
          if (ok) {
            console.log(`\n${COLORS.green}✅ ${name} stored securely in ${secretStore.backend}!${COLORS.reset}\n`);
          }
        }
        promptUser();
        return;
      }

      if (lower === 'keys' || lower === '/keys') {
        await printConfiguredKeys();
        promptUser();
        return;
      }

      if (lower.startsWith('unset ') || lower.startsWith('remove-key ') || lower.startsWith('/unset ')) {
        const parts = trimmed.split(' ');
        const name = (parts[1] || '').toUpperCase();
        if (!name) {
          console.log(`\n${COLORS.gold}Usage:${COLORS.reset} unset <NAME> (e.g. unset NVIDIA_API_KEY)\n`);
        } else {
          await secretStore.delete(name);
          console.log(`\n${COLORS.green}🗑️  Removed ${name} from the secret store.${COLORS.reset}\n`);
        }
        promptUser();
        return;
      }

      if (lower.startsWith('feed ') || lower.startsWith('timer ') || lower.startsWith('/feed ')) {
        const parts = trimmed.split(' ');
        const mins = parseInt(parts[1], 10);
        if (mins > 0) {
          const taskScheduler = require('../scheduler/taskScheduler');
          taskScheduler.setLiveFeedTimer(mins);
          console.log(`\n${COLORS.green}⏰ Live WhatsApp resource feed timer set for every ${mins} minutes!${COLORS.reset}\n`);
        } else {
          console.log(`\n${COLORS.gold}Usage:${COLORS.reset} feed <interval_in_minutes> (e.g. 'feed 15' to send live updates to WhatsApp every 15 mins)\n`);
        }
        promptUser();
        return;
      }

      if (lower === 'feed-now' || lower === 'run-feed' || lower === '/feed-now') {
        console.log(`\n${COLORS.gold}🚀 Running web discovery & sending live feed to WhatsApp...${COLORS.reset}`);
        try {
          const taskScheduler = require('../scheduler/taskScheduler');
          const resources = await taskScheduler.triggerLiveFeedNow();
          console.log(`${COLORS.green}✅ Live feed dispatched to WhatsApp! (${resources.length} resources found)${COLORS.reset}\n`);
        } catch (feedErr) {
          console.log(`\x1b[31m[Feed Error]\x1b[0m ${feedErr.message}\n`);
        }
        promptUser();
        return;
      }

      if (lower === 'reset' || lower === 'reset-memory' || lower === 'clear-memory' || lower === 'logout' || lower === '/reset' || lower === '/logout') {
        console.log(`\n${COLORS.gold}🧹 Performing complete reset of all configurations, settings, memory, and sessions...${COLORS.reset}`);
        
        // 1. Clear memory & WhatsApp session
        chatAgent.clearAllMemory();
        await gateway.resetSession();

        // 2. Clear config files
        const configDir = path.join(require('os').homedir(), '.selfagent/config');
        const files = ['user_config.json', 'gateway_store.json'];
        for (const file of files) {
          const filePath = path.join(configDir, file);
          if (fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (e) {}
          }
        }

        // 3. Clear secret store keys
        const knownKeys = ['GITHUB_TOKEN', 'GROQ_API_KEY', 'NVIDIA_API_KEY', 'SERVER_SECRET', 'WHATSAPP_PHONE_NUMBER', 'WHATSAPP_TOKEN'];
        for (const key of knownKeys) {
          try {
            await secretStore.delete(key);
            delete process.env[key];
          } catch (e) {}
        }

        // 4. Delete OS secrets files/folder (~/.selfagent)
        const dpapiStoreDir = path.join(require('os').homedir(), '.selfagent');
        if (fs.existsSync(dpapiStoreDir)) {
          try { fs.rmSync(dpapiStoreDir, { recursive: true, force: true }); } catch (e) {}
        }

        console.log(`${COLORS.green}✅ All configurations, credentials, sessions, and memory have been wiped!${COLORS.reset}`);
        console.log(`${COLORS.gray}Process will now exit to allow a clean startup wizard run.${COLORS.reset}\n`);
        
        rl.close();
        process.exit(0);
        return;
      }

      // WhatsApp Status Command (handles aliases connect, connet, pair, qr, whatsapp, gateway)
      const isConnectCmd = lower.startsWith('connect') || lower.startsWith('connet') || lower.startsWith('/connect') || 
                           lower.startsWith('pair') || lower.startsWith('/pair') || lower.startsWith('qr') || 
                           lower === 'whatsapp' || lower === '/whatsapp' || lower === 'gateway';

      if (isConnectCmd) {
        const parts = trimmed.split(' ');
        if (parts.length > 1 && parts[1].includes('92')) {
          const newPhone = parts[1].startsWith('+') ? parts[1] : '+' + parts[1].replace(/[^\d]/g, '');
          await setSecretKey('WHATSAPP_PHONE_NUMBER', newPhone);
          console.log(`\n${COLORS.green}✅ Phone number set to ${newPhone} (stored securely)!${COLORS.reset}`);
        }

        const waStatus = gateway.getStatus();
        if (waStatus.isReady) {
          console.log(`\n${COLORS.green}✅ WhatsApp Gateway is CONNECTED! [Phone: ${gateway.myPhone || 'Active'}]${COLORS.reset}\n`);
          promptUser();
        } else {
          console.log(`\n${COLORS.gold}📱 Initializing WhatsApp Gateway engine...${COLORS.reset}`);
          console.log(`${COLORS.gray}⏳ Generating QR Code... Please wait a few seconds...${COLORS.reset}\n`);

          try {
            const res = await gateway.requestQrCode();
            if (res && res.ready) {
              console.log(`\n${COLORS.green}✅ WhatsApp Gateway is CONNECTED!${COLORS.reset}\n`);
            }
          } catch (err) {
            console.log(`\x1b[31m[WhatsApp Error]\x1b[0m ${err.message}`);
          }
          if (!rl.closed) {
            promptUser();
          }
        }
        return;
      }

      // Send WhatsApp message command
      if (lower.startsWith('send ') || lower.startsWith('/send ')) {
        const parts = trimmed.split(' ');
        if (parts.length < 3) {
          console.log(`\n${COLORS.gold}Usage:${COLORS.reset} send <phone_number> <message_text>\nExample: send +923188201502 Hello from CLI\n`);
        } else {
          const targetPhone = parts[1];
          const messageText = parts.slice(2).join(' ');
          try {
            process.stdout.write(`${COLORS.gray}📱 Sending WhatsApp message...${COLORS.reset}\r`);
            const res = await gateway.sendMessage(targetPhone, messageText);
            process.stdout.write('\x1b[2K\r');
            if (res && res.success !== false) {
              console.log(`${COLORS.green}✅ Message sent to ${targetPhone}!${COLORS.reset}\n`);
            } else {
              console.log(`${COLORS.gold}⚠️ Message queued/failed. Connect WhatsApp first with 'connect'${COLORS.reset}\n`);
            }
          } catch (sendErr) {
            process.stdout.write('\x1b[2K\r');
            console.log(`\x1b[31m[Send Error]\x1b[0m ${sendErr.message}\n`);
          }
        }
        promptUser();
        return;
      }

      try {
        const onStep = (stepMsg) => {
          process.stdout.write(`\x1b[2K\r${COLORS.gray}${stepMsg}${COLORS.reset}`);
        };

        let outputText = '';
        if (lower === 'status' || lower === '/status') {
          const health = await healthMonitor.getHealthStatus();
          const waStatus = gateway.getStatus();
          outputText = `✅ Status: ${health.status} | WhatsApp: ${waStatus.isReady ? 'CONNECTED' : 'DISCONNECTED'} | Uptime: ${health.formattedUptime || (health.uptimeSeconds + 's')}`;
        } else if (lower === 'resources' || lower === '/resources') {
          const result = await chatAgent.processMessage('cli_user', 'Find me free developer APIs and tools available right now', { onStep });
          outputText = result.reply;
        } else {
          const result = await chatAgent.processMessage('cli_user', trimmed, { onStep });
          outputText = result.reply;
        }

        // Clear processing step line
        process.stdout.write('\x1b[2K\r');
        console.log(`${COLORS.lavenderBold}⚡ SelfAgent${COLORS.reset}\n${outputText}\n`);

      } catch (err) {
        process.stdout.write('\x1b[2K\r');
        console.log(`\x1b[31m[SelfAgent Error]\x1b[0m ${err.message}\n`);
      }

      promptUser();
    });
  }

  promptUser();
}

module.exports = { startTerminalConsole };
