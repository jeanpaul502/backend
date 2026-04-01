import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Response } from 'express';
import type { AxiosResponse } from 'axios';
import { Readable, pipeline } from 'stream';
import * as https from 'https';
import * as http from 'http';

// ─── Agents HTTP/HTTPS persistants ────────────────────────────────────────────
// keepAlive = true : réutilise les connexions TCP vers les serveurs IPTV.
// Cruciale pour la lecture live : évite la renegociation TCP à chaque segment.
const HTTPS_AGENT = new https.Agent({
  rejectUnauthorized: false, // Certificats auto-signés courants sur panneaux IPTV
  keepAlive: true,
  keepAliveMsecs: 60000,
  maxSockets: 100,
  timeout: 30000,
});

const HTTP_AGENT = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 60000,
  maxSockets: 100,
});

// User-Agent VLC pour passer les filtres anti-web des fournisseurs IPTV
const BROWSER_UA = 'VLC/3.0.18 LibVLC/3.0.18';

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);

  constructor(private readonly httpService: HttpService) {}

  async handleProxyRequest(
    url: string,
    reqHeaders: any,
    res: Response,
    host: string,
    protocol: string,
    token?: string,
    rewriteM3u8 = false,
  ) {
    if (!url) return res.status(400).send('Missing URL');

    let targetOrigin = '';
    try {
      const parsed = new URL(url);
      targetOrigin = parsed.origin;
    } catch {
      return res.status(400).send('Invalid URL provided');
    }

    // ── CORS — toujours en premier ────────────────────────────────────────────
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Vary', 'Origin');

    // ── Détection du type de ressource ────────────────────────────────────────
    const urlPath = url.split('?')[0].toLowerCase();
    const isM3u8Url = urlPath.endsWith('.m3u8') || urlPath.includes('.m3u8.');
    const isSegment =
      urlPath.endsWith('.ts') ||
      urlPath.endsWith('.m4s') ||
      urlPath.endsWith('.aac');

    // ──────────────────────────────────────────────────────────────────────────
    // SEGMENTS .ts / .m4s : Pipe natif Node.js (zéro overhead Axios)
    //
    // Pour la TV live, les segments doivent arriver le plus vite possible.
    // L'utilisation de Axios ajoute une couche de traitement inutile pour du binaire pur.
    // On utilise http.request natif + proxyRes.pipe(res) : latence minimale.
    // ──────────────────────────────────────────────────────────────────────────
    if (isSegment && !isM3u8Url) {
      return this.pipeSegmentDirect(url, reqHeaders, res, targetOrigin, token);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // MANIFESTES .m3u8 : Axios (on a besoin de lire et réécrire le contenu)
    // ──────────────────────────────────────────────────────────────────────────
    return this.handleM3u8Request(
      url,
      reqHeaders,
      res,
      host,
      protocol,
      token,
      rewriteM3u8,
      targetOrigin,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PIPE DIRECT pour segments binaires (.ts, .m4s)
  //
  // Inspiré de proxy.controller.ts (ancien projet) : proxyRes.pipe(res).
  // Aucune mise en mémoire tampon. Le flux IPTV est redirigé tel quel vers
  // le navigateur dès le premier octet → latence minimale → pas de stall.
  // ─────────────────────────────────────────────────────────────────────────────
  private pipeSegmentDirect(
    url: string,
    reqHeaders: any,
    res: Response,
    targetOrigin: string,
    token?: string,
  ): Promise<void> {
    return new Promise((resolve) => {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        res.status(400).send('Invalid URL');
        return resolve();
      }

      const lib = parsedUrl.protocol === 'https:' ? https : http;
      const agent = parsedUrl.protocol === 'https:' ? HTTPS_AGENT : HTTP_AGENT;

      const options: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        agent,
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: '*/*',
          'Accept-Language': 'fr,fr-FR;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept-Encoding': 'identity',
          Connection: 'keep-alive',
          ...(reqHeaders['range'] && { Range: reqHeaders['range'] }),
          ...(reqHeaders['cookie'] && { Cookie: reqHeaders['cookie'] }),
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      };

      // Timeout de 30s pour les segments (les serveurs IPTV peuvent être lents)
      const proxyReq = lib.request(options, (proxyRes) => {
        const status = proxyRes.statusCode || 200;
        res.statusCode = status;

        // Forward des headers utiles pour le streaming
        const fwd = [
          'content-type',
          'content-length',
          'content-range',
          'accept-ranges',
          'etag',
          'last-modified',
        ];
        for (const key of fwd) {
          const val = proxyRes.headers[key];
          if (val !== undefined) res.setHeader(key, val as any);
        }

        // Type de contenu par défaut si absent
        if (!proxyRes.headers['content-type']) {
          const ext = url.split('?')[0].toLowerCase();
          if (ext.endsWith('.ts')) res.setHeader('Content-Type', 'video/mp2t');
          if (ext.endsWith('.m4s')) res.setHeader('Content-Type', 'video/mp4');
          if (ext.endsWith('.aac')) res.setHeader('Content-Type', 'audio/aac');
        }

        // Cache court pour les segments live
        res.setHeader('Cache-Control', 'public, max-age=10');

        // ─── Pipe direct IPTV → navigateur ────────────────────────────────
        // On NE détruit PAS proxyReq quand res ferme.
        // Raison : HLS.js annule (abort) les XHR lors des seeks live.
        // Si on détruit proxyReq à ce moment, on logge un faux "aborted".
        // On laisse le pipe se terminer naturellement, ou expirer via timeout.
        pipeline(proxyRes, res, (err) => {
          if (!err) return resolve();

          // Ces erreurs sont normales dans un contexte live :
          // - 'aborted'               : HLS.js a cancel l'XHR (seek live, buffer suffisant)
          // - ECONNRESET              : réseau interrompu côté client
          // - ERR_STREAM_PREMATURE_CLOSE : client a fermé en avance
          const isNormal =
            err.message === 'aborted' ||
            (err as any).code === 'ECONNRESET' ||
            (err as any).code === 'ERR_STREAM_PREMATURE_CLOSE' ||
            err.message.includes('aborted') ||
            err.message.includes('closed');

          if (!isNormal) {
            this.logger.debug(
              `Segment stream interrupted [${url.split('/').pop()}]: ${err.message}`,
            );
          }
          resolve();
        });
      });

      proxyReq.setTimeout(30000, () => {
        this.logger.warn(`Segment timeout [${url.split('/').pop()}]`);
        proxyReq.destroy();
        if (!res.headersSent) res.status(504).end();
        resolve();
      });

      proxyReq.on('error', (err) => {
        // Ignoré si ECONNRESET (client a fermé avant la fin — normal sur live)
        if ((err as any).code !== 'ECONNRESET') {
          this.logger.debug(
            `Segment request error [${url.split('/').pop()}]: ${err.message}`,
          );
        }
        if (!res.headersSent) res.status(502).end();
        resolve();
      });

      proxyReq.end();
    });
  }

  // Manifestes M3U8 : Axios + réécriture des URLs de segments
  private async handleM3u8Request(
    url: string,
    reqHeaders: any,
    res: Response,
    host: string,
    protocol: string,
    token?: string,
    rewriteM3u8 = false,
    targetOrigin = '',
  ) {
    const maxRetries = 3;
    let attempt = 0;
    let response: AxiosResponse<Readable> | null = null;
    let lastError: any = null;

    while (attempt <= maxRetries) {
      try {
        const headers: Record<string, string> = {
          'User-Agent': BROWSER_UA,
          Accept: '*/*',
          'Accept-Language': 'fr,fr-FR;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept-Encoding': 'identity',
          Connection: 'keep-alive',
        };
        if (reqHeaders['range']) headers['Range'] = reqHeaders['range'];
        if (reqHeaders['cookie']) headers['Cookie'] = reqHeaders['cookie'];
        if (token) headers['Authorization'] = `Bearer ${token}`;

        response = await firstValueFrom(
          this.httpService.get<Readable>(url, {
            headers,
            responseType: 'stream',
            httpsAgent: HTTPS_AGENT,
            httpAgent: HTTP_AGENT,
            maxRedirects: 10,
            validateStatus: () => true,
            timeout: 20000,
          }),
        );

        if (response.status !== 429 && response.status < 500) break;

        attempt++;
        if (attempt <= maxRetries) {
          const delay = 500 * Math.pow(2, attempt - 1);
          await new Promise((r) => setTimeout(r, delay));
        }
      } catch (err) {
        lastError = err;
        attempt++;
        if (attempt <= maxRetries) await new Promise((r) => setTimeout(r, 500));
      }
    }

    if (!response) {
      const msg =
        lastError instanceof Error ? lastError.message : String(lastError);
      this.logger.error(`M3U8 proxy failed for ${url}: ${msg}`);
      return res.status(502).send('Proxy Error: Upstream unavailable.');
    }

    try {
      const resStatus = response.status;
      const contentType = response.headers['content-type'] || '';
      const urlPath = url.split('?')[0].toLowerCase();

      const isM3u8Content =
        contentType.includes('mpegurl') || contentType.includes('x-mpegURL');
      const isM3u8 =
        urlPath.endsWith('.m3u8') ||
        urlPath.includes('.m3u8.') ||
        isM3u8Content;

      res.status(resStatus);

      // Ensure strict Content-Type for Apple / React Native / Expo Video
      // We must ALWAYS force it to application/x-mpegURL or application/vnd.apple.mpegurl
      // Expo-video (ExoPlayer on Android) specifically looks for these.
      if (isM3u8 || rewriteM3u8) {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      } else if (contentType) {
        res.setHeader('Content-Type', contentType);
      }

      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Expose-Headers', '*');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.setHeader('Vary', 'Origin');

      const shouldRewrite =
        rewriteM3u8 && isM3u8 && resStatus >= 200 && resStatus < 300;

      if (shouldRewrite) {
        const stream: Readable = response.data;
        const text = await new Promise<string>((resolve, reject) => {
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () =>
            resolve(Buffer.concat(chunks).toString('utf-8')),
          );
          stream.on('error', reject);
        });

        const trimmed = text.trim();

        const isLikelyM3u8 =
          trimmed.startsWith('#EXTM3U') ||
          trimmed.startsWith('#EXT-X-') ||
          (trimmed.includes('#EXT') &&
            (trimmed.includes('.ts') || trimmed.includes('.m3u8')));

        const finalUrl = (response as any).request?.res?.responseUrl || url;
        const baseUrl = new URL(finalUrl);
        const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';

        const buildProxiedUrl = (absUrl: string): string => {
          const lower = absUrl.toLowerCase().split('?')[0];
          const isChildM3u8 =
            lower.endsWith('.m3u8') || lower.includes('.m3u8.');
          const endpoint = isChildM3u8 ? 'proxy/m3u8' : 'proxy';
          return `${protocol}://${host}/${endpoint}?url=${encodeURIComponent(absUrl)}${tokenParam}`;
        };

        const rewritten = text
          .split('\n')
          .map((rawLine) => {
            const line = rawLine.trimEnd();
            const trimLine = line.trim();
            if (!trimLine) return line;

            // Rewrite URI="..." attributes (for master playlists, subtitles, etc.)
            if (trimLine.startsWith('#')) {
              return trimLine.replace(/URI="([^"]+)"/g, (_m, uri: string) => {
                if (uri.startsWith('data:')) return _m;
                try {
                  const absoluteUri = new URL(uri, baseUrl).toString();
                  return `URI="${buildProxiedUrl(absoluteUri)}"`;
                } catch {
                  return _m;
                }
              });
            }

            // Rewrite segment URLs or child playlist URLs
            try {
              const absoluteUri = new URL(trimLine, baseUrl).toString();
              return buildProxiedUrl(absoluteUri);
            } catch {
              return line;
            }
          })
          .join('\n');

        return res.send(rewritten);
      }

      // Pas de réécriture : streamer le manifeste tel quel
      // Expo-video needs explicit Content-Type to play streams properly
      if (isM3u8)
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');

      return await new Promise<void>((resolve, reject) => {
        res.on('close', () => {
          try {
            (response.data as any).destroy();
          } catch {
            /* noop */
          }
        });
        pipeline(response.data, res, (err) => {
          if (!err) return resolve();
          const benign =
            err.code === 'ERR_STREAM_PREMATURE_CLOSE' ||
            err.code === 'ECONNRESET';
          if (benign) return resolve();
          this.logger.debug(`M3U8 stream error for ${url}: ${err.message}`);
          reject(err);
        });
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`M3U8 processing error for ${url}: ${msg}`);
      if (!res.headersSent) res.status(500).send('Internal Proxy Error');
    }
  }
}
