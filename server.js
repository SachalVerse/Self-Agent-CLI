#!/usr/bin/env node
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const configManager = require('./src/utils/configManager');
const secretStore = require('./src/security/secretStore');
const { handleCliArgs } = require('./src/cli/setupCli');
const { promptForMissingLlmKeys } = require('./src/security/setupWizard');

const { config, validateEnvironment, refreshConfigObject } = require('./src/config/environment');
const logger = require('./src/utils/logger');
const chatAgent = require('./src/agents/chatAgent');
const voiceAgent = require('./src/agents/voiceAgent');
const voiceResponseAgent = require('./src/agents/voiceResponseAgent');
const gateway = require('./src/whatsapp/gateway');
const notificationService = require('./src/whatsapp/notificationService');
const resourceDiscovery = require('./src/scrapers/resourceDiscovery');
const resourceVerifier = require('./src/verification/resourceVerifier');
const healthMonitor = require('./src/health/healthMonitor');
const taskScheduler = require('./src/scheduler/taskScheduler');
const terminalAgent = require('./src/cli/terminalAgent');

async function main() {
  const handled = await handleCliArgs(process.argv.slice(2));
  if (handled) {
    process.exit(0);
    return;
  }

  await configManager.syncWithSecretStore(secretStore);
  await configManager.ensureConfig();
  secretStore.hydrateEnvSync();
  refreshConfigObject();
  chatAgent.refreshClients();
  validateEnvironment();
  startServer();
}

main().catch((error) => {
  logger.error('Startup failed:', error.message || error);
  process.exit(1);
});

const app = express();

// Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Security & Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate Limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

app.use('/api/', apiLimiter);

// Multer storage for voice uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// ─────────────────────────────────────────────
// WHATSAPP EVENT HANDLING
// ─────────────────────────────────────────────
gateway.on('ready', async () => {
  try {
    const target = gateway.myPhone || config.whatsapp.phoneNumber;
    if (target) {
      logger.info(`Sending activation message to self: ${target}...`);
      await gateway.sendMessage(target, '🤖 *SelfAgent WhatsApp Gateway Activated!* Your bot is now online and ready to chat. Try typing a message or sending a voice note!');
      logger.info(`✅ Activation message sent successfully.`);
    }
  } catch (error) {
    logger.error('Failed to send activation message:', error.message);
  }
});

gateway.on('message', async (message) => {
  try {
    const targetChat = message.fromMe ? message.to : message.from;
    const body = (message.body || '').trim();
    const type = message.type;
    const isAudio = ['ptt', 'audio', 'voice'].includes(type);

    if (!isAudio && !body) return;

    // Strict Authorization Filter: Only reply to authorized user number or self-chat
    const allowedPhone = (gateway.myPhone || config.whatsapp.phoneNumber || '').replace(/[^\d]/g, '');
    const senderClean = (targetChat || '').split('@')[0].replace(/[^\d]/g, '');
    const isAuthorizedUser = gateway.isSelfJid(targetChat) || (allowedPhone && senderClean.includes(allowedPhone));

    if (!isAuthorizedUser) {
      logger.info(`🔒 Ignoring message from unauthorized WhatsApp sender: ${targetChat}`);
      return;
    }

    logger.info(`📩 Processing WhatsApp message [${type}] from ${targetChat}: "${body.substring(0, 50)}"`);

    let responseText = '';

    if (isAudio && message.hasMedia) {
      logger.info('🎤 Processing incoming WhatsApp voice note...');
      const audioBuffer = await gateway.downloadMedia(message);

      if (audioBuffer) {
        // 1. Transcribe voice using Groq Whisper
        const transcriptionResult = await voiceAgent.transcribeAudio(audioBuffer, {
          filename: 'voice_note.ogg'
        });

        logger.info(`Voice note transcribed: "${transcriptionResult.text}"`);

        // 2. Generate AI response with ChatAgent
        const result = await chatAgent.processMessage(targetChat, transcriptionResult.text);
        responseText = result.reply;

        // Send text reply first
        await gateway.sendMessage(targetChat, `🎙️ *You said:* "_${transcriptionResult.text}_"\n\n🤖 ${responseText}`);

        // 3. Convert response to audio TTS and send back voice note
        await voiceResponseAgent.sendVoiceResponse(gateway, targetChat, responseText);
        logger.info(`🔊 Sent TTS voice note response to ${targetChat}`);

      } else {
        await gateway.sendMessage(targetChat, '⚠️ Received voice note, but could not download audio data.');
      }

    } else if (body) {
      const result = await chatAgent.processMessage(targetChat, body);
      responseText = result.reply;
      await gateway.sendMessage(targetChat, responseText);
      logger.info(`✅ Agent replied to ${targetChat}`);
    }

  } catch (error) {
    logger.error('Error in WhatsApp message handler:', error.message);
    healthMonitor.recordError(error);
  }
});

// ─────────────────────────────────────────────
// REST API & ROUTING
// ─────────────────────────────────────────────

