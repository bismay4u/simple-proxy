/*
 * Admin API — manage gateway routes & settings at runtime.
 * Mounted under /api, secured with a static Bearer token (ADMIN_TOKEN env var).
 * The whole /api/* prefix is disabled (503) if ADMIN_TOKEN is not configured.
 */

function authMiddleware(config) {
    return function(req, res, next) {
        if (!req.path.startsWith('/api')) {
            return next();
        }

        if (!config.admin_token) {
            res.status(503).json({ error: 'Admin API disabled: ADMIN_TOKEN is not configured' });
            return;
        }

        const header = req.headers['authorization'] || '';
        const [scheme, token] = header.split(' ');

        if (scheme !== 'Bearer' || token !== config.admin_token) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        return next();
    };
}

function mountRoutes(server, state, restartSocks5) {
    server.get('/api/routes', (req, res) => {
        res.json(state.data.routes);
    });

    server.get('/api/routes/:key', (req, res) => {
        const route = state.data.routes[req.params.key];
        if (!route) return notFound(res);
        res.json(route);
    });

    server.post('/api/routes', (req, res) => {
        const body = req.body || {};
        const key = body.key;
        const url = body.url;

        if (!key || !url) return badRequest(res, 'key and url are required');
        if (state.data.routes[key]) return conflict(res, `Route '${key}' already exists`);

        state.data.routes[key] = { url, headers: body.headers || {} };
        state.save();
        res.status(201).json(state.data.routes[key]);
    });

    server.put('/api/routes/:key', (req, res) => {
        const key = req.params.key;
        if (!state.data.routes[key]) return notFound(res);

        const body = req.body || {};
        if (!body.url) return badRequest(res, 'url is required');

        state.data.routes[key] = { url: body.url, headers: body.headers || {} };
        state.save();
        res.json(state.data.routes[key]);
    });

    server.delete('/api/routes/:key', (req, res) => {
        const key = req.params.key;
        if (!state.data.routes[key]) return notFound(res);

        delete state.data.routes[key];
        state.save();
        res.status(204).end();
    });

    server.get('/api/settings', (req, res) => {
        res.json(redactSettings(state.data.settings));
    });

    // Only cors_sites and socks5 take effect live; throttle is fixed at
    // server startup by express-rate-limit so it isn't exposed for writes here.
    server.patch('/api/settings', (req, res) => {
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
        res.json(redactSettings(state.data.settings));
    });
}

function notFound(res) {
    res.status(404).json({ error: 'Not found' });
}

function badRequest(res, message) {
    res.status(400).json({ error: message });
}

function conflict(res, message) {
    res.status(409).json({ error: message });
}

function redactSettings(settings) {
    const copy = JSON.parse(JSON.stringify(settings));
    if (copy.socks5 && copy.socks5.auth && copy.socks5.auth.password) {
        copy.socks5.auth.password = '***';
    }
    return copy;
}

module.exports = { authMiddleware, mountRoutes };
