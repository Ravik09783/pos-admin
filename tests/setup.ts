// Global test setup. Stubs env vars that downstream modules expect at
// import time (Supabase client construction, Razorpay creds, etc.) so
// pure-logic tests don't need a real .env.
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://test.supabase.co"
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "test-anon-key"
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-role-key"
