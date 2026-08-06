const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');
const configManager = require('../utils/configManager');

const USER_AGENT = 'desktop:my-agent-app:v1.0.0 (by /u/appuser)';

class RedditSearchService {
  constructor() {
    this.defaultSubreddits = ['webdev', 'programming', 'learnprogramming', 'devops', 'MachineLearning'];
  }

  _getSubreddits() {
    const prefs = configManager.get('SEARCH_PREFERENCES') || {};
    return (prefs.subreddits && prefs.subreddits.length > 0) ? prefs.subreddits : this.defaultSubreddits;
  }

  /**
   * Execute a targeted search across configured subreddits.
   * @param {string} query - Search term
   * @param {object} options - { limit: 10, subreddits: [] }
   */
  async search(query, options = {}) {
    const subreddits = options.subreddits || this._getSubreddits();
    const limit = options.limit || 10;
    const results = [];

    for (const subreddit of subreddits) {
      try {
        const posts = await this.searchSubreddit(subreddit, query, limit);
        results.push(...posts);
      } catch (err) {
        logger.debug(`Reddit search failed for r/${subreddit}: ${err.message}`);
      }
    }

    return results;
  }

  /**
   * Search a specific subreddit via Reddit JSON API with old.reddit & HTML fallback.
   */
  async searchSubreddit(subreddit, query = '', limit = 10) {
    const searchUrl = query
      ? `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&sort=new&restrict_sr=1&limit=${limit}`
      : `https://www.reddit.com/r/${subreddit}/new.json?limit=${limit}`;

    const oldUrl = query
      ? `https://old.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&sort=new&restrict_sr=1&limit=${limit}`
      : `https://old.reddit.com/r/${subreddit}/new.json?limit=${limit}`;

    const urlsToTry = [searchUrl, oldUrl];

    for (const url of urlsToTry) {
      try {
        const response = await axios.get(url, {
          headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'application/json, text/plain, */*'
          },
          timeout: 8000
        });

        if (response.data && response.data.data && response.data.data.children) {
          return this._parseJsonPosts(response.data.data.children);
        }
      } catch (err) {
        logger.debug(`JSON endpoint failed for ${url}: ${err.message}`);
      }
    }

    // HTML Parsing Fallback using Cheerio
    return this._scrapeHtmlFallback(subreddit, query);
  }

  _parseJsonPosts(children) {
    return children.map((item) => {
      const data = item.data || {};
      return {
        title: data.title || '',
        url: data.url || `https://reddit.com${data.permalink}`,
        selfText: (data.selftext || '').substring(0, 500),
        permalink: `https://reddit.com${data.permalink}`,
        subreddit: data.subreddit,
        score: data.score || 0,
        numComments: data.num_comments || 0,
        author: data.author || '',
        createdUtc: data.created_utc,
        source: 'reddit',
        discoveredAt: new Date().toISOString()
      };
    });
  }

  /**
   * Fallback HTML scraper for r/{subreddit} using Cheerio
   */
  async _scrapeHtmlFallback(subreddit, query = '') {
    try {
      const targetUrl = query
        ? `https://old.reddit.com/r/${subreddit}/search?q=${encodeURIComponent(query)}&sort=new`
        : `https://old.reddit.com/r/${subreddit}/new`;

      const response = await axios.get(targetUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml'
        },
        timeout: 10000
      });

      const $ = cheerio.load(response.data);
      const posts = [];

      $('.thing.link').each((i, el) => {
        if (i >= 10) return;
        const titleEl = $(el).find('a.title');
        const title = titleEl.text().trim();
        const href = titleEl.attr('href');
        const permalink = $(el).attr('data-permalink') ? `https://old.reddit.com${$(el).attr('data-permalink')}` : '';
        const score = parseInt($(el).attr('data-score') || '0', 10);
        const author = $(el).attr('data-author') || '';

        if (title) {
          posts.push({
            title,
            url: href && href.startsWith('/') ? `https://old.reddit.com${href}` : href,
            selfText: '',
            permalink,
            subreddit,
            score,
            numComments: 0,
            author,
            source: 'reddit-html',
            discoveredAt: new Date().toISOString()
          });
        }
      });

      return posts;
    } catch (err) {
      logger.debug(`HTML fallback failed for r/${subreddit}: ${err.message}`);
      return [];
    }
  }
}

module.exports = new RedditSearchService();
