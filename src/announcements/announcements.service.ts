import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { Announcement } from './entities/announcement.entity';

@Injectable()
export class AnnouncementsService {
  constructor(
    @InjectRepository(Announcement)
    private repo: Repository<Announcement>,
  ) {}

  async create(createAnnouncementDto: CreateAnnouncementDto) {
    if (createAnnouncementDto.isActive) {
      await this.repo.update({ isActive: true }, { isActive: false }); // Desactivate currently active ones
    }
    const ann = this.repo.create(createAnnouncementDto);
    return this.repo.save(ann);
  }

  findAll() {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  findActive() {
    return this.repo.findOne({ where: { isActive: true } });
  }

  findOne(id: string) {
    return this.repo.findOne({ where: { id } });
  }

  async update(id: string, updateAnnouncementDto: UpdateAnnouncementDto) {
    if (updateAnnouncementDto.isActive) {
      await this.repo.update({ isActive: true }, { isActive: false });
    }
    await this.repo.update(id, updateAnnouncementDto);
    return this.findOne(id);
  }

  async remove(id: string) {
    const ann = await this.findOne(id);
    if (!ann) throw new NotFoundException();
    return this.repo.remove(ann);
  }
}
