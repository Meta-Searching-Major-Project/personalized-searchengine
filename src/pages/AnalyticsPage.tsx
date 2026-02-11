import AppHeader from "@/components/AppHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";

const AnalyticsPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-4xl p-4 space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Search Quality Measures
            </CardTitle>
            <CardDescription>
              SQM scores per engine will appear here after you perform searches and interact with results.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <p>No search data yet. Start searching to build your quality profile.</p>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default AnalyticsPage;
