import { badRequest } from '../utils/errors.js';

/** validate({ body, query, params }) with zod schemas; parsed values replace the originals. */
export const validate = (schemas) => (req, res, next) => {
  for (const part of ['params', 'query', 'body']) {
    if (!schemas[part]) continue;
    const result = schemas[part].safeParse(req[part] ?? {});
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return next(badRequest('VALIDATION_ERROR', details[0] ? `${details[0].path || part}: ${details[0].message}` : 'Invalid input', details));
    }
    if (part === 'query') Object.defineProperty(req, 'query', { value: result.data, writable: true });
    else req[part] = result.data;
  }
  next();
};
