/*
 * Simple Proxy Server
 * Proxy Server for redirecting data from request to another server for sake of security and used during server side whitelisting
 *
 * Use https://github.com/nodejs/undici
 * For Proxy Configuration, each object in proxy.js can have fields that can be picked from above URL options
 *
 * @author : Bismay <bismay@smartinfologiks.com>
 * */

const config = require('./config');
const defaultProxyConfig = require('./proxy');
const startSocks5Server = require('./socks5');
const createState = require('./state');
const adminApi = require('./admin');

/**
 * Loading all plugin packages required
 */
const express = require('express');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const { request: undiciRequest, Agent, interceptors } = require('undici');
const zlib = require('zlib');
const urlParser = require('url');
const bunyan = require('bunyan');
const _ = require('lodash');

/**
 * Create A Logger, may be we will remove this in future
 */
const logger = bunyan.createLogger({
    name: config.name,
    streams: [{
        level: 'error',
        path: './logs/error.log' // log ERROR and above to a file
    }]
});

// Follows redirects like the old `request` library did by default (undici doesn't, on its own).
const upstreamDispatcher = new Agent().compose(interceptors.redirect({ maxRedirections: 10 }));

/**
 * Initialize Server
 */
const server = express();

/**
 * Runtime-mutable, persisted gateway state (proxy routes + settings),
 * seeded from proxy.js / config.js and managed at runtime via the admin API.
 */
const state = createState({
    routes: defaultProxyConfig,
    settings: {
        cors_sites: config.cors_sites,
        socks5: config.socks5
    }
});
config.cors_sites = state.data.settings.cors_sites;
config.socks5 = state.data.settings.socks5;

server.config = config;
server.proxyConfig = state.data.routes;

// Express ignores trailing slashes by default (non-strict routing), matching
// the old ignoreTrailingSlash:true restify option, so no extra config is needed.

/**
 * Middleware
*/
server.use((req, res, next) => {
    // Collapse repeated slashes in the path, leaving the query string alone.
    const [pathname, search] = req.url.split('?');
    const deduped = pathname.replace(/\/{2,}/g, '/');
    req.url = search ? `${deduped}?${search}` : deduped;
    return next();
});

server.use(express.urlencoded({ extended: true }));
server.use(express.json());
server.use(express.text({ type: 'application/xml' }));

server.use(compression());

server.use(rateLimit({
    windowMs: (config.throttle.burst / config.throttle.rate) * 1000,
    max: config.throttle.burst,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        const override = config.throttle.overrides && config.throttle.overrides[req.ip];
        return !!(override && override.rate === 0);
    }
}));

server.use(function(req, res, next) {
    // console.log("XXXXX", req.headers.origin);
    res.header('Access-Control-Allow-Origin', config.cors_sites);//req.headers.origin

    if(req.method.toUpperCase()=="OPTIONS") {
        var allowHeaders = ['Accept', 'Accept-Version', 'Content-Type',
            'Api-Version', 'Origin', 'X-Requested-With',
            'x-data-hash', 'authorization', 'auth-token'];

        res.header('Access-Control-Allow-Credentials', true);
        res.header('Access-Control-Allow-Headers', allowHeaders.join(', '));
        res.header('Access-Control-Allow-Methods', "GET, POST, OPTIONS, OPTION, PUT, DELETE, AUTHORIZATION");

        // res.header("Access-Control-Allow-Origin", "*");
        // res.header("Access-Control-Allow-Methods", req.header("Access-Control-Request-Method"));
        // res.header("Access-Control-Allow-Headers", req.header("Access-Control-Request-Headers"));

        return res.status(204).end();
    }
    return next();
});

server.use(adminApi.authMiddleware(server.config));

//Landing Page
server.get('/', (req, res, next) => {
    res.send('Welcome to '+server.config.name);
})

/**
 * Admin API - manage gateway routes & settings at runtime.
 * See admin.js. Registered before the /:proxykey catch-all routes.
 */
adminApi.mountRoutes(server, state, restartSocks5);

//With ProxyKEY
server.get('/:proxykey', (req, res, next) => {
    processProxyRequest("GET",req.path,req, res, next);
});

server.post('/:proxykey', (req, res, next) => {
    processProxyRequest("POST",req.path,req, res, next);
});

server.put('/:proxykey', (req, res, next) => {
    processProxyRequest("PUT",req.path,req, res, next);
});

server.delete('/:proxykey', (req, res, next) => {
    processProxyRequest("DELETE",req.path,req, res, next);
});

server.get('/:proxykey/*', (req, res, next) => {
    processProxyRequest("GET",req.path,req, res, next);
});

server.post('/:proxykey/*', (req, res, next) => {
    processProxyRequest("POST",req.path,req, res, next);
});

server.put('/:proxykey/*', (req, res, next) => {
    processProxyRequest("PUT",req.path,req, res, next);
});

server.delete('/:proxykey/*', (req, res, next) => {
    processProxyRequest("DELETE",req.path,req, res, next);
});

