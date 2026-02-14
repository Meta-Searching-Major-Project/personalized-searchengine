import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppHeader from "@/components/AppHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart3, History, BookmarkIcon, Search, TrendingUp, Users, ExternalLink } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from "recharts";
import { useNavigate } from "react-router-dom";

interface SearchHistoryItem {
  id: string;
  query: string;
  created_at: string;
}

interface SQMEntry {
  engine: string;
  sqm_score: number;
  query_count: number;
  updated_at: string;
}

interface LearnedDoc {
  id: string;
  url: string;
  title: string | null;
  snippet: string | null;
  learned_score: number;
  updated_at: string;
}

interface SavedDoc {
  id: string;
  url: string;
  title: string;
  saved: boolean | null;
  bookmarked: boolean | null;
}

const AnalyticsPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [sqmData, setSqmData] = useState<SQMEntry[]>([]);
  const [learnedDocs, setLearnedDocs] = useState<LearnedDoc[]>([]);
  const [savedDocs, setSavedDocs] = useState<SavedDoc[]>([]);
  const [loading, setLoading] = useState(true);

  // Admin state
  const [adminSqm, setAdminSqm] = useState<{ engine: string; avg_score: number; total_queries: number; user_count: number }[]>([]);
  const [adminUserCount, setAdminUserCount] = useState(0);
  const [adminSearchCount, setAdminSearchCount] = useState(0);

  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      setLoading(true);

      // Check admin role
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();

      const userIsAdmin = !!roleData;
      setIsAdmin(userIsAdmin);

      // Fetch user data in parallel
      const [historyRes, sqmRes, learnedRes, savedRes] = await Promise.all([
        supabase
          .from("search_history")
          .select("id, query, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("search_quality_measures")
          .select("engine, sqm_score, query_count, updated_at")
          .eq("user_id", user.id),
        supabase
          .from("feedback_learning_index")
          .select("id, url, title, snippet, learned_score, updated_at")
          .eq("user_id", user.id)
          .order("learned_score", { ascending: false })
          .limit(50),
        supabase
          .from("user_feedback")
          .select("id, search_result_id, saved, bookmarked")
          .eq("user_id", user.id)
          .or("saved.eq.true,bookmarked.eq.true"),
      ]);

      setSearchHistory(historyRes.data || []);
      setSqmData(sqmRes.data || []);
      setLearnedDocs(learnedRes.data || []);

      // For saved/bookmarked docs, fetch the corresponding search_results to get URLs/titles
      if (savedRes.data && savedRes.data.length > 0) {
        const resultIds = savedRes.data.map((f) => f.search_result_id);
        const { data: resultDetails } = await supabase
          .from("search_results")
          .select("id, url, title")
          .in("id", resultIds);

        if (resultDetails) {
          const feedbackMap = new Map(savedRes.data.map((f) => [f.search_result_id, f]));
          const docs: SavedDoc[] = resultDetails.map((r) => {
            const fb = feedbackMap.get(r.id);
            return {
              id: r.id,
              url: r.url,
              title: r.title,
              saved: fb?.saved ?? false,
              bookmarked: fb?.bookmarked ?? false,
            };
          });
          // Dedupe by URL
          const seen = new Set<string>();
          setSavedDocs(docs.filter((d) => {
            if (seen.has(d.url)) return false;
            seen.add(d.url);
            return true;
          }));
        }
      }

      // Fetch admin data if admin
      if (userIsAdmin) {
        const [adminSqmRes, adminProfilesRes, adminHistoryRes] = await Promise.all([
          supabase
            .from("search_quality_measures")
            .select("engine, sqm_score, query_count, user_id"),
          supabase
            .from("profiles")
            .select("id"),
          supabase
            .from("search_history")
            .select("id"),
        ]);

        setAdminUserCount(adminProfilesRes.data?.length || 0);
        setAdminSearchCount(adminHistoryRes.data?.length || 0);

        // Aggregate SQM by engine
        if (adminSqmRes.data) {
          const engineMap = new Map<string, { total: number; count: number; queries: number; users: Set<string> }>();
          for (const row of adminSqmRes.data) {
            const existing = engineMap.get(row.engine) || { total: 0, count: 0, queries: 0, users: new Set<string>() };
            existing.total += row.sqm_score;
            existing.count += 1;
            existing.queries += row.query_count;
            existing.users.add(row.user_id);
            engineMap.set(row.engine, existing);
          }
          setAdminSqm(
            Array.from(engineMap.entries()).map(([engine, data]) => ({
              engine,
              avg_score: data.count > 0 ? data.total / data.count : 0,
              total_queries: data.queries,
              user_count: data.users.size,
            }))
          );
        }
      }

      setLoading(false);
    };

    fetchData();
  }, [user]);

  const handleRerunSearch = (query: string) => {
    navigate("/", { state: { rerunQuery: query } });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <div className="flex items-center justify-center p-12 text-muted-foreground">Loading analytics...</div>
      </div>
    );
  }

  const sqmChartData = sqmData.map((s) => ({
    engine: s.engine.charAt(0).toUpperCase() + s.engine.slice(1),
    score: Number(s.sqm_score.toFixed(3)),
    queries: s.query_count,
  }));

  const learnedChartData = learnedDocs.slice(0, 10).map((d) => ({
    name: (d.title || d.url).substring(0, 30) + ((d.title || d.url).length > 30 ? "…" : ""),
    score: Number(d.learned_score.toFixed(3)),
  }));

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-5xl p-4 space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Analytics</h1>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="history">Search History</TabsTrigger>
            <TabsTrigger value="library">Saved & Bookmarked</TabsTrigger>
            <TabsTrigger value="learning">Learning Index</TabsTrigger>
            {isAdmin && <TabsTrigger value="admin">Admin</TabsTrigger>}
          </TabsList>

          {/* ── Overview Tab ── */}
          <TabsContent value="overview" className="space-y-6 mt-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Searches</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-foreground">{searchHistory.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Learned Documents</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-foreground">{learnedDocs.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Saved / Bookmarked</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-foreground">{savedDocs.length}</p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Search Quality Measures (SQM) per Engine
                </CardTitle>
                <CardDescription>
                  Spearman rank-order correlation between engine rankings and your preference ranking R
                </CardDescription>
              </CardHeader>
              <CardContent>
                {sqmChartData.length === 0 ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <p>No SQM data yet. Interact with search results to build quality scores.</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={sqmChartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="engine" className="text-xs" />
                      <YAxis domain={[-1, 1]} className="text-xs" />
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                        labelStyle={{ color: "hsl(var(--foreground))" }}
                      />
                      <Bar dataKey="score" name="SQM Score" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {learnedChartData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Top Learned Documents
                  </CardTitle>
                  <CardDescription>Documents with the highest learned importance scores from your feedback</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={learnedChartData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis type="number" className="text-xs" />
                      <YAxis type="category" dataKey="name" width={180} className="text-xs" />
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                        labelStyle={{ color: "hsl(var(--foreground))" }}
                      />
                      <Bar dataKey="score" name="Importance I(d)" fill="hsl(var(--chart-4))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── Search History Tab ── */}
          <TabsContent value="history" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="h-5 w-5" />
                  Search History
                </CardTitle>
                <CardDescription>Your recent searches — click to re-run a query</CardDescription>
              </CardHeader>
              <CardContent>
                {searchHistory.length === 0 ? (
                  <p className="text-muted-foreground py-8 text-center">No searches yet.</p>
                ) : (
                  <div className="space-y-2">
                    {searchHistory.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="font-medium text-foreground truncate">{item.query}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs text-muted-foreground">
                            {new Date(item.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <Button variant="outline" size="sm" onClick={() => handleRerunSearch(item.query)}>
                            Re-run
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Library Tab ── */}
          <TabsContent value="library" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookmarkIcon className="h-5 w-5" />
                  Saved & Bookmarked Documents
                </CardTitle>
                <CardDescription>Documents you've saved or bookmarked during search sessions</CardDescription>
              </CardHeader>
              <CardContent>
                {savedDocs.length === 0 ? (
                  <p className="text-muted-foreground py-8 text-center">No saved or bookmarked documents yet. Use the save/bookmark buttons on search results.</p>
                ) : (
                  <div className="space-y-2">
                    {savedDocs.map((doc) => (
                      <div key={doc.id} className="flex items-center justify-between rounded-lg border p-3">
                        <div className="min-w-0 flex-1">
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-primary hover:underline inline-flex items-center gap-1"
                          >
                            {doc.title}
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          <p className="text-xs text-muted-foreground truncate">{doc.url}</p>
                        </div>
                        <div className="flex gap-1 shrink-0 ml-2">
                          {doc.saved && <Badge variant="secondary" className="text-[10px]">Saved</Badge>}
                          {doc.bookmarked && <Badge variant="secondary" className="text-[10px]">Bookmarked</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Learning Index Tab ── */}
          <TabsContent value="learning" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Feedback Learning Index
                </CardTitle>
                <CardDescription>
                  Your personalized document index — acts as the (N+1)-th search source
                </CardDescription>
              </CardHeader>
              <CardContent>
                {learnedDocs.length === 0 ? (
                  <p className="text-muted-foreground py-8 text-center">No learned documents yet. Search and interact with results to build your index.</p>
                ) : (
                  <div className="space-y-2">
                    {learnedDocs.map((doc) => (
                      <div key={doc.id} className="flex items-center justify-between rounded-lg border p-3">
                        <div className="min-w-0 flex-1">
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-primary hover:underline inline-flex items-center gap-1"
                          >
                            {doc.title || doc.url}
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          {doc.snippet && (
                            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{doc.snippet}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          <Badge variant="outline" className="font-mono text-[10px]">
                            I(d) = {doc.learned_score.toFixed(3)}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(doc.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Admin Tab ── */}
          {isAdmin && (
            <TabsContent value="admin" className="space-y-6 mt-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                      <Users className="h-4 w-4" /> Total Users
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-foreground">{adminUserCount}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Total Searches</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-foreground">{adminSearchCount}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Engines Tracked</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-foreground">{adminSqm.length}</p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Aggregate SQM Across All Users
                  </CardTitle>
                  <CardDescription>Average search quality measures per engine system-wide</CardDescription>
                </CardHeader>
                <CardContent>
                  {adminSqm.length === 0 ? (
                    <p className="text-muted-foreground py-8 text-center">No aggregate SQM data available yet.</p>
                  ) : (
                    <div className="space-y-4">
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={adminSqm.map((s) => ({
                          engine: s.engine.charAt(0).toUpperCase() + s.engine.slice(1),
                          avg_score: Number(s.avg_score.toFixed(3)),
                          total_queries: s.total_queries,
                          user_count: s.user_count,
                        }))}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="engine" className="text-xs" />
                          <YAxis domain={[-1, 1]} className="text-xs" />
                          <Tooltip
                            contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                            labelStyle={{ color: "hsl(var(--foreground))" }}
                          />
                          <Legend />
                          <Bar dataKey="avg_score" name="Avg SQM Score" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                      <div className="border rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-muted/50">
                              <th className="text-left p-3 font-medium text-muted-foreground">Engine</th>
                              <th className="text-right p-3 font-medium text-muted-foreground">Avg SQM</th>
                              <th className="text-right p-3 font-medium text-muted-foreground">Total Queries</th>
                              <th className="text-right p-3 font-medium text-muted-foreground">Users</th>
                            </tr>
                          </thead>
                          <tbody>
                            {adminSqm.map((row) => (
                              <tr key={row.engine} className="border-t">
                                <td className="p-3 font-medium text-foreground capitalize">{row.engine}</td>
                                <td className="p-3 text-right font-mono text-foreground">{row.avg_score.toFixed(3)}</td>
                                <td className="p-3 text-right text-foreground">{row.total_queries}</td>
                                <td className="p-3 text-right text-foreground">{row.user_count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </main>
    </div>
  );
};

export default AnalyticsPage;
