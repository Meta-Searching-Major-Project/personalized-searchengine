
-- Role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  weight_v FLOAT NOT NULL DEFAULT 1.0,
  weight_t FLOAT NOT NULL DEFAULT 1.0,
  weight_p FLOAT NOT NULL DEFAULT 1.0,
  weight_s FLOAT NOT NULL DEFAULT 1.0,
  weight_b FLOAT NOT NULL DEFAULT 1.0,
  weight_e FLOAT NOT NULL DEFAULT 1.0,
  weight_c FLOAT NOT NULL DEFAULT 1.0,
  reading_speed FLOAT NOT NULL DEFAULT 10.0,
  default_aggregation_method TEXT NOT NULL DEFAULT 'borda',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- User roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'user',
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function for role checking
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Search history
CREATE TABLE public.search_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.search_history ENABLE ROW LEVEL SECURITY;

-- Search results (per engine per query)
CREATE TABLE public.search_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  search_history_id UUID NOT NULL REFERENCES public.search_history(id) ON DELETE CASCADE,
  engine TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  snippet TEXT,
  original_rank INT NOT NULL,
  aggregated_rank INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.search_results ENABLE ROW LEVEL SECURITY;

-- User feedback (7-tuple per document)
CREATE TABLE public.user_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  search_result_id UUID NOT NULL REFERENCES public.search_results(id) ON DELETE CASCADE,
  click_order INT,
  dwell_time_ms INT DEFAULT 0,
  printed BOOLEAN DEFAULT false,
  saved BOOLEAN DEFAULT false,
  bookmarked BOOLEAN DEFAULT false,
  emailed BOOLEAN DEFAULT false,
  copy_paste_chars INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;

-- Search quality measures (SQM per user per engine)
CREATE TABLE public.search_quality_measures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  engine TEXT NOT NULL,
  sqm_score FLOAT NOT NULL DEFAULT 0.0,
  query_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.search_quality_measures ENABLE ROW LEVEL SECURITY;

-- Feedback learning index (internal document index)
CREATE TABLE public.feedback_learning_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  snippet TEXT,
  learned_score FLOAT NOT NULL DEFAULT 0.0,
  query_matches TEXT[] DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.feedback_learning_index ENABLE ROW LEVEL SECURITY;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_feedback_updated_at BEFORE UPDATE ON public.user_feedback FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_sqm_updated_at BEFORE UPDATE ON public.search_quality_measures FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_learning_updated_at BEFORE UPDATE ON public.feedback_learning_index FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS Policies

-- Profiles: users own, admins read all
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- User roles: only admins manage, users read own
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Search history: user owns
CREATE POLICY "Users own search history" ON public.search_history FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Admins read search history" ON public.search_history FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Search results: via search_history ownership
CREATE POLICY "Users own search results" ON public.search_results FOR ALL 
USING (EXISTS (SELECT 1 FROM public.search_history WHERE id = search_results.search_history_id AND user_id = auth.uid()));
CREATE POLICY "Admins read search results" ON public.search_results FOR SELECT 
USING (public.has_role(auth.uid(), 'admin'));

-- User feedback: user owns
CREATE POLICY "Users own feedback" ON public.user_feedback FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Admins read feedback" ON public.user_feedback FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- SQM: user owns
CREATE POLICY "Users own sqm" ON public.search_quality_measures FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Admins read sqm" ON public.search_quality_measures FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Feedback learning index: user owns
CREATE POLICY "Users own learning index" ON public.feedback_learning_index FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Admins read learning index" ON public.feedback_learning_index FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
