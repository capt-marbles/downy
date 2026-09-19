export class AuthVault {
  constructor(home: string, checkpoint: string, key: string);
  restore(saved?: {
    v: number;
    iv: string;
    tag: string;
    ciphertext: string;
  }): Promise<void>;
  snapshot(): Promise<{
    v: number;
    iv: string;
    tag: string;
    ciphertext: string;
  } | null>;
  flush(): Promise<void>;
  start(): void;
  close(): void;
}
