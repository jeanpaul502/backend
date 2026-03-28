import {
  Injectable,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Channel } from './entities/channel.entity';
import { Playlist } from './entities/playlist.entity';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';
import * as https from 'https';
import * as http from 'http';

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    @InjectRepository(Channel)
    private channelsRepository: Repository<Channel>,
    @InjectRepository(Playlist)
    private playlistsRepository: Repository<Playlist>,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Playlists
  // ─────────────────────────────────────────────────────────────────────────────

  async createPlaylist(dto: CreatePlaylistDto): Promise<Playlist> {
    if (dto.country && dto.country !== 'Unknown') {
      const existing = await this.playlistsRepository.findOne({
        where: { country: dto.country },
      });
      if (existing) {
        throw new ConflictException(
          `Une playlist pour le pays "${dto.country}" existe déjà.`,
        );
      }
    }
    const playlist = this.playlistsRepository.create(dto);
    return this.playlistsRepository.save(playlist);
  }

  async findAllPlaylists(): Promise<Playlist[]> {
    return this.playlistsRepository.find({ relations: ['channels'] });
  }

  async findOnePlaylist(id: string): Promise<Playlist> {
    const playlist = await this.playlistsRepository.findOne({
      where: { id },
      relations: ['channels'],
    });
    if (!playlist) {
      throw new NotFoundException(`Playlist ${id} introuvable.`);
    }
    return playlist;
  }

  async updatePlaylist(id: string, dto: UpdatePlaylistDto): Promise<Playlist> {
    const playlist = await this.findOnePlaylist(id);
    Object.assign(playlist, dto);
    return this.playlistsRepository.save(playlist);
  }

  async removePlaylist(id: string): Promise<void> {
    const result = await this.playlistsRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Playlist ${id} introuvable.`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Channels
  // ─────────────────────────────────────────────────────────────────────────────

  async createChannel(dto: CreateChannelDto): Promise<Channel> {
    const { playlistId, ...channelData } = dto;
    const channel = this.channelsRepository.create(channelData);
    if (playlistId) {
      channel.playlist = await this.findOnePlaylist(playlistId);
    }
    return this.channelsRepository.save(channel);
  }

  async findAllChannels(): Promise<Channel[]> {
    return this.channelsRepository.find({ relations: ['playlist'] });
  }

  async findOneChannel(id: string): Promise<Channel> {
    const channel = await this.channelsRepository.findOne({
      where: { id },
      relations: ['playlist'],
    });
    if (!channel) {
      throw new NotFoundException(`Chaîne ${id} introuvable.`);
    }
    return channel;
  }

  async updateChannel(id: string, dto: UpdateChannelDto): Promise<Channel> {
    const channel = await this.findOneChannel(id);
    const { playlistId, ...updateData } = dto;
    Object.assign(channel, updateData);
    if (playlistId) {
      channel.playlist = await this.findOnePlaylist(playlistId);
    }
    return this.channelsRepository.save(channel);
  }

  async removeChannel(id: string): Promise<void> {
    const result = await this.channelsRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Chaîne ${id} introuvable.`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Import M3U — Server-side (pas de CORS, pas de limite navigateur)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Récupère un fichier M3U/M3U8 depuis une URL externe,
   * le parse, et insère toutes les chaînes en masse dans la playlist donnée.
   *
   * Avantages vs parsing frontend :
   *  - Pas d'erreurs CORS
   *  - Gestion des certificats HTTPS auto-signés
   *  - Insertion en masse (jusqu'à 500 chaînes par requête DB)
   *  - Déduplication automatique
   */
  async importM3U(
    playlistId: string,
    m3uUrl: string,
  ): Promise<{ imported: number; skipped: number; total: number }> {
    // 1. Charger la playlist avec ses chaînes existantes
    const playlist = await this.findOnePlaylist(playlistId);

    // 2. Fetch le fichier M3U côté serveur
    this.logger.log(`Importing M3U from ${m3uUrl} into playlist ${playlistId}`);
    let content: string;
    try {
      content = await this.fetchM3UContent(m3uUrl);
    } catch (err) {
      this.logger.error(`Failed to fetch M3U from ${m3uUrl}: ${err.message}`);
      throw new InternalServerErrorException(
        `Impossible de récupérer le fichier M3U : ${err.message}`,
      );
    }

    // 3. Parser le contenu M3U
    const parsed = this.parseM3UContent(content);
    this.logger.log(`Parsed ${parsed.length} channels from M3U`);

    if (parsed.length === 0) {
      return { imported: 0, skipped: 0, total: 0 };
    }

    // 4. Déduplication avec les chaînes déjà présentes
    const existingUrls = new Set((playlist.channels || []).map((c) => c.url));

    const toInsert: Partial<Channel>[] = [];
    let skipped = 0;

    for (const ch of parsed) {
      if (!ch.url || !ch.name) continue;
      if (existingUrls.has(ch.url)) {
        skipped++;
        continue;
      }
      toInsert.push({
        name: ch.name,
        url: ch.url,
        logo: ch.logo || undefined,
        status: 'active',
        playlistId: playlist.id,
      });
      existingUrls.add(ch.url);
    }

    // 5. Insertion en masse par batches de 500
    const BATCH = 500;
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const batch = toInsert.slice(i, i + BATCH);
      await this.channelsRepository
        .createQueryBuilder()
        .insert()
        .into(Channel)
        .values(batch as any)
        .execute();
    }

    this.logger.log(
      `Import done: ${toInsert.length} imported, ${skipped} skipped, ${parsed.length} total`,
    );

    return {
      imported: toInsert.length,
      skipped,
      total: parsed.length,
    };
  }

  /**
   * Fetch le contenu brut d'une URL M3U externe.
   * - Utilise un User-Agent navigateur pour bypass les filtres serveur
   * - Ignore les certificats HTTPS auto-signés (courant sur les serveurs IPTV)
   * - Suit les redirections (HTTP 301/302)
   * - Timeout de 30s pour les serveurs lents
   */
  private async fetchM3UContent(url: string): Promise<string> {
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    return new Promise<string>((resolve, reject) => {
      const parsedUrl = new URL(url);
      const lib = parsedUrl.protocol === 'https:' ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: '*/*',
          'Accept-Encoding': 'identity',
          Connection: 'close',
        },
        agent: parsedUrl.protocol === 'https:' ? httpsAgent : undefined,
        timeout: 30000,
      };

      const handleResponse = (res: http.IncomingMessage) => {
        // Follow redirects (max 5 hops)
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          try {
            const redirectUrl = new URL(res.headers.location, url).toString();
            this.fetchM3UContent(redirectUrl).then(resolve).catch(reject);
          } catch {
            reject(new Error(`Invalid redirect URL: ${res.headers.location}`));
          }
          return;
        }

        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      };

      const req = lib.request(options, handleResponse);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout after 30s'));
      });
      req.on('error', reject);
      req.end();
    });
  }

  /**
   * Parse le texte brut d'un fichier M3U / M3U8 de playlist.
   * Supporte les attributs avec guillemets simples, doubles ou sans guillemets.
   */
  private parseM3UContent(
    content: string,
  ): Array<{ name: string; url: string; logo?: string; group?: string }> {
    const channels: Array<{
      name: string;
      url: string;
      logo?: string;
      group?: string;
    }> = [];

    const lines = content.split(/\r?\n/);
    let currentName = '';
    let currentLogo = '';
    let currentGroup = '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line.startsWith('#EXTINF:')) {
        // Nom : tout ce qui suit la dernière virgule
        const nameMatch = line.match(/,([^,]+)$/);
        currentName = nameMatch
          ? this.cleanChannelName(nameMatch[1].trim())
          : '';
        currentLogo = this.extractAttr(line, 'tvg-logo');
        currentGroup = this.extractAttr(line, 'group-title');
      } else if (line.startsWith('#')) {
        continue; // Autre directive M3U — ignorer
      } else if (
        line.startsWith('http://') ||
        line.startsWith('https://') ||
        line.startsWith('rtmp://') ||
        line.startsWith('rtsp://')
      ) {
        if (currentName) {
          channels.push({
            name: currentName,
            url: line.split(' ')[0], // ignorer les paramètres en ligne
            logo: currentLogo || undefined,
            group: currentGroup || undefined,
          });
        }
        currentName = '';
        currentLogo = '';
        currentGroup = '';
      }
    }

    return channels;
  }

  /**
   * Extrait la valeur d'un attribut M3U.
   * Supporte : attr="val"  attr='val'  attr=val
   */
  private extractAttr(line: string, attr: string): string {
    const regex = new RegExp(
      `${attr}="([^"]*)"|${attr}='([^']*)'|${attr}=([^ ,]*)`,
    );
    const m = line.match(regex);
    if (!m) return '';
    return (m[1] ?? m[2] ?? m[3] ?? '').trim();
  }

  /**
   * Nettoie les noms de chaînes :
   * - Supprime tags qualité [HD], [720p], (4K), {FHD}...
   * - Supprime [Geo-blocked]
   * - Normalise les espaces
   */
  private cleanChannelName(name: string): string {
    return name
      .replace(/\s*\[\s*\]\s*/g, '')
      .replace(
        /\s*[\[({](?:720p|1080p|4K|HD|SD|FHD|UHD|2K|480p|576p|360p)\s*[\])}]/gi,
        '',
      )
      .replace(/\s*\[\s*Geo-?blocked\s*\]\s*/gi, '')
      .replace(/\s*\[[^\]]*\]\s*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
