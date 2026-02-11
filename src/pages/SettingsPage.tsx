import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import AppHeader from "@/components/AppHeader";

const WEIGHT_LABELS = [
  { key: "weight_v", label: "Click Order (wV)", desc: "Weight for click sequence importance" },
  { key: "weight_t", label: "Dwell Time (wT)", desc: "Weight for time spent on document" },
  { key: "weight_p", label: "Print (wP)", desc: "Weight for printing a document" },
  { key: "weight_s", label: "Save (wS)", desc: "Weight for saving a document" },
  { key: "weight_b", label: "Bookmark (wB)", desc: "Weight for bookmarking" },
  { key: "weight_e", label: "Email (wE)", desc: "Weight for sharing via email" },
  { key: "weight_c", label: "Copy-Paste (wC)", desc: "Weight for text copy actions" },
] as const;

const AGGREGATION_METHODS = [
  { value: "borda", label: "Borda's Method" },
  { value: "shimura", label: "Shimura's Fuzzy Ordering" },
  { value: "modal", label: "Modal Value Method" },
  { value: "mfo", label: "Membership Function Ordering (MFO)" },
  { value: "mbv", label: "Mean-by-Variance (MBV)" },
  { value: "owa", label: "OWA-improved Shimura" },
  { value: "biased", label: "Biased Rank Aggregation" },
];

type ProfileWeights = {
  weight_v: number;
  weight_t: number;
  weight_p: number;
  weight_s: number;
  weight_b: number;
  weight_e: number;
  weight_c: number;
  reading_speed: number;
  default_aggregation_method: string;
};

const SettingsPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [profile, setProfile] = useState<ProfileWeights | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("weight_v, weight_t, weight_p, weight_s, weight_b, weight_e, weight_c, reading_speed, default_aggregation_method")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (data) setProfile(data);
      });
  }, [user]);

  const handleSave = async () => {
    if (!user || !profile) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").update(profile).eq("id", user.id);
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Saved", description: "Your preferences have been updated." });
    }
  };

  if (!profile) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <div className="flex items-center justify-center p-8 text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-2xl p-4 space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>

        <Card>
          <CardHeader>
            <CardTitle>Feedback Weights</CardTitle>
            <CardDescription>
              Adjust the importance of each implicit feedback signal (0–2). These weights determine how your preference ranking R is computed per the paper's formula.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {WEIGHT_LABELS.map(({ key, label, desc }) => (
              <div key={key} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{label}</Label>
                  <span className="text-sm font-mono text-muted-foreground">
                    {(profile[key as keyof ProfileWeights] as number).toFixed(1)}
                  </span>
                </div>
                <Slider
                  min={0}
                  max={2}
                  step={0.1}
                  value={[profile[key as keyof ProfileWeights] as number]}
                  onValueChange={([v]) => setProfile({ ...profile, [key]: v })}
                />
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reading Speed</CardTitle>
            <CardDescription>
              Your reading speed in bytes/second (paper default: 10). Used to normalize dwell time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Slider
                min={1}
                max={50}
                step={1}
                value={[profile.reading_speed]}
                onValueChange={([v]) => setProfile({ ...profile, reading_speed: v })}
                className="flex-1"
              />
              <span className="text-sm font-mono w-16 text-right text-muted-foreground">
                {profile.reading_speed} B/s
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Default Aggregation Method</CardTitle>
            <CardDescription>Choose the rank aggregation algorithm for search results.</CardDescription>
          </CardHeader>
          <CardContent>
            <Select
              value={profile.default_aggregation_method}
              onValueChange={(v) => setProfile({ ...profile, default_aggregation_method: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGGREGATION_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Button onClick={handleSave} disabled={saving} className="w-full">
          {saving ? "Saving..." : "Save Preferences"}
        </Button>
      </main>
    </div>
  );
};

export default SettingsPage;
