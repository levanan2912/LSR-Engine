module.exports = {
  apps: [
    {
      name: 'studysignal',
      script: 'npx',
      args: 'wrangler pages dev dist --d1=studysignal-production --local --ip 0.0.0.0 --port 3000',
      cwd: '/home/user/webapp',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
        GEMINI_API_KEY: 'REDACTED_GEMINI_KEY_6',
        JWT_SECRET: 'CHANGE_THIS_JWT_SECRET_IN_PRODUCTION',
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
    }
  ]
}
