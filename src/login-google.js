import { loadConfig } from './config.js';
import { loginGoogle } from './google.js';

const config = loadConfig();
const tokenPath = await loginGoogle(config);
console.log(`Google authorization saved to ${tokenPath}`);

