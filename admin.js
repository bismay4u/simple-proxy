/*
 * Admin API — manage gateway routes & settings at runtime.
 * Mounted under /api, secured with a static Bearer token (ADMIN_TOKEN env var).
 * The whole /api/* prefix is disabled (503) if ADMIN_TOKEN is not configured.
 */

function authMiddleware(config) {
    return function(req, res, next) {
        if (!req.path().startsWith('/api')) {
            return next();
        }

        if (!config.admin_token) {
            res.send(503, { error: 'Admin API disabled: ADMIN_TOKEN is not configured' });
            return next(false);
        }

        const header = req.headers['authorization'] || '';
        const [scheme, token] = header.split(' ');

        if (scheme !== 'Bearer' || token !== config.admin_token) {
            res.send(401, { error: 'Unauthorized' });
            return next(false);
        }

        return next();
    };
}

function mountRoutes(server, state, restartSocks5) {
    server.get('/api/routes', (req, res, next) => {
        res.send(200, state.data.routes);
        return next();
    });

    server.get('/api/routes/:key', (req, res, next) => {
        const route = state.data.routes[req.params.key];
        if (!route) return notFound(res, next);
        res.send(200, route);
        return next();
    });

    server.post('/api/routes', (req, res, next) => {
        const body = req.body || {};
        const key = body.key;
        const url = body.url;

        if (!key || !url) return badRequest(res, next, 'key and url are required');
        if (state.data.routes[key]) return conflict(res, next, `Route '${key}' already exists`);

        state.data.routes[key] = { url, headers: body.headers || {} };
        state.save();
        res.send(201, state.data.routes[key]);
        return next();
    });

    server.put('/api/routes/:key', (req, res, next) => {
        const key = req.params.key;
        if (!state.data.routes[key]) return notFound(res, next);

        const body = req.body || {};
        if (!body.url) return badRequest(res, next, 'url is required');

        state.data.routes[key] = { url: body.url, headers: body.headers || {} };
        state.save();
        res.send(200, state.data.routes[key]);
        return next();
    });

    server.del('/api/routes/:key', (req, res, next) => {
        const key = req.params.key;
        if (!state.data.routes[key]) return notFound(res, next);

        delete state.data.routes[key];
        state.save();
        res.send(204);
        return next();
    });

    server.get('/api/settings', (req, res, next) => {
        res.send(200, redactSettings(state.data.settings));
        return next();
    });

    // Only cors_sites and socks5 take effect live; throttle is fixed at
    // server startup by restify's plugin so it isn't exposed for writes here.
    server.patch('/api/settings', (req, res, next) => {
        const body = req.body || {};

        if (body.cors_sites != null) {
            state.data.settings.cors_sites = body.cors_sites;
            server.config.cors_sites = body.cors_sites;
        }

        if (body.socks5 != null) {
            state.data.settings.socks5 = Object.assign({}, state.data.settings.socks5, body.socks5);
            server.config.socks5 = state.data.settings.socks5;
            restartSocks5();
        }

        state.save();
        res.send(200, redactSettings(state.data.settings));
        return next();
    });
}

function notFound(res, next) {
    res.send(404, { error: 'Not found' });
    return next();
}

function badRequest(res, next, message) {
    res.send(400, { error: message });
    return next();
}

function conflict(res, next, message) {
    res.send(409, { error: message });
    return next();
}

function redactSettings(settings) {
    const copy = JSON.parse(JSON.stringify(settings));
    if (copy.socks5 && copy.socks5.auth && copy.socks5.auth.password) {
        copy.socks5.auth.password = '***';
    }
    return copy;
}

module.exports = { authMiddleware, mountRoutes };
