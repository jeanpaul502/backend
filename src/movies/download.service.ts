import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Movie } from './entities/movie.entity';
import { Response } from 'express';
import * as ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import * as ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { spawn, spawnSync } from 'child_process';
import { EventsGateway } from '../events/events.gateway';

const ALLOWED_FORMATS = ['mp4', 'mkv', 'avi'] as const;
type AllowedFormat = (typeof ALLOWED_FORMATS)[number];

/**
 * Maps output format → ffmpeg video/audio codec pair
 */
const FORMAT_CODECS: Record<AllowedFormat, { vcodec: string; acodec: string }> =
  {
    mp4: { vcodec: 'libx264', acodec: 'aac' },
    mkv: { vcodec: 'libx264', acodec: 'ac3' },
    avi: { vcodec: 'mpeg4', acodec: 'mp3' },
  };

const FALLBACK_OUTPUT_BITRATE: Record<AllowedFormat, number> = {
  mp4: 3_000_000,
  mkv: 3_200_000,
  avi: 2_200_000,
};

@Injectable()
export class DownloadService {
  private readonly logger = new Logger(DownloadService.name);
  private readonly downloadDebug =
    String(process.env.DOWNLOAD_DEBUG || '').toLowerCase() === 'true' ||
    String(process.env.DOWNLOAD_DEBUG || '') === '1';

  constructor(
    @InjectRepository(Movie)
    private readonly moviesRepository: Repository<Movie>,
    private readonly eventsGateway: EventsGateway,
  ) {}

