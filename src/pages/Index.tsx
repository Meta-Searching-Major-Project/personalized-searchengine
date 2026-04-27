import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Loader2, LogIn } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import AppHeader from "@/components/AppHeader";
import AnimatedBackground from "@/components/AnimatedBackground";
import SearchResultCard from "@/components/SearchResultCard";
import EngineStatusBar from "@/components/EngineStatusBar";
import RichWidgets from "@/components/RichWidgets";
import { multiSearch, type MergedResult, type EngineSummary, type RichBlocks } from "@/lib/api/search";
import { updateLearningIndex, computeSQM } from "@/lib/api/learningIndex";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useFeedbackTracker } from "@/hooks/useFeedbackTracker";
import { ExtensionPrompt } from "@/components/ExtensionPrompt";

export interface ResultWithId extends MergedResult {
  /** Maps engine name → search_results row id */
  resultIds: Record<string, string>;
}

const Index = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ResultWithId[]>([]);
  const [engineSummary, setEngineSummary] = useState<EngineSummary[]>([]);
  const [richBlocks, setRichBlocks] = useState<RichBlocks | undefined>();
  const [searchedQuery, setSearchedQuery] = useState("");
  const [queryTime, setQueryTime] = useState<number | undefined>();
  const [aggregationMethod, setAggregationMethod] = useState("borda");
  const [usedMethod, setUsedMethod] = useState<string | undefined>();
  const [queryIntent, setQueryIntent] = useState<string | undefined>();
  const startTimeRef = useRef<number>(0);
  const prevHistoryIdRef = useRef<string | null>(null);

  const feedback = useFeedbackTracker();

  // Fetch user's preferred aggregation method
  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("default_aggregation_method")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (data?.default_aggregation_method) {
          setAggregationMethod(data.default_aggregation_method);
        }
      });
  }, [user]);

  // Handle re-run from analytics page
  const rerunHandled = useRef(false);
  useEffect(() => {
    const rerunQuery = (location.state as any)?.rerunQuery;
    if (rerunQuery && !rerunHandled.current) {
      rerunHandled.current = true;
      setQuery(rerunQuery);
      // Clear the state so it doesn't re-trigger
      window.history.replaceState({}, document.title);
      // Auto-submit after a tick
      setTimeout(() => {
        const form = document.querySelector("form");
        if (form) form.requestSubmit();
      }, 100);
    }
  }, [location.state]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    const isGuest = !user;

    setLoading(true);
    setResults([]);
    setEngineSummary([]);
    setRichBlocks(undefined);
    setQueryIntent(undefined);
    setSearchedQuery(trimmed);
    // Process previous session's feedback before starting new search (signed-in only)
    if (!isGuest && prevHistoryIdRef.current) {
      // 1. Tell extension to flush current dwell times to DB
      window.postMessage({ type: "PERSONASEARCH_FLUSH_DWELL" }, "*");

      // 2. Wait a tiny bit for the extension's POST request to hit Supabase
      await new Promise(resolve => setTimeout(resolve, 300));

      // 3. Process the feedback and update indexes
      await Promise.all([
        updateLearningIndex(prevHistoryIdRef.current),
        computeSQM(prevHistoryIdRef.current)
      ]);
    }

    if (!isGuest) feedback.resetSession();
    startTimeRef.current = Date.now();

    try {
      const response = await multiSearch(trimmed, aggregationMethod);
      const elapsed = Date.now() - startTimeRef.current;
      setQueryTime(elapsed);
      setUsedMethod(response.aggregation_method);
      setQueryIntent(response.query_intent);

      if (!response.success) {
        toast({
          title: "Search failed",
          description: response.error || "An error occurred",
          variant: "destructive",
        });
        return;
      }

      const merged = response.merged || [];
      setEngineSummary(response.engineResults || []);
      setRichBlocks(response.richBlocks);
      // Guest users: show results without persistence
      if (isGuest) {
        setResults(merged.map((m) => ({ ...m, resultIds: {} })));
        return;
      }

      // Persist search history and results for signed-in users
      const { data: historyRow, error: historyError } = await supabase
        .from("search_history")
        .insert({ query: trimmed, user_id: user.id })
        .select("id")
        .single();

      if (historyError) {
        console.error("Failed to save search history:", historyError);
        prevHistoryIdRef.current = null;
        setResults(merged.map((m) => ({ ...m, resultIds: {} })));
        return;
      }

      if (historyRow && merged.length > 0) {
        prevHistoryIdRef.current = historyRow.id;
        const resultRows: {
          search_history_id: string;
          engine: string;
          original_rank: number;
          title: string;
          url: string;
          snippet: string | null;
          aggregated_rank: number;
        }[] = [];

        merged.forEach((m, aggIdx) => {
          m.engines.forEach((eng) => {
            resultRows.push({
              search_history_id: historyRow.id,
              engine: eng.engine,
              original_rank: eng.rank,
              title: m.title,
              url: m.url,
              snippet: m.snippet || null,
              aggregated_rank: aggIdx + 1,
            });
          });
        });

        const { data: insertedResults, error: resultsError } = await supabase
          .from("search_results")
          .insert(resultRows)
          .select("id, url, engine");

        if (resultsError) {
          console.error("Failed to save search results:", resultsError);
          setResults(merged.map((m) => ({ ...m, resultIds: {} })));
          return;
        }

        const idMap = new Map<string, Record<string, string>>();
        insertedResults?.forEach((r) => {
          if (!idMap.has(r.url)) idMap.set(r.url, {});
          idMap.get(r.url)![r.engine] = r.id;
        });

        setResults(
          merged.map((m) => ({
            ...m,
            resultIds: idMap.get(m.url) || {},
          })),
        );
      } else {
        setResults(merged.map((m) => ({ ...m, resultIds: {} })));
      }
    } catch (error) {
      console.error("Search error:", error);
      toast({
        title: "Search failed",
        description: "Could not connect to search service",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Process learning index on page unload for the last session
  useEffect(() => {
    const handleUnload = () => {
      if (prevHistoryIdRef.current) {
        // Fire-and-forget via sendBeacon fallback
        updateLearningIndex(prevHistoryIdRef.current);
        computeSQM(prevHistoryIdRef.current);
      }
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, []);

  const hasResults = results.length > 0;

  return (
    <div className={`min-h-screen relative ${hasResults ? "bg-slate-50" : ""} overflow-hidden`}>
      {!hasResults && <AnimatedBackground />}
      <AppHeader />
      <main
        className={`flex flex-col items-center px-4 transition-all relative z-10 ${
          hasResults ? "pt-24" : "justify-center pt-20"
        }`}
        style={{ minHeight: "100vh" }}
      >
        <div className={`w-full relative ${hasResults ? "max-w-3xl" : "max-w-4xl text-center"}`}>
          <ExtensionPrompt />

          <form onSubmit={handleSearch} className={!hasResults ? "mx-auto max-w-2xl bg-white/60 backdrop-blur-xl border border-white/80 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-full p-2 flex items-center" : "flex gap-2"}>
            <div className="relative flex-1">
              <Search className={`absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 ${!hasResults ? "text-slate-400" : "text-muted-foreground"}`} />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={!hasResults ? "Search with aggregated, personalized results..." : "Search the web..."}
                className={`pl-12 ${!hasResults ? "h-12 border-0 bg-transparent shadow-none text-lg focus-visible:ring-0 placeholder:text-slate-400" : ""}`}
                autoFocus
                disabled={loading}
              />
            </div>
            <Button 
              type="submit" 
              disabled={loading || !query.trim()} 
              className={!hasResults 
                ? "h-12 px-8 rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white font-medium shadow-md transition-all flex items-center gap-2" 
                : "bg-slate-500 hover:bg-slate-600 text-white"}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                <>
                  {!hasResults && <Search className="h-4 w-4" />}
                  <span>Search</span>
                </>
              )}
            </Button>
          </form>

          {!hasResults && !loading && (
            <div className="mt-6 space-y-4">
              <p className="text-[15px] font-medium text-slate-700">
                Explore information across multiple sources, unified and personalized for you.
              </p>
            </div>
          )}

          {loading && (
            <div className="mt-12 flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Querying multiple search engines in parallel...
              </p>
            </div>
          )}

          {hasResults && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">
                  Results for &ldquo;{searchedQuery}&rdquo;
                </p>
              </div>
              <EngineStatusBar
                engines={engineSummary}
                totalResults={results.length}
                queryTime={queryTime}
                aggregationMethod={usedMethod}
                queryIntent={queryIntent}
              />
              <RichWidgets blocks={richBlocks} />
              {!user && (
                <button
                  onClick={() => navigate("/auth")}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  <LogIn className="h-3 w-3" />
                  Sign in to save history &amp; get personalized results
                </button>
              )}
              <div className="space-y-2 pb-8">
                {results.map((result, i) => (
                  <SearchResultCard
                    key={result.url}
                    result={result}
                    index={i}
                    feedback={feedback}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {!hasResults && (
        <footer className="absolute bottom-6 w-full text-center text-xs font-medium text-slate-500 flex justify-center gap-4 z-10">
          <a href="#" className="hover:text-slate-700">Privacy</a>
          <span className="text-slate-300">|</span>
          <a href="#" className="hover:text-slate-700">Terms</a>
          <span className="text-slate-300">|</span>
          <a href="#" className="hover:text-slate-700">Support</a>
          <span className="text-slate-300">|</span>
          <a href="#" className="hover:text-slate-700">Careers</a>
          <span className="text-slate-300">|</span>
          <a href="#" className="hover:text-slate-700">Copyright</a>
        </footer>
      )}
    </div>
  );
};

export default Index;
