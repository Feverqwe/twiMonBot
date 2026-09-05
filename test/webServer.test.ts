import {describe, expect, jest, test} from '@jest/globals';
import {EventEmitter} from 'node:events';
import WebServer from '../src/shared/webServer';

class ServerMock extends EventEmitter {
  close = jest.fn((callback: (error?: Error) => void) => callback());
}

describe('WebServer', () => {
  test('rejects init when the server emits a listen error', async () => {
    const server = new ServerMock();
    const webServer = new WebServer({host: '127.0.0.1', port: 8080});
    Object.defineProperty(webServer, 'app', {value: {listen: () => server}});

    const initPromise = webServer.init();
    const error = Object.assign(new Error('address in use'), {code: 'EADDRINUSE'});
    server.emit('error', error);

    await expect(initPromise).rejects.toBe(error);
    await expect(webServer.close()).resolves.toBeUndefined();
  });

  test('clears the server after close', async () => {
    const server = new ServerMock();
    const webServer = new WebServer({host: '127.0.0.1', port: 8080});
    Object.defineProperty(webServer, 'app', {value: {listen: () => server}});

    const initPromise = webServer.init();
    server.emit('listening');
    await initPromise;
    await webServer.close();
    await webServer.close();

    expect(server.close).toHaveBeenCalledTimes(1);
  });
});
