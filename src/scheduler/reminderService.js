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
  createReminder(senderId, task, durationMs, type = 'reminder') {
    const triggerTime = Date.now() + durationMs;
    const reminder = {
      id: Math.random().toString(36).substring(2, 9),
      senderId,
      task,
      triggerTime,
      createdTime: Date.now(),
      triggered: false,
      type
    };

    this.reminders.push(reminder);
    this.saveReminders();
    logger.info(`🔔 Created ${type}: "${task}" for sender ${senderId} to trigger at ${new Date(triggerTime).toISOString()}`);
    return reminder;
  }

  /**
   * Check all pending reminders and send WhatsApp alerts when due.
   */
  async checkAndTriggerReminders() {
    const now = Date.now();
    let dirty = false;

    // Use a copy to safely handle array insertions during loops
    const activeReminders = [...this.reminders];

    for (const reminder of activeReminders) {
      if (!reminder.triggered && now >= reminder.triggerTime) {
        if (gateway.isReady) {
          reminder.triggered = true;
          dirty = true;
          logger.info(`⏰ Triggering alert for ${reminder.type}: "${reminder.task}" for ${reminder.senderId}`);

          try {
            if (reminder.type === 'followup') {
              const checkMessage = `📝 *SelfAgent Productivity Check-in!*\n\n` +
                                   `Have you completed the task you set?\n` +
                                   `👉 _${reminder.task}_\n\n` +
                                   `Reply to let me know! Keep up the momentum! 🚀`;
              await gateway.sendMessage(reminder.senderId, checkMessage);
              logger.info(`✅ Sent productivity follow-up message to ${reminder.senderId}`);
            } else {
              const alertMessage = `⏰ *SelfAgent Reminder Alert!*\n\n` +
                                   `You asked me to remind you about:\n` +
                                   `👉 _${reminder.task}_\n\n` +
                                   `⏰ Set on: ${new Date(reminder.createdTime).toLocaleTimeString()}`;

              await gateway.sendMessage(reminder.senderId, alertMessage);
              logger.info(`✅ Sent reminder WhatsApp message successfully to ${reminder.senderId}`);

              // Automatically schedule a productivity follow-up check-in 2 minutes later for testing
              const followUpDelayMs = 2 * 60 * 1000;
              this.createReminder(reminder.senderId, reminder.task, followUpDelayMs, 'followup');
            }
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
