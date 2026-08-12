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
