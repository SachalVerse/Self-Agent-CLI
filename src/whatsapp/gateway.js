// src/whatsapp/gateway.js
// WhatsApp Gateway powered by Baileys (Pure WebSocket - Fast & Reliable)

// Intercept libsignal node_modules console log dumps to preserve clean CLI REPL UX
const originalConsoleInfo = console.info;
console.info = function (...args) {
  if (args[0] && typeof args[0] === 'string' && (args[0].includes('Closing session:') || args[0].includes('SessionEntry'))) {
    return;
  }
  originalConsoleInfo.apply(console, args);
};

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage, getContentType } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const pino = require('pino');
const util = require('util');
const logger = require('../utils/logger');

// Redirect Baileys logs to a separate file to prevent CLI pollution.
const logsDir = path.join(require('os').homedir(), '.selfagent/logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}
const libLogStream = fs.createWriteStream(path.join(logsDir, 'whatsapp_library.log'), { flags: 'a' });

function writeLibLog(level, args) {
  libLogStream.write(`[${new Date().toISOString()}] ${level}: ${util.format(...args)}\n`);
}

const libraryConsole = {
  info: (...args) => writeLibLog('INFO', args),
  warn: (...args) => writeLibLog('WARN', args),
  error: (...args) => writeLibLog('ERROR', args)
};

function getInnerMessage(message) {
  if (!message) return null;
  
  if (message.ephemeralMessage) {
    return getInnerMessage(message.ephemeralMessage.message);
  }
  if (message.viewOnceMessage) {
    return getInnerMessage(message.viewOnceMessage.message);
  }
  if (message.viewOnceMessageV2) {
    return getInnerMessage(message.viewOnceMessageV2.message);
  }
  if (message.documentWithCaptionMessage) {
    return getInnerMessage(message.documentWithCaptionMessage.message);
  }
  
  return message;
}

class WhatsAppGateway extends EventEmitter {
  constructor() {
    super();
    this.sock = null;
    this.isReady = false;
    this.isInitializing = false;
    this.qrCodeData = null;
    this.latestRawQr = null;
    this.myPhone = process.env.WHATSAPP_PHONE_NUMBER || null;
    this.sessionPath = path.join(require('os').homedir(), '.selfagent/auth/baileys');
    this.sentMessageIds = new Set();
  }

  isSelfJid(jid) {
    if (!jid || !this.sock || !this.sock.user) return false;
    const clean = (j) => j.replace(/:[\d]+@/, '@');
    const target = clean(jid);
    const myId = clean(this.sock.user.id);
    const myLid = this.sock.user.lid ? clean(this.sock.user.lid) : null;
    return target === myId || (myLid && target === myLid);
  }

  _saveStoreRecord(data = {}) {
    try {
      const configDir = path.join(require('os').homedir(), '.selfagent/config');
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      const storeFile = path.join(configDir, 'gateway_store.json');
      const existing = fs.existsSync(storeFile) ? JSON.parse(fs.readFileSync(storeFile, 'utf8')) : {};
      const updated = {
        ...existing,
        ...data,
        updatedAt: new Date().toISOString()
      };
      fs.writeFileSync(storeFile, JSON.stringify(updated, null, 2), 'utf8');
    } catch (e) {
      // Ignore
    }
  }

  renderQrInTerminal() {
    if (!this.latestRawQr) return false;
    console.log('\n\x1b[1m\x1b[38;5;214m📱 SCAN THIS QR CODE WITH WHATSAPP (Settings → Linked Devices):\x1b[0m\n');
    qrcode.generate(this.latestRawQr, { small: true }, (qrStr) => {
      console.log(qrStr);
    });
    console.log('\n\x1b[90m(Web pairing URL also available at: http://localhost:3000/qr)\x1b[0m\n');
    return true;
  }

  async initialize(options = {}) {
    if (this.isReady && !options.force) return this;
    if (this.isInitializing && !options.force) return this;
    this.isInitializing = true;

    if (options.resetSession) {
      try {
        if (fs.existsSync(this.sessionPath)) {
          fs.rmSync(this.sessionPath, { recursive: true, force: true });
        }
      } catch (e) {}
    }

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);
      const version = [2, 3000, 1043857760];

      this.sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.latestRawQr = qr;
          try {
            this.qrCodeData = await QRCode.toDataURL(qr);
          } catch (e) {}
          this.renderQrInTerminal();
          this.emit('qr', qr);
        }

        if (connection === 'open') {
          this.isReady = true;
          this.isInitializing = false;
          this.qrCodeData = null;
          this.latestRawQr = null;

          const userJid = this.sock.user?.id || '';
          const phoneNum = userJid.split(':')[0] || this.myPhone;
          this.myPhone = phoneNum;

          this._saveStoreRecord({ status: 'CONNECTED', phone: phoneNum, paired: true });
          console.log(`\n\x1b[32m✅ WhatsApp Connected Successfully! [Phone: ${phoneNum}]\x1b[0m\n`);
          this.emit('ready');
        }

        if (connection === 'close') {
          this.isReady = false;
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          if (shouldReconnect) {
            this.isInitializing = false;
            setTimeout(() => this.initialize().catch(() => {}), 3000);
          } else {
            this._saveStoreRecord({ status: 'LOGGED_OUT', paired: false });
          }
        }
      });

      this.sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        for (const msg of m.messages) {
          logger.info(`Received raw Baileys message JID: ${msg.key.remoteJid}, fromMe: ${msg.key.fromMe}, messageKeys: ${Object.keys(msg.message || {})}`);

          // Skip messages sent by the bot itself
          if (this.sentMessageIds.has(msg.key.id)) {
            this.sentMessageIds.delete(msg.key.id);
            continue;
          }

          // If the message is fromMe, only process it if it's a self-chat (user messaging themselves)
          if (msg.key.fromMe && !this.isSelfJid(msg.key.remoteJid)) {
            continue;
          }

          const innerMessage = getInnerMessage(msg.message);
          if (!innerMessage) continue;

          const contentType = getContentType(innerMessage);
          let type = 'chat';
          let hasMedia = false;
          let body = '';

          if (contentType === 'conversation') {
            body = innerMessage.conversation;
          } else if (contentType === 'extendedTextMessage') {
            body = innerMessage.extendedTextMessage.text;
          } else if (contentType === 'audioMessage') {
            type = 'audio';
            hasMedia = true;
          } else if (contentType === 'imageMessage') {
            type = 'image';
            hasMedia = true;
            body = innerMessage.imageMessage?.caption;
          } else if (contentType === 'videoMessage') {
            type = 'video';
            hasMedia = true;
            body = innerMessage.videoMessage?.caption;
          } else if (contentType === 'documentMessage') {
            type = 'document';
            hasMedia = true;
            body = innerMessage.documentMessage?.caption;
          }

          this.emit('message', {
            from: msg.key.remoteJid,
            body: body || '',
            type,
            hasMedia,
            raw: msg
          });
        }
      });

    } catch (err) {
      logger.debug('Baileys init notice:', err.message);
    } finally {
      this.isInitializing = false;
    }

    return this;
  }

  async requestQrCode() {
    if (this.isReady) return { ready: true };

    try {
      if (fs.existsSync(this.sessionPath)) {
        fs.rmSync(this.sessionPath, { recursive: true, force: true });
      }
    } catch (e) {}

    return new Promise((resolve) => {
      let resolved = false;

      const onQr = (qr) => {
        if (resolved) return;
        resolved = true;
        this.removeListener('ready', onReady);
        resolve({ qr });
      };

      const onReady = () => {
        if (resolved) return;
        resolved = true;
        this.removeListener('qr', onQr);
        resolve({ ready: true });
      };

      this.once('qr', onQr);
      this.once('ready', onReady);

      this.initialize({ force: true, resetSession: true }).catch((err) => {
        if (!resolved) {
          resolved = true;
          this.removeListener('qr', onQr);
          this.removeListener('ready', onReady);
          resolve({ error: err.message });
        }
      });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.removeListener('qr', onQr);
          this.removeListener('ready', onReady);
          resolve({ timeout: true });
        }
      }, 15000);
    });
  }

  getStatus() {
    return {
      isReady: this.isReady,
      phone: this.myPhone,
      hasQr: !!this.qrCodeData
    };
  }

  async sendMessage(to, message) {
    if (!this.sock || !this.isReady) {
      throw new Error('WhatsApp Gateway is not connected.');
    }
    // Strip device suffix (e.g. :12@s.whatsapp.net -> @s.whatsapp.net) to ensure delivery
    const cleanJid = to.replace(/:[\d]+@/, '@');
    const formattedJid = cleanJid.includes('@') ? cleanJid : `${cleanJid.replace(/[^\d]/g, '')}@s.whatsapp.net`;
    const res = await this.sock.sendMessage(formattedJid, { text: message });
    if (res && res.key && res.key.id) {
      this.sentMessageIds.add(res.key.id);
    }
    return res;
  }

  async downloadMedia(message) {
    if (!message || !message.raw) return null;
    try {
      const buffer = await downloadMediaMessage(
        message.raw,
        'buffer',
        {},
        {
          logger: pino({ level: 'silent' }),
          reuploadRequest: this.sock?.updateMediaMessage
        }
      );
      return buffer;
    } catch (error) {
      logger.error('Error downloading media:', error.message);
      return null;
    }
  }

  async sendVoiceMessage(to, audioBuffer) {
    if (!this.sock || !this.isReady) {
      throw new Error('WhatsApp Gateway is not connected.');
    }
    const formattedJid = to.includes('@') ? to : `${to.replace(/[^\d]/g, '')}@s.whatsapp.net`;
    const res = await this.sock.sendMessage(formattedJid, {
      audio: audioBuffer,
      mimetype: 'audio/mp4',
      ptt: true
    });
    if (res && res.key && res.key.id) {
      this.sentMessageIds.add(res.key.id);
    }
    return res;
  }

  async resetSession() {
    logger.info('🧹 Resetting WhatsApp Gateway auth session...');
    try {
      if (this.sock) {
        try { this.sock.end(); } catch (e) {}
        this.sock = null;
      }
      this.isReady = false;
      this.isInitializing = false;
      this.qrCodeData = null;
      this.latestRawQr = null;
      if (fs.existsSync(this.sessionPath)) {
        fs.rmSync(this.sessionPath, { recursive: true, force: true });
      }
      this._saveStoreRecord({ status: 'LOGGED_OUT', paired: false });
      logger.info('✅ Session cleared successfully.');
      return true;
    } catch (error) {
      logger.error('Failed to reset session:', error.message);
      return false;
    }
  }

  async destroy() {
    if (this.sock) {
      try {
        this.sock.end();
      } catch (e) {}
      this.sock = null;
    }
    this.isReady = false;
    this.isInitializing = false;
  }
}

module.exports = new WhatsAppGateway();
