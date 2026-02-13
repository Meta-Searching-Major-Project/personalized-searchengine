import { useRef, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bookmark, Mail, Printer, Save, ExternalLink } from "lucide-react";
import type { ResultWithId } from "@/pages/Index";
import type { useFeedbackTracker } from "@/hooks/useFeedbackTracker";

interface SearchResultCardProps {
  result: ResultWithId;
  index: number;
  feedback: ReturnType<typeof useFeedbackTracker>;
}

const engineColors: Record<string, string> = {
  google: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  bing: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  duckduckgo: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

const SearchResultCard = ({ result, index, feedback }: SearchResultCardProps) => {
  const snippetRef = useRef<HTMLParagraphElement>(null);

  // Pick the first available search_result_id for this merged result
  const searchResultId = Object.values(result.resultIds)[0];

  const displayUrl = (() => {
    try {
      const u = new URL(result.url);
      return u.hostname + (u.pathname !== "/" ? u.pathname : "");
    } catch {
      return result.url;
    }
  })();

  // C — track copy events on the snippet
  useEffect(() => {
    const el = snippetRef.current;
    if (!el || !searchResultId) return;

    const handler = () => {
      const sel = window.getSelection();
      const text = sel?.toString() || "";
      if (text.length > 0) {
        feedback.trackCopyPaste(searchResultId, text.length);
      }
    };

    el.addEventListener("copy", handler);
    return () => el.removeEventListener("copy", handler);
  }, [searchResultId, feedback]);

  // V + T — track click order on open, dwell time on return via visibilitychange
  const handleLinkClick = useCallback(() => {
    if (!searchResultId) return;
    feedback.trackClick({ searchResultId, url: result.url });

    // Listen for visibility change to estimate dwell time
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        feedback.trackDwell(searchResultId);
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
  }, [searchResultId, result.url, feedback]);

  const handleAction = useCallback(
    (action: string) => {
      if (!searchResultId) return;
      switch (action) {
        case "save":
          feedback.trackSave(searchResultId);
          break;
        case "bookmark":
          feedback.trackBookmark(searchResultId);
          break;
        case "email":
          feedback.trackEmail(searchResultId);
          break;
        case "print":
          feedback.trackPrint(searchResultId);
          break;
      }
    },
    [searchResultId, feedback],
  );

  return (
    <div className="group rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
              {index + 1}
            </span>
            <p className="truncate text-xs text-muted-foreground">{displayUrl}</p>
          </div>
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-1 inline-flex items-center gap-1 text-base font-medium text-primary hover:underline"
            onClick={handleLinkClick}
          >
            {result.title}
            <ExternalLink className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          </a>
          {result.snippet && (
            <p
              ref={snippetRef}
              className="text-sm text-muted-foreground line-clamp-2"
            >
              {result.snippet}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {result.engines.map((e) => (
              <Badge
                key={e.engine}
                variant="secondary"
                className={`text-[10px] ${engineColors[e.engine] || ""}`}
              >
                {e.engine} #{e.rank}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Save"
            onClick={() => handleAction("save")}
          >
            <Save className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Bookmark"
            onClick={() => handleAction("bookmark")}
          >
            <Bookmark className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Email"
            onClick={() => handleAction("email")}
          >
            <Mail className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Print"
            onClick={() => handleAction("print")}
          >
            <Printer className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SearchResultCard;
