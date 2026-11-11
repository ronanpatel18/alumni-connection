import { Icon } from "./icon";

/** The one-line result shown after an action redirects back with `?result=…`. */
export function ResultNotice({ result, messages }: { result: string | string[] | undefined; messages: Record<string, { tone?: "success" | "error"; text: string }> }) {
  const notice = typeof result === "string" ? messages[result] : undefined;
  if (!notice) return null;
  const tone = notice.tone ?? "success";
  return (
    <div className={`notice ${tone}`} role={tone === "success" ? "status" : "alert"} style={{ marginBottom: 24 }}>
      <Icon name={tone === "success" ? "check" : "info"} />
      <div>{notice.text}</div>
    </div>
  );
}
