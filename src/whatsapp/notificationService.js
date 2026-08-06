const whatsappGateway = require('./gateway');
const { formatResourceForWhatsApp } = require('../utils/helpers');
const logger = require('../utils/logger');

class NotificationService {
  constructor() {
    this.subscribers = new Set();
  }

  subscribe(phoneNumber) {
    this.subscribers.add(phoneNumber);
    logger.info(`Subscribed phone number for alerts: ${phoneNumber}`);
  }

  unsubscribe(phoneNumber) {
    this.subscribers.delete(phoneNumber);
    logger.info(`Unsubscribed phone number from alerts: ${phoneNumber}`);
  }

  async sendResourceAlert(phoneNumber, resource) {
    const formattedText = formatResourceForWhatsApp(resource);
    return whatsappGateway.sendMessage(phoneNumber, formattedText);
  }

  async broadcastVerifiedResources(resources) {
    if (!resources || resources.length === 0) return;

    if (this.subscribers.size === 0) {
      const defaultPhone = whatsappGateway.myPhone || process.env.WHATSAPP_PHONE_NUMBER;
      if (defaultPhone) {
        this.subscribers.add(defaultPhone);
      }
    }

    if (this.subscribers.size === 0) {
      logger.info('No active WhatsApp subscribers to broadcast resource updates to.');
      return;
    }

    logger.info(`Broadcasting ${resources.length} resources to ${this.subscribers.size} subscribers...`);

    let digest = `🔥 *Live Developer Resource Feed (${resources.length} Found)*\n\n`;
    resources.slice(0, 5).forEach((r, idx) => {
      digest += `${idx + 1}. *${r.title}*\n🔗 ${r.url}\n\n`;
    });
    digest += `💡 _Automated Live Feed by SelfAgent_`;

    for (const recipient of this.subscribers) {
      try {
        await whatsappGateway.sendMessage(recipient, digest);
      } catch (error) {
        logger.error(`Broadcast to ${recipient} failed:`, error.message);
      }
    }
  }

  async sendDailyDigest(phoneNumber, resources) {
    let digest = `🌅 *Daily Developer Resource Digest*\n\n`;
    digest += `Found ${resources.length} top verified tools & deals today:\n\n`;

    resources.slice(0, 5).forEach((r, idx) => {
      digest += `${idx + 1}. *${r.title}*\n🔗 ${r.url}\n\n`;
    });

    digest += `Have a productive coding day! 🚀`;

    return whatsappGateway.sendMessage(phoneNumber, digest);
  }
}

module.exports = new NotificationService();
