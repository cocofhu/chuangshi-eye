import { mountCommandChrome } from './ui/commandChrome.js';
import { createStandaloneApplication } from './standalone/application.js';
import { describeError } from './standalone/errors.js';

mountCommandChrome();

const application = createStandaloneApplication({
  googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
  cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
  tiandituEnabled: import.meta.env.TIANDITU_ENABLED === true,
  amapEnabled: import.meta.env.AMAP_ENABLED === true,
  allowQaRegistration: import.meta.env.DEV,
});

application.start().catch((error) => {
  console.error('创世之眼初始化失败:', error);
  const loaderStatus = document.querySelector('#loading-screen .loader-status');
  loaderStatus.textContent = `启动失败：${describeError(error)}`;
  loaderStatus.style.color = '#ff4444';
});

export { application };
