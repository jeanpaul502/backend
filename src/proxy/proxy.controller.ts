import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ProxyService } from './proxy.service';
import type { Request, Response } from 'express';
import { AuthGuard } from '@nestjs/passport';

@Controller('proxy')
// @UseGuards(AuthGuard('jwt')) // Temporarily disabled for debugging
export class ProxyController {
  constructor(private readonly proxyService: ProxyService) { }

  @Get()
  async proxy(
    @Query('url') url: string,
    @Query('token') tokenQuery: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!url) {
      return res.status(400).send('Missing URL');
    }

    const hostHeader = req.headers.host;
    const host = (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader) || 'localhost';
    const protoHeader = req.headers['x-forwarded-proto'];
    const protocol = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader) || req.protocol;

    let token = tokenQuery;
    if (!token && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        token = parts[1];
      }
    }

    return this.proxyService.handleProxyRequest(
      url,
      req.headers,
      res,
      host,
      protocol,
      token,
    );
  }

  @Get('m3u8')
  async proxyM3u8(
    @Query('url') url: string,
    @Query('token') tokenQuery: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {

    if (!url) {
      return res.status(400).send('Missing URL');
    }

    const host = req.headers.host || 'localhost';
    const protoHeader = req.headers['x-forwarded-proto'];
    const protocol = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader) || req.protocol;

    let token = tokenQuery;
    if (!token && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        token = parts[1];
      }
    }

    return this.proxyService.handleProxyRequest(
      url,
      req.headers,
      res,
      host,
      protocol,
      token,
      true, // rewriteM3u8=true
    );
  }
}
