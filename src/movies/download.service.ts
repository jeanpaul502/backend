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
import ffmpeg from 'fluent-ffmpeg';
import * as ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import * as ffprobeInstaller from '@ffprobe-installer/ffprobe';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';
import { EventsGateway } from '../events/events.gateway';

// Use the bundled ffmpeg/ffprobe binaries
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

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

@Injectable()
export class DownloadService {
  private readonly logger = new Logger(DownloadService.name);

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
    // --- Validate format ---
    const fmt = format.toLowerCase() as AllowedFormat;
    if (!ALLOWED_FORMATS.includes(fmt)) {
      throw new BadRequestException(
        `Format non supporté : ${format}. Formats acceptés : ${ALLOWED_FORMATS.join(', ')}`,
      );
    }

    // --- Fetch movie from DB ---
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
    const tmpDir = os.tmpdir();
    const sessionId = `cineo_${Date.now()}`;

    // Phase 1: Download the raw stream using yt-dlp (handles DRM-protected HLS)
    const rawPath = path.join(tmpDir, `${sessionId}_raw.ts`);
    // Phase 2: Output of ffmpeg format conversion
    const finalPath = path.join(tmpDir, `${sessionId}_${outputFilename}`);

    this.logger.log(`[Download] Phase 1 – yt-dlp fetching: ${movie.videoUrl}`);
    this.eventsGateway.emitDownloadProgress(movieId, 0, 'initializing');

    // Phase 1 (0% -> 80% total progress)
    await this.downloadWithYtDlp(url => {
      this.eventsGateway.emitDownloadProgress(movieId, Math.round(url * 0.8), 'downloading');
    }, movie.videoUrl, rawPath);

    this.logger.log(`[Download] Phase 2 – converting to ${fmt.toUpperCase()} → ${finalPath}`);
    this.eventsGateway.emitDownloadProgress(movieId, 80, 'converting');

    // Get duration for better progress calculation in Phase 2
    const duration: number = await new Promise((res) => {
      ffmpeg.ffprobe(rawPath, (err, metadata) => {
        if (err || !metadata.format?.duration) return res(0);
        res(metadata.format.duration);
      });
    });

    // Phase 2 (80% -> 100% total progress)
    await new Promise<void>((resolve, reject) => {
      const command = ffmpeg(rawPath);
      
      if (duration > 0) {
        command.inputOptions(['-t', duration.toString()]);
      }

      command
        .videoCodec(codecs.vcodec)
        .audioCodec(codecs.acodec)
        .outputOptions('-preset', 'fast')
        .outputOptions('-crf', '23')
        .outputOptions('-movflags', '+faststart')
        .output(finalPath)
        .on('start', (cmd) => this.logger.debug(`FFmpeg cmd: ${cmd}`))
        .on('progress', (p) => {
          let pct = p.percent;
          
          // Fallback if p.percent is undefined (common with TS files)
          if (!pct && duration > 0 && p.timemark) {
              const [h, m, s] = p.timemark.split(':').map(parseFloat);
              const currentSeconds = (h * 3600) + (m * 60) + s;
              pct = (currentSeconds / duration) * 100;
          }

          if (pct) {
            const totalPct = 80 + Math.round(pct * 0.19); // map 0-100 ffmpeg to 80-99 total
            this.eventsGateway.emitDownloadProgress(movieId, Math.min(totalPct, 99), 'converting');
          }
        })
        .on('end', () => {
          this.logger.log(`[Download] Conversion done → ${finalPath}`);
          this.eventsGateway.emitDownloadProgress(movieId, 100, 'ready');
          resolve();
        })
        .on('error', (err) => {
          this.logger.error(`[Download] FFmpeg error: ${err.message}`);
          reject(err);
        })
        .run();
    });

    // Clean up raw download
    try { fs.unlinkSync(rawPath); } catch (_) { /* ignore */ }

    // --- Stream the converted file to the client ---
    const stat = fs.statSync(finalPath);
    res.set({
      'Content-Type': this.getMimeType(fmt),
      'Content-Disposition': `attachment; filename="${outputFilename}"`,
      'Content-Length': stat.size.toString(),
    });

    const fileStream = fs.createReadStream(finalPath);
    fileStream.pipe(res);

    // Clean up final file after streaming
    fileStream.on('close', () => {
      try { fs.unlinkSync(finalPath); } catch (_) { /* ignore */ }
    });
  }

  /**
   * Uses yt-dlp to download a (possibly protected) HLS stream to a local file.
   * yt-dlp handles token-signed URLs, CDN headers, and anti-bot measures.
   */
  private downloadWithYtDlp(
    onProgress: (pct: number) => void,
    url: string,
    outputPath: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const ytDlp = spawn('yt-dlp', [
        '--newline', // forces it to output one progress line per line
        '--no-playlist',
        '--format', 'bestvideo+bestaudio/best',  // best quality
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        '--add-header', 'Accept-Language:fr-FR,fr;q=0.9,en-US;q=0.8',
        '--hls-prefer-native',                   // use native HLS downloader
        '--no-warnings',
        '-o', outputPath,
        url,
      ]);

      ytDlp.stdout.on('data', (data: Buffer) => {
        const line = data.toString();
        // Regex to match percentage in "[download]  24.5% of..."
        const match = line.match(/\[download\]\s+(\d+\.?\d*)%/);
        if (match && match[1]) {
          const pct = parseFloat(match[1]);
          onProgress(pct);
        }
        // No logging to console as requested by user
      });

      ytDlp.stderr.on('data', (data: Buffer) => {
        this.logger.error(`[yt-dlp error] ${data.toString().trim()}`);
      });

      ytDlp.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new InternalServerErrorException(
              `yt-dlp a échoué avec le code ${code}. Le flux vidéo est peut-être protégé ou non disponible.`,
            ),
          );
        }
      });

      ytDlp.on('error', (err) => {
        // yt-dlp not installed
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(
            new InternalServerErrorException(
              'yt-dlp est introuvable. Installez-le sur le serveur : pip install yt-dlp',
            ),
          );
        } else {
          reject(err);
        }
      });
    });
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
