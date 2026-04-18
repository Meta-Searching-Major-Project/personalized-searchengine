import { useState, useRef, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bookmark, Mail, Printer, Save, ExternalLink, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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
  learned: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  local_index: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
};

const SearchResultCard = ({ result, index, feedback }: SearchResultCardProps) => {
  const snippetRef = useRef<HTMLParagraphElement>(null);
  const { toast } = useToast();

  // Track which actions have been performed (for visual feedback)
  const [actions, setActions] = useState<Record<string, boolean>>({});

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

  // C — track copy events on the snippet (fallback when no extension)
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

  // V + T — track click order, notify extension for dwell tracking
  const handleLinkClick = useCallback(() => {
    if (!searchResultId) return;
    feedback.trackClick({ searchResultId, url: result.url });

    // Notify the Chrome extension to start tracking dwell time
    // The extension's content script listens for this message
    window.postMessage(
      {
        type: "PERSONASEARCH_TRACK_START",
        url: result.url,
        searchResultId,
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
        authToken: feedback.getAuthToken?.() || "",
      },
      "*"
    );

    // Fallback: use visibilitychange for users without the extension
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
          setActions((prev) => ({ ...prev, save: true }));
          toast({ description: "Result saved ✓", duration: 1500 });
          break;
        case "bookmark":
          feedback.trackBookmark(searchResultId);
          setActions((prev) => ({ ...prev, bookmark: true }));
          toast({ description: "Result bookmarked ✓", duration: 1500 });
          break;
        case "email":
          feedback.trackEmail(searchResultId);
          setActions((prev) => ({ ...prev, email: true }));
          // Actually open email compose
          window.open(
            `mailto:?subject=${encodeURIComponent(result.title)}&body=${encodeURIComponent(
              `Check out: ${result.url}\n\n${result.snippet || ""}`
            )}`,
            "_self"
          );
          break;
        case "print":
          feedback.trackPrint(searchResultId);
          setActions((prev) => ({ ...prev, print: true }));
          // Actually open the page for printing
          const printWin = window.open(result.url, "_blank");
          if (printWin) {
            printWin.addEventListener("load", () => {
              setTimeout(() => printWin.print(), 500);
            });
          }
          break;
      }
    },
    [searchResultId, feedback, result, toast],
  );

  const ActionButton = ({
    action,
    title,
    icon: Icon,
  }: {
    action: string;
    title: string;
    icon: typeof Save;
  }) => (
    <Button
      variant="ghost"
      size="icon"
      className={`h-7 w-7 transition-colors ${
        actions[action]
          ? "text-primary bg-primary/10"
          : ""
      }`}
      title={actions[action] ? `${title} ✓` : title}
      onClick={() => handleAction(action)}
    >
      {actions[action] ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Icon className="h-3.5 w-3.5" />
      )}
    </Button>
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
          <ActionButton action="save" title="Save" icon={Save} />
          <ActionButton action="bookmark" title="Bookmark" icon={Bookmark} />
          <ActionButton action="email" title="Email" icon={Mail} />
          <ActionButton action="print" title="Print" icon={Printer} />
        </div>
      </div>
    </div>
  );
};

export default SearchResultCard;
