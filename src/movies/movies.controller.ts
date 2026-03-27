import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { MoviesService } from './movies.service';
import { TmdbService } from './tmdb.service';
import { DownloadService } from './download.service';
import { CreateMovieDto } from './dto/create-movie.dto';
import { UpdateMovieDto } from './dto/update-movie.dto';
import { AuthGuard } from '@nestjs/passport';

@Controller('movies')
@UseGuards(AuthGuard('jwt'))
export class MoviesController {
  constructor(
    private readonly moviesService: MoviesService,
    private readonly tmdbService: TmdbService,
    private readonly downloadService: DownloadService,
  ) {}

  @Get('search/tmdb')
  searchTmdb(@Query('query') query: string, @Query('type') type: string) {
    if (type === 'series') {
      return this.tmdbService.searchSeries(query);
    }
    return this.tmdbService.searchMovies(query);
  }

  @Get('tmdb/:id')
  getTmdbDetails(@Param('id') id: string) {
    return this.tmdbService.getMovieDetails(id);
  }

  @Post()
  create(@Body() createMovieDto: CreateMovieDto) {
    return this.moviesService.create(createMovieDto);
  }

  @Get()
  async findAll(@Res({ passthrough: true }) res: Response) {
    // Cache 30s pour le navigateur, 60s pour les CDN
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300');
    return this.moviesService.findAll();
  }

  @Get(':id/download')
  async downloadMovie(
    @Param('id') id: string,
    @Query('format') format: string = 'mp4',
    @Res() res: Response,
  ) {
    return this.downloadService.convertAndStream(id, format, res);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    return this.moviesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateMovieDto: UpdateMovieDto) {
    return this.moviesService.update(id, updateMovieDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.moviesService.remove(id);
  }
}
