/**
 * proxy.js
 * Proxy support for Polymarket API calls only.
 *
 * - CLOB API: uses axios internally (via @polymarket/clob-client) →
 *   we set axios.defaults.httpAgent/httpsAgent via https-proxy-agent.
 * - Gamma / Data API: uses native fetch (undici) →
 *   we use undici.ProxyAgent with the `dispatcher` option.
 * - Polygon RPC: NOT proxied (separate ethers.js provider).
 *
 * Set PROXY_URL in .env to enable. Supports HTTP/HTTPS proxies.
 * Example: PROXY_URL=http://user:pass@proxy.example.com:8080
 */

import config from '../config/index.js';
import logger from './logger.js';

let axiosAgent = null;   // https-proxy-agent for axios (CLOB client)
let fetchDispatcher = null; // undici ProxyAgent for native fetch

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

    try {
        // 1. Setup axios proxy (for CLOB client)
        const { HttpsProxyAgent } = await import('https-proxy-agent');
        axiosAgent = new HttpsProxyAgent(config.proxyUrl);

        const axiosModule = await import('axios');
        const axios = axiosModule.default || axiosModule;
        axios.defaults.proxy = false;
        axios.defaults.httpAgent = axiosAgent;
        axios.defaults.httpsAgent = axiosAgent;
        logger.info(`Axios proxy configured → ${maskProxyUrl(config.proxyUrl)}`);
    } catch (err) {
        logger.error(`Failed to configure axios proxy: ${err.message}`);
        logger.error('Make sure https-proxy-agent is installed: npm i https-proxy-agent');
    }

    try {
        // 2. Setup undici ProxyAgent (for native fetch)
        const undici = await import('undici');
        fetchDispatcher = new undici.ProxyAgent(config.proxyUrl);
        logger.info(`Fetch proxy configured → ${maskProxyUrl(config.proxyUrl)}`);
    } catch (err) {
        logger.error(`Failed to configure fetch proxy: ${err.message}`);
    }
}

/**
 * Proxy-aware fetch wrapper.
 * Drop-in replacement for global fetch() — uses undici ProxyAgent
 * as dispatcher when PROXY_URL is configured.
 * Use this for Gamma API and Data API calls.
 */
export async function proxyFetch(url, opts = {}) {
    if (fetchDispatcher) {
        opts.dispatcher = fetchDispatcher;
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
        if (!fetchDispatcher) {
            throw new Error('Proxy dispatcher not initialized');
        }

        // Test with a simple GET to the CLOB time endpoint via proxied fetch
        const resp = await fetch(`${config.clobHost}/time`, {
            dispatcher: fetchDispatcher,
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
