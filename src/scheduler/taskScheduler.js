const cron = require('node-cron');
const { config } = require('../config/environment');
const resourceDiscovery = require('../scrapers/resourceDiscovery');
const resourceVerifier = require('../verification/resourceVerifier');
const notificationService = require('../whatsapp/notificationService');
const healthMonitor = require('../health/healthMonitor');
const logger = require('../utils/logger');

class TaskScheduler {
  constructor() {
    this.tasks = [];
  }

  startAll() {
    logger.info('⏰ Initializing Task Scheduler...');

    this._scheduleJob(
      'Resource Discovery',
      config.scheduler.discoveryInterval,
      async () => {
        logger.info('🔄 [CRON] Triggering automated resource discovery & verification...');
        try {
          const rawResources = await resourceDiscovery.runDiscovery();
          const verifiedResources = await resourceVerifier.verifyBatch(rawResources);

          const newlyVerified = verifiedResources.filter((r) => r.verified);
          if (newlyVerified.length > 0) {
            await notificationService.broadcastVerifiedResources(newlyVerified.slice(0, 3));
          }

          logger.info(`✅ [CRON] Discovery task completed. ${newlyVerified.length} verified resources ready.`);
        } catch (error) {
          logger.error('❌ [CRON] Resource Discovery task failed:', error.message);
          healthMonitor.recordError(error);
        }
      }
    );

    this._scheduleJob(
      'Health Check',
      config.scheduler.healthCheckInterval,
      async () => {
        logger.debug('🩺 [CRON] Running health check cycle...');
        try {
          const status = await healthMonitor.getHealthStatus();
          logger.debug(`Health status: Memory Heap ${status.processMemoryMb.heapUsed}MB / Error Count: ${status.errorCount}`);
        } catch (error) {
          logger.error('❌ [CRON] Health Check task failed:', error.message);
        }
      }
    );

    this._scheduleJob(
      'Reminder Check',
      '* * * * *',
      async () => {
        logger.debug('🔔 [CRON] Checking pending reminders & notifications...');
        try {
          const reminderService = require('./reminderService');
          await reminderService.checkAndTriggerReminders();
        } catch (err) {
          logger.error('Error running reminder check job:', err.message);
        }
      }
    );

    logger.info(`✅ Task Scheduler active with ${this.tasks.length} scheduled tasks.`);
  }

  _scheduleJob(name, cronExpression, jobFn) {
    if (!cron.validate(cronExpression)) {
      logger.error(`Invalid cron expression "${cronExpression}" for task "${name}". Task skipped.`);
      return;
    }

    const task = cron.schedule(cronExpression, jobFn);
    this.tasks.push({ name, cronExpression, task });
    logger.info(`Scheduled job: "${name}" [Cron: ${cronExpression}]`);
  }

  async triggerLiveFeedNow() {
    logger.info('🚀 Triggering manual live resource discovery feed...');
    const rawResources = await resourceDiscovery.runDiscovery();
    const verifiedResources = await resourceVerifier.verifyBatch(rawResources);
    const newlyVerified = verifiedResources.filter((r) => r.verified);
    const resourcesToSend = newlyVerified.length > 0 ? newlyVerified : rawResources;
    if (resourcesToSend.length > 0) {
      await notificationService.broadcastVerifiedResources(resourcesToSend.slice(0, 5));
    }
    return resourcesToSend;
  }

  setLiveFeedTimer(intervalMinutes) {
    const mins = parseInt(intervalMinutes, 10) || 15;
    const cronExpr = `*/${mins} * * * *`;

    const existingIdx = this.tasks.findIndex((t) => t.name === 'Resource Discovery');
    if (existingIdx !== -1) {
      this.tasks[existingIdx].task.stop();
      this.tasks.splice(existingIdx, 1);
    }

    this._scheduleJob('Resource Discovery', cronExpr, async () => {
      await this.triggerLiveFeedNow();
    });

    logger.info(`⏰ Updated live resource feed timer: Every ${mins} minutes [Cron: ${cronExpr}]`);
    return mins;
  }

  stopAll() {
    logger.info('Stopping all scheduled background tasks...');
    for (const { name, task } of this.tasks) {
      task.stop();
      logger.debug(`Stopped task: ${name}`);
    }
    this.tasks = [];
  }
}

module.exports = new TaskScheduler();
