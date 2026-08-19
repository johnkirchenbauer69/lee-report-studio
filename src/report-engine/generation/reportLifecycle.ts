import type { ReportInstance } from "../schema/generation";

export function transitionReportStatus(
  instance: ReportInstance,
  status: ReportInstance["status"],
): ReportInstance {
  if (status === "approved" && !instance.readiness.canApprove) {
    throw new Error(
      `Cannot approve report:\n${instance.readiness.blockers.map((issue) => `- ${issue.message}`).join("\n")}`,
    );
  }
  if (status === "published" && !instance.readiness.canPublish) {
    throw new Error(
      `Cannot publish report:\n${instance.readiness.blockers.map((issue) => `- ${issue.message}`).join("\n")}`,
    );
  }
  return { ...instance, status };
}
