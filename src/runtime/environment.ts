// Preload service settings before upstream imports run. No shell evaluation or
// recursive ${...} expansion: provider-issued credentials stay byte-for-byte.
import { readFileSync } from 'node:fs';
import { parseNativeEnv } from './native-env.js';

if (process.env.AMS_ENV_FILE) {
  const values = JSON.parse(readFileSync(process.env.AMS_ENV_FILE, 'utf8'));
  if (!values || Array.isArray(values) || typeof values !== 'object') {
    throw new Error('AMS_ENV_FILE must contain an environment object');
  }
  for (const [name, value] of Object.entries(values)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name) || typeof value !== 'string') {
      throw new Error('AMS_ENV_FILE contains an invalid environment entry');
    }
    process.env[name] = value;
  }
}

// Knowledge and Panel own their complete native environment documents. Load
// them after helper settings, without shell or Compose interpolation.
if (process.env.AMS_NATIVE_ENV_FILE) {
  for (const [name, value] of Object.entries(parseNativeEnv(readFileSync(process.env.AMS_NATIVE_ENV_FILE, 'utf8')))) {
    process.env[name] = value;
  }
}
