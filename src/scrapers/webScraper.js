const axios = require('axios');
const cheerio = require('cheerio');
const { config } = require('../config/environment');
const { sleep, retryWithBackoff, sanitizeText, isValidUrl } = require('../utils/helpers');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────
// Core Web Scraper Module
// Fast, lightweight Axios + Cheerio HTTP scraper
// (No heavy browser download required!)
// ─────────────────────────────────────────────

class WebScraper {
  constructor() {
    this.usePlaywright = config.scraping.usePlaywright;
    this.delayMs = config.scraping.delayMs;
    this.maxRetries = config.scraping.maxRetries;
    this.browser = null;

    this.defaultHeaders = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache'
    };
  }

  async scrape(url, options = {}) {
    if (!isValidUrl(url)) {
      logger.warn(`Invalid URL skipped: ${url}`);
      return null;
    }

    logger.debug(`Scraping: ${url}`);
    await sleep(this.delayMs);

    return retryWithBackoff(
      () => this._scrapeWithAxios(url, options),
      this.maxRetries
    );
  }

  async _scrapeWithAxios(url, options = {}) {
    try {
      const response = await axios.get(url, {
        headers: { ...this.defaultHeaders, ...options.headers },
        timeout: options.timeout || 15000,
        maxRedirects: 5,
        validateStatus: (status) => status < 500
      });

      if (response.status === 429) {
        logger.warn(`Rate limited by ${url}. Waiting 15 seconds...`);
        await sleep(15000);
        throw new Error('Rate limited');
      }

      const $ = cheerio.load(response.data);
      return this._extractPageData($, url);

    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        logger.warn(`Connection refused for: ${url}`);
        return null;
      }
      throw error;
    }
  }

  _extractPageData($, url) {
    $('script, style, nav, footer, iframe, ads, .ad, .advertisement').remove();

    const title = $('title').text() || $('h1').first().text() || 'Untitled';

    const description =
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      $('p').first().text() || '';

    const bodyText = sanitizeText($('body').text());

    const links = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        try {
          const absoluteUrl = new URL(href, url).toString();
          links.push({ url: absoluteUrl, text });
        } catch {
          // Skip invalid URL
        }
      }
    });

    return {
      url,
      title: sanitizeText(title),
      description: sanitizeText(description),
      bodyText: bodyText.substring(0, 5000),
      links: links.slice(0, 100),
      scrapedAt: new Date().toISOString()
    };
  }

  async scrapeMultiple(urls, concurrency = config.scraping.concurrency) {
    const results = [];
    for (let i = 0; i < urls.length; i += concurrency) {
      const batch = urls.slice(i, i + concurrency);
      const batchResults = await Promise.allSettled(batch.map((url) => this.scrape(url)));
      for (const res of batchResults) {
        if (res.status === 'fulfilled' && res.value) {
          results.push(res.value);
        }
      }
    }
    return results;
  }

  async close() {
    // Cleanup if needed
  }
}

module.exports = new WebScraper();
