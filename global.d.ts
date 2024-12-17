declare module 'node-localstorage' {
    export class LocalStorage {
      constructor(location: string, quota?: number);
      getItem(key: string): string | null;
      setItem(key: string, value: string): void;
      removeItem(key: string): void;
      clear(): void;
      key(index: number): string | null;
      length: number;
    }
  }
  