-- Add a permissive policy requiring authentication for profile access
CREATE POLICY "Require authentication for profile access"
ON public.profiles
FOR SELECT
USING (auth.uid() IS NOT NULL);