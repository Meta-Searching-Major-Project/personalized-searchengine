import fetch from 'node-fetch';

const SUPABASE_URL = "https://tqczpxsrtymzmjmacqip.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxY3pweHNydHltem1qbWFjcWlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NDkwMjAsImV4cCI6MjA5MjAyNTAyMH0.DEuVe19y5rI-1b2esNQ7rqqQjgLZFDasYAAV4R24i1U";

// I need the user's access token to insert rows because of RLS.
// Wait, the anon key is NOT the user token!
