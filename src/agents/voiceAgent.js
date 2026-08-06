const Groq = require('groq-sdk');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { config } = require('../config/environment');
const logger = require('../utils/logger');

class VoiceAgent {
  constructor() {
    this.groq = config.ai.groqApiKey ? new Groq({
      apiKey: config.ai.groqApiKey,
      fetch: globalThis.fetch
    }) : null;
  }

  async transcribeAudio(audioInput, options = {}) {
    const {
      language = 'en',
      translate = false,
      model = 'whisper-large-v3'
    } = options;

    logger.debug(`Transcribing audio [lang: ${language}, translate: ${translate}]`);

    if (!this.groq) {
      if (config.ai.nvidiaApiKey) {
        return this._transcribeWithNvidia(audioInput, options);
      }
      logger.warn('No AI Voice transcription API key provided.');
      return {
        text: '[Voice message received - Transcription API key not configured]',
        language: 'en',
        confidence: 0,
        model: 'none'
      };
    }

    try {
      let audioFile;
      if (Buffer.isBuffer(audioInput)) {
        audioFile = await this._bufferToFile(audioInput, options.filename || 'audio.ogg');
      } else if (typeof audioInput === 'string') {
        audioFile = fs.createReadStream(audioInput);
      } else {
        audioFile = audioInput;
      }

      const endpoint = translate ? 'translations' : 'transcriptions';
      const transcription = await this.groq.audio[endpoint].create({
        file: audioFile,
        model,
        language: translate ? undefined : language,
        response_format: 'verbose_json',
        temperature: 0.0
      });

      const result = {
        text: transcription.text,
        language: transcription.language || language,
        duration: transcription.duration,
        segments: transcription.segments || [],
        confidence: this._calculateConfidence(transcription),
        model: `groq-${model}`
      };

      logger.info(`✅ Audio transcribed: "${result.text.substring(0, 80)}..."`);
      return result;

    } catch (error) {
      logger.error('Groq transcription failed:', error.message);

      if (config.ai.nvidiaApiKey) {
        logger.info('Falling back to Nvidia ASR...');
        return this._transcribeWithNvidia(audioInput, options);
      }

      throw error;
    }
  }

  async _bufferToFile(buffer, filename) {
    const tmpDir = process.env.TEMP || process.env.TMPDIR || '/tmp';
    const tmpPath = path.join(tmpDir, `voice_${Date.now()}_${filename}`);
    fs.writeFileSync(tmpPath, buffer);

    const stream = fs.createReadStream(tmpPath);
    stream.on('close', () => {
      fs.unlink(tmpPath, () => {});
    });

    return stream;
  }

  async _transcribeWithNvidia(audioInput, options = {}) {
    try {
      const FormData = require('form-data');
      const form = new FormData();

      if (Buffer.isBuffer(audioInput)) {
        form.append('audio', audioInput, {
          filename: options.filename || 'audio.wav',
          contentType: 'audio/wav'
        });
      } else if (typeof audioInput === 'string') {
        form.append('audio', fs.createReadStream(audioInput));
      }

      const response = await axios.post(
        `${config.ai.nvidiaBaseUrl}/audio/transcriptions`,
        form,
        {
          headers: {
            ...form.getHeaders(),
            'Authorization': `Bearer ${config.ai.nvidiaApiKey}`
          },
          timeout: 30000
        }
      );

      return {
        text: response.data.text || '',
        language: 'en',
        model: 'nvidia-asr',
        confidence: 0.8
      };
    } catch (error) {
      logger.error('Nvidia ASR transcription failed:', error.message);
      return {
        text: '[Audio Transcription Failed]',
        language: 'en',
        confidence: 0,
        model: 'failed'
      };
    }
  }

  _calculateConfidence(transcription) {
    if (!transcription.segments || transcription.segments.length === 0) {
      return 0.9;
    }

    const totalProb = transcription.segments.reduce((acc, seg) => {
      const prob = seg.avg_logprob ? Math.exp(seg.avg_logprob) : 0.85;
      return acc + prob;
    }, 0);

    return parseFloat((totalProb / transcription.segments.length).toFixed(2));
  }
}

module.exports = new VoiceAgent();
