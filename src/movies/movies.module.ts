import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { MoviesService } from './movies.service';
import { MoviesController } from './movies.controller';
import { Movie } from './entities/movie.entity';
import { TmdbService } from './tmdb.service';

@Module({
  imports: [TypeOrmModule.forFeature([Movie]), HttpModule, ConfigModule],
  controllers: [MoviesController],
  providers: [MoviesService, TmdbService],
  exports: [MoviesService],
})
export class MoviesModule {}
