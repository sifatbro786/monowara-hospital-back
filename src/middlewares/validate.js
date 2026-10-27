/**
 * zod validation for query / params / body. Parsed (coerced, stripped) values land on `req.valid`
 * — Express 5 makes req.query read-only, and handlers should only ever read validated input.
 * A ZodError is turned into a 400 by the error handler.
 */
export const validate =
    ({ query, params, body } = {}) =>
    (req, _res, next) => {
        req.valid = {
            query: query ? query.parse(req.query ?? {}) : {},
            params: params ? params.parse(req.params ?? {}) : {},
            body: body ? body.parse(req.body ?? {}) : {},
        };
        next();
    };
