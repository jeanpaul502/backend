import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;

  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
  ) {}

  afterInit(server: Server) {
    console.log('WebSocket Gateway initialized');
  }

  async handleConnection(client: Socket, ...args: any[]) {
    try {
      // Extract token from handshake auth or headers
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        // Allow unauthenticated connection for now but log it?
        // Or disconnect if strict?
        // For now, just return
        return;
      }

      const payload = this.jwtService.verify(token);
      if (payload && payload.sub) {
        // Store user info in socket
        client.data.user = payload;

        // Update user status to online immediately
        await this.usersService.updateLastActive(payload.sub);

        // Join a room specific to this user (optional, good for targeted events)
        client.join(`user_${payload.sub}`);
      }
    } catch (e) {
      // Token invalid
      // client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    // console.log(`Client disconnected: ${client.id}`);
  }

  emitMovieCreated(movie: any) {
    this.server.emit('movieCreated', movie);
  }

  emitMovieUpdated(movie: any) {
    this.server.emit('movieUpdated', movie);
  }

  emitMovieDeleted(id: string) {
    this.server.emit('movieDeleted', { id });
  }

  emitDownloadProgress(movieId: string, progress: number, status: string) {
    this.server.emit('downloadProgress', { movieId, progress, status });
  }
}
