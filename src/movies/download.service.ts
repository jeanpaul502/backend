import {
  Injectable,
  NotFoundException,
  BadRequestException,
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
    const tmpPath = path.join(os.tmpdir(), `cineo_${Date.now()}_${outputFilename}`);

    this.logger.log(
      `[Download] Starting conversion: ${movie.videoUrl} → ${fmt.toUpperCase()} (${tmpPath})`,
    );

    // Extract origin from videoUrl to use as Referer
    const videoOrigin = new URL(movie.videoUrl).origin;

    await new Promise<void>((resolve, reject) => {
      ffmpeg(movie.videoUrl)
        // Allow all protocols needed for HLS over HTTPS
        .inputOptions('-protocol_whitelist', 'file,http,https,tcp,tls,crypto,hls')
        // Spoof browser-like headers so the streaming server accepts the request
        .inputOptions('-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')
        .inputOptions('-headers', `Referer: ${videoOrigin}/\r\nOrigin: ${videoOrigin}`)
        .videoCodec(codecs.vcodec)
        .audioCodec(codecs.acodec)
        .outputOptions('-preset', 'fast')        // balance speed/quality
        .outputOptions('-crf', '23')             // good default quality
        .outputOptions('-movflags', '+faststart') // MP4: playable while downloading
        .output(tmpPath)
        .on('start', (cmd) => this.logger.debug(`FFmpeg cmd: ${cmd}`))
        .on('progress', (p) =>
          this.logger.debug(`Progress: ${p.percent?.toFixed(1)}%`),
        )
        .on('end', () => {
          this.logger.log(`[Download] Conversion done → ${tmpPath}`);
          resolve();
        })
        .on('error', (err) => {
          this.logger.error(`[Download] FFmpeg error: ${err.message}`);
          reject(err);
        })
        .run();
    });

    // --- Stream the converted file to the client ---
    const stat = fs.statSync(tmpPath);
    res.set({
      'Content-Type': this.getMimeType(fmt),
      'Content-Disposition': `attachment; filename="${outputFilename}"`,
      'Content-Length': stat.size.toString(),
    });

    const fileStream = fs.createReadStream(tmpPath);
    fileStream.pipe(res);

    // Clean up tmp file after streaming
    fileStream.on('close', () => {
      try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
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
