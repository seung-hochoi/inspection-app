const { spawnSync } = require('child_process');
const result = spawnSync('npm', ['run', 'build'], {
  cwd: 'C:/inspection-app-main (1)/inspection-app-main',
  timeout: 180000,
  encoding: 'utf8',
  env: { ...process.env, CI: 'false' },
  shell: true
});
console.log('EXIT CODE:', result.status);
console.log('STDOUT:', (result.stdout || '').slice(-4000));
console.log('STDERR:', (result.stderr || '').slice(-4000));
