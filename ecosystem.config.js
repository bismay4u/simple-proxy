module.exports = {
  apps : [{
    name: 'Simple Proxy',
    script: 'index.js',
    instances : 'max',
    cron_restart: '10 03 * * *',
    max_memory_restart: '1024M',
    exec_mode : "cluster",
    env: {
        "NODE_ENV": "production"
    }
  }]
};
