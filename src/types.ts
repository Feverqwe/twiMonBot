export interface TelegramError extends Error {
  code: string;
  response: {
    statusCode: number;
    body: {
      error_code: number;
      description: string;
      parameters?: {
        migrate_to_chat_id?: number;
      };
    };
  };
}
