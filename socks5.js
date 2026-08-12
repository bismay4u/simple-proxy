/*
 * Minimal SOCKS5 server (RFC 1928, RFC 1929)
 * Supports the CONNECT command only (no BIND / UDP ASSOCIATE),
 * with optional username/password authentication.
 */

const net = require('net');

const VERSION = 0x05;

const AUTH_NONE = 0x00;
const AUTH_USERPASS = 0x02;
const AUTH_NO_ACCEPTABLE = 0xFF;

const CMD_CONNECT = 0x01;

const ATYP_IPV4 = 0x01;
const ATYP_DOMAIN = 0x03;
const ATYP_IPV6 = 0x04;

const REP_SUCCESS = 0x00;
const REP_HOST_UNREACHABLE = 0x04;
const REP_CMD_NOT_SUPPORTED = 0x07;
const REP_ATYP_NOT_SUPPORTED = 0x08;

function startSocks5Server(config, logger) {
    if (!config.socks5 || !config.socks5.enabled) {
        return null;
    }

    const requireAuth = !!(config.socks5.auth && config.socks5.auth.username);

    const server = net.createServer((socket) => {
        socket.once('error', () => {}); // guard against ECONNRESET etc. before a real handler is attached

        negotiateMethod(socket, requireAuth, (err) => {
            if (err) return socket.end();

            if (requireAuth) {
                authenticate(socket, config.socks5.auth, (err) => {
                    if (err) return socket.end();
                    handleRequest(socket, logger);
                });
            } else {
                handleRequest(socket, logger);
            }
        });
    });

    server.on('error', (err) => {
        logger.error({ err }, 'SOCKS5 server error');
    });

    server.listen(config.socks5.port, () => {
        console.log(`SOCKS5 proxy listening on port ${config.socks5.port}`);
    });

    return server;
}

function negotiateMethod(socket, requireAuth, cb) {
    readBytes(socket, 2, (err, header) => {
        if (err) return cb(err);
        const ver = header[0];
        const nmethods = header[1];
        if (ver !== VERSION) return cb(new Error('Unsupported SOCKS version'));

        readBytes(socket, nmethods, (err, methods) => {
            if (err) return cb(err);

            const wantMethod = requireAuth ? AUTH_USERPASS : AUTH_NONE;
            const supported = methods.includes(wantMethod);

            socket.write(Buffer.from([VERSION, supported ? wantMethod : AUTH_NO_ACCEPTABLE]));
            if (!supported) return cb(new Error('No acceptable auth method'));
            cb(null);
        });
    });
}

function authenticate(socket, auth, cb) {
    readBytes(socket, 2, (err, header) => {
        if (err) return cb(err);
        const ulen = header[1];

        readBytes(socket, ulen, (err, unameBuf) => {
            if (err) return cb(err);

            readBytes(socket, 1, (err, plenBuf) => {
                if (err) return cb(err);
                const plen = plenBuf[0];

                readBytes(socket, plen, (err, passBuf) => {
                    if (err) return cb(err);

                    const ok = unameBuf.toString('utf8') === auth.username &&
                        passBuf.toString('utf8') === auth.password;

                    socket.write(Buffer.from([0x01, ok ? 0x00 : 0x01]));
                    cb(ok ? null : new Error('Auth failed'));
                });
            });
        });
    });
}

function handleRequest(socket, logger) {
    readBytes(socket, 4, (err, header) => {
        if (err) return socket.end();
        const ver = header[0];
        const cmd = header[1];
        const atyp = header[3];

        if (ver !== VERSION) return socket.end();

        if (cmd !== CMD_CONNECT) {
            return sendReply(socket, REP_CMD_NOT_SUPPORTED, () => socket.end());
        }

        readAddress(socket, atyp, (err, host) => {
            if (err) return sendReply(socket, REP_ATYP_NOT_SUPPORTED, () => socket.end());

            readBytes(socket, 2, (err, portBuf) => {
                if (err) return socket.end();
                const port = portBuf.readUInt16BE(0);

                connectUpstream(socket, host, port, logger);
            });
        });
    });
}

function connectUpstream(socket, host, port, logger) {
    const upstream = net.connect(port, host, () => {
        sendReply(socket, REP_SUCCESS, () => {
            socket.pipe(upstream);
            upstream.pipe(socket);
        });
    });

    upstream.on('error', (err) => {
        logger.error({ err, host, port }, 'SOCKS5 upstream connection failed');
        sendReply(socket, REP_HOST_UNREACHABLE, () => socket.end());
    });

    socket.on('error', () => upstream.destroy());
    upstream.on('close', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
}

function sendReply(socket, rep, cb) {
    // BND.ADDR / BND.PORT are informational for CONNECT; 0.0.0.0:0 is acceptable.
    const reply = Buffer.from([VERSION, rep, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0]);
    socket.write(reply, cb);
}

function readAddress(socket, atyp, cb) {
    if (atyp === ATYP_IPV4) {
        readBytes(socket, 4, (err, buf) => {
            if (err) return cb(err);
            cb(null, Array.from(buf).join('.'));
        });
    } else if (atyp === ATYP_DOMAIN) {
        readBytes(socket, 1, (err, lenBuf) => {
            if (err) return cb(err);
            readBytes(socket, lenBuf[0], (err, buf) => {
                if (err) return cb(err);
                cb(null, buf.toString('utf8'));
            });
        });
    } else if (atyp === ATYP_IPV6) {
        readBytes(socket, 16, (err, buf) => {
            if (err) return cb(err);
            const parts = [];
            for (let i = 0; i < 16; i += 2) {
                parts.push(buf.readUInt16BE(i).toString(16));
            }
            cb(null, parts.join(':'));
        });
    } else {
        cb(new Error('Unsupported address type'));
    }
}

// Reads exactly `n` bytes from a socket, buffering across multiple 'data' events
// and pushing back any surplus so the next read sees it.
function readBytes(socket, n, cb) {
    if (n === 0) return cb(null, Buffer.alloc(0));

    let chunks = [];
    let received = 0;
    let done = false;

    function onData(chunk) {
        chunks.push(chunk);
        received += chunk.length;
        if (received >= n) {
            cleanup();
            const buf = Buffer.concat(chunks, received);
            const result = buf.subarray(0, n);
            const rest = buf.subarray(n);
            if (rest.length > 0) socket.unshift(rest);
            finish(null, result);
        }
    }

    function onError(err) {
        cleanup();
        finish(err);
    }

    function onClose() {
        cleanup();
        finish(new Error('Socket closed'));
    }

    function cleanup() {
        socket.removeListener('data', onData);
        socket.removeListener('error', onError);
        socket.removeListener('close', onClose);
    }

    function finish(err, result) {
        if (done) return;
        done = true;
        cb(err, result);
    }

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
}

module.exports = startSocks5Server;
