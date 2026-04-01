import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Headers,
  UseGuards,
  Request,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthGuard } from '@nestjs/passport';

@Controller('users')
@UseGuards(AuthGuard('jwt'))
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('heartbeat')
  async heartbeat(@Request() req: any) {
    // req.user contains { userId: ..., email: ..., sid: ... } from JwtStrategy
    if (req.user?.sid) {
      await this.usersService.updateSessionActivity(
        req.user.sid,
        req.user.userId,
      );
    } else {
      await this.usersService.updateLastActive(req.user.userId);
    }
    return { status: 'ok' };
  }

  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    const updated = await this.usersService.update(id, updateUserDto);
    return updated;
  }

  @Patch(':id/password')
  async changePassword(@Param('id') id: string, @Body() body: any) {
    return this.usersService.changePassword(
      id,
      body.currentPassword,
      body.newPassword,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  @Get(':id/sessions')
  getSessions(
    @Param('id') id: string,
    @Headers('authorization') authHeader: string,
  ) {
    const token = authHeader ? authHeader.replace('Bearer ', '') : undefined;
    return this.usersService.getUserSessions(id, token);
  }

  @Delete(':id/sessions/:sessionId')
  deleteSession(
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.usersService.deleteSession(+sessionId, id);
  }
}
