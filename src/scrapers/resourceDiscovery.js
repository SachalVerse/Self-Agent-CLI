const webScraper = require('./webScraper');
const configManager = require('../utils/configManager');
const { sleep } = require('../utils/helpers');
const logger = require('../utils/logger');
const NodeCache = require('node-cache');

const discoveryCache = new NodeCache({ stdTTL: 3600 });

const DEFAULT_GITHUB_QUERIES = [
  'free API key developer',
  'free cloud credits 2024',
  'open source developer tools',
  'free tier API service',
  'developer free resources'
];

const DEFAULT_RESOURCE_PAGES = [
  'https://free-for.dev/',
  'https://github.com/ripienaar/free-for-dev',
  'https://github.com/255kb/stack-on-a-budget'
];

class ResourceDiscovery {
  constructor() {
    this.discoveredResources = [];
    this.seenUrls = new Set();
  }

  async runDiscovery() {
    logger.info('🔍 Starting resource discovery cycle...');
    const allResources = [];

    const [redditResults, githubResults, pageResults] = await Promise.allSettled([
      this._discoverFromReddit(),
      this._discoverFromGitHub(),
      this._discoverFromResourcePages()
    ]);

    for (const result of [redditResults, githubResults, pageResults]) {
      if (result.status === 'fulfilled') {
        allResources.push(...(result.value || []));
      } else {
        logger.warn('Discovery source failed:', result.reason?.message);
      }
    }

    const unique = this._deduplicateResources(allResources);
    this.discoveredResources = unique;
    logger.info(`✅ Discovery complete. Found ${unique.length} unique resources`);

    return unique;
  }

  get searchPreferences() {
    return configManager.get('SEARCH_PREFERENCES') || {
      searchDepth: 2,
      timeoutMs: 10000,
      subreddits: ['webdev', 'programming', 'learnprogramming', 'devops', 'MachineLearning'],
      repositories: ['free-for-dev', 'ripienaar/free-for-dev']
    };
  }

  async _discoverFromReddit() {
    const redditSearchService = require('./redditSearchService');
    const subreddits = Array.isArray(this.searchPreferences.subreddits) && this.searchPreferences.subreddits.length > 0
      ? this.searchPreferences.subreddits
      : ['webdev', 'programming', 'learnprogramming', 'devops', 'MachineLearning'];

    const resources = await redditSearchService.search('free', { subreddits, limit: 10 });
    logger.info(`Reddit: Found ${resources.length} relevant posts`);
    return resources;
  }

  async _discoverFromGitHub() {
    const githubSearchService = require('./githubSearchService');
    const repositories = Array.isArray(this.searchPreferences.repositories) && this.searchPreferences.repositories.length > 0
      ? this.searchPreferences.repositories
      : ['free-for-dev', 'ripienaar/free-for-dev'];

    const queries = [...DEFAULT_GITHUB_QUERIES, ...repositories];
    const resources = [];

    for (const query of queries) {
      const repos = await githubSearchService.searchRepositories(query, { perPage: 10 });
      resources.push(...repos);
      await sleep(1000);
    }

    logger.info(`GitHub: Found ${resources.length} repositories`);
    return resources;
  }

  async _discoverFromResourcePages() {
    const resources = [];

    const resourcePages = Array.isArray(this.searchPreferences.resourcePages) && this.searchPreferences.resourcePages.length > 0
      ? this.searchPreferences.resourcePages
      : DEFAULT_RESOURCE_PAGES;

    for (const url of resourcePages) {
      const cacheKey = `page_${url}`;
      if (discoveryCache.has(cacheKey)) {
        resources.push(...discoveryCache.get(cacheKey));
        continue;
      }

      const pageData = await webScraper.scrape(url);
      if (!pageData) continue;

      const relevantLinks = pageData.links
        .filter((link) => this._isResourceRelated(link.text))
        .map((link) => ({
          title: link.text || 'Unnamed Resource',
          url: link.url,
          type: this._classifyResource(link.text),
          source: 'resource-page',
          sourceUrl: url,
          discoveredAt: new Date().toISOString()
        }));

      discoveryCache.set(cacheKey, relevantLinks);
      resources.push(...relevantLinks);
    }

    logger.info(`Resource Pages: Found ${resources.length} links`);
    return resources;
  }

  _isResourceRelated(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    const keywords = [
      'free', 'api key', 'cloud credit', 'open source',
      'framework', 'tool', 'sdk', 'library', 'developer',
      'launch', 'beta', 'early access', 'free tier',
      'no credit card', 'open beta', 'free plan'
    ];
    return keywords.some((kw) => lower.includes(kw));
  }

  _classifyResource(text) {
    if (!text) return 'general';
    const lower = text.toLowerCase();
    if (lower.includes('api')) return 'free-api';
    if (lower.includes('credit') || lower.includes('cloud')) return 'cloud-credits';
    if (lower.includes('framework') || lower.includes('library')) return 'framework';
    if (lower.includes('tool') || lower.includes('cli')) return 'developer-tool';
    if (lower.includes('course') || lower.includes('tutorial')) return 'learning';
    return 'general';
  }

  _deduplicateResources(resources) {
    const seen = new Set();
    return resources.filter((resource) => {
      const key = resource.url || resource.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

module.exports = new ResourceDiscovery();
