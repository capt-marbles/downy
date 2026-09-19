export class AuthVault {
  constructor(home: string, checkpoint: string, key: string);
  restore(): Promise<void>;
  flush(): Promise<void>;
  start(): void;
  close(): void;
}
