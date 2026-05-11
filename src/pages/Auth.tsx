import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Search, Eye, EyeOff, ShieldCheck } from "lucide-react";

type Mode = "login" | "signup" | "forgot" | "reset";

// ── Security constants ────────────────────────────────────────────────────────
const MAX_ATTEMPTS = 5;          // lock after N failed sign-in attempts
const LOCKOUT_MS   = 5 * 60 * 1000; // 5-minute lockout
const MIN_PW_LEN   = 8;

// ── Password strength ─────────────────────────────────────────────────────────
function pwStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= MIN_PW_LEN)      score++;
  if (pw.length >= 12)              score++;
  if (/[A-Z]/.test(pw))            score++;
  if (/[0-9]/.test(pw))            score++;
  if (/[^A-Za-z0-9]/.test(pw))    score++;
  const map = [
    { label: "Too short",  color: "#ef4444" },
    { label: "Weak",       color: "#f97316" },
    { label: "Fair",       color: "#eab308" },
    { label: "Good",       color: "#22c55e" },
    { label: "Strong",     color: "#16a34a" },
    { label: "Very strong",color: "#15803d" },
  ];
  return { score, ...map[score] };
}

// ── Sanitise: strip leading/trailing whitespace, collapse inner spaces for name
const sanitizeEmail = (v: string) => v.trim().toLowerCase();
const sanitizeName  = (v: string) => v.trim().replace(/\s{2,}/g, " ").slice(0, 80);

