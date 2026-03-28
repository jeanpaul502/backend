import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MediaRequest } from './entities/request.entity';
import { CreateRequestDto } from './dto/create-request.dto';

@Injectable()
export class RequestsService {
  constructor(
    @InjectRepository(MediaRequest)
    private requestsRepository: Repository<MediaRequest>,
  ) {}

  async create(createRequestDto: CreateRequestDto) {
    const request = this.requestsRepository.create(createRequestDto);
    return this.requestsRepository.save(request);
  }

  findAllAdmin() {
    return this.requestsRepository.find({
      relations: { user: true },
      order: { createdAt: 'DESC' },
    });
  }

  findOne(id: string) {
    return this.requestsRepository.findOneBy({ id });
  }

  async update(id: string, updateRequestDto: Partial<MediaRequest>) {
    await this.requestsRepository.update(id, updateRequestDto);
    return this.requestsRepository.findOne({
      where: { id },
      relations: { user: true },
    });
  }

  remove(id: string) {
    return this.requestsRepository.delete(id);
  }
}
