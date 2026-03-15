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
    return this.findOne(id);
  }

  remove(id: string) {
    return this.moviesRepository.delete(id);
  }
}
