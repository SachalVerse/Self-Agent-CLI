const fs = require('fs');
const path = require('path');
const os = require('os');
const gateway = require('../whatsapp/gateway');
const logger = require('../utils/logger');

const REMINDERS_FILE = path.join(os.homedir(), '.selfagent/config/reminders.json');

class ReminderService {
  constructor() {
    this.reminders = [];
    this.loadReminders();
  }

  loadReminders() {
    try {
      const dir = path.dirname(REMINDERS_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (fs.existsSync(REMINDERS_FILE)) {
        this.reminders = JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf8'));
      } else {
        this.reminders = [];
      }
    } catch (err) {
      logger.error('Failed to load reminders:', err.message);
      this.reminders = [];
    }
  }

  saveReminders() {
    try {
      fs.writeFileSync(REMINDERS_FILE, JSON.stringify(this.reminders, null, 2), 'utf8');
    } catch (err) {
      logger.error('Failed to save reminders:', err.message);
    }
  }

  /**
   * Create a new reminder.
   */
  createReminder(senderId, task, durationMs) {
    const triggerTime = Date.now() + durationMs;
    const reminder = {
      id: Math.random().toString(36).substring(2, 9),
      senderId,
      task,
      triggerTime,
      createdTime: Date.now(),
      triggered: false
    };

    this.reminders.push(reminder);
    this.saveReminders();
    logger.info(`🔔 Created reminder: "${task}" for sender ${senderId} to trigger at ${new Date(triggerTime).toISOString()}`);
    return reminder;
  }

  /**
   * Check all pending reminders and send WhatsApp alerts when due.
   */
  async checkAndTriggerReminders() {
    const now = Date.now();
    let dirty = false;

    for (const reminder of this.reminders) {
      if (!reminder.triggered && now >= reminder.triggerTime) {
        if (gateway.isReady) {
          reminder.triggered = true;
          dirty = true;
          logger.info(`⏰ Triggering reminder alert: "${reminder.task}" for ${reminder.senderId}`);

          try {
            const alertMessage = `⏰ *SelfAgent Reminder Alert!*\n\n` +
                                 `You asked me to remind you about:\n` +
                                 `👉 _${reminder.task}_\n\n` +
                                 `⏰ Set on: ${new Date(reminder.createdTime).toLocaleTimeString()}`;

            await gateway.sendMessage(reminder.senderId, alertMessage);
            logger.info(`✅ Sent reminder WhatsApp message successfully to ${reminder.senderId}`);
          } catch (err) {
            logger.error(`❌ Failed to send reminder to ${reminder.senderId}:`, err.message);
          }
        } else {
          logger.warn(`⚠️ WhatsApp gateway not connected. Retrying reminder for ${reminder.senderId} once connection is restored.`);
        }
      }
    }

    if (dirty) {
      // Remove triggered reminders
      this.reminders = this.reminders.filter((r) => !r.triggered);
      this.saveReminders();
    }
  }
}

module.exports = new ReminderService();
