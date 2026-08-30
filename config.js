// Fill these in from your Supabase project settings:
// Project Settings -> API -> Project URL / anon public key
// This is safe to expose publicly - it's the anon key, restricted by Row Level Security.

const SUPABASE_URL = "https://hsjfswuyyzymvbjasiin.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ENqGt6BGRnNx5n2EBlZ_eg_aL4qGCik";

// Study Suite's own, separate Supabase project. Deck reads from this
// project (never writes) to show live study stats. It's a different auth
// system from Deck's own sign-in above, so Deck needs its own session with
// Study Suite - see the "Connect Study Suite" form on the Study panel.
const STUDY_SUPABASE_URL = "https://mxlsfidugngggzfkongg.supabase.co";
const STUDY_SUPABASE_ANON_KEY = "sb_publishable_d3yFH07rNB8_R6nxDuh1Aw_oVmD1GMl";
 
