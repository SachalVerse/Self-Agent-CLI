const Groq = require('groq-sdk');
const OpenAI = require('openai');
const { config } = require('../config/environment');
const logger = require('../utils/logger');
const resourceDiscovery = require('../scrapers/resourceDiscovery');
const resourceVerifier = require('../verification/resourceVerifier');

// ─────────────────────────────────────────────
// Chat Processing Agent
// Main conversational interface handling:
//  - Groq LLM (llama-3.3-70b-versatile / llama-3.1-8b-instant for fast responses)
//  - NVIDIA LLM (fallback)
//  - Intent classification & context memory
//  - Developer resource lookup & formatting
// ─────────────────────────────────────────────

class ChatAgent {
  constructor() {
    this.groq = null;
    this.nvidia = null;
    this.userContext = new Map(); // Simple in-memory context store per sender
    this.refreshClients();
  }

  // ─────────────────────────────────────────
  // Process incoming user text message
  // ─────────────────────────────────────────
  async processMessage(senderId, textMessage, options = {}) {
    const startTime = Date.now();
    const { onStep } = options;

    if (onStep) onStep('● [1/3] Classifying intent & context...');

    // Maintain conversation context (last 10 messages)
    const context = this._getUserContext(senderId);
    context.push({ role: 'user', content: textMessage });

    // Trim history to prevent overflow
    if (context.length > 10) {
      context.splice(0, context.length - 10);
    }

    // Detect if user is asking for developer resources / free APIs
    const intent = this._classifyIntent(textMessage);

    // Parse and schedule reminder if requested
    const reminderParser = require('../utils/reminderParser');
    const reminder = reminderParser.parseReminder(textMessage);
    let reminderConfirm = '';

    if (reminder) {
      const gateway = require('../whatsapp/gateway');
      const reminderService = require('../scheduler/reminderService');
      const pairedPhone = gateway.myPhone || config.whatsapp.phoneNumber;
      let targetJid = senderId === 'cli_user' ? (pairedPhone ? `${pairedPhone.replace(/[^\d]/g, '')}@s.whatsapp.net` : 'cli_user') : senderId;
      targetJid = targetJid.replace(/:[\d]+@/, '@');

      let finalTask = reminder.task;
      const lowerTask = finalTask.toLowerCase();
      // If the parsed task is referential (contains "that", "it"), inherit the content of the previous user message
      if (lowerTask.includes('that') || lowerTask.includes(' it ') || lowerTask.endsWith(' it') || lowerTask === 'it' || lowerTask.length < 3) {
        const lastUserMsg = context.filter(m => m.role === 'user' && m.content !== textMessage).pop();
        if (lastUserMsg) {
          finalTask = lastUserMsg.content;
        }
      }

      reminderService.createReminder(targetJid, finalTask, reminder.durationMs);
      reminderConfirm = `✅ *Reminder Set:* I will notify you about "_${finalTask}_" in ${reminder.label}.\n\n`;
    }

    let replyText = '';

    if (intent === 'RESOURCE_LOOKUP') {
      if (onStep) onStep('● [2/3] Searching free developer tools & APIs...');
      replyText = reminderConfirm + await this._handleResourceLookup(textMessage);
    } else if (intent === 'HEALTH_CHECK') {
      if (onStep) onStep('● [2/3] Checking system health metrics...');
      replyText = reminderConfirm + '✅ *System Status:* SelfAgent Core Server is up and running smoothly!';
    } else if (reminder) {
      replyText = reminderConfirm + `🤖 _Your reminder has been registered in the system._`;
    } else {
      if (onStep) onStep('● [2/3] Groq Llama 3.3 generating response...');
      replyText = await this._generateLlmResponse(context, options);
    }

    const totalDuration = Date.now() - startTime;
    if (onStep) onStep(`● [3/3] Complete (${totalDuration}ms)`);

    context.push({ role: 'assistant', content: replyText });
    this.userContext.set(senderId, context);

    return {
      reply: replyText,
      intent,
      timestamp: new Date().toISOString()
    };
  }

  // ─────────────────────────────────────────
  // Classify intent from user message
  // ─────────────────────────────────────────
  _classifyIntent(text) {
    const lower = text.toLowerCase();
    if (
      lower.includes('resource') ||
      lower.includes('free api') ||
      lower.includes('cloud credit') ||
      lower.includes('dev tool') ||
      lower.includes('find tool') ||
      lower.includes('discount') ||
      lower.includes('deal')
    ) {
      return 'RESOURCE_LOOKUP';
    }
    if (lower.includes('ping') || lower === 'status' || lower.includes('health check')) {
      return 'HEALTH_CHECK';
    }
    return 'GENERAL_CHAT';
  }

  // ─────────────────────────────────────────
  // Handle developer resource query
  // ─────────────────────────────────────────
  async _handleResourceLookup(userQuery) {
    try {
      const resources = resourceDiscovery.discoveredResources.length > 0
        ? resourceDiscovery.discoveredResources
        : await resourceDiscovery.runDiscovery();

      if (!resources || resources.length === 0) {
        return '🤖 I currently don\'t have fresh developer resources cached. Running a discovery scan now, check back in a moment!';
      }

      const topResources = resources.slice(0, 3);
      let response = `🔥 *Top Free Developer Resources Found:*\n\n`;

      topResources.forEach((res, idx) => {
        response += `${idx + 1}. *${res.title}*\n`;
        response += `🔗 ${res.url}\n`;
        response += `📂 Type: ${res.type || 'General'}\n`;
        if (res.description) response += `📝 ${res.description.substring(0, 100)}...\n`;
        response += `\n`;
      });

      response += `💡 _Ask me for more details or specific categories like "free APIs" or "cloud credits"!_`;
      return response;

    } catch (error) {
      logger.error('Error handling resource lookup in ChatAgent:', error.message);
      return '⚠️ An error occurred while retrieving developer resources. Please try again shortly.';
    }
  }

