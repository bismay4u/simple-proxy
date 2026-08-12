/*
 * Simple Proxy Server
 * Proxy Server for redirecting data from request to another server for sake of security and used during server side whitelisting
 * 
 * Use https://github.com/request/request 
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
const restify = require('restify');
const restifyPlugins = require('restify-plugins');
const errors = require('restify-errors');

const request = require('request');
const urlParser = require('url');
const fs = require('fs');
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

/**
 * Initialize Server
 */
const server = restify.createServer({
    name: config.name,
    version: config.version,

    dtrace: false,
    log: logger,
    ignoreTrailingSlash: true
});
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

/**
 * Preeware
*/
server.pre(restify.plugins.pre.context());
server.pre(restify.plugins.pre.dedupeSlashes());
server.pre(restify.plugins.pre.sanitizePath());

/**
 * Middleware
*/
server.use(restify.plugins.urlEncodedBodyParser());
server.use(restify.plugins.queryParser({ mapParams: true }));//req.query
server.use(restify.plugins.acceptParser( server.acceptable ));
server.use(restify.plugins.dateParser());
server.use(restify.plugins.fullResponse());
server.use(restify.plugins.gzipResponse());
server.use(restify.plugins.throttle( config.throttle ));

server.use(restify.plugins.bodyParser({ mapParams: false }));

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
        
        return res.send(204);
    }
    return next();
});

server.use(adminApi.authMiddleware(server.config));

//Landing Page
server.get('/', (req, res, next) => {
    res.sendRaw('Welcome to '+server.config.name);
    return next();
})

/**
 * Admin API - manage gateway routes & settings at runtime.
 * See admin.js. Registered before the /:proxykey catch-all routes.
 */
adminApi.mountRoutes(server, state, restartSocks5);

//With ProxyKEY
server.get('/:proxykey', (req, res, next) => {
    processProxyRequest("GET",req.path(),req, res, next);
});

server.post('/:proxykey', (req, res, next) => {
    processProxyRequest("POST",req.path(),req, res, next);
});

server.put('/:proxykey', (req, res, next) => {
    processProxyRequest("PUT",req.path(),req, res, next);
});

server.del('/:proxykey', (req, res, next) => {
    processProxyRequest("DELETE",req.path(),req, res, next);
});

server.get('/:proxykey/*', (req, res, next) => {
    processProxyRequest("GET",req.path(),req, res, next);
});

server.post('/:proxykey/*', (req, res, next) => {
    processProxyRequest("POST",req.path(),req, res, next);
});

server.put('/:proxykey/*', (req, res, next) => {
    processProxyRequest("PUT",req.path(),req, res, next);
});

server.del('/:proxykey/*', (req, res, next) => {
    processProxyRequest("DELETE",req.path(),req, res, next);
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

function processProxyRequest(type, path, req, res, next) {
    proxyKEY = req.params.proxykey;

    if(server.proxyConfig[proxyKEY]==null) {
        res.sendRaw(404, "Not Found");
        return next();
    }

    if(req.query.debug != null && req.query.debug=="true") {
        res.send({
            "proxykey":proxyKEY,
            "type":type,
            "path":path,
            "params":req.params,
            "query":req.query,
            "body":req.body,
            "headers":req.headers,
        });
        return next();
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
                        res.sendRaw(502, `${req.headers['content-type']} Not supported`);
                        return next();
                    break;
                    case "application/x-www-form-urlencoded":
                        postData = [];
                        _.each(req.body, function(a ,b) {
                            postData.push(b+"="+encodeURIComponent(a));
                        });
                        optsFinal.body = postData.join("&");
                    break;
                    case "application/json":
                        optsFinal.json = JSON.stringify(req.body);
                    break;
                    case "application/xml":
                        optsFinal.body = req.body;
                    break;
                    default:
                        res.sendRaw(502, `${req.headers['content-type']} Not supported`);
                        return next();
                }
            } else {
                res.sendRaw(502, `${req.headers['content-type']} Not supported`);
                return next();
            }
        break;
        case "HEAD":
            res.sendRaw(405, `HEAD Request Not supported`);
            return next();
        break;
        case "OPTIONS":
            res.sendRaw(405, `OPTIONS Request Not supported`);
            return next();
        break;
    }

    // res.send([optsFinal]);
    // return next();

    request(optsFinal, function(error, response, body) {
        if (error) {
            // console.error('request failed:', error);
            res.sendRaw(500, "Request Failed");
            return next();
        }
        // console.log(response.statusCode) // 200
        // console.log(response.headers['content-type']); // 'image/png'
        // console.log('Response:', body);

        if(optsFinal.use_response_headers) {
            res.sendRaw(response.statusCode, body, response.headers);
        } else {
            res.sendRaw(response.statusCode, body);
        }

        return next();
    });
}
