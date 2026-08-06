const gtts = require('gtts');
const fs = require('fs');
const path = require('path');
const os = require('os');
const logger = require('../utils/logger');

class VoiceResponseAgent {
  constructor() {
    this.tempDir = path.join(os.tmpdir(), 'tts_audio');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  // ─────────────────────────────────────────
  // Convert text to speech audio file
  // Uses Google TTS (100% Free)
  // Supports: English ('en'), Urdu ('ur'), Arabic ('ar') etc.
  // ─────────────────────────────────────────
  async textToSpeech(text, options = {}) {
    const language = options.language || this.detectLanguage(text);
    const slow = options.slow || false;

    // Clean formatting characters (markdown stars, underscores) for natural speech
    const cleanText = text
      .replace(/[*_~`#]/g, '')
      .replace(/https?:\/\/\S+/g, 'link')
      .trim();

    const filename = `tts_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.mp3`;
    const filePath = path.join(this.tempDir, filename);

    return new Promise((resolve, reject) => {
      const speech = new gtts(cleanText || 'Hello', language, slow);

      speech.save(filePath, (err) => {
        if (err) {
          logger.error(`TTS generation failed for text length ${cleanText.length}:`, err.message);
          return reject(err);
        }

        logger.info(`✅ TTS audio generated: ${filename} [lang: ${language}]`);

        try {
          const audioBuffer = fs.readFileSync(filePath);

          // Cleanup temporary file after 60 seconds
          setTimeout(() => {
            if (fs.existsSync(filePath)) {
              fs.unlink(filePath, () => {});
            }
          }, 60000);

          resolve({
            buffer: audioBuffer,
            filePath,
            filename,
            language,
            textLength: cleanText.length
          });
        } catch (readErr) {
          logger.error('Failed to read TTS generated audio file:', readErr.message);
          reject(readErr);
        }
      });
    });
  }

  // ─────────────────────────────────────────
  // Generate voice response and send via
  // WhatsApp as audio voice note
  // ─────────────────────────────────────────
  async sendVoiceResponse(gateway, to, text, options = {}) {
    try {
      logger.info(`🔊 Generating voice response for target ${to}: "${text.substring(0, 50)}..."`);

      const audio = await this.textToSpeech(text, options);

      await gateway.sendVoiceMessage(to, audio.buffer);

      logger.info(`✅ Voice response sent to ${to}`);
      return true;

    } catch (error) {
      logger.error('Voice response failed:', error.message);
      // Fallback to text message if voice output fails
      try {
        await gateway.sendMessage(to, `🔊 ${text}`);
      } catch (fallbackErr) {
        logger.error('Fallback text message also failed:', fallbackErr.message);
      }
      return false;
    }
  }

  // ─────────────────────────────────────────
  // Detect language of text automatically
  // ─────────────────────────────────────────
  detectLanguage(text) {
    const urduArabicPattern = /[\u0600-\u06FF]/;
    if (urduArabicPattern.test(text)) {
      return 'ur';
    }
    return 'en';
  }
}

module.exports = new VoiceResponseAgent();
