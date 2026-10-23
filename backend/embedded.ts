export interface EmbeddedAsset { mime: string; base64: string }
// Replaced by build/embedded.ts during bundling. No build required for dev/typecheck.
export const assets: Readonly<Record<string, EmbeddedAsset>> = {};
