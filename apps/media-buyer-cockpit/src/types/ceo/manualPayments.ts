export type ManualPaymentRefusal = {
  code: "refused" | "repeat" | string;
  message: string;
  refusal?: string;
  possibleMatch?: any;
  [key: string]: any;
};
