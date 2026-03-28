import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateMovieDto } from './dto/create-movie.dto';
import { UpdateMovieDto } from './dto/update-movie.dto';
import { Movie } from './entities/movie.entity';
import { EventsGateway } from '../events/events.gateway';

@Injectable()
export class MoviesService {
  constructor(
    @InjectRepository(Movie)
    private moviesRepository: Repository<Movie>,
    private eventsGateway: EventsGateway,
  ) {}

  async create(createMovieDto: CreateMovieDto) {
    const existingMovie = await this.moviesRepository.findOne({
      where: { title: createMovieDto.title },
    });

    if (existingMovie) {
      throw new ConflictException('Un film avec ce titre existe déjà.');
    }

    const movie = this.moviesRepository.create(createMovieDto);
    const savedMovie = await this.moviesRepository.save(movie);

    if (savedMovie.isTop10) {
      await this.enforceTop10Limit();
    }

    this.eventsGateway.emitMovieCreated(savedMovie);
    return savedMovie;
  }

  findAll() {
    return this.moviesRepository.find();
  }

  findOne(id: string) {
    return this.moviesRepository.findOneBy({ id });
  }

  async update(id: string, updateMovieDto: UpdateMovieDto) {
    await this.moviesRepository.update(id, updateMovieDto);
    const updated = await this.findOne(id);

    if (updated?.isTop10) {
      await this.enforceTop10Limit();
    }

    if (updated) {
      this.eventsGateway.emitMovieUpdated(updated);
    }
    return updated;
  }

  private async enforceTop10Limit() {
    const top10 = await this.moviesRepository.find({
      where: { isTop10: true },
      order: { updatedAt: 'DESC' },
    });

    if (top10.length > 10) {
      const toRemove = top10.slice(10);
      for (const movie of toRemove) {
        await this.moviesRepository.update(movie.id, { isTop10: false });
        const fix = await this.findOne(movie.id);
        if (fix) {
          this.eventsGateway.emitMovieUpdated(fix);
        }
      }
    }
  }

  async remove(id: string) {
    const res = await this.moviesRepository.delete(id);
    this.eventsGateway.emitMovieDeleted(id);
    return res;
  }
}
