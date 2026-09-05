import {beforeAll, beforeEach, describe, expect, jest, test} from '@jest/globals';

type AxiosMockResponse = {
  config: {method: string; url: string};
  data: string;
  headers: Record<string, string>;
  status: number;
  statusText: string;
};

type AxiosRequestMock = jest.Mock<
  (url: string, options: Record<string, unknown>) => Promise<AxiosMockResponse>
>;

const mockAxiosRequest: AxiosRequestMock = jest.fn();
jest.mock('axios', () => ({__esModule: true, default: {create: () => mockAxiosRequest}}));

let fetchRequest: typeof import('../../src/shared/tools/fetchRequest').default;
let TimeoutError: typeof import('../../src/shared/tools/fetchRequest').TimeoutError;

describe('fetchRequest timeouts', () => {
  beforeAll(async () => {
    const modulePath = '../../src/shared/tools/fetchRequest';
    const fetchRequestModule = (await import(
      modulePath
    )) as typeof import('../../src/shared/tools/fetchRequest');
    fetchRequest = fetchRequestModule.default;
    TimeoutError = fetchRequestModule.TimeoutError;
  });

  beforeEach(() => {
    mockAxiosRequest.mockReset();
  });

  test.each([0, 70_000])('passes timeout %s directly to Axios', async (timeout) => {
    mockAxiosRequest.mockResolvedValue({
      config: {method: 'get', url: 'https://example.com'},
      data: 'ok',
      headers: {},
      status: 200,
      statusText: 'OK',
    });

    await fetchRequest('https://example.com', {timeout});

    expect(mockAxiosRequest).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({timeout}),
    );
  });

  test('reports an Axios timeout as TimeoutError', async () => {
    mockAxiosRequest.mockRejectedValue(Object.assign(new Error('timeout'), {code: 'ECONNABORTED'}));

    await expect(fetchRequest('https://example.com', {timeout: 20})).rejects.toBeInstanceOf(
      TimeoutError,
    );
  });
});
