export interface RedisConfigOptions {
  host: string;
  port: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  tls?: boolean;
  maxRetriesPerRequest?: number | null;
}
