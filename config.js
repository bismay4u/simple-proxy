const packageConfig = require('./package.json');

module.exports = {
	name: packageConfig.title,
	version: packageConfig.version,
	packageid: packageConfig.name,
	env: process.env.NODE_ENV || 'development',
	port: process.env.PORT || 9010,
	base_url: process.env.BASE_URL || 'http://localhost:9010',
	cors_sites: "*",
	cache : {
		host: '127.0.0.1',   // Redis host
		port: 6379,          // Redis port
		family: 4,           // 4 (IPv4) or 6 (IPv6)
		//password: 'auth',
		db: 0
	},
	throttle: {
		burst: 10,  // Max 10 concurrent requests (if tokens)
		rate: 0.5,  // Steady state: 1 request / 2 seconds
		ip: true,   // throttle per IP
		overrides: {
			'localhost': {
				burst: 0,
				rate: 0    // unlimited
			}
		}
	},
	default_request_params: {
        method: 'GET',
        url: 'http://127.0.0.1',
        headers: {},
        timeout: 1500,
        gzip: true,
        use_response_headers: false
    },
	socks5: {
		enabled: process.env.SOCKS5_ENABLED !== 'false',
		port: process.env.SOCKS5_PORT || 1080,
		auth: (process.env.SOCKS5_USER && process.env.SOCKS5_PASS) ? {
			username: process.env.SOCKS5_USER,
			password: process.env.SOCKS5_PASS
		} : null
	},
	admin_token: process.env.ADMIN_TOKEN || null
};