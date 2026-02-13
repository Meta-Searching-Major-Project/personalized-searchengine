import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bookmark, Mail, Printer, Save, ExternalLink } from "lucide-react";
import type { MergedResult } from "@/lib/api/search";

interface SearchResultCardProps {
  result: MergedResult;
  index: number;
  onAction?: (url: string, action: string) => void;
}

const engineColors: Record<string, string> = {
  google: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  bing: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  duckduckgo: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

const SearchResultCard = ({ result, index, onAction }: SearchResultCardProps) => {
  const displayUrl = (() => {
    try {
      const u = new URL(result.url);
      return u.hostname + (u.pathname !== "/" ? u.pathname : "");
    } catch {
      return result.url;
    }
  })();

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
          >
            {result.title}
            <ExternalLink className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          </a>
          {result.snippet && (
            <p className="text-sm text-muted-foreground line-clamp-2">
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
            onClick={() => onAction?.(result.url, "save")}
          >
            <Save className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Bookmark"
            onClick={() => onAction?.(result.url, "bookmark")}
          >
            <Bookmark className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Email"
            onClick={() => onAction?.(result.url, "email")}
          >
            <Mail className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Print"
            onClick={() => onAction?.(result.url, "print")}
          >
            <Printer className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SearchResultCard;
