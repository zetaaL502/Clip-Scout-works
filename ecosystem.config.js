module.exports = {
  apps: [
    {
      name: "api-server",
      script: "C:/Users/Galaxy/AppData/Roaming/npm/pnpm.cmd",
      args: "run dev",
      cwd: "C:/Users/Galaxy/Clip-Scout-works-2/artifacts/api-server",
      interpreter: "none",
      shell: true,
      windowsHide: true,
      autorestart: true,
      restart_delay: 5000,
      env: {
        NODE_ENV: "development"
      }
    },
    {
      name: "frontend",
      script: "C:/Users/Galaxy/AppData/Roaming/npm/pnpm.cmd",
      args: "run dev",
      cwd: "C:/Users/Galaxy/Clip-Scout-works-2/artifacts/clipscout",
      interpreter: "none",
      shell: true,
      windowsHide: true,
      autorestart: true,
      restart_delay: 5000,
      env: {
        NODE_ENV: "development",
        PORT: "3001",
        BASE_PATH: "/"
      }
    }
  ]
};