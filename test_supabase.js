import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function test() {
  // Sign in with the user's token or just call the function if possible.
  // Wait, I don't have the user's password.
  console.log("Supabase URL:", supabaseUrl);
}

test();
