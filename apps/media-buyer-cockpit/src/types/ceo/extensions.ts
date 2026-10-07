export type ApplyResult = {
  written: number;
  cleared: number;
  skipped: number;
  errors: string[];
  note: string;
  ok?: boolean;
  error?: string;
  applied?: number;
  [key: string]: any;
};

export type ExtensionsWithLastMonth = {
  extensions: any[];
  lastMonth?: any;
  [key: string]: any;
};
