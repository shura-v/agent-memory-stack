export const accountProviders = {
  codex: { label: 'ChatGPT (Codex)', loginFlag: '-codex-device-login' },
  claude: { label: 'Claude', loginFlag: '-claude-login' },
} as const;

export type AccountProvider = keyof typeof accountProviders;
