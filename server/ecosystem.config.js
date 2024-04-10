module.exports = {
  apps: [
    {
      name: 'app',
      script: 'npm',
      args: 'start',
      instances: -1,
      exec_mode: 'cluster',
      wait_ready: true,
      listen_timeout: 30000,
      kill_timeout: 5000,
      watch: true,
      ignore_watch: ['node_modules', 'logs'],
      max_memory_restart: '900M',
    },
  ],
};
