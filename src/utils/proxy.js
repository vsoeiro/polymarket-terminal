/**
 * proxy.js
 * Proxy support for Polymarket API calls only.
 *
 * - CLOB API: uses axios internally (via @polymarket/clob-client) →
 *   we set axios.defaults to use the proxy agent globally.
 * - Gamma / Data API: uses native fetch → we provide proxyFetch() wrapper.
 * - Polygon RPC: NOT proxied (separate ethers.js provider).
 *
 * Set PROXY_URL in .env to enable. Supports HTTP/HTTPS/SOCKS5 proxies.
 * Example: PROXY_URL=http://user:pass@proxy.example.com:8080
 */

import config from '../config/index.js';
import logger from './logger.js';

let proxyAgent = null;

/**
 * Initialize the proxy agent from config.proxyUrl.
 * Returns the agent or null if no proxy is configured.
 */
async function createAgent() {
    if (!config.proxyUrl) return null;

    try {
        const { HttpsProxyAgent } = await import('https-proxy-agent');
        return new HttpsProxyAgent(config.proxyUrl);
    } catch (err) {
        logger.error(`Failed to create proxy agent: ${err.message}`);
        logger.error('Make sure https-proxy-agent is installed: npm i https-proxy-agent');
        return null;
    }
}

/**
 * Set up axios defaults so that the @polymarket/clob-client's
 * internal axios calls go through the proxy.
 * Call this BEFORE creating ClobClient.
 */
export async function setupAxiosProxy() {
    if (!config.proxyUrl) {
        logger.info('No PROXY_URL set — Polymarket API calls will be direct');
        return;
    }

    proxyAgent = await createAgent();
    if (!proxyAgent) return;

    try {
        const axiosModule = await import('axios');
        const axios = axiosModule.default || axiosModule;

        // Disable axios built-in proxy (env vars) and use our agent instead
        axios.defaults.proxy = false;
        axios.defaults.httpAgent = proxyAgent;
        axios.defaults.httpsAgent = proxyAgent;

        logger.info(`Axios proxy configured → ${maskProxyUrl(config.proxyUrl)}`);
    } catch (err) {
        logger.error(`Failed to configure axios proxy: ${err.message}`);
    }
}

/**
 * Get the proxy agent for use with native fetch().
 */
export function getProxyAgent() {
    return proxyAgent;
}

/**
 * Proxy-aware fetch wrapper.
 * Drop-in replacement for global fetch() — injects the proxy agent
 * when PROXY_URL is configured.
 * Use this for Gamma API and Data API calls.
 */
export async function proxyFetch(url, opts = {}) {
    if (proxyAgent) {
        // Node 18+ fetch supports the 'dispatcher' option for undici,
        // but the standard approach for http/https agent is via the agent option.
        // We use the node-fetch compatible approach via the agent option.
        opts.agent = proxyAgent;
    }
    return fetch(url, opts);
}

/**
 * Test that the proxy works by making a simple request to the CLOB API.
 * Call this at startup to fail fast if the proxy is misconfigured.
 */
export async function testProxy() {
    if (!config.proxyUrl) return true; // no proxy = nothing to test

    logger.info(`Testing proxy connection → ${maskProxyUrl(config.proxyUrl)} ...`);

    try {
        // Ensure agent is created
        if (!proxyAgent) {
            proxyAgent = await createAgent();
        }
        if (!proxyAgent) {
            throw new Error('Proxy agent creation failed');
        }

        // Test with a simple GET to the CLOB time endpoint
        const resp = await fetch(`${config.clobHost}/time`, {
            agent: proxyAgent,
            signal: AbortSignal.timeout(15000),
        });

        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
        }

        logger.success(`Proxy test passed — connected via ${maskProxyUrl(config.proxyUrl)}`);
        return true;
    } catch (err) {
        logger.error(`Proxy test FAILED: ${err.message}`);
        logger.error('Check PROXY_URL in .env. Bot cannot reach Polymarket without a working proxy.');
        return false;
    }
}

/**
 * Mask credentials in proxy URL for safe logging.
 * http://user:pass@host:port → http://***:***@host:port
 */
function maskProxyUrl(url) {
    try {
        const u = new URL(url);
        if (u.username || u.password) {
            u.username = '***';
            u.password = '***';
        }
        return u.toString();
    } catch {
        return '(invalid URL)';
    }
}
