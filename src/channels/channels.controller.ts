import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';

@Controller('channels')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  // --- Playlists ---

  @Post('playlists')
  createPlaylist(@Body() dto: CreatePlaylistDto) {
    return this.channelsService.createPlaylist(dto);
  }

  @Get('playlists')
  findAllPlaylists() {
    return this.channelsService.findAllPlaylists();
  }

  @Get('playlists/:id')
  findOnePlaylist(@Param('id') id: string) {
    return this.channelsService.findOnePlaylist(id);
  }

  @Patch('playlists/:id')
  updatePlaylist(@Param('id') id: string, @Body() dto: UpdatePlaylistDto) {
    return this.channelsService.updatePlaylist(id, dto);
  }

  @Delete('playlists/:id')
  removePlaylist(@Param('id') id: string) {
    return this.channelsService.removePlaylist(id);
  }

  /**
   * POST /channels/playlists/:id/import-m3u
   * Body: { "m3uUrl": "http://..." }
   *
   * Import server-side : le backend fetch le fichier M3U, le parse,
   * et insère toutes les chaînes en masse dans la playlist.
   * Résoud les erreurs CORS et les limites du navigateur.
   */
  @Post('playlists/:id/import-m3u')
  importM3U(@Param('id') playlistId: string, @Body() body: { m3uUrl: string }) {
    return this.channelsService.importM3U(playlistId, body.m3uUrl);
  }

  // ─── Channels ────────────────────────────────────────────────────────────────

  @Post()
  createChannel(@Body() dto: CreateChannelDto) {
    return this.channelsService.createChannel(dto);
  }

  @Get()
  findAllChannels() {
    return this.channelsService.findAllChannels();
  }

  @Get(':id')
  findOneChannel(@Param('id') id: string) {
    return this.channelsService.findOneChannel(id);
  }

  @Patch(':id')
  updateChannel(@Param('id') id: string, @Body() dto: UpdateChannelDto) {
    return this.channelsService.updateChannel(id, dto);
  }

  @Delete(':id')
  removeChannel(@Param('id') id: string) {
    return this.channelsService.removeChannel(id);
  }
}
