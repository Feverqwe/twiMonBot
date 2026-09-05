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
      const server = this.app.listen(this.port, this.host);
      this.server = server;

      const onError = (error: Error) => {
        server.off('listening', onListening);
        if (this.server === server) {
          this.server = undefined;
        }
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };

      server.once('error', onError);
      server.once('listening', onListening);
    });
  }

  close() {
    return new Promise<void>((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      const server = this.server;
      server.close((error) => {
        if (this.server === server) {
          this.server = undefined;
        }
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

export default WebServer;
