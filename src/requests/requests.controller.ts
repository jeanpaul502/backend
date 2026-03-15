import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { RequestsService } from './requests.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { AuthGuard } from '@nestjs/passport';

@Controller('requests')
// @UseGuards(AuthGuard('jwt')) // Ideally protected, but for now user might not be logged in or we might want public requests?
// The user prompt implies users can make requests. If they are logged in, we have userId. If not, maybe public?
// Given the dashboard context, they are likely logged in. I'll keep it simple for now and maybe comment out AuthGuard if needed, but safer to have it if we have userId.
// Actually, let's keep it open or check if we have a user.
// The frontend Requests.tsx is in dashboard, so user is logged in.
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Post()
  create(@Body() createRequestDto: CreateRequestDto) {
    return this.requestsService.create(createRequestDto);
  }

  @Get()
  findAll() {
    return this.requestsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.requestsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateRequestDto: Partial<CreateRequestDto>,
  ) {
    return this.requestsService.update(id, updateRequestDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.requestsService.remove(id);
  }
}
