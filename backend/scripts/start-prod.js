const { spawn } = require('child_process');
const { configureDatabaseUrl } = require('./database-url');

async function start() {
  try {
    console.log('Starting application...');
    configureDatabaseUrl();

    // Schema migration is executed exactly once by the release Cloud Run Job.
    // Runtime instances must only start the application process.
    console.log('Starting NestJS server...');
    const args = process.env.ERP_DEV_SANDBOX === 'true'
      ? ['--require', './scripts/dev-sandbox.cjs', 'dist/src/main.js']
      : ['dist/src/main.js'];
    const child = spawn('node', args, {
      stdio: 'inherit',
      env: process.env,
    });

    for (const signal of ['SIGTERM', 'SIGINT']) {
      process.on(signal, () => {
        if (!child.killed) {
          child.kill(signal);
        }
      });
    }

    child.on('error', (error) => {
      console.error('Unable to start NestJS server:', error);
      process.exit(1);
    });
    child.on('close', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code || 0);
    });
  } catch (error) {
    console.error('Startup failed:', error);
    process.exit(1);
  }
}

start();
