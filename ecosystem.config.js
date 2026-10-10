// One file for both instances. BOOGBE_INSTANCE=prod|staging selects names, ports and cwd.
const instance = process.env.BOOGBE_INSTANCE || 'prod';
const cwd = instance === 'prod' ? '/home/boogbe/app' : '/home/boogbe/staging';
const port = instance === 'prod' ? 3060 : 3061;
const common = {
  cwd,
  instances: 1,
  exec_mode: 'fork', // single instance on purpose: throttler and auth rate limits are in-memory (as Unclutter)
  autorestart: true,
  min_uptime: '30s',
  max_restarts: 10,
  restart_delay: 2000,
  max_memory_restart: '600M',
  kill_timeout: 10000,
  merge_logs: true,
  time: true,
};
module.exports = {
  apps: [
    {
      ...common,
      name: `boogbe-${instance}-api`,
      script: './apps/api/dist/main.js',
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      env_production: { NODE_ENV: 'production', PORT: port, BOOGBE_ROLE: 'api' },
    },
    {
      ...common,
      name: `boogbe-${instance}-worker`,
      script: './apps/api/dist/worker.js',
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      env_production: { NODE_ENV: 'production', BOOGBE_ROLE: 'worker' },
    },
  ],
};
