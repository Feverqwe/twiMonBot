import {describe, expect, jest, test} from '@jest/globals';
import type {Request, Response} from 'express';
import requireDatabaseReady from '../src/shared/requireDatabaseReady';

describe('Database readiness middleware', () => {
  test('rejects requests before readiness and during an outage, then resumes the handler chain', () => {
    let ready = false;
    const middleware = requireDatabaseReady(() => ready);
    const response = {
      set: jest.fn(),
      status: jest.fn(),
      json: jest.fn(),
    };
    response.status.mockReturnValue(response);
    const next = jest.fn();
    const request = {} as Request;

    middleware(request, response as unknown as Response, next);
    expect(response.status).toHaveBeenLastCalledWith(503);
    expect(response.json).toHaveBeenCalledWith({error: expect.any(String)});
    expect(next).not.toHaveBeenCalled();

    ready = true;
    middleware(request, response as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(1);

    ready = false;
    middleware(request, response as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledTimes(2);
  });
});