/**
 * Start Server, Checks for availale PORTs
 */
server.listen(config.port, () => {
    console.log(`${server.config.name} is listening on port ${config.port}`);
});

server.socks5 = startSocks5Server(config, logger);

function restartSocks5() {
    if (server.socks5) {
        const old = server.socks5;
        server.socks5 = null;
        old.close(() => {
            server.socks5 = startSocks5Server(server.config, logger);
        });
    } else {
        server.socks5 = startSocks5Server(server.config, logger);
    }
}

async function processProxyRequest(type, path, req, res, next) {
    proxyKEY = req.params.proxykey;

    if(server.proxyConfig[proxyKEY]==null) {
        res.status(404).send("Not Found");
        return;
    }

    if(req.query.debug != null && req.query.debug=="true") {
        res.json({
            "proxykey":proxyKEY,
            "type":type,
            "path":path,
            "params":req.params,
            "query":req.query,
            "body":req.body,
            "headers":req.headers,
        });
        return;
    }

    proxyInfo = server.proxyConfig[proxyKEY];

    optsDefault = server.config.default_request_params;
    optsFinal = _.extend(optsDefault, proxyInfo);

    urlHOST = urlParser.parse(optsFinal.url).hostname;
    urlFinal = optsFinal.url + path.replace("/"+proxyKEY,"");
    qParams = [];
    _.each(req.query, function(a, b) {
        qParams.push(b+"="+encodeURIComponent(a));
    });
    if(qParams.length>0) {
        urlFinal += "?"+qParams.join("&");
    }
    optsFinal.url = urlFinal;
    optsFinal.method = type.toUpperCase();
    optsFinal.headers = _.extend(req.headers, optsFinal.headers);
    optsFinal.headers.host = urlHOST;
    // These describe the inbound request; the body we're about to send upstream
    // is freshly (re)built below, so stale values here would either be wrong
    // (content-length) or misleading (transfer-encoding, already fully buffered).
    delete optsFinal.headers['content-length'];
    delete optsFinal.headers['transfer-encoding'];
    if (optsFinal.gzip && !optsFinal.headers['accept-encoding']) {
        optsFinal.headers['accept-encoding'] = 'gzip, deflate, br';
    }

    let requestBody;

    switch(type.toUpperCase()) {
        case "GET":
        break;
        case "POST":
        case "PUT":
        case "DELETE":
            if(req.headers['content-type']!=null && req.headers['content-type'].length>0) {
                contentType = req.headers['content-type'].toLowerCase();
                if(contentType.indexOf("multipart")>=0) {
                    contentType = "multipart";
                }
                switch(contentType) {
                    case "multipart":
                        console.log(req.headers['content-type']);
                        res.status(502).send(`${req.headers['content-type']} Not supported`);
                        return;
                    break;
                    case "application/x-www-form-urlencoded":
                        postData = [];
                        _.each(req.body, function(a ,b) {
                            postData.push(b+"="+encodeURIComponent(a));
                        });
                        requestBody = postData.join("&");
                    break;
                    case "application/json":
                        requestBody = JSON.stringify(req.body);
                    break;
                    case "application/xml":
                        requestBody = req.body;
                    break;
                    default:
                        res.status(502).send(`${req.headers['content-type']} Not supported`);
                        return;
                }
            } else {
                res.status(502).send(`${req.headers['content-type']} Not supported`);
                return;
            }
        break;
        case "HEAD":
            res.status(405).send(`HEAD Request Not supported`);
            return;
        break;
        case "OPTIONS":
            res.status(405).send(`OPTIONS Request Not supported`);
            return;
        break;
    }

    // res.json([optsFinal]);
    // return;

    let response;
    let body;
    try {
        response = await undiciRequest(optsFinal.url, {
            dispatcher: upstreamDispatcher,
            method: optsFinal.method,
            headers: optsFinal.headers,
            body: requestBody,
            headersTimeout: optsFinal.timeout,
            bodyTimeout: optsFinal.timeout
        });
        body = Buffer.from(await response.body.arrayBuffer());
    } catch (error) {
        // console.error('request failed:', error);
        res.status(500).send("Request Failed");
        return;
    }

    const encoding = (response.headers['content-encoding'] || '').toLowerCase();
    try {
        if (encoding === 'gzip') body = zlib.gunzipSync(body);
        else if (encoding === 'deflate') body = zlib.inflateSync(body);
        else if (encoding === 'br') body = zlib.brotliDecompressSync(body);
    } catch (error) {
        // content-encoding lied or the body was truncated - fall through with the raw bytes
    }

    if(response.headers['content-type']) {
        res.set('content-type', response.headers['content-type']);
    }
    if(optsFinal.use_response_headers) {
        const headers = Object.assign({}, response.headers);
        delete headers['content-length']; // stale once the body above may have been decompressed
        delete headers['content-encoding'];
        delete headers['transfer-encoding'];
        res.set(headers);
    }
    res.status(response.statusCode).send(body);
}
