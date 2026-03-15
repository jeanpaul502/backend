import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { UsersService } from './users.service';

@Injectable()
export class UserActivityInterceptor implements NestInterceptor {
  constructor(private usersService: UsersService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (user && user.userId) {
      // Update user last active time asynchronously to not block the response
      this.usersService.updateLastActive(user.userId).catch((err) => {
        console.error('Failed to update user last active:', err);
      });
    }

    return next.handle();
  }
}