  async convertAndStream(
    movieId: string,
    format: string,
    res: Response,
  ): Promise<void> {
    const fmt = format.toLowerCase() as AllowedFormat;
    if (!ALLOWED_FORMATS.includes(fmt)) {
      throw new BadRequestException(
        `Format non supporté : ${format}. Formats acceptés : ${ALLOWED_FORMATS.join(', ')}`,
      );
    }

    const movie = await this.moviesRepository.findOneBy({ id: movieId });
    if (!movie) {
      throw new NotFoundException(`Film introuvable : ${movieId}`);
    }

    if (!movie.videoUrl) {
      throw new BadRequestException(
        'Ce film ne possède pas de fichier vidéo associé.',
      );
    }

    const codecs = FORMAT_CODECS[fmt];
    const safeTitle = movie.title.replace(/[^a-zA-Z0-9_-]/g, '_');
    const outputFilename = `${safeTitle}.${fmt}`;
    const videoUrl = this.cleanUrl(movie.videoUrl);

    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    const { origin, headers } = this.buildHttpHeaders(videoUrl);

    const sessionId = `cineo_${Date.now()}`;
    if (this.downloadDebug) {
      this.logger.log(
        `[Download] ${sessionId} – start streaming ${fmt.toUpperCase()} for movie=${movieId}`,
      );
    }

    const ytDlpAvailable = this.isYtDlpAvailable();
    const probe = await this.getFfprobeInfo(videoUrl);
    const detectedDurationSeconds =
      probe.durationSeconds > 0
        ? probe.durationSeconds
        : await this.getDurationSeconds(videoUrl, ytDlpAvailable);
    const metadataDurationSeconds = this.parseDurationSeconds(movie.duration);
    const durationSeconds = this.resolveDurationSeconds(
      detectedDurationSeconds,
      metadataDurationSeconds,
    );

    const estimatedBytes =
      durationSeconds > 0
        ? Math.round(
            (this.resolveOutputBitrate(probe.bitRate, fmt) / 8) *
              durationSeconds,
          )
        : 0;

    if (this.downloadDebug) {
      this.logger.log(
        `[Download] ${sessionId} – detectedDuration=${Math.round(
          detectedDurationSeconds,
        )}s metadataDuration=${Math.round(metadataDurationSeconds)}s effectiveDuration=${Math.round(durationSeconds)}s estimatedBytes=${estimatedBytes}`,
      );
    }
    this.eventsGateway.emitDownloadProgress(movieId, 0, 'initializing');

    res.set({
      'Content-Type': this.getMimeType(fmt),
      'Content-Disposition': `attachment; filename="${outputFilename}"`,
      'Cache-Control': 'no-store',
      ...(estimatedBytes > 0
        ? { 'X-Estimated-Bytes': String(estimatedBytes) }
        : {}),
    });

    const ytDlpArgs = [
      '--no-playlist',
      '--format',
      'bestvideo+bestaudio/best',
      '--user-agent',
      ua,
      '--add-header',
      'Accept-Language:fr-FR,fr;q=0.9,en-US;q=0.8',
      ...(origin ? ['--add-header', `Origin:${origin}`] : []),
      ...(origin ? ['--add-header', `Referer:${origin}/`] : []),
      '--hls-prefer-native',
      '--retries',
      '10',
      '--fragment-retries',
      '10',
      '--socket-timeout',
      '30',
      '--newline',
      '--no-warnings',
      '-o',
      '-',
      videoUrl,
    ];

    const mode: 'yt-dlp' | 'ffmpeg' = ytDlpAvailable ? 'yt-dlp' : 'ffmpeg';
    const ytDlp =
      mode === 'yt-dlp'
        ? spawn('yt-dlp', ytDlpArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
        : null;

    const ffmpegProc =
      mode === 'yt-dlp'
        ? spawn(
            ffmpegInstaller.path,
            this.buildFfmpegPipeArgs(fmt, codecs, probe),
            {
              stdio: ['pipe', 'pipe', 'pipe'],
            },
          )
        : spawn(
            ffmpegInstaller.path,
            this.buildFfmpegUrlArgs(fmt, codecs, videoUrl, ua, headers, probe),
            { stdio: ['ignore', 'pipe', 'pipe'] },
          );

    let closedByClient = false;
    const cleanup = () => {
      if (ytDlp && !ytDlp.killed) {
        try {
          ytDlp.kill('SIGKILL');
        } catch (_) {}
      }
      if (!ffmpegProc.killed) {
        try {
          ffmpegProc.kill('SIGKILL');
        } catch (_) {}
      }
    };

    res.on('close', () => {
      closedByClient = true;
      cleanup();
    });

    const ytDlpProgress = this.createLineParser((line) => {
      const match = line.match(/\[download\]\s+(\d+\.?\d*)%/);
      if (match?.[1]) {
        this.eventsGateway.emitDownloadProgress(movieId, 0, 'downloading');
      }
    });

    const ffmpegProgress = this.createLineParser((line) => {
      if (line.startsWith('out_time_ms=')) {
        const ms = parseInt(line.split('=')[1] || '', 10);
        if (!Number.isFinite(ms) || durationSeconds <= 0) return;
        const pct = Math.max(
          0,
          Math.min(100, (ms / 1_000_000 / durationSeconds) * 100),
        );
        const totalPct = Math.round(pct * 0.99);
        this.eventsGateway.emitDownloadProgress(
          movieId,
          Math.min(totalPct, 99),
          mode === 'yt-dlp' ? 'converting' : 'downloading',
        );
      }
      if (line.startsWith('progress=end')) {
        this.eventsGateway.emitDownloadProgress(movieId, 100, 'ready');
      }
    });

    if (ytDlp) {
      ytDlp.stderr.on('data', (data: Buffer) => ytDlpProgress.push(data));
    }
    let ffmpegStderrTail = '';
    ffmpegProc.stderr.on('data', (data: Buffer) => {
      const s = data.toString();
      ffmpegStderrTail = (ffmpegStderrTail + s).slice(-8000);
      ffmpegProgress.push(data);
    });

    if (ytDlp) {
      ytDlp.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          this.logger.error('[Download] yt-dlp introuvable dans le PATH');
        }
      });
    }

    const streamPromise = new Promise<void>((resolve, reject) => {
      ffmpegProc.on('close', (code) => {
        if (closedByClient) return resolve();
        if (code === 0) return resolve();
        if (ffmpegStderrTail) {
          this.logger.error(
            `[Download] FFmpeg stderr tail (movie=${movieId}): ${ffmpegStderrTail}`,
          );
        }
        reject(
          new InternalServerErrorException(
            `FFmpeg a échoué (code ${code ?? 'inconnu'}).`,
          ),
        );
      });

      ffmpegProc.on('error', (err) => {
        if (closedByClient) return resolve();
        reject(err);
      });

      ytDlp?.on('close', (code) => {
        if (closedByClient) return;
        if (code !== 0) {
          reject(
            new InternalServerErrorException(
              `yt-dlp a échoué (code ${code ?? 'inconnu'}). Le flux vidéo est peut-être protégé ou non disponible.`,
            ),
          );
        }
      });
    });

    if (ytDlp) {
      if (!ffmpegProc.stdin) {
        cleanup();
        throw new InternalServerErrorException(
          'FFmpeg stdin indisponible pour le mode yt-dlp.',
        );
      }
      ytDlp.stdout.pipe(ffmpegProc.stdin);
    }
    ffmpegProc.stdout.pipe(res);

    try {
      await streamPromise;
    } catch (e) {
      cleanup();
      if (!res.headersSent) throw e;
      res.destroy();
    }
  }

  /**
   * Uses yt-dlp to download a (possibly protected) HLS stream to a local file.
   * yt-dlp handles token-signed URLs, CDN headers, and anti-bot measures.
   */
  private async getDurationSeconds(
    url: string,
    ytDlpAvailable: boolean,
  ): Promise<number> {
    const ffprobeDuration = await this.getDurationSecondsWithFfprobe(url);
    if (ffprobeDuration > 0) return ffprobeDuration;

    if (!ytDlpAvailable) return 0;

    return new Promise<number>((resolve) => {
      const proc = spawn(
        'yt-dlp',
        [
          '--no-playlist',
          '--no-warnings',
          '--skip-download',
          '--print',
          'duration',
          url,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      let out = '';
      proc.stdout.on('data', (d: Buffer) => {
        out += d.toString();
      });

      proc.on('close', () => {
        const v = out.trim();
        const num = parseFloat(v);
        if (!v || v === 'NA' || !Number.isFinite(num) || num <= 0)
          return resolve(0);
        resolve(num);
      });

      proc.on('error', () => resolve(0));
    });
  }

  private isYtDlpAvailable(): boolean {
    try {
      const r = spawnSync('yt-dlp', ['--version'], { stdio: 'ignore' });
      if (r.error) return false;
      return r.status === 0;
    } catch {
      return false;
    }
  }

  private buildFfmpegPipeArgs(
    fmt: AllowedFormat,
    codecs: { vcodec: string; acodec: string },
    probe: { videoCodec?: string | null; audioCodec?: string | null },
  ): string[] {
    if (fmt === 'mp4') {
      const canRemux =
        (probe.videoCodec ?? '').toLowerCase() === 'h264' &&
        !!(probe.audioCodec ?? '');
      if (canRemux) {
        const audio = (probe.audioCodec ?? '').toLowerCase();
        return [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          'pipe:0',
          '-map',
          '0:v?',
          '-map',
          '0:a?',
          '-c:v',
          'copy',
          ...(audio === 'aac'
            ? ['-c:a', 'copy', '-bsf:a', 'aac_adtstoasc']
            : ['-c:a', 'aac', '-b:a', '192k']),
          '-movflags',
          'frag_keyframe+empty_moov+faststart',
          '-progress',
          'pipe:2',
          '-nostats',
          '-f',
          'mp4',
          'pipe:1',
        ];
      }
      return [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        'pipe:0',
        '-map',
        '0:v?',
        '-map',
        '0:a?',
        '-c:v',
        codecs.vcodec,
        '-c:a',
        codecs.acodec,
        '-preset',
        'fast',
        '-crf',
        '23',
        '-movflags',
        'frag_keyframe+empty_moov+faststart',
        '-progress',
        'pipe:2',
        '-nostats',
        '-f',
        'mp4',
        'pipe:1',
      ];
    }

    if (fmt === 'mkv') {
      return [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        'pipe:0',
        '-map',
        '0:v?',
        '-map',
        '0:a?',
        '-c:v',
        codecs.vcodec,
        '-c:a',
        codecs.acodec,
        '-preset',
        'fast',
        '-crf',
        '23',
        '-progress',
        'pipe:2',
        '-nostats',
        '-f',
        'matroska',
        'pipe:1',
      ];
    }

    return [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-map',
      '0:v?',
      '-map',
      '0:a?',
      '-c:v',
      codecs.vcodec,
      '-c:a',
      codecs.acodec,
      '-preset',
      'fast',
      '-crf',
      '23',
      '-progress',
      'pipe:2',
      '-nostats',
      '-f',
      'avi',
      'pipe:1',
    ];
  }

  private buildFfmpegUrlArgs(
    fmt: AllowedFormat,
    codecs: { vcodec: string; acodec: string },
    url: string,
    userAgent: string,
    headers: string,
    probe: { videoCodec?: string | null; audioCodec?: string | null },
  ): string[] {
    if (fmt === 'mp4') {
      const canRemux =
        (probe.videoCodec ?? '').toLowerCase() === 'h264' &&
        !!(probe.audioCodec ?? '');
      if (canRemux) {
        const audio = (probe.audioCodec ?? '').toLowerCase();
        return [
          '-hide_banner',
          '-loglevel',
          'error',
          '-user_agent',
          userAgent,
          '-headers',
          headers,
          '-i',
          url,
          '-map',
          '0:v?',
          '-map',
          '0:a?',
          '-c:v',
          'copy',
          ...(audio === 'aac'
            ? ['-c:a', 'copy', '-bsf:a', 'aac_adtstoasc']
            : ['-c:a', 'aac', '-b:a', '192k']),
          '-movflags',
          'frag_keyframe+empty_moov+faststart',
          '-progress',
          'pipe:2',
          '-nostats',
          '-f',
          'mp4',
          'pipe:1',
        ];
      }
      return [
        '-hide_banner',
        '-loglevel',
        'error',
        '-user_agent',
        userAgent,
        '-headers',
        headers,
        '-i',
        url,
        '-map',
        '0:v?',
        '-map',
        '0:a?',
        '-c:v',
        codecs.vcodec,
        '-c:a',
        codecs.acodec,
        '-preset',
        'fast',
        '-crf',
        '23',
        '-movflags',
        'frag_keyframe+empty_moov+faststart',
        '-progress',
        'pipe:2',
        '-nostats',
        '-f',
        'mp4',
        'pipe:1',
      ];
    }

    if (fmt === 'mkv') {
      return [
        '-hide_banner',
        '-loglevel',
        'error',
        '-user_agent',
        userAgent,
        '-headers',
        headers,
        '-i',
        url,
        '-map',
        '0:v?',
        '-map',
        '0:a?',
        '-c:v',
        codecs.vcodec,
        '-c:a',
        codecs.acodec,
        '-preset',
        'fast',
        '-crf',
        '23',
        '-progress',
        'pipe:2',
        '-nostats',
        '-f',
        'matroska',
        'pipe:1',
      ];
    }

    return [
      '-hide_banner',
      '-loglevel',
      'error',
      '-user_agent',
      userAgent,
      '-headers',
      headers,
      '-i',
      url,
      '-map',
      '0:v?',
      '-map',
      '0:a?',
      '-c:v',
      codecs.vcodec,
      '-c:a',
      codecs.acodec,
      '-preset',
      'fast',
      '-crf',
      '23',
      '-progress',
      'pipe:2',
      '-nostats',
      '-f',
      'avi',
      'pipe:1',
    ];
  }

  private async getFfprobeInfo(url: string): Promise<{
    durationSeconds: number;
    bitRate: number;
    videoCodec: string | null;
    audioCodec: string | null;
  }> {
    return new Promise((resolve) => {
      const proc = spawn(
        ffprobeInstaller.path,
        [
          '-v',
          'error',
          '-print_format',
          'json',
          '-show_entries',
          'format=duration,bit_rate:stream=codec_type,codec_name',
          url,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      let out = '';
      const timeout = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch (_) {}
        resolve({
          durationSeconds: 0,
          bitRate: 0,
          videoCodec: null,
          audioCodec: null,
        });
      }, 8000);

      proc.stdout.on('data', (d: Buffer) => {
        out += d.toString();
      });

      proc.on('close', () => {
        clearTimeout(timeout);
        try {
          const parsed = JSON.parse(out || '{}');
          const durationSeconds = Number(parsed?.format?.duration ?? 0) || 0;
          const bitRate = Number(parsed?.format?.bit_rate ?? 0) || 0;
          const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
          const v = streams.find(
            (s: any) => s?.codec_type === 'video',
          )?.codec_name;
          const a = streams.find(
            (s: any) => s?.codec_type === 'audio',
          )?.codec_name;
          resolve({
            durationSeconds: durationSeconds > 0 ? durationSeconds : 0,
            bitRate: bitRate > 0 ? bitRate : 0,
            videoCodec: typeof v === 'string' ? v : null,
            audioCodec: typeof a === 'string' ? a : null,
          });
        } catch {
          resolve({
            durationSeconds: 0,
            bitRate: 0,
            videoCodec: null,
            audioCodec: null,
          });
        }
      });

      proc.on('error', () => {
        clearTimeout(timeout);
        resolve({
          durationSeconds: 0,
          bitRate: 0,
          videoCodec: null,
          audioCodec: null,
        });
      });
    });
  }

  private async getDurationSecondsWithFfprobe(url: string): Promise<number> {
    return new Promise<number>((resolve) => {
      const proc = spawn(
        ffprobeInstaller.path,
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=nk=1:nw=1',
          url,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      let out = '';
      const timeout = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch (_) {}
        resolve(0);
      }, 8000);

      proc.stdout.on('data', (d: Buffer) => {
        out += d.toString();
      });

      proc.on('close', () => {
        clearTimeout(timeout);
        const v = out.trim();
        const num = parseFloat(v);
        if (!v || v === 'N/A' || !Number.isFinite(num) || num <= 0)
          return resolve(0);
        resolve(num);
      });

      proc.on('error', () => {
        clearTimeout(timeout);
        resolve(0);
      });
    });
  }

  private cleanUrl(rawUrl: string): string {
    let cleaned = String(rawUrl ?? '').trim();
    if (cleaned.startsWith('`') && cleaned.endsWith('`')) {
      cleaned = cleaned.slice(1, -1).trim();
    }
    return cleaned;
  }

  private parseDurationSeconds(value?: string | null): number {
    const text = String(value || '')
      .trim()
      .toLowerCase();
    if (!text) return 0;

    const hours = Number(text.match(/(\d+)\s*h/)?.[1] || 0);
    const minutes = Number(text.match(/(\d+)\s*(min|m)/)?.[1] || 0);
    const seconds = Number(text.match(/(\d+)\s*s/)?.[1] || 0);
    const total = hours * 3600 + minutes * 60 + seconds;
    if (total > 0) return total;

    const plainMinutes = Number.parseFloat(text);
    return Number.isFinite(plainMinutes) && plainMinutes > 0
      ? Math.round(plainMinutes * 60)
      : 0;
  }

  private resolveDurationSeconds(
    detectedDurationSeconds: number,
    metadataDurationSeconds: number,
  ): number {
    if (metadataDurationSeconds <= 0) {
      return detectedDurationSeconds > 0 ? detectedDurationSeconds : 0;
    }

    if (detectedDurationSeconds <= 0) return metadataDurationSeconds;

    const ratio = detectedDurationSeconds / metadataDurationSeconds;
    if (ratio < 0.5 || ratio > 1.5) return metadataDurationSeconds;

    return detectedDurationSeconds;
  }

  private resolveOutputBitrate(
    detectedBitRate: number,
    fmt: AllowedFormat,
  ): number {
    if (detectedBitRate >= 300_000) return detectedBitRate;
    return FALLBACK_OUTPUT_BITRATE[fmt];
  }

  private buildHttpHeaders(url: string): { origin: string; headers: string } {
    try {
      const parsed = new URL(url);
      const origin = `${parsed.protocol}//${parsed.host}`;
      const headers =
        `Accept: */*\r\n` +
        `Accept-Language: fr-FR,fr;q=0.9,en-US;q=0.8\r\n` +
        `Origin: ${origin}\r\n` +
        `Referer: ${origin}/\r\n`;
      return { origin, headers };
    } catch {
      return {
        origin: '',
        headers: `Accept: */*\r\nAccept-Language: fr-FR,fr;q=0.9,en-US;q=0.8\r\n`,
      };
    }
  }

  private createLineParser(onLine: (line: string) => void): {
    push: (data: Buffer) => void;
  } {
    let buffer = '';
    return {
      push: (data: Buffer) => {
        buffer += data.toString();
        let idx = buffer.indexOf('\n');
        while (idx >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (line) onLine(line);
          idx = buffer.indexOf('\n');
        }
      },
    };
  }

  private getMimeType(fmt: AllowedFormat): string {
    const map: Record<AllowedFormat, string> = {
      mp4: 'video/mp4',
      mkv: 'video/x-matroska',
      avi: 'video/x-msvideo',
    };
    return map[fmt];
  }
}
