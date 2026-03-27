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
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';

// Use the bundled ffmpeg binary
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

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

    this.logger.log(
      `[Download] Phase 1 – yt-dlp fetching: ${movie.videoUrl}`,
    );

    await this.downloadWithYtDlp(movie.videoUrl, rawPath);

    this.logger.log(
      `[Download] Phase 2 – converting to ${fmt.toUpperCase()} → ${finalPath}`,
    );

    await new Promise<void>((resolve, reject) => {
      ffmpeg(rawPath)
        .inputOptions('-allowed_extensions', 'ALL')
        .videoCodec(codecs.vcodec)
        .audioCodec(codecs.acodec)
        .outputOptions('-preset', 'fast')
        .outputOptions('-crf', '23')
        .outputOptions('-movflags', '+faststart')
        .output(finalPath)
        .on('start', (cmd) => this.logger.debug(`FFmpeg cmd: ${cmd}`))
        .on('progress', (p) =>
          this.logger.debug(`Progress: ${p.percent?.toFixed(1)}%`),
        )
        .on('end', () => {
          this.logger.log(`[Download] Conversion done → ${finalPath}`);
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
  private downloadWithYtDlp(url: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ytDlp = spawn('yt-dlp', [
        '--no-playlist',
        '--format', 'bestvideo+bestaudio/best',  // best quality
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        '--add-header', 'Accept-Language:fr-FR,fr;q=0.9,en-US;q=0.8',
        '--hls-prefer-native',                   // use native HLS downloader
        '--no-warnings',
        '-o', outputPath,
        url,
      ]);

      ytDlp.stdout.on('data', (data: Buffer) =>
        this.logger.debug(`[yt-dlp] ${data.toString().trim()}`),
      );
      ytDlp.stderr.on('data', (data: Buffer) =>
        this.logger.error(`[yt-dlp] ${data.toString().trim()}`),
      );

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
