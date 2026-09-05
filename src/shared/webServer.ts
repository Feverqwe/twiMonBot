import {Server} from 'node:http';
import express, {Express} from 'express';

type WebServerOptions = {
  host?: string;
  port: number;
};

class WebServer {
  readonly app: Express = express();
  private server: Server | undefined;
  private host: string;
  private port: number;

  constructor(options: WebServerOptions) {
    this.host = options.host || 'localhost';
    this.port = options.port;
  }

  init() {
    return new Promise<void>((resolve, reject) => {
      this.server = this.app.listen(this.port, this.host, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  close() {
    return new Promise<void>((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

export default WebServer;
