const axios = require('axios');
const logger = require('../utils/logger');
const configManager = require('../utils/configManager');

class GitHubSearchService {
  constructor() {
    this.baseUrl = 'https://api.github.com';
  }

  _getToken() {
    return process.env.GITHUB_TOKEN || configManager.get('GITHUB_TOKEN') || '';
  }

  _getHeaders() {
    const token = this._getToken();
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'SelfAgent-GitHubSearch/1.0.0'
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
  }

  /**
   * Search GitHub Repositories.
   * @param {string} query - Search query (e.g. "free API key developer")
   * @param {object} options - { sort: "stars", order: "desc", perPage: 10 }
   */
  async searchRepositories(query, options = {}) {
    try {
      const perPage = options.perPage || 10;
      const sort = options.sort || 'stars';
      const order = options.order || 'desc';

      const url = `${this.baseUrl}/search/repositories?q=${encodeURIComponent(query)}&sort=${sort}&order=${order}&per_page=${perPage}`;

      const response = await axios.get(url, {
        headers: this._getHeaders(),
        timeout: 10000
      });

      const items = response.data?.items || [];
      return items.map((item) => ({
        title: item.full_name || item.name,
        name: item.name,
        owner: item.owner?.login,
        url: item.html_url,
        description: item.description || '',
        stars: item.stargazers_count || 0,
        forks: item.forks_count || 0,
        language: item.language || 'Unknown',
        topics: item.topics || [],
        source: 'github-repo',
        discoveredAt: new Date().toISOString()
      }));
    } catch (err) {
      logger.error(`GitHub repository search error: ${err.message}`);
      return [];
    }
  }

  /**
   * Search GitHub Code Snippets.
   * @param {string} query - Search query (e.g. "free tier API key")
   * @param {object} options - { perPage: 10 }
   */
  async searchCode(query, options = {}) {
    try {
      const perPage = options.perPage || 10;
      const url = `${this.baseUrl}/search/code?q=${encodeURIComponent(query)}&per_page=${perPage}`;

      const response = await axios.get(url, {
        headers: this._getHeaders(),
        timeout: 10000
      });

      const items = response.data?.items || [];
      return items.map((item) => ({
        title: `${item.repository?.full_name}: ${item.name}`,
        url: item.html_url,
        path: item.path,
        repository: item.repository?.full_name,
        source: 'github-code',
        discoveredAt: new Date().toISOString()
      }));
    } catch (err) {
      logger.error(`GitHub code search error: ${err.message}`);
      return [];
    }
  }

  /**
   * Search GitHub Issues and Discussions.
   * @param {string} query - Search query
   * @param {object} options - { perPage: 10 }
   */
  async searchIssues(query, options = {}) {
    try {
      const perPage = options.perPage || 10;
      const url = `${this.baseUrl}/search/issues?q=${encodeURIComponent(query)}&per_page=${perPage}`;

      const response = await axios.get(url, {
        headers: this._getHeaders(),
        timeout: 10000
      });

      const items = response.data?.items || [];
      return items.map((item) => ({
        title: item.title,
        url: item.html_url,
        body: (item.body || '').substring(0, 400),
        state: item.state,
        user: item.user?.login,
        commentsCount: item.comments || 0,
        source: 'github-issue',
        discoveredAt: new Date().toISOString()
      }));
    } catch (err) {
      logger.error(`GitHub issue search error: ${err.message}`);
      return [];
    }
  }

  /**
   * Fetch raw README file content for a repository.
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   */
  async fetchReadme(owner, repo) {
    try {
      const url = `${this.baseUrl}/repos/${owner}/${repo}/readme`;
      const response = await axios.get(url, {
        headers: {
          ...this._getHeaders(),
          'Accept': 'application/vnd.github.v3.raw'
        },
        timeout: 8000
      });

      return typeof response.data === 'string' ? response.data.substring(0, 3000) : '';
    } catch (err) {
      logger.debug(`Failed to fetch README for ${owner}/${repo}: ${err.message}`);
      return '';
    }
  }
}

module.exports = new GitHubSearchService();