const Auth = () => {
  const [mode, setMode]                 = useState<Mode>("login");
  const [email, setEmail]               = useState("");
  const [password, setPassword]         = useState("");
  const [newPassword, setNewPassword]   = useState("");
  const [displayName, setDisplayName]   = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showNew, setShowNew]           = useState(false);
  const [loading, setLoading]           = useState(false);

  // Rate-limiting state (stored in refs so we don't re-render on every attempt)
  const failCount  = useRef(0);
  const lockedUntil = useRef(0);
  const [lockMsg, setLockMsg] = useState("");

  const navigate = useNavigate();
  const { toast } = useToast();

  // Detect Supabase password-recovery redirect
  useEffect(() => {
    if (window.location.hash.includes("type=recovery")) setMode("reset");
  }, []);

  // Live lockout countdown
  useEffect(() => {
    if (!lockMsg) return;
    const id = setInterval(() => {
      const remaining = Math.ceil((lockedUntil.current - Date.now()) / 1000);
      if (remaining <= 0) { setLockMsg(""); clearInterval(id); }
      else setLockMsg(`Too many failed attempts. Try again in ${remaining}s.`);
    }, 1000);
    return () => clearInterval(id);
  }, [lockMsg]);

  const isLocked = () => Date.now() < lockedUntil.current;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isLocked()) {
      const s = Math.ceil((lockedUntil.current - Date.now()) / 1000);
      setLockMsg(`Too many failed attempts. Try again in ${s}s.`);
      return;
    }

    setLoading(true);

    try {
      // ── Set new password (recovery flow) ──────────────────────────────────
      if (mode === "reset") {
        const strength = pwStrength(newPassword);
        if (newPassword.length < MIN_PW_LEN) throw new Error(`Password must be at least ${MIN_PW_LEN} characters.`);
        if (strength.score < 2)              throw new Error("Password is too weak. Add uppercase letters, numbers or symbols.");
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;
        toast({ title: "Password updated", description: "You can now sign in with your new password." });
        navigate("/");
        return;
      }

      // ── Forgot password ───────────────────────────────────────────────────
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(sanitizeEmail(email), {
          redirectTo: `${window.location.origin}/auth`,
        });
        if (error) throw error;
        toast({ title: "Reset link sent", description: "Check your email for a password reset link." });
        setMode("login");
        return;
      }

      // ── Sign in ───────────────────────────────────────────────────────────
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: sanitizeEmail(email),
          password,
        });
        if (error) {
          failCount.current++;
          if (failCount.current >= MAX_ATTEMPTS) {
            lockedUntil.current = Date.now() + LOCKOUT_MS;
            failCount.current = 0;
            const s = Math.ceil(LOCKOUT_MS / 1000);
            setLockMsg(`Too many failed attempts. Try again in ${s}s.`);
            throw new Error("Account temporarily locked due to multiple failed attempts.");
          }
          // Generic error — don't reveal whether email or password was wrong
          throw new Error("Invalid email or password.");
        }
        failCount.current = 0;
        navigate("/");
        return;
      }

      // ── Sign up ───────────────────────────────────────────────────────────
      const strength = pwStrength(password);
      if (password.length < MIN_PW_LEN) throw new Error(`Password must be at least ${MIN_PW_LEN} characters.`);
      if (strength.score < 2)           throw new Error("Password is too weak. Add uppercase letters, numbers or symbols.");

      const { data, error } = await supabase.auth.signUp({
        email: sanitizeEmail(email),
        password,
        options: {
          emailRedirectTo: window.location.origin,
          data: { display_name: sanitizeName(displayName) || sanitizeEmail(email) },
        },
      });

      // Supabase returns a fake-success for already-registered emails to prevent
      // enumeration. We detect the "ghost" user (identities array is empty) and
      // surface a friendly message with a link to reset password instead.
      const isAlreadyRegistered =
        error?.message?.toLowerCase().includes("already registered") ||
        (data?.user && (data.user.identities?.length === 0));

      if (isAlreadyRegistered) {
        toast({
          title: "Email already registered",
          description: "This email is already linked to an account. Use Forgot Password to regain access.",
          variant: "destructive",
        });
        setMode("forgot");
        return;
      }

      if (error) throw error;

      toast({
        title: "Check your email",
        description: "We sent a confirmation link to verify your account.",
      });

    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const strength = mode === "signup" ? pwStrength(password) : mode === "reset" ? pwStrength(newPassword) : null;
  const activePw = mode === "reset" ? newPassword : password;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary">
            <Search className="h-6 w-6 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl font-bold">AMUSE</CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Aligarh Muslim University Search Engine
          </CardDescription>
          <CardDescription>
            {mode === "login"  ? "Sign in to your personalized search engine"
           : mode === "signup" ? "Create your account"
           : mode === "forgot" ? "Enter your email to receive a reset link"
           :                    "Set a new password"}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {/* Lockout banner */}
          {lockMsg && (
            <div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive font-medium text-center">
              {lockMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off" noValidate>

            {/* ── Reset mode: only new password ── */}
            {mode === "reset" ? (
              <PasswordField
                value={newPassword}
                show={showNew}
                onToggle={() => setShowNew(v => !v)}
                onChange={setNewPassword}
                placeholder="New password (min 8 chars)"
              />
            ) : (
              <>
                {mode === "signup" && (
                  <Input
                    placeholder="Display name"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    maxLength={80}
                    autoComplete="off"
                  />
                )}

                <Input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                />

                {mode !== "forgot" && (
                  <PasswordField
                    value={password}
                    show={showPassword}
                    onToggle={() => setShowPassword(v => !v)}
                    onChange={setPassword}
                    placeholder={mode === "login" ? "Password" : `Password (min ${MIN_PW_LEN} chars)`}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                  />
                )}
              </>
            )}

            {/* Password strength bar (signup + reset) */}
            {strength && activePw.length > 0 && (
              <StrengthBar strength={strength} />
            )}

            {/* Forgot password link */}
            {mode === "login" && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => setMode("forgot")}
                  className="text-xs text-primary underline-offset-4 hover:underline"
                >
                  Forgot password?
                </button>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading || isLocked()}>
              {loading ? "Loading…"
               : mode === "login"  ? "Sign In"
               : mode === "signup" ? "Sign Up"
               : mode === "forgot" ? "Send Reset Link"
               :                    "Set New Password"}
            </Button>
          </form>

          {/* Secure badge */}
          <div className="mt-3 flex items-center justify-center gap-1 text-xs text-muted-foreground">
            <ShieldCheck className="h-3 w-3" />
            Secured with Supabase Auth &amp; rate limiting
          </div>

          {/* Mode switcher */}
          <div className="mt-3 text-center text-sm text-muted-foreground">
            {mode === "forgot" ? (
              <>Remembered it?{" "}
                <ModeBtn onClick={() => setMode("login")}>Sign in</ModeBtn>
              </>
            ) : mode === "login" ? (
              <>Don't have an account?{" "}
                <ModeBtn onClick={() => setMode("signup")}>Sign up</ModeBtn>
              </>
            ) : mode === "signup" ? (
              <>Already have an account?{" "}
                <ModeBtn onClick={() => setMode("login")}>Sign in</ModeBtn>
              </>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────────

interface PFProps {
  value: string;
  show: boolean;
  onToggle: () => void;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
}
const PasswordField = ({ value, show, onToggle, onChange, placeholder = "Password", autoComplete = "current-password" }: PFProps) => (
  <div className="relative">
    <Input
      type={show ? "text" : "password"}
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
      required
      minLength={MIN_PW_LEN}
      className="pr-10"
      autoComplete={autoComplete}
    />
    <button
      type="button"
      onClick={onToggle}
      tabIndex={-1}
      aria-label={show ? "Hide password" : "Show password"}
      className="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
    >
      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  </div>
);

const StrengthBar = ({ strength }: { strength: ReturnType<typeof pwStrength> }) => (
  <div className="space-y-1">
    <div className="flex gap-1">
      {[1,2,3,4,5].map(i => (
        <div
          key={i}
          className="h-1 flex-1 rounded-full transition-all duration-300"
          style={{ background: i <= strength.score ? strength.color : "#e5e7eb" }}
        />
      ))}
    </div>
    <p className="text-xs" style={{ color: strength.color }}>{strength.label}</p>
  </div>
);

const ModeBtn = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button type="button" onClick={onClick} className="text-primary underline-offset-4 hover:underline">
    {children}
  </button>
);

export default Auth;
