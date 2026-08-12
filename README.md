# Simple Proxy

Simple Proxy, a free, open-source, very fast, reliable, and simple proxying software for TCP and HTTP-based applications, built on NodeJS for redirecting data from request to another server for sake of security and used during server side whitelisting. 

A Proxy Server is a gateway or an intermediary server that takes a client request, passes it on to one or more back-end servers, and subsequently fetches the response from the server and delivers it back to the client, thus making it appear as if the content originated from the reverse proxy server itself.


Simple Proxy is non-caching request proxy powered by an event-driven, non-blocking engine that combines a very fast I/O layer with a priority-based, multi-threaded scheduler which enables it to easily deal with tens of thousands of concurrent connections. 

# Common Use Cases:
+ Using single Whitelisted Server for creation of microservices across multiple development servers.

# SOCKS5 Proxy
Simple Proxy also runs a SOCKS5 server (RFC 1928, CONNECT command only) alongside the HTTP reverse proxy, so any SOCKS5-capable client can tunnel arbitrary TCP traffic through the whitelisted host.

Configure it via env vars (see [config.js](config.js)):
+ `SOCKS5_ENABLED` — set to `false` to disable (default: enabled)
+ `SOCKS5_PORT` — listen port (default: `1080`)
+ `SOCKS5_USER` / `SOCKS5_PASS` — set both to require username/password auth (default: no auth)

# Admin API
A `/api` route lets you manage the gateway at runtime — add/edit/remove proxy routes and update select settings — without restarting the server. It's disabled (503) unless `ADMIN_TOKEN` is set, and every request must send `Authorization: Bearer <ADMIN_TOKEN>`. Changes are persisted to `state.json` (gitignored) so they survive restarts, and `proxy.js` / `config.js` are only used to seed that file on first boot.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/routes` | List all proxy routes |
| GET | `/api/routes/:key` | Get one route |
| POST | `/api/routes` | Create a route — body: `{ "key", "url", "headers" }` |
| PUT | `/api/routes/:key` | Replace a route's `url`/`headers` |
| DELETE | `/api/routes/:key` | Remove a route |
| GET | `/api/settings` | View current gateway settings |
| PATCH | `/api/settings` | Update `cors_sites` and/or `socks5` (restarts the SOCKS5 listener if changed) |

Example:
```
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  -X POST http://localhost:9010/api/routes \
  -H "Content-Type: application/json" \
  -d '{"key":"test","url":"https://test.com","headers":{"Authorization":"Bearer test"}}'
```

Note: `throttle` (rate limiting) is fixed at server startup by restify's plugin and isn't editable through this API — changing it still requires a restart.

# Features In Plan:
+ Logging
+ Statistics
+ SSL support
+ Monitoring
+ Load Balancing
+ Stickiness
+ content switching
+ HTTP rewriting
+ Redirection
+ Server protection


Thank you
Bismay M
