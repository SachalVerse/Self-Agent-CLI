const os = require('os');
const axios = require('axios');
const { config } = require('../config/environment');
const logger = require('../utils/logger');

class HealthMonitor {
  constructor() {
    this.startTime = Date.now();
    this.errorCount = 0;
    this.lastCheck = null;
  }

  recordError(error) {
    this.errorCount++;
    logger.debug(`HealthMonitor recorded error count: ${this.errorCount}`);
  }

  async getHealthStatus() {
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    const memoryUsage = process.memoryUsage();
    const systemMemory = {
      free: Math.round(os.freemem() / (1024 * 1024)),
      total: Math.round(os.totalmem() / (1024 * 1024))
    };

    const [groqStatus, githubStatus] = await Promise.all([
      this._checkGroqHealth(),
      this._checkGithubHealth()
    ]);

    const status = {
      status: 'HEALTHY',
      timestamp: new Date().toISOString(),
      uptimeSeconds,
      formattedUptime: this._formatUptime(uptimeSeconds),
      processMemoryMb: {
        rss: Math.round(memoryUsage.rss / (1024 * 1024)),
        heapTotal: Math.round(memoryUsage.heapTotal / (1024 * 1024)),
        heapUsed: Math.round(memoryUsage.heapUsed / (1024 * 1024))
      },
      systemMemoryMb: systemMemory,
      errorCount: this.errorCount,
      services: {
        groqApi: groqStatus,
        githubApi: githubStatus
      }
    };

    this.lastCheck = status;
    return status;
  }

  async _checkGroqHealth() {
    if (!config.ai.groqApiKey) return 'NOT_CONFIGURED';
    try {
      const response = await axios.get('https://api.groq.com/openai/v1/models', {
        headers: { 'Authorization': `Bearer ${config.ai.groqApiKey}` },
        timeout: 5000
      });
      return response.status === 200 ? 'CONNECTED' : 'DEGRADED';
    } catch {
      return 'UNREACHABLE';
    }
  }

  async _checkGithubHealth() {
    try {
      const response = await axios.get('https://api.github.com/zen', {
        headers: { 'User-Agent': 'AutomatedAgentServer/1.0' },
        timeout: 5000
      });
      return response.status === 200 ? 'CONNECTED' : 'DEGRADED';
    } catch {
      return 'UNREACHABLE';
    }
  }

  _formatUptime(seconds) {
    const days = Math.floor(seconds / (3600 * 24));
    const hours = Math.floor((seconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${days}d ${hours}h ${minutes}m ${secs}s`;
  }
}

module.exports = new HealthMonitor();
