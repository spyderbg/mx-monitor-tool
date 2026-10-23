declare module 'postject' {
  export function inject(filename: string, resourceName: string, resourceData: Buffer, options: { sentinelFuse: string }): Promise<void>;
}
