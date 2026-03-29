import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { RequestsService } from './requests.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from '../users/users.service';
import type { Request } from 'express';

type AuthedRequest = Request & { user?: { userId?: string } };

@Controller('requests')
// @UseGuards(AuthGuard('jwt')) // Ideally protected, but for now user might not be logged in or we might want public requests?
// The user prompt implies users can make requests. If they are logged in, we have userId. If not, maybe public?
// Given the dashboard context, they are likely logged in. I'll keep it simple for now and maybe comment out AuthGuard if needed, but safer to have it if we have userId.
// Actually, let's keep it open or check if we have a user.
// The frontend Requests.tsx is in dashboard, so user is logged in.
export class RequestsController {
  constructor(
    private readonly requestsService: RequestsService,
    private readonly usersService: UsersService,
  ) {}

  @Post()
  @UseGuards(AuthGuard('jwt'))
  create(
    @Body() createRequestDto: CreateRequestDto,
    @Req() req: AuthedRequest,
  ) {
    const userId = String(req.user?.userId || '');
    return this.requestsService.create({
      ...createRequestDto,
      userId: userId || undefined,
    });
  }

  @Get('admin')
  @UseGuards(AuthGuard('jwt'))
  async findAllAdmin(@Req() req: AuthedRequest) {
    const userId = String(req.user?.userId || '');
    const user = userId ? await this.usersService.findOne(userId) : null;
    if (!user || user.role !== 'admin') throw new ForbiddenException();
    return this.requestsService.findAllAdmin();
  }

  @Patch(':id/status')
  @UseGuards(AuthGuard('jwt'))
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: 'pending' | 'approved' | 'rejected' },
    @Req() req: AuthedRequest,
  ) {
    const userId = String(req.user?.userId || '');
    const user = userId ? await this.usersService.findOne(userId) : null;
    if (!user || user.role !== 'admin') throw new ForbiddenException();
    return this.requestsService.update(id, { status: body.status });
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  async remove(@Param('id') id: string, @Req() req: AuthedRequest) {
    const userId = String(req.user?.userId || '');
    const user = userId ? await this.usersService.findOne(userId) : null;
    if (!user || user.role !== 'admin') throw new ForbiddenException();
    return this.requestsService.remove(id);
  }
}
