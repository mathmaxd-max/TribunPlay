interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_WS_BASE?: string;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
