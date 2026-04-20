export const SECRET_PATTERNS = [
  { name: 'github-token', regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g, envHint: 'GITHUB_TOKEN' },
  { name: 'aws-access-key', regex: /\bAKIA[0-9A-Z]{16}\b/g, envHint: 'AWS_ACCESS_KEY_ID' },
  { name: 'openai-api-key', regex: /\bsk-(?!ant-)[A-Za-z0-9_-]{20,}\b/g, envHint: 'OPENAI_API_KEY' },
  { name: 'anthropic-api-key', regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, envHint: 'ANTHROPIC_API_KEY' },
];
