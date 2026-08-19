export interface RenderOptions {
  signal?: AbortSignal;
}
export interface ReportRenderer<TInput, TOutput> {
  render(report: TInput, options?: RenderOptions): Promise<TOutput>;
}
