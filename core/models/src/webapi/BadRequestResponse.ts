export type BadRequestResponse = {
  type: string;
  title: string;
  status: number;
  errors: Record<string, string[]>;
  traceId: string;
};
