const logger = require('./logger');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function retryWithBackoff(fn, maxRetries = 3, baseDelayMs = 1000) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);

      logger.warn(`Attempt ${attempt}/${maxRetries} failed: ${error.message}. Retrying in ${delay}ms...`);

      if (attempt < maxRetries) {
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

function sanitizeText(text) {
  if (!text) return '';
  return text
    .replace(/\s+/g, ' ')
    .replace(/[\r\n]+/g, '\n')
    .replace(/[^\x20-\x7E\n]/g, '')
    .trim();
}

function extractUrls(text) {
  if (!text) return [];
  const urlRegex = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi;
  return [...new Set(text.match(urlRegex) || [])];
}

function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function formatResourceForWhatsApp(resource) {
  const lines = [
    `🔥 *New Developer Resource Found!*`,
    ``,
    `📌 *Title:* ${resource.title || 'N/A'}`,
    `🔗 *Link:* ${resource.url || 'N/A'}`,
    `📂 *Type:* ${resource.type || 'General'}`,
    `✅ *Verified:* ${resource.verified ? 'Yes' : 'Pending'}`,
    `📝 *Summary:* ${resource.summary || resource.description || 'No description available'}`,
    ``,
    `⏰ Found at: ${new Date().toLocaleString()}`
  ];
  return lines.join('\n');
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

module.exports = {
  sleep,
  retryWithBackoff,
  sanitizeText,
  extractUrls,
  isValidUrl,
  formatResourceForWhatsApp,
  chunkArray
};
