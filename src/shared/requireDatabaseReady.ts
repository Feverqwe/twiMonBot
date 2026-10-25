import type {RequestHandler} from 'express';

const requireDatabaseReady = (isReady: () => boolean): RequestHandler => {
  return (_req, res, next) => {
    if (!isReady()) {
      res.set('Retry-After', '10');
      res.status(503).json({error: 'Database is not ready'});
      return;
    }
    next();
  };
};

export default requireDatabaseReady;
