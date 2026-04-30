import { build } from 'vite';

process.env.CSS_TRANSFORMER_WASM ||= '1';
process.env.NAPI_RS_FORCE_WASI ||= '1';

try {
  await build();
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
