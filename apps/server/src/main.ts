import { loadConfig } from './config/index.js';
import { createApp } from './http/app.js';

const config = loadConfig();
createApp().listen(config.PORT, config.HOST, () => {
  console.log(`remote-terminal-access server listening on http://${config.HOST}:${config.PORT}`);
});
