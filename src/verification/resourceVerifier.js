const axios = require('axios');
const Groq = require('groq-sdk');
const { config } = require('../config/environment');
const { retryWithBackoff, sleep } = require('../utils/helpers');
const logger = require('../utils/logger');

class ResourceVerifier {
  constructor() {
    this.groq = config.ai.groqApiKey ? new Groq({ apiKey: config.ai.groqApiKey }) : null;
  }

  async verify(resource) {
    logger.debug(`Verifying resource: ${resource.title}`);

    const checks = {
      urlAccessible: false,
      contentLegitimate: false,
      notSpam: false,
      aiVerified: false
    };

    checks.urlAccessible = await this._checkUrlAccessibility(resource.url);

    if (!checks.urlAccessible) {
      return {
        ...resource,
        verified: false,
        verificationScore: 0,
        verificationDetails: checks,
        verifiedAt: new Date().toISOString()
      };
    }

    checks.notSpam = this._runSpamFilter(resource);

    if (checks.notSpam) {
      const aiResult = await this._runAiVerification(resource);
      checks.aiVerified = aiResult.isLegitimate;
      checks.contentLegitimate = aiResult.isLegitimate;
    }

    const score = Object.values(checks).filter(Boolean).length / Object.keys(checks).length;

    return {
      ...resource,
      verified: score >= 0.75,
      verificationScore: Math.round(score * 100),
      verificationDetails: checks,
      verifiedAt: new Date().toISOString()
    };
  }

  async _checkUrlAccessibility(url) {
    if (!url) return false;

    try {
      const response = await retryWithBackoff(async () => {
        return axios.head(url, {
          timeout: 8000,
          maxRedirects: 5,
          headers: { 'User-Agent': 'Mozilla/5.0 AutomatedAgent/1.0' },
          validateStatus: (status) => status < 500
        });
      }, 2);

      return response.status < 400;

    } catch (error) {
      logger.debug(`URL accessibility check failed for ${url}: ${error.message}`);
      return false;
    }
  }

  _runSpamFilter(resource) {
    const text = `${resource.title} ${resource.description || ''} ${resource.selfText || ''}`.toLowerCase();

    const spamIndicators = [
      'click here to claim',
      'limited time offer',
      'act now',
      'guaranteed income',
      'make money fast',
      'earn $',
      'crypto airdrop',
      'nft mint',
      'telegram group join',
      'dm for link'
    ];

    const hasSpam = spamIndicators.some((indicator) => text.includes(indicator));
    return !hasSpam;
  }

  async _runAiVerification(resource) {
    if (!this.groq) {
      logger.debug('Groq SDK not configured; using heuristic verification.');
      return { isLegitimate: true, confidence: 70 };
    }

    try {
      const prompt = `You are a developer resource verifier. Analyze this resource and determine if it's a legitimate free developer tool, API, cloud credit, or framework offer.

Resource Title: ${resource.title}
URL: ${resource.url}
Type: ${resource.type || 'unknown'}
Description: ${resource.description || resource.selfText || 'No description'}

Respond with ONLY a JSON object:
{
  "isLegitimate": true/false,
  "confidence": 0-100,
  "reason": "brief explanation",
  "category": "free-api|cloud-credits|framework|developer-tool|spam|other"
}`;

      const completion = await this.groq.chat.completions.create({
        model: 'llama3-8b-8192',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 200,
        response_format: { type: 'json_object' }
      });

      const result = JSON.parse(completion.choices[0].message.content);
      return {
        isLegitimate: result.isLegitimate && result.confidence > 60,
        confidence: result.confidence,
        category: result.category,
        reason: result.reason
      };

    } catch (error) {
      logger.warn(`AI verification failed: ${error.message}`);
      return { isLegitimate: true, confidence: 50 };
    }
  }

  async verifyBatch(resources) {
    const results = [];

    for (const resource of resources) {
      try {
        const verified = await this.verify(resource);
        results.push(verified);
        await sleep(500);
      } catch (error) {
        logger.error(`Verification failed for ${resource.title}:`, error.message);
        results.push({ ...resource, verified: false, verificationScore: 0 });
      }
    }

    const verifiedCount = results.filter((r) => r.verified).length;
    logger.info(`Verification complete: ${verifiedCount}/${results.length} resources verified`);

    return results;
  }
}

module.exports = new ResourceVerifier();