// 1. QR Code Display Page for WhatsApp Web pairing
app.get('/qr', (req, res) => {
  const status = gateway.getStatus();

  if (status.isReady) {
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>WhatsApp Status</title></head>
        <body style="font-family: system-ui, sans-serif; text-align: center; padding: 50px; background: #0f172a; color: #f8fafc;">
          <h1 style="color: #22c55e;">✅ WhatsApp Connected!</h1>
          <p>Your WhatsApp account is linked and active.</p>
          <p>Phone: <code>${status.phone || 'Connected'}</code></p>
        </body>
      </html>
    `);
  }

  if (gateway.qrCodeData) {
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>WhatsApp Web QR Code</title>
          <meta http-equiv="refresh" content="10">
        </head>
        <body style="font-family: system-ui, sans-serif; text-align: center; padding: 50px; background: #0f172a; color: #f8fafc;">
          <h1 style="color: #38bdf8;">📱 Scan WhatsApp QR Code</h1>
          <p>Open WhatsApp on your phone → <strong>Settings</strong> → <strong>Linked Devices</strong> → <strong>Link a Device</strong></p>
          <div style="background: white; display: inline-block; padding: 20px; border-radius: 16px; margin: 20px 0;">
            <img src="${gateway.qrCodeData}" style="width: 280px; height: 280px;" alt="WhatsApp QR Code"/>
          </div>
          <p style="color: #94a3b8;">Page auto-refreshes every 10 seconds.</p>
        </body>
      </html>
    `);
  }

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Loading WhatsApp...</title>
        <meta http-equiv="refresh" content="3">
      </head>
      <body style="font-family: system-ui, sans-serif; text-align: center; padding: 50px; background: #0f172a; color: #f8fafc;">
        <h1>⏳ Initializing WhatsApp Engine...</h1>
        <p>Please wait while the QR code is generated.</p>
      </body>
    </html>
  `);
});

// 2. Health Endpoint
app.get('/health', async (req, res) => {
  try {
    const health = await healthMonitor.getHealthStatus();
    health.whatsappStatus = gateway.getStatus();
    const statusCode = health.status === 'HEALTHY' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    logger.error('Health check failed:', error.message);
    res.status(500).json({ status: 'ERROR', message: error.message });
  }
});

// 3. Direct Chat Agent Endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { senderId = 'web_user', message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message body is required.' });
    }

    const response = await chatAgent.processMessage(senderId, message);
    res.json(response);

  } catch (error) {
    logger.error('Chat endpoint error:', error.message);
    res.status(500).json({ error: 'Failed to process chat message.' });
  }
});

// 4. Direct Voice Transcription Endpoint
app.post('/api/voice/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Audio file upload is required.' });
    }

    const { translate, language } = req.body;

    const result = await voiceAgent.transcribeAudio(req.file.buffer, {
      filename: req.file.originalname || 'uploaded_voice.ogg',
      translate: translate === 'true' || translate === true,
      language
    });

    res.json(result);

  } catch (error) {
    logger.error('Voice transcription endpoint error:', error.message);
    res.status(500).json({ error: 'Failed to transcribe audio file.' });
  }
});

// 4b. Direct Text-To-Speech (TTS) Generation Endpoint
app.post('/api/voice/tts', async (req, res) => {
  try {
    const { text, language } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'text field is required.' });
    }

    const ttsResult = await voiceResponseAgent.textToSpeech(text, { language });
    res.set('Content-Type', 'audio/mp3');
    res.send(ttsResult.buffer);

  } catch (error) {
    logger.error('TTS endpoint error:', error.message);
    res.status(500).json({ error: 'Failed to generate TTS audio.' });
  }
});

// 5. Trigger Resource Discovery Cycle
app.get('/api/resources/discover', async (req, res) => {
  try {
    logger.info('Manual trigger: Starting resource discovery...');
    const rawResources = await resourceDiscovery.runDiscovery();
    const verifiedResources = await resourceVerifier.verifyBatch(rawResources);

    res.json({
      totalFound: rawResources.length,
      verifiedCount: verifiedResources.filter((r) => r.verified).length,
      resources: verifiedResources
    });

  } catch (error) {
    logger.error('Resource discovery trigger error:', error.message);
    res.status(500).json({ error: 'Failed to execute resource discovery.' });
  }
});

// 6. Get Cached Resources
app.get('/api/resources', (req, res) => {
  const resources = resourceDiscovery.discoveredResources;
  res.json({
    count: resources.length,
    resources
  });
});

// 7. Root Route
app.get('/', (req, res) => {
  res.json({
    name: 'Automated Voice & Chat Agent Backend Server',
    version: '1.0.0',
    status: 'ONLINE',
    whatsapp: gateway.getStatus(),
    endpoints: {
      qrCodePage: '/qr',
      health: '/health',
      chat: '/api/chat',
      voice: '/api/voice/transcribe',
      discoverResources: '/api/resources/discover',
      resources: '/api/resources'
    }
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ─────────────────────────────────────────────
// SERVER STARTUP & GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────
const PORT = config.server.port;

function startServer() {
  const server = app.listen(PORT, async () => {
    logger.info(`🚀 Server running on port ${PORT} [Env: ${config.server.env}]`);
    logger.info(`💻 Terminal Agent Console starting below...`);

    taskScheduler.startAll();

    // Auto-initialize WhatsApp Gateway on startup
    gateway.initialize().catch((err) => {
      logger.error('Failed to auto-initialize WhatsApp Gateway on startup:', err.message);
    });

    // Start Terminal Interactive REPL Console
    terminalAgent.startTerminalConsole();
  });

  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      const message = `Port ${PORT} is already in use. Set a different PORT in .env or stop the process using that port.`;
      logger.error(message);
      console.error(`
[Error] ${message}
`);
    } else {
      logger.error('HTTP server error:', error && error.message ? error.message : error);
      console.error(`
[Error] Server startup failed: ${error && error.message ? error.message : error}
`);
    }
    process.exit(1);
  });

  function handleShutdown(signal) {
    logger.info(`Received ${signal}. Shutting down server gracefully...`);

    taskScheduler.stopAll();

    server.close(async () => {
      logger.info('HTTP server closed.');

      await gateway.destroy();

      const webScraper = require('./src/scrapers/webScraper');
      await webScraper.close();

      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down.');
      process.exit(1);
    }, 10000);
  }

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

module.exports = app;
