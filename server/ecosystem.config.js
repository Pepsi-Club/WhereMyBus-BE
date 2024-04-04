module.exports = {
  apps: [
    {
      name: 'app',
      script: 'npm',
      args: 'start',
      instances: 0,
      exec_mode: 'cluster',
      wait_ready: true,
      listen_timeout: 30000,
      kill_timeout: 5000,
      watch: true,
      ignore_watch: ['node_modules'],
      max_memory_restart: '900M',
    },
  ],
};