  // ─────────────────────────────────────────
  // Generate LLM Response via Groq AI (with NVIDIA fallback)
  // ─────────────────────────────────────────
  async _generateLlmResponse(history, options = {}) {
    const selectedModel = options.model || 'llama-3.3-70b-versatile';

    const gateway = require('../whatsapp/gateway');
    const connectedPhone = gateway.myPhone || config.whatsapp.phoneNumber || 'None';

    const systemPrompt = {
      role: 'system',
      content: `You are SelfAgent, an Automated Voice & Chat Agent Backend Server.

SYSTEM CONTEXT:
- Connected WhatsApp Phone Number: ${connectedPhone} (If the user asks which WhatsApp number is connected, this is the one).

SYSTEM CAPABILITIES & GUIDELINES:
- You have FULL access to real-time tools. You CAN schedule reminders and send messages/alerts to WhatsApp in real-time.
- NEVER tell the user "I cannot send messages", "I cannot schedule reminders", or "I don't have access to real-time tools".
- If the user asks you to set a reminder or send a WhatsApp alert, tell them that the system has registered it and will send the message when due.

RESPONSE LENGTH & STYLE DIRECTIVE:
- Keep all responses SHORT, concise, punchy, and direct (maximum 2-3 sentences or clean bullet points).
- Avoid long fluff, conversational filler, or unrequested disclaimers.
- Greetings: Reply warmly and concisely: "Hello! I am SelfAgent. How can I assist you with developer resources or tasks today?"
- Tone: Professional, helpful, concise, and developer-focused.`
    };

    const messages = [systemPrompt, ...history];

    if (!this.groq && !this.nvidia) {
      this.refreshClients();
    }

    if (!this.groq && !this.nvidia) {
      return '⚠️ No Groq or NVIDIA API key is configured. Run `selfagent setup` or use `key GROQ_API_KEY <key>` / `key NVIDIA_API_KEY <key>` to configure your LLM credentials.';
    }

    // Try primary & fallback Groq models to avoid 429 Rate Limits
    const groqModelsToTry = [
      selectedModel,
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768',
      'gemma2-9b-it'
    ];
    // Remove duplicates while keeping order
    const models = [...new Set(groqModelsToTry)];

    if (this.groq) {
      for (const modelName of models) {
        try {
          const startTime = Date.now();
          logger.info(`[Groq AI] 🚀 Sending prompt to Groq API... (Model: ${modelName})`);

          const completion = await this.groq.chat.completions.create({
            model: modelName,
            messages,
            temperature: 0.5,
            max_tokens: 350
          });

          const elapsed = Date.now() - startTime;

          if (completion.choices[0]?.message?.content) {
            logger.info(`[Groq AI] ✅ Completion received successfully in ${elapsed}ms! (Model: ${modelName})`);
            return completion.choices[0].message.content.trim();
          }
        } catch (err) {
          logger.error(`[Groq AI Error - ${modelName}] ${err.message}`);
        }
      }
    }

    // Secondary: NVIDIA AI Fallback
    if (this.nvidia) {
      try {
        const startTime = Date.now();
        const nvidiaModel = options.nvidiaModel || 'meta/llama-3.3-70b-instruct';
        logger.info(`[NVIDIA AI] 🚀 Sending prompt to NVIDIA API... (Model: ${nvidiaModel})`);

        const completion = await this.nvidia.chat.completions.create({
          model: nvidiaModel,
          messages,
          temperature: 0.5,
          max_tokens: 350
        });

        const elapsed = Date.now() - startTime;

        if (completion.choices[0]?.message?.content) {
          logger.info(`[NVIDIA AI] ✅ Completion received successfully in ${elapsed}ms!`);
          return completion.choices[0].message.content.trim();
        }
      } catch (err) {
        logger.error(`[NVIDIA AI Error] ${err.message}`);
      }
    }

    const userMsg = history.length > 0 ? history[history.length - 1].content : '';
    return `⚠️ Unable to call AI provider. Check your Groq/NVIDIA API keys and network connectivity, then try again.`;
  }

  // ─────────────────────────────────────────
  // Refresh any clients after credentials change.
  // ─────────────────────────────────────────
  refreshClients() {
    const configManager = require('../utils/configManager');
    const groqKey = process.env.GROQ_API_KEY || configManager.get('GROQ_API_KEY') || '';
    const nvidiaKey = process.env.NVIDIA_API_KEY || configManager.get('NVIDIA_API_KEY') || '';
    const nvidiaBaseUrl = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';

    this.groq = (groqKey && groqKey !== 'gsk_test') ? new Groq({ apiKey: groqKey, fetch: globalThis.fetch }) : null;
    this.nvidia = (nvidiaKey && nvidiaKey !== 'nvapi_test') ? new OpenAI({ apiKey: nvidiaKey, baseURL: nvidiaBaseUrl }) : null;
  }

  // ─────────────────────────────────────────
  // Context management
  // ─────────────────────────────────────────
  _getUserContext(senderId) {
    if (!this.userContext.has(senderId)) {
      this.userContext.set(senderId, []);
    }
    return this.userContext.get(senderId);
  }

  clearUserContext(senderId) {
    this.userContext.delete(senderId);
  }

  clearAllMemory() {
    this.userContext.clear();
    logger.info('🧹 Cleared all chat memory contexts.');
  }
}

module.exports = new ChatAgent();
